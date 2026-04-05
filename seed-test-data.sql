-- Test family tree with ~45 people across 5 generations
-- Two main family branches that intermarry, creating the cross-graph partner edges
-- that stress-test the layout algorithm.

INSERT INTO trees (id, code, name) VALUES ('test-tree', 'AAA111', 'Test Family Tree')
ON CONFLICT (id) DO NOTHING;

DELETE FROM people WHERE tree_id = 'test-tree';
DELETE FROM meta WHERE tree_id = 'test-tree';
INSERT INTO meta (tree_id, key, value) VALUES ('test-tree', 'nextId', '46');

-- ══════════════════════════════════════
-- Generation 0 (great-great-grandparents)
-- ══════════════════════════════════════

-- Branch A: Andersson family
INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p0', 'Erik Andersson', '1910', 'p1'),
('test-tree', 'p1', 'Ingrid Holm', '1912', 'p0');

-- Branch B: Bergström family
INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p2', 'Karl Bergström', '1908', 'p3'),
('test-tree', 'p3', 'Maja Lindqvist', '1911', 'p2');

-- Branch C: Kowalski family (Polish roots)
INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p4', 'Jan Kowalski', '1905', 'p5'),
('test-tree', 'p5', 'Anna Nowak', '1909', 'p4');

-- ══════════════════════════════════════
-- Generation 1 (great-grandparents)
-- ══════════════════════════════════════

-- Andersson children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p6', 'Lars Andersson', '1935', 'p0', 'p1', 'p7'),
('test-tree', 'p8', 'Karin Andersson', '1938', 'p0', 'p1', 'p9');

-- Lars's wife (from outside)
INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p7', 'Birgit Svensson', '1937', 'p6');

-- Bergström children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p10', 'Gunnar Bergström', '1933', 'p2', 'p3', 'p11'),
('test-tree', 'p12', 'Elsa Bergström', '1936', 'p2', 'p3', NULL);

-- Gunnar's wife (from outside)
INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p11', 'Margit Olsson', '1935', 'p10');

-- Karin Andersson marries into Kowalski family
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p9', 'Piotr Kowalski', '1934', 'p4', 'p5', 'p8');

-- Another Kowalski child
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p13', 'Maria Kowalski', '1937', 'p4', 'p5', NULL);

-- ══════════════════════════════════════
-- Generation 2 (grandparents)
-- ══════════════════════════════════════

-- Lars & Birgit's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p14', 'Sven Andersson', '1960', 'p6', 'p7', 'p15'),
('test-tree', 'p16', 'Helena Andersson', '1963', 'p6', 'p7', 'p17');

INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p15', 'Lena Nilsson', '1962', 'p14');

-- Helena marries a Bergström (cross-branch marriage!)
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p17', 'Thomas Bergström', '1961', 'p10', 'p11', 'p16');

-- More Bergström grandchildren
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p18', 'Eva Bergström', '1958', 'p10', 'p11', 'p19');

INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p19', 'Daniel Fransson', '1956', 'p18');

-- Karin & Piotr's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p20', 'Anders Kowalski', '1962', 'p9', 'p8', 'p21'),
('test-tree', 'p22', 'Katarina Kowalski', '1965', 'p9', 'p8', NULL);

INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p21', 'Sofia Ekström', '1964', 'p20');

-- ══════════════════════════════════════
-- Generation 3 (parents)
-- ══════════════════════════════════════

-- Sven & Lena's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p23', 'Johan Andersson', '1988', 'p14', 'p15', 'p24'),
('test-tree', 'p25', 'Emma Andersson', '1991', 'p14', 'p15', NULL);

-- Johan marries someone from the Kowalski branch (cross-branch!)
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p24', 'Nina Kowalski', '1990', 'p20', 'p21', 'p23');

-- Helena & Thomas's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p26', 'Sebastian Bergström', '1987', 'p16', 'p17', 'p27'),
('test-tree', 'p28', 'Rebecka Bergström', '1990', 'p16', 'p17', NULL);

INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p27', 'Paula Johansson', '1989', 'p26');

-- Eva & Daniel's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p29', 'David Fransson', '1985', 'p18', 'p19', 'p30'),
('test-tree', 'p31', 'Susanne Fransson', '1988', 'p18', 'p19', NULL);

INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p30', 'Maria Elena García', '1987', 'p29');

-- Anders & Sofia's other child
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2, partner) VALUES
('test-tree', 'p32', 'Miriam Kowalski', '1992', 'p20', 'p21', NULL);

-- Katarina's children (single parent)
INSERT INTO people (tree_id, id, name, birth_year, parent1, partner) VALUES
('test-tree', 'p33', 'Isak Kowalski', '1993', 'p22', NULL);

-- ══════════════════════════════════════
-- Generation 4 (youngest)
-- ══════════════════════════════════════

-- Johan & Nina's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2) VALUES
('test-tree', 'p34', 'Carl Andersson', '2015', 'p23', 'p24'),
('test-tree', 'p35', 'Hanna Andersson', '2018', 'p23', 'p24');

-- Sebastian & Paula's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2) VALUES
('test-tree', 'p36', 'Naima Bergström', '2016', 'p26', 'p27'),
('test-tree', 'p37', 'Ruben Bergström', '2019', 'p26', 'p27');

-- David & Maria Elena's children
INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2) VALUES
('test-tree', 'p38', 'Leila Fransson', '2017', 'p29', 'p30'),
('test-tree', 'p39', 'Theo Fransson', '2020', 'p29', 'p30');

-- Emma's child (single parent)
INSERT INTO people (tree_id, id, name, birth_year, parent1) VALUES
('test-tree', 'p40', 'Mina Andersson', '2019', 'p25');

-- Rebecka's partner and child
INSERT INTO people (tree_id, id, name, birth_year, partner) VALUES
('test-tree', 'p41', 'Bo Lindgren', '1988', 'p28');
UPDATE people SET partner = 'p41' WHERE tree_id = 'test-tree' AND id = 'p28';

INSERT INTO people (tree_id, id, name, birth_year, parent1, parent2) VALUES
('test-tree', 'p42', 'Elias Lindgren', '2021', 'p28', 'p41');

-- Susanne's children
INSERT INTO people (tree_id, id, name, birth_year, parent1) VALUES
('test-tree', 'p43', 'Masha Fransson', '2020', 'p31');

-- Miriam's child
INSERT INTO people (tree_id, id, name, birth_year, parent1) VALUES
('test-tree', 'p44', 'Gabrielle Kowalski', '2022', 'p32');

-- Elsa Bergström (gen 1, unmarried) adopted a child
INSERT INTO people (tree_id, id, name, birth_year, parent1) VALUES
('test-tree', 'p45', 'Anette Bergström', '1965', 'p12');
