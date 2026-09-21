const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Wait for Postgres to be ready
async function waitForDb() {
  for (let i = 0; i < 20; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Database connected');
      return;
    } catch (e) {
      console.log('Waiting for database...');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Database not available');
}

// Generate a short unique code (6 chars, uppercase alphanumeric)
function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Helpers
function rowToPerson(row) {
  return {
    id: row.id,
    name: row.name,
    parent1: row.parent1,
    parent2: row.parent2,
    partner: row.partner,
    birthYear: row.birth_year,
    notes: row.notes,
    photo: row.photo,
  };
}

async function getTreeState(treeId) {
  const [peopleRes, metaRes] = await Promise.all([
    pool.query('SELECT * FROM people WHERE tree_id = $1', [treeId]),
    pool.query("SELECT value FROM meta WHERE tree_id = $1 AND key = 'nextId'", [treeId]),
  ]);
  const people = {};
  for (const row of peopleRes.rows) {
    people[row.id] = rowToPerson(row);
  }
  const nextId = parseInt(metaRes.rows[0]?.value || '1', 10);
  return { nextId, people };
}

// Broadcast to all WebSocket clients subscribed to a specific tree
function broadcast(treeId, data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.treeId === treeId && client.readyState === 1) {
      client.send(msg);
    }
  }
}

// WebSocket: client sends { type: "join", treeId } to subscribe
wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'join' && msg.treeId) {
        ws.treeId = msg.treeId;
        const state = await getTreeState(msg.treeId);
        ws.send(JSON.stringify({ type: 'state:full', data: state }));
      }
    } catch (e) {
      console.error('WS message error:', e.message);
    }
  });
});

// ── Tree management ──

