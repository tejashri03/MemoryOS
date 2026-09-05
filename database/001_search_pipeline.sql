USE memoryos;

ALTER TABLE images
  ADD COLUMN owner_id VARCHAR(128) NOT NULL DEFAULT 'local-user' AFTER id,
  ADD COLUMN subcategory VARCHAR(128) NULL AFTER category,
  ADD COLUMN location VARCHAR(512) NULL AFTER subcategory,
  ADD COLUMN importance ENUM('Critical', 'Important', 'Normal', 'Low') NOT NULL DEFAULT 'Normal' AFTER location,
  ADD COLUMN ocr_confidence DECIMAL(5,4) NULL AFTER ocr_text,
  ADD COLUMN ocr_status ENUM('pending', 'complete', 'failed') NOT NULL DEFAULT 'pending' AFTER ocr_confidence,
  ADD COLUMN keywords TEXT NULL AFTER visual_description,
  ADD COLUMN image_embedding MEDIUMBLOB NULL AFTER keywords,
  ADD COLUMN image_data LONGBLOB NULL AFTER image_embedding;

ALTER TABLE images
  ADD INDEX idx_images_owner (owner_id),
  ADD INDEX idx_images_subcategory (subcategory),
  ADD INDEX idx_images_importance (importance),
  ADD INDEX idx_images_created (created_at),
  ADD INDEX idx_images_mime_type (mime_type),
  ADD INDEX idx_images_location (location),
  ADD FULLTEXT INDEX ft_images_search (filename, ocr_text, visual_description, keywords, category, subcategory, location);
