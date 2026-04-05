CREATE TABLE IF NOT EXISTS trees (
  id      TEXT PRIMARY KEY,
  code    TEXT UNIQUE NOT NULL,
  name    TEXT NOT NULL DEFAULT 'My Family Tree'
);

CREATE TABLE IF NOT EXISTS people (
  id         TEXT NOT NULL,
  tree_id    TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'Unnamed',
  parent1    TEXT,
  parent2    TEXT,
  partner    TEXT,
  birth_year TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  photo      TEXT,
  PRIMARY KEY (tree_id, id)
);

CREATE TABLE IF NOT EXISTS meta (
  tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (tree_id, key)
);
