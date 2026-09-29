USE memoryos;

ALTER TABLE images
  ADD COLUMN file_path VARCHAR(1024) NULL AFTER filename,
  ADD COLUMN file_hash CHAR(64) NULL AFTER file_size,
  ADD COLUMN phash CHAR(16) NULL AFTER file_hash,
  ADD COLUMN file_modified_at DATETIME NULL AFTER file_hash,
  ADD COLUMN classification_candidates JSON NULL AFTER confidence,
  ADD COLUMN importance_score TINYINT UNSIGNED NOT NULL DEFAULT 50 AFTER classification_candidates,
  ADD COLUMN protection_status ENUM('unprotected', 'protected') NOT NULL DEFAULT 'unprotected' AFTER importance_score,
  ADD COLUMN processing_status ENUM('pending', 'processing', 'completed', 'failed', 'needs_review') NOT NULL DEFAULT 'completed' AFTER protection_status;

ALTER TABLE images
  ADD UNIQUE INDEX uq_images_owner_hash (owner_id, file_hash),
  ADD INDEX idx_images_phash (phash),
  ADD INDEX idx_images_path (file_path),
  ADD INDEX idx_images_processing (processing_status),
  ADD INDEX idx_images_protection (protection_status);