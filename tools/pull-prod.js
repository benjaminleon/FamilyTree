#!/usr/bin/env node
/**
 * Copy a tree out of production into the local dev database, so layout work
 * can be done against real data.
 *
 *   node tools/pull-prod.js <TREECODE> [--from=https://familjen.fly.dev]
 *                           [--db=postgres://ft:ftpass@localhost:5432/familytree]
 *
 * The tree lands locally under the same code, so http://localhost:3100/tree/<CODE>
 * shows the same tree as production. The downloaded JSON is cached in
 * local-data/ (git-ignored — it holds real names and photos).
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const code = (process.argv[2] || '').toUpperCase();
const arg = (n, d) => {
  const a = process.argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const origin = arg('from', 'https://familjen.fly.dev');
const dbUrl = arg('db', process.env.DATABASE_URL || 'postgres://ft:ftpass@localhost:5432/familytree');
const dataDir = path.join(__dirname, '..', 'local-data');

if (!/^[A-F0-9]{6}$/.test(code)) {
  console.error('usage: node tools/pull-prod.js <TREECODE>   (6 hex chars, as shown in the app)');
  process.exit(1);
}

async function main() {
  const tree = await fetch(`${origin}/api/trees/join/${code}`).then(r => {
    if (!r.ok) throw new Error(`no tree ${code} at ${origin} (${r.status})`);
    return r.json();
  });
  const data = await fetch(`${origin}/api/trees/${tree.id}/people`).then(r => r.json());
  const people = Object.values(data.people);

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'prod-people.json'), JSON.stringify(data, null, 1));
  console.log(`fetched ${people.length} people from ${origin} (${tree.name})`);

  const localId = 'prod-' + code;
  const pool = new Pool({ connectionString: dbUrl });
  await pool.query(
    `INSERT INTO trees (id, code, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name`,
    [localId, code, tree.name]
  );
  await pool.query('DELETE FROM people WHERE tree_id = $1', [localId]);
  await pool.query('DELETE FROM meta WHERE tree_id = $1', [localId]);
  await pool.query("INSERT INTO meta (tree_id, key, value) VALUES ($1, 'nextId', $2)", [localId, String(data.nextId)]);
  for (const p of people) {
    await pool.query(
      `INSERT INTO people (id, tree_id, name, parent1, parent2, partner, birth_year, notes, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, localId, p.name, p.parent1, p.parent2, p.partner, p.birthYear || '', p.notes || '', p.photo]
    );
  }
  await pool.end();
  console.log(`imported into local db as tree ${localId} — open /tree/${code}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
