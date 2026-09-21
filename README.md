# Family Tree

A shared, real-time family tree. Express + Postgres on the server, a single
`index.html` (cytoscape) on the client.

## Running locally

```sh
docker compose up -d          # app on :3000, postgres on :5432
```

`docker-compose.override.yml` is the place for machine-specific tweaks — e.g.
publishing the app on another port when 3000 is taken.

## Working with real data

Layout work needs a realistic tree, so pull one out of production into the local
database (read-only on the prod side — it only uses the public API):

```sh
node tools/pull-prod.js A710E7          # tree code as shown in the app
```

The tree keeps its code locally, so `/tree/A710E7` shows the same family you see
in production. The downloaded JSON is cached in `local-data/`, which is
git-ignored because it holds real names, notes and photos.

`seed-test-data.sql` is the synthetic alternative (~45 people, code `AAA111`)
for anything that shouldn't touch real data.

## Layout

`layout.js` (`FamilyLayout.compute`) decides where everyone goes; cytoscape only
draws the result. It is a layered layout built around family units rather than
individuals:

1. **unions** — every distinct set of co-parents, plus childless couples
2. **layers** — generations, where a child is always below every parent and a
   couple always shares a row (this is what pulls a married-in spouse down from
   the top of the tree to sit beside their partner). Someone with no children
   of their own sinks to their shallowest sibling rather than floating at the
   top, which is what stops their parents being stranded generations above the
   rest of the family
3. **order** — per-row ordering that keeps spouses adjacent, keeps a set of
   siblings contiguous, and minimises crossings
4. **x** — priority method, so children end up centred under their parents'
   marriage bar, followed by a pass that closes the gaps inside each sibling
   group and re-seats every junction on its own couple

Disconnected families are laid out separately and then slotted into the
leftmost column where the generations they actually occupy are free, so a
shallow branch tucks in beside a deep one instead of widening the whole tree.

It has no DOM dependency, so it can be run and checked offline:

```sh
node tools/render-layout.js                       # SVG preview + quality report
node tools/render-layout.js local-data/prod-people.json out.html \
     --region=100,80,1400,650 --scale=1.6         # zoom into part of the graph
```

The report flags what matters: parents not above their children, spouses split
across rows or drawn apart, overlapping nodes, and edge crossings.

To drive the real app headlessly (screenshots, console errors, evaluating
expressions against the live `cy` instance):

```sh
node tools/cdp.js http://localhost:3100/tree/A710E7 --shot=out.png \
     --eval="cy.nodes().length"
```
