USE memoryos;

-- Identical bytes at different paths are separate library entries and should
-- remain visible as an exact-duplicate group. Only reuse a row for the same path.
ALTER TABLE images DROP INDEX uq_images_owner_hash;
ALTER TABLE images ADD INDEX idx_images_owner_hash (owner_id, file_hash);
