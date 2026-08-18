#!/usr/bin/env node
/**
 * Offline harness for the family layout: runs FamilyLayout over a dataset and
 * writes an SVG that mirrors what cytoscape draws, plus a quality report.
 *
 *   node tools/render-layout.js [data.json] [out.html]
 */
const fs = require('fs');
const path = require('path');
const FamilyLayout = require('../layout.js');

const dataFile = process.argv[2] || path.join(__dirname, '..', 'local-data', 'prod-people.json');
const outFile = process.argv[3] || path.join(__dirname, '..', 'local-data', 'layout-preview.html');

const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const people = raw.people || raw;

// Mirror the cytoscape node styles closely enough for layout purposes.
const CHAR = 7.1, MAX_TEXT = 120;
function labelLines(p) {
  return p.birthYear ? [p.name, String(p.birthYear)] : [p.name];
}
function sizeOf(id) {
  const p = people[id];
  const text = Math.min(MAX_TEXT, Math.max(...labelLines(p).map(l => l.length * CHAR)));
  if (p.photo) return { w: Math.max(60, Math.min(MAX_TEXT, text)), h: 60 };
  return { w: text + 20, h: 32 };
}

const t0 = Date.now();
const L = FamilyLayout.compute(people, { size: sizeOf });
const ms = Date.now() - t0;

// ── quality report ────────────────────────────────────────────────────────
const report = { people: Object.keys(people).length, unions: L.unions.length, rows: L.rows.length, ms };
let below = 0, spouseRowMismatch = [], spouseFar = [], seen = new Set();
for (const id in people) {
  for (const par of [people[id].parent1, people[id].parent2]) {
    if (par && people[par] && L.layers[par] >= L.layers[id]) below++;
  }
  const q = people[id].partner;
  if (q && people[q]) {
    const k = [id, q].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    if (L.layers[id] !== L.layers[q]) spouseRowMismatch.push(`${people[id].name} / ${people[q].name}`);
    else {
      const gap = Math.abs(L.pos[id].x - L.pos[q].x) - (sizeOf(id).w + sizeOf(q).w) / 2;
      if (gap > 40) spouseFar.push(`${people[id].name} / ${people[q].name} (${Math.round(gap)}px apart)`);
    }
  }
}
report.parentNotAboveChild = below;
report.spousesOnDifferentRows = spouseRowMismatch;
report.spousesNotAdjacent = spouseFar;

// segment-crossing count over the drawn edges
const segs = [];
for (const u of L.unions) {
  if (u.parents.length === 2) {
    segs.push([L.pos[u.parents[0]].x, L.pos[u.parents[0]].y, L.pos[u.parents[1]].x, L.pos[u.parents[1]].y]);
  }
  for (const c of u.children) {
    segs.push([u.x, u.y, u.x, u.barY]);
    segs.push([u.x, u.barY, L.pos[c].x, u.barY]);
    segs.push([L.pos[c].x, u.barY, L.pos[c].x, L.pos[c].y]);
  }
}
function crosses(a, b) {
  const d = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const A = [a[0], a[1]], B = [a[2], a[3]], C = [b[0], b[1]], D = [b[2], b[3]];
  if ((A[0] === C[0] && A[1] === C[1]) || (A[0] === D[0] && A[1] === D[1]) ||
      (B[0] === C[0] && B[1] === C[1]) || (B[0] === D[0] && B[1] === D[1])) return false;
  return d(A, B, C) * d(A, B, D) < 0 && d(C, D, A) * d(C, D, B) < 0;
}
let cross = 0;
for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (crosses(segs[i], segs[j])) cross++;
report.edgeCrossings = cross;

// node overlaps
let overlaps = [];
const idsByRow = {};
for (const id in people) (idsByRow[L.layers[id]] = idsByRow[L.layers[id]] || []).push(id);
for (const r in idsByRow) {
  const row = idsByRow[r].sort((a, b) => L.pos[a].x - L.pos[b].x);
  for (let i = 1; i < row.length; i++) {
    const gap = (L.pos[row[i]].x - sizeOf(row[i]).w / 2) - (L.pos[row[i - 1]].x + sizeOf(row[i - 1]).w / 2);
    if (gap < -0.5) overlaps.push(`${people[row[i - 1]].name} / ${people[row[i]].name} (${Math.round(gap)}px)`);
  }
}
report.overlaps = overlaps;
report.size = `${Math.round(L.width)} x ${Math.round(L.height)}`;
console.log(JSON.stringify(report, null, 2));

// ── SVG ───────────────────────────────────────────────────────────────────
const GEN_COLORS = ['#2ecc71', '#3498db', '#9b59b6', '#e67e22', '#e74c3c', '#1abc9c', '#f39c12', '#8e44ad'];
const PAD = 40;
function wrapText(text, maxPx) {
  const words = String(text).split(' '), lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length * CHAR > maxPx && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let svg = '';

for (const u of L.unions) {
  for (const c of u.children) {
    const cx = L.pos[c].x, cy = L.pos[c].y - sizeOf(c).h / 2;
    svg += `<path d="M ${u.x} ${u.y} V ${u.barY} H ${cx} V ${cy}" fill="none" stroke="#8b8b8b" stroke-width="2"/>`;
  }
  if (u.parents.length === 2) {
    const [a, b] = u.parents;
    svg += `<line x1="${L.pos[a].x}" y1="${L.pos[a].y}" x2="${L.pos[b].x}" y2="${L.pos[b].y}" stroke="#e74c3c" stroke-width="2.5"/>`;
  }
}
for (const id in people) {
  const p = people[id], s = sizeOf(id), { x, y } = L.pos[id];
  const color = GEN_COLORS[(L.maxLayer - L.layers[id]) % GEN_COLORS.length];
  if (p.photo) {
    svg += `<circle cx="${x}" cy="${y}" r="${30}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    wrapText(p.name, MAX_TEXT).forEach((line, i) => {
      svg += `<text x="${x}" y="${y + 46 + i * 13}" fill="#ddd" font-size="12" text-anchor="middle" font-family="system-ui">${esc(line)}</text>`;
    });
  } else {
    svg += `<rect x="${x - s.w / 2}" y="${y - s.h / 2}" width="${s.w}" height="${s.h}" rx="7" fill="${color}"/>`;
    svg += `<text x="${x}" y="${y + (p.birthYear ? -1 : 5)}" fill="#fff" font-size="13" text-anchor="middle" font-family="system-ui">${esc(p.name)}</text>`;
    if (p.birthYear) svg += `<text x="${x}" y="${y + 12}" fill="#ffffffcc" font-size="11" text-anchor="middle" font-family="system-ui">${esc(p.birthYear)}</text>`;
  }
}

// --region x,y,w,h and --scale N let the harness zoom into part of the graph
const regionArg = (process.argv.find(a => a.startsWith('--region=')) || '').split('=')[1];
const scale = parseFloat((process.argv.find(a => a.startsWith('--scale=')) || '=1').split('=')[1]) || 1;
let vb = [-PAD, -PAD, Math.round(L.width + PAD * 2), Math.round(L.height + PAD * 2 + 30)];
if (regionArg) vb = regionArg.split(',').map(Number);
const W = Math.round(vb[2] * scale), H = Math.round(vb[3] * scale);
fs.writeFileSync(outFile,
`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1e1e1e">
<svg width="${W}" height="${H}" viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>
</body>`);
console.log('wrote', outFile, `${W}x${H}`);
