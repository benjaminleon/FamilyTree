/**
 * FamilyLayout — a layered ("Sugiyama style") layout specialised for family trees.
 *
 * Generic layered layouts (dagre & co.) know nothing about marriage, so they
 * scatter spouses across a row and drop children wherever the ranking happens
 * to land. This engine works on *family units* instead of individuals:
 *
 *   1. unions  — every distinct set of co-parents, plus childless couples
 *   2. layers  — generations: parents strictly above children, spouses level
 *   3. order   — per-row ordering that keeps spouses adjacent and cuts crossings
 *   4. x       — priority method: children centred under their parents' union
 *
 * It has no DOM/cytoscape dependency so it can be exercised in node — see
 * tools/render-layout.js for the SVG harness.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FamilyLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    spouseGap: 26,        // between the two halves of a couple
    nodeGap: 44,          // between unrelated people / sibling groups
    tightGap: 20,         // around junction points and long-edge corridors
    rowGap: 76,           // vertical space between generations
    componentGap: 140,    // between disconnected families
    trunk: 30,            // drop from the marriage bar down to the sibling bar
    barStagger: 11,       // extra drop for sibling bars that would otherwise merge
    defaultWidth: 96,
    defaultHeight: 32,
    orderIterations: 16,
    xIterations: 16,
    costCrossing: 300,    // how many px of stray sibling bar one crossing is worth
    costWidth: 0.5,
  };

  // ── generic helpers ──────────────────────────────────────────────────────

  // Weighted median (Gansner et al.) — biases towards the denser side.
  function medianOf(values) {
    if (!values.length) return -1;
    values.sort(function (a, b) { return a - b; });
    var m = values.length >> 1;
    if (values.length % 2 === 1) return values[m];
    if (values.length === 2) return (values[0] + values[1]) / 2;
    var left = values[m - 1] - values[0];
    var right = values[values.length - 1] - values[m];
    return (values[m - 1] * right + values[m] * left) / (left + right || 1);
  }

  function average(values) {
    var s = 0;
    for (var i = 0; i < values.length; i++) s += values[i];
    return s / values.length;
  }

  // Crossings between two adjacent ranks, counted as inversions with a BIT.
  function countCrossings(upper, lower) {
    var seq = [];
    for (var i = 0; i < upper.length; i++) {
      var targets = [];
      for (var j = 0; j < upper[i].down.length; j++) targets.push(upper[i].down[j].idx);
      targets.sort(function (a, b) { return a - b; });
      for (var k = 0; k < targets.length; k++) seq.push(targets[k]);
    }
    var n = lower.length, tree = new Array(n + 2), cross = 0, x;
    for (var t = 0; t < tree.length; t++) tree[t] = 0;
    for (var s = seq.length - 1; s >= 0; s--) {
      for (x = seq[s]; x > 0; x -= x & -x) cross += tree[x];
      for (x = seq[s] + 1; x <= n; x += x & -x) tree[x]++;
    }
    return cross;
  }

  // Crossings contributed by two neighbouring items, given `a` sits left of `b`.
  function pairCrossings(a, b, dir) {
    var av = [], bv = [], i, j, c = 0;
    for (i = 0; i < a.nodes.length; i++) {
      var an = a.nodes[i][dir];
      for (j = 0; j < an.length; j++) av.push(an[j].idx);
    }
    for (i = 0; i < b.nodes.length; i++) {
      var bn = b.nodes[i][dir];
      for (j = 0; j < bn.length; j++) bv.push(bn[j].idx);
    }
    for (i = 0; i < av.length; i++) for (j = 0; j < bv.length; j++) if (av[i] > bv[j]) c++;
    return c;
  }

  // ── main ─────────────────────────────────────────────────────────────────

  function compute(people, opts) {
    opts = opts || {};
    var cfg = {}, key;
    for (key in DEFAULTS) cfg[key] = (opts[key] !== undefined) ? opts[key] : DEFAULTS[key];
    var sizeOf = opts.size || function () { return null; };

    // A stable id order keeps the drawing from reshuffling just because the
    // server handed the rows back differently.
    var ids = Object.keys(people).sort(function (a, b) {
      return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    });
    if (!ids.length) return { layers: {}, maxLayer: 0, rows: [], pos: {}, unions: [], width: 0, height: 0 };

    var size = {};
    ids.forEach(function (id) {
      var s = sizeOf(id) || {};
      size[id] = {
        w: s.w > 0 ? s.w : cfg.defaultWidth,
        h: s.h > 0 ? s.h : cfg.defaultHeight,
      };
    });

    function birthKey(id) {
      var y = parseInt((people[id].birthYear || '').slice(0, 4), 10);
      return isNaN(y) ? 99999 : y;
    }

    // ── 1. Relationships & unions ──────────────────────────────────────────

    var parentsOf = {}, childrenOf = {};
    ids.forEach(function (id) { childrenOf[id] = []; });
    ids.forEach(function (id) {
      var p = people[id], out = [];
      [p.parent1, p.parent2].forEach(function (par) {
        if (par && people[par] && par !== id && out.indexOf(par) === -1) out.push(par);
      });
      parentsOf[id] = out;
      out.forEach(function (par) { childrenOf[par].push(id); });
    });

    var unions = [], unionByKey = {};
    function unionFor(parents) {
      var k = parents.slice().sort().join('+');
      if (!unionByKey[k]) {
        unionByKey[k] = { id: 'u:' + k, parents: parents.slice().sort(), children: [] };
        unions.push(unionByKey[k]);
      }
      return unionByKey[k];
    }
    ids.forEach(function (id) {
      if (parentsOf[id].length) unionFor(parentsOf[id]).children.push(id);
    });
    // A couple with no (visible) children still forms a unit worth keeping together.
    ids.forEach(function (id) {
      var p = people[id];
      if (p.partner && people[p.partner] && p.partner !== id) unionFor([id, p.partner]);
    });
    unions.forEach(function (u) {
      u.children.sort(function (a, b) { return birthKey(a) - birthKey(b); });
    });

    var unionsAsParent = {};
    ids.forEach(function (id) { unionsAsParent[id] = []; });
    unions.forEach(function (u) {
      u.parents.forEach(function (par) { unionsAsParent[par].push(u); });
    });

    // ── 2. Layers ──────────────────────────────────────────────────────────
    // Pairs that belong on the same row: spouses, and anyone sharing a child.
    // Skipped when one is an ancestor of the other (bad data would otherwise
    // make the relaxation below diverge).

    function isAncestor(a, b) {
      var stack = parentsOf[b].slice(), seen = {};
      while (stack.length) {
        var cur = stack.pop();
        if (cur === a) return true;
        if (seen[cur]) continue;
        seen[cur] = 1;
        for (var i = 0; i < parentsOf[cur].length; i++) stack.push(parentsOf[cur][i]);
      }
      return false;
    }

    var levelPairs = [];
    unions.forEach(function (u) { if (u.parents.length === 2) levelPairs.push(u.parents); });
    ids.forEach(function (id) {
      var p = people[id];
      if (p.partner && people[p.partner] && id < p.partner) levelPairs.push([id, p.partner]);
    });
    levelPairs = levelPairs.filter(function (pr) {
      return !isAncestor(pr[0], pr[1]) && !isAncestor(pr[1], pr[0]);
    });

    var uf = {};
    ids.forEach(function (id) { uf[id] = id; });
    function find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
    function unite(a, b) { a = find(a); b = find(b); if (a !== b) uf[a] = b; }
    levelPairs.forEach(function (pr) { unite(pr[0], pr[1]); });

    var members = {};
    ids.forEach(function (id) {
      var g = find(id);
      (members[g] = members[g] || []).push(id);
    });
    var groups = Object.keys(members);
    var groupLayer = {};
    groups.forEach(function (g) { groupLayer[g] = 0; });
    function layerOfGroup(id) { return groupLayer[find(id)]; }

    // Longest path downwards: a child is always at least one row below every
    // parent, and a whole couple moves as one — that is what pulls married-in
    // spouses (who have no parents of their own) down to their partner's row.
    var pass, changed, guard = ids.length + 4;
    for (pass = 0; pass < guard; pass++) {
      changed = false;
      groups.forEach(function (g) {
        var want = groupLayer[g];
        members[g].forEach(function (id) {
          parentsOf[id].forEach(function (par) {
            want = Math.max(want, layerOfGroup(par) + 1);
          });
        });
        if (want > groupLayer[g]) { groupLayer[g] = want; changed = true; }
      });
      if (!changed) break;
    }

    // Compaction: nobody should float far above their children. Slide each
    // group down until it sits directly on top of its earliest child.
    var childGroups = {};
    groups.forEach(function (g) { childGroups[g] = {}; });
    ids.forEach(function (id) {
      parentsOf[id].forEach(function (par) { childGroups[find(par)][find(id)] = 1; });
    });
    for (pass = 0; pass < guard; pass++) {
      changed = false;
      groups.forEach(function (g) {
        var lowest = Infinity;
        for (var cg in childGroups[g]) lowest = Math.min(lowest, groupLayer[cg] - 1);
        if (lowest !== Infinity && lowest > groupLayer[g]) { groupLayer[g] = lowest; changed = true; }
      });
      if (!changed) break;
    }

    var layers = {}, minLayer = Infinity;
    ids.forEach(function (id) {
      layers[id] = layerOfGroup(id);
      minLayer = Math.min(minLayer, layers[id]);
    });
    var maxLayer = 0;
    ids.forEach(function (id) {
      layers[id] -= minLayer;
      maxLayer = Math.max(maxLayer, layers[id]);
    });
    unions.forEach(function (u) {
      u.layer = Math.max.apply(null, u.parents.map(function (p) { return layers[p]; }));
    });

    // ── 3. Spouse blocks ───────────────────────────────────────────────────
    // Members of a level-pair group are drawn side by side. Ordering them as a
    // path puts a twice-married person between their two spouses.

    var spouseAdj = {};
    ids.forEach(function (id) { spouseAdj[id] = []; });
    levelPairs.forEach(function (pr) {
      if (spouseAdj[pr[0]].indexOf(pr[1]) === -1) spouseAdj[pr[0]].push(pr[1]);
      if (spouseAdj[pr[1]].indexOf(pr[0]) === -1) spouseAdj[pr[1]].push(pr[0]);
    });

    var blockOrder = {};
    groups.forEach(function (g) {
      var mem = members[g];
      if (mem.length === 1) { blockOrder[g] = mem.slice(); return; }
      var start = mem.slice().sort(function (a, b) {
        return (spouseAdj[a].length - spouseAdj[b].length) || (birthKey(a) - birthKey(b));
      })[0];
      var order = [], seen = {}, stack = [start];
      while (stack.length) {
        var cur = stack.pop();
        if (seen[cur]) continue;
        seen[cur] = 1;
        order.push(cur);
        var next = spouseAdj[cur].filter(function (x) { return !seen[x]; });
        for (var i = next.length - 1; i >= 0; i--) stack.push(next[i]);
      }
      mem.forEach(function (id) { if (!seen[id]) order.push(id); });
      blockOrder[g] = order;
    });

    // ── 4. Connected families ──────────────────────────────────────────────
    // Laid out one at a time and placed side by side, so two unrelated
    // branches never interleave.

    var compOf = {}, components = [];
    ids.forEach(function (id) {
      if (compOf[id] !== undefined) return;
      var idx = components.length, queue = [id], comp = [];
      compOf[id] = idx;
      while (queue.length) {
        var cur = queue.pop();
        comp.push(cur);
        var linked = parentsOf[cur].concat(childrenOf[cur], spouseAdj[cur], members[find(cur)]);
        var p = people[cur];
        if (p.partner && people[p.partner]) linked.push(p.partner);
        linked.forEach(function (o) {
          if (compOf[o] === undefined) { compOf[o] = idx; queue.push(o); }
        });
      }
      components.push(comp);
    });
    components.sort(function (a, b) { return b.length - a.length; });

    // ── layout node graph (persons on even ranks, unions/routing on odd) ────

    var pos = {}, unionsOut = [], xCursor = 0;

    var descCount = {};
    function descendantCount(id, seen) {
      if (descCount[id] !== undefined) return descCount[id];
      seen = seen || {};
      if (seen[id]) return 0;
      seen[id] = 1;
      var total = 0;
      childrenOf[id].forEach(function (c) { total += 1 + descendantCount(c, seen); });
      descCount[id] = total;
      return total;
    }
    function cmpId(a, b) { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); }

    // Where the first guess starts from decides which local optimum the
    // crossing reduction settles in, and no single rule wins on every family —
    // so try a handful of seedings and keep whichever draws best.
    var SEEDS = [
      function (a, b) { return (layers[a] - layers[b]) || (birthKey(a) - birthKey(b)) || cmpId(a, b); },
      function (a, b) { return (layers[a] - layers[b]) || (descendantCount(b) - descendantCount(a)) || cmpId(a, b); },
      function (a, b) { return (layers[a] - layers[b]) || (descendantCount(a) - descendantCount(b)) || cmpId(a, b); },
      function (a, b) { return (layers[a] - layers[b]) || (birthKey(b) - birthKey(a)) || cmpId(b, a); },
      function (a, b) { return (layers[b] - layers[a]) || (birthKey(a) - birthKey(b)) || cmpId(a, b); },
    ];

    function layoutComponent(compIds, seedCmp) {
      var compSet = {};
      compIds.forEach(function (id) { compSet[id] = 1; });
      var compUnions = unions.filter(function (u) { return compSet[u.parents[0]]; });

      var ranks = [], nodesByKey = {};
      function rankAt(r) {
        while (ranks.length <= r) ranks.push({ nodes: [], items: [] });
        return ranks[r];
      }
      function addNode(n) { nodesByKey[n.key] = n; rankAt(n.rank).nodes.push(n); return n; }
      function personNode(id) {
        var k = 'p:' + id;
        if (!nodesByKey[k]) {
          addNode({ key: k, kind: 'person', person: id, group: find(id), rank: layers[id] * 2,
                    w: size[id].w, up: [], down: [], x: 0, idx: 0 });
        }
        return nodesByKey[k];
      }
      function unionNode(u) {
        if (!nodesByKey[u.id]) {
          addNode({ key: u.id, kind: 'union', union: u, rank: u.layer * 2 + 1,
                    w: 0, up: [], down: [], x: 0, idx: 0 });
        }
        return nodesByKey[u.id];
      }
      // Long edges get invisible waypoints so they reserve a corridor of their
      // own instead of slicing through whoever sits in between.
      function connect(a, b) {
        var cur = a;
        while (b.rank - cur.rank > 1) {
          var d = addNode({ key: 'd:' + a.key + '>' + b.key + '@' + (cur.rank + 1), kind: 'dummy',
                            rank: cur.rank + 1, w: 0, up: [], down: [], x: 0, idx: 0 });
          cur.down.push(d); d.up.push(cur);
          cur = d;
        }
        cur.down.push(b); b.up.push(cur);
      }

      // Seed the order with a depth-first walk so families start out contiguous.
      var visited = {};
      function walk(id) {
        if (visited[id]) return;
        visited[id] = 1;
        personNode(id);
        blockOrder[find(id)].forEach(function (m) {
          if (!visited[m]) { visited[m] = 1; personNode(m); }
        });
        members[find(id)].forEach(function (m) {
          unionsAsParent[m].forEach(function (u) {
            if (!u.children.length) return;
            unionNode(u);
            u.children.forEach(walk);
          });
        });
      }
      compIds.slice().sort(seedCmp).forEach(walk);

      compUnions.forEach(function (u) {
        if (!u.children.length) return;   // childless couple: the bar is enough
        var un = unionNode(u);
        u.parents.forEach(function (par) { connect(personNode(par), un); });
        u.children.forEach(function (c) { connect(un, personNode(c)); });
      });

      // Items: a spouse block moves as one unit through ordering and x-placement.
      ranks.forEach(function (rank) {
        var byGroup = {};
        rank.nodes.forEach(function (n) {
          if (n.kind === 'person') {
            if (byGroup[n.group]) { byGroup[n.group].nodes.push(n); return; }
            var ordered = blockOrder[n.group]
              .map(function (id) { return nodesByKey['p:' + id]; })
              .filter(function (x) { return !!x; });
            byGroup[n.group] = { nodes: [], kind: 'person', prio: 0, x: 0, w: 0, target: 0, order: ordered };
            rank.items.push(byGroup[n.group]);
            byGroup[n.group].nodes.push(n);
          } else {
            rank.items.push({ nodes: [n], kind: n.kind, prio: 0, x: 0, w: 0, target: 0 });
          }
        });
        // restore the intended left-to-right order inside each block
        rank.items.forEach(function (item) {
          if (item.order && item.nodes.length > 1) {
            var wanted = [];
            item.order.forEach(function (n) { if (n && item.nodes.indexOf(n) !== -1) wanted.push(n); });
            item.nodes.forEach(function (n) { if (wanted.indexOf(n) === -1) wanted.push(n); });
            item.nodes = wanted;
          }
        });
      });

      function flatten(rank) {
        var out = [];
        rank.items.forEach(function (item) {
          item.nodes.forEach(function (n) { out.push(n); });
        });
        for (var i = 0; i < out.length; i++) out[i].idx = i;
        rank.flat = out;
        return out;
      }
      ranks.forEach(flatten);

      // ── 5. Crossing reduction ────────────────────────────────────────────

      function totalCrossings() {
        var c = 0;
        for (var r = 0; r + 1 < ranks.length; r++) c += countCrossings(ranks[r].flat, ranks[r + 1].flat);
        return c;
      }
      function snapshot() {
        return ranks.map(function (rank) {
          return rank.items.map(function (item) { return { item: item, nodes: item.nodes.slice() }; });
        });
      }
      function restore(snap) {
        snap.forEach(function (rankSnap, r) {
          ranks[r].items = rankSnap.map(function (s) { s.item.nodes = s.nodes; return s.item; });
          flatten(ranks[r]);
        });
      }

      function medianSweep(down) {
        var order = [], r;
        if (down) { for (r = 1; r < ranks.length; r++) order.push(r); }
        else { for (r = ranks.length - 2; r >= 0; r--) order.push(r); }
        order.forEach(function (r) {
          var adj = ranks[down ? r - 1 : r + 1];
          var dAdj = Math.max(1, adj.flat.length - 1);
          var dCur = Math.max(1, ranks[r].flat.length - 1);
          ranks[r].items.forEach(function (item) {
            var vals = [];
            item.nodes.forEach(function (n) {
              (down ? n.up : n.down).forEach(function (m) { vals.push(m.idx / dAdj); });
            });
            item.med = vals.length ? medianOf(vals) : item.nodes[0].idx / dCur;
          });
          ranks[r].items.sort(function (a, b) { return a.med - b.med; });
          flatten(ranks[r]);
        });
      }

      function localCrossings(r) {
        var c = 0;
        if (r > 0) c += countCrossings(ranks[r - 1].flat, ranks[r].flat);
        if (r + 1 < ranks.length) c += countCrossings(ranks[r].flat, ranks[r + 1].flat);
        return c;
      }

      function transpose() {
        var improved = true, rounds = 0;
        while (improved && rounds++ < 4) {
          improved = false;
          for (var r = 0; r < ranks.length; r++) {
            var items = ranks[r].items;
            for (var i = 0; i + 1 < items.length; i++) {
              var a = items[i], b = items[i + 1];
              var before = pairCrossings(a, b, 'up') + pairCrossings(a, b, 'down');
              var after = pairCrossings(b, a, 'up') + pairCrossings(b, a, 'down');
              if (after < before) {
                items[i] = b; items[i + 1] = a;
                flatten(ranks[r]);
                improved = true;
              }
            }
            // a couple can also read better the other way round
            for (var j = 0; j < items.length; j++) {
              if (items[j].nodes.length < 2) continue;
              var base = localCrossings(r);
              items[j].nodes.reverse();
              flatten(ranks[r]);
              if (localCrossings(r) >= base) { items[j].nodes.reverse(); flatten(ranks[r]); }
              else improved = true;
            }
          }
        }
      }

      var best = snapshot(), bestCross = totalCrossings();
      for (var it = 0; it < cfg.orderIterations && bestCross > 0; it++) {
        // finish on a downward sweep so junctions end up ordered the way their
        // parents are — otherwise a trunk can be forced off its own couple
        medianSweep(it % 2 === 1);
        transpose();
        var cross = totalCrossings();
        if (cross <= bestCross) { bestCross = cross; best = snapshot(); }
      }
      restore(best);

      // ── 6. X coordinates ─────────────────────────────────────────────────

      ranks.forEach(function (rank) {
        rank.items.forEach(function (item) {
          var w = 0;
          item.nodes.forEach(function (n, i) {
            if (i) w += cfg.spouseGap;
            n.off = w + n.w / 2;
            w += n.w;
          });
          item.w = w;
          item.nodes.forEach(function (n) { n.off -= w / 2; });
          item.prio = item.kind === 'union' ? Infinity
                    : item.kind === 'dummy' ? 1e6
                    : 10 * item.nodes.length + item.nodes.reduce(function (s, n) { return s + n.up.length + n.down.length; }, 0);
        });
      });

      function gapBetween(a, b) {
        if (a.kind === 'person' && b.kind === 'person') return cfg.nodeGap;
        if (a.kind === 'person' || b.kind === 'person') return cfg.tightGap + 6;
        return cfg.tightGap;
      }
      function sepOf(a, b) { return a.w / 2 + b.w / 2 + gapBetween(a, b); }

      function syncNodes(rank) {
        rank.items.forEach(function (item) {
          item.nodes.forEach(function (n) { n.x = item.x + n.off; });
        });
      }
      ranks.forEach(function (rank) {
        rank.items.forEach(function (item, i) {
          if (i === 0) item.x = item.w / 2;
          else item.x = rank.items[i - 1].x + sepOf(rank.items[i - 1], item);
        });
        syncNodes(rank);
      });

      // Priority method: the most constrained items (junctions, then long-edge
      // corridors) get their ideal position and shove the rest aside.
      function moveRight(items, i, amount, prio) {
        if (amount <= 0) return 0;
        if (i === items.length - 1) { items[i].x += amount; return amount; }
        var slack = items[i + 1].x - items[i].x - sepOf(items[i], items[i + 1]);
        var moved = Math.max(0, Math.min(slack, amount));
        if (moved < amount && items[i + 1].prio < prio) {
          moved += moveRight(items, i + 1, amount - moved, prio);
        }
        items[i].x += moved;
        return moved;
      }
      function moveLeft(items, i, amount, prio) {
        if (amount <= 0) return 0;
        if (i === 0) { items[i].x -= amount; return amount; }
        var slack = items[i].x - items[i - 1].x - sepOf(items[i - 1], items[i]);
        var moved = Math.max(0, Math.min(slack, amount));
        if (moved < amount && items[i - 1].prio < prio) {
          moved += moveLeft(items, i - 1, amount - moved, prio);
        }
        items[i].x -= moved;
        return moved;
      }

      function xSweep(down) {
        var seq = [], r1, r2;
        if (down) { for (r1 = 1; r1 < ranks.length; r1++) seq.push(r1); }
        else { for (r2 = ranks.length - 2; r2 >= 0; r2--) seq.push(r2); }
        seq.forEach(function (r) {
          var rank = ranks[r];
          rank.items.forEach(function (item) {
            var vals = [];
            item.nodes.forEach(function (n) {
              (down ? n.up : n.down).forEach(function (m) { vals.push(m.x - n.off); });
            });
            item.target = vals.length ? average(vals) : item.x;
          });
          var byPrio = rank.items.map(function (_, i) { return i; })
            .sort(function (a, b) { return rank.items[b].prio - rank.items[a].prio; });
          byPrio.forEach(function (i) {
            var delta = rank.items[i].target - rank.items[i].x;
            if (delta > 0.01) moveRight(rank.items, i, delta, rank.items[i].prio);
            else if (delta < -0.01) moveLeft(rank.items, i, -delta, rank.items[i].prio);
          });
          syncNodes(rank);
        });
      }

      for (var xi = 0; xi < cfg.xIterations; xi++) xSweep(xi % 2 === 0);
      // A junction is not a free node: it is the point on the marriage bar the
      // children hang from. Finish downwards so every junction ends up back on
      // its parents (single parent included) and the children re-centre beneath.
      xSweep(true);

      // ── 7. Score this attempt ────────────────────────────────────────────
      // Crossings alone don't say whether a tree reads well — a family strung
      // out along a 1000px sibling bar is worse than one with a crossing or two.
      var minX = Infinity, maxX = -Infinity, reach = 0;
      ranks.forEach(function (rank) {
        rank.nodes.forEach(function (n) {
          minX = Math.min(minX, n.x - n.w / 2);
          maxX = Math.max(maxX, n.x + n.w / 2);
          if (n.kind === 'union') {
            n.down.forEach(function (c) { reach += Math.abs(c.x - n.x); });
          }
        });
      });
      if (minX === Infinity) { minX = 0; maxX = 0; }

      return {
        ranks: ranks,
        minX: minX,
        maxX: maxX,
        cost: bestCross * cfg.costCrossing + reach + (maxX - minX) * cfg.costWidth,
      };
    }

    components.forEach(function (compIds) {
      var winner = null;
      SEEDS.forEach(function (seed) {
        var attempt = layoutComponent(compIds, seed);
        if (!winner || attempt.cost < winner.cost) winner = attempt;
      });

      var shift = xCursor - winner.minX;
      winner.ranks.forEach(function (rank) {
        rank.nodes.forEach(function (n) {
          n.x += shift;
          if (n.kind === 'person') pos[n.person] = { x: n.x };
          else if (n.kind === 'union') n.union.x = n.x;
        });
      });
      xCursor += (winner.maxX - winner.minX) + cfg.componentGap;
    });


    // ── 8. Rows ──────────────────────────────────────────────────────────

    var rows = [];
    for (var L = 0; L <= maxLayer; L++) rows.push({ h: cfg.defaultHeight, y: 0 });
    ids.forEach(function (id) {
      rows[layers[id]].h = Math.max(rows[layers[id]].h, size[id].h);
    });
    var y = 0;
    rows.forEach(function (row) {
      row.y = y + row.h / 2;
      y += row.h + cfg.rowGap;
    });
    ids.forEach(function (id) { pos[id].y = rows[layers[id]].y; });

    unions.forEach(function (u) {
      var row = rows[u.layer];
      unionsOut.push({
        id: u.id,
        parents: u.parents,
        children: u.children,
        layer: u.layer,
        x: u.x !== undefined ? u.x : average(u.parents.map(function (p) { return pos[p].x; })),
        y: row.y,                        // the junction sits on the marriage bar
        barY: row.y + row.h / 2 + cfg.trunk,   // where the sibling bar runs
      });
    });

    // Two couples side by side would otherwise draw their sibling bars at the
    // same height, reading as one long line. Push overlapping bars down a step
    // — interval colouring, so only the ones that actually clash move.
    var byRow = {};
    unionsOut.forEach(function (u) {
      if (!u.children.length) return;
      var xs = u.children.map(function (c) { return pos[c].x; }).concat([u.x]);
      u.span = [Math.min.apply(null, xs), Math.max.apply(null, xs)];
      (byRow[u.layer] = byRow[u.layer] || []).push(u);
    });
    Object.keys(byRow).forEach(function (layer) {
      var lanes = [];
      byRow[layer].sort(function (a, b) { return a.span[0] - b.span[0]; }).forEach(function (u) {
        var lane = 0;
        while (lanes[lane] !== undefined && lanes[lane] > u.span[0] - 1) lane++;
        lanes[lane] = u.span[1];
        u.barY += lane * cfg.barStagger;
      });
    });

    return {
      layers: layers,
      maxLayer: maxLayer,
      rows: rows,
      pos: pos,
      unions: unionsOut,
      width: Math.max(0, xCursor - cfg.componentGap),
      height: y - cfg.rowGap,
      config: cfg,
    };
  }

  return { compute: compute, DEFAULTS: DEFAULTS };
});