// Create a new tree
app.post('/api/trees', async (req, res) => {
  try {
    const id = crypto.randomUUID();
    const code = generateCode();
    const name = req.body.name || 'My Family Tree';
    await pool.query('INSERT INTO trees (id, code, name) VALUES ($1, $2, $3)', [id, code, name]);
    await pool.query("INSERT INTO meta (tree_id, key, value) VALUES ($1, 'nextId', '1')", [id]);
    res.json({ id, code, name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Join a tree by code
app.get('/api/trees/join/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query('SELECT id, code, name FROM trees WHERE code = $1', [code.toUpperCase()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tree not found' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── People (all scoped to a tree) ──

app.get('/api/trees/:treeId/people', async (req, res) => {
  try {
    const state = await getTreeState(req.params.treeId);
    res.json(state);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A refusal that still needs the transaction unwound, so it travels as an
// error rather than an early return.
function reject(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Create a person, optionally wired into the tree in the same request.
// `attach` is { relation, anchorId, withPartner } where relation is one of
// child | parent | partner | sibling, described from the new person's side.
// Doing it here rather than as a follow-up PUT means a new relative is never
// briefly visible as a stray unconnected node, and one broadcast carries it.
app.post('/api/trees/:treeId/people', async (req, res) => {
  const client = await pool.connect();
  try {
    const { treeId } = req.params;
    const { name, birthYear, attach } = req.body;

    const rel = attach && attach.relation;
    if (rel && ['child', 'parent', 'partner', 'sibling'].indexOf(rel) === -1) {
      return res.status(400).json({ error: 'Unknown relation: ' + rel });
    }

    await client.query('BEGIN');

    // Two people on two phones can be filling in the same relative at once,
    // so the anchor is read and held inside the transaction — checking first
    // and writing afterwards would let both pass the same guard.
    let anchor = null;
    if (rel) {
      const a = await client.query(
        'SELECT * FROM people WHERE tree_id = $1 AND id = $2 FOR UPDATE', [treeId, attach.anchorId]);
      if (!a.rows.length) throw reject(404, 'That person is no longer in the tree.');
      anchor = rowToPerson(a.rows[0]);
      if (rel === 'partner' && anchor.partner) {
        throw reject(409, anchor.name + ' already has a partner. Remove it first.');
      }
      if (rel === 'parent' && anchor.parent1 && anchor.parent2) {
        throw reject(409, anchor.name + ' already has two parents. Remove one first.');
      }
      if (rel === 'sibling' && !anchor.parent1 && !anchor.parent2) {
        throw reject(400, 'Give ' + anchor.name + ' a parent first — a sibling is someone who shares them.');
      }
    }

    let parent1 = null, parent2 = null, partner = null;
    if (rel === 'child') {
      parent1 = anchor.id;
      if (attach.withPartner && anchor.partner) parent2 = anchor.partner;
    } else if (rel === 'sibling') {
      parent1 = anchor.parent1;
      parent2 = anchor.parent2;
    } else if (rel === 'partner') {
      partner = anchor.id;
    }

    const metaRes = await client.query(
      "UPDATE meta SET value = (value::int + 1)::text WHERE tree_id = $1 AND key = 'nextId' RETURNING value",
      [treeId]
    );
    const id = 'p' + (parseInt(metaRes.rows[0].value, 10) - 1);
    await client.query(
      `INSERT INTO people (id, tree_id, name, birth_year, parent1, parent2, partner)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, treeId, name || 'Unnamed', birthYear || '', parent1, parent2, partner]
    );

    // The other half of a two-sided link lives on the anchor.
    let anchorCol = null;
    if (rel === 'partner') anchorCol = 'partner';
    else if (rel === 'parent') anchorCol = anchor.parent1 ? 'parent2' : 'parent1';
    if (anchorCol) {
      await client.query(
        `UPDATE people SET ${anchorCol} = $1 WHERE tree_id = $2 AND id = $3`,
        [id, treeId, anchor.id]
      );
    }
    await client.query('COMMIT');

    const person = { id, name: name || 'Unnamed', parent1, parent2, partner, birthYear: birthYear || '', notes: '', photo: null };
    broadcast(treeId, { type: 'person:created', person });

    let updatedAnchor = null;
    if (anchorCol) {
      const row = await client.query('SELECT * FROM people WHERE tree_id = $1 AND id = $2', [treeId, anchor.id]);
      updatedAnchor = rowToPerson(row.rows[0]);
      broadcast(treeId, { type: 'person:updated', person: updatedAnchor });
    }
    res.json({ person, anchor: updatedAnchor });
  } catch (e) {
    await client.query('ROLLBACK').catch(function () {});
    res.status(e.status || 500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.put('/api/trees/:treeId/people/:id', async (req, res) => {
  try {
    const { treeId, id } = req.params;
    const fields = req.body;
    const sets = [];
    const vals = [];
    let i = 1;

    const fieldMap = { name: 'name', birthYear: 'birth_year', notes: 'notes', photo: 'photo', parent1: 'parent1', parent2: 'parent2', partner: 'partner' };
    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (jsKey in fields) {
        sets.push(`${dbCol} = $${i++}`);
        vals.push(fields[jsKey]);
      }
    }
    if (sets.length === 0) return res.json({ ok: true });

    vals.push(treeId, id);
    await pool.query(`UPDATE people SET ${sets.join(', ')} WHERE tree_id = $${i} AND id = $${i + 1}`, vals);

    const row = await pool.query('SELECT * FROM people WHERE tree_id = $1 AND id = $2', [treeId, id]);
    if (row.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const person = rowToPerson(row.rows[0]);
    broadcast(treeId, { type: 'person:updated', person });
    res.json(person);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/trees/:treeId/people/:id', async (req, res) => {
  try {
    const { treeId, id } = req.params;
    const childrenRes = await pool.query(
      'SELECT id FROM people WHERE tree_id = $1 AND (parent1 = $2 OR parent2 = $3)', [treeId, id, id]
    );
    const affectedChildren = childrenRes.rows.map(r => r.id);

    // Manually nullify parent/partner refs since we have composite keys
    await pool.query('UPDATE people SET parent1 = NULL WHERE tree_id = $1 AND parent1 = $2', [treeId, id]);
    await pool.query('UPDATE people SET parent2 = NULL WHERE tree_id = $1 AND parent2 = $2', [treeId, id]);
    await pool.query('UPDATE people SET partner = NULL WHERE tree_id = $1 AND partner = $2', [treeId, id]);
    await pool.query('DELETE FROM people WHERE tree_id = $1 AND id = $2', [treeId, id]);

    broadcast(treeId, { type: 'person:deleted', id, affectedChildren });
    res.json({ ok: true, affectedChildren });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve index.html for /tree/:code URLs (shareable links)
app.get('/tree/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;

waitForDb().then(async () => {
  // Migration: add partner column if missing
  await pool.query(`ALTER TABLE people ADD COLUMN IF NOT EXISTS partner TEXT`).catch(e => console.error('Migration failed:', e.message));
  server.listen(PORT, '0.0.0.0', () => console.log(`Server running on 0.0.0.0:${PORT}`));
}).catch(e => {
  console.error(e.message);
  process.exit(1);
});
