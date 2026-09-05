CREATE DATABASE IF NOT EXISTS memoryos;
USE memoryos;

CREATE TABLE IF NOT EXISTS images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id VARCHAR(128) NOT NULL DEFAULT 'local-user',
  filename VARCHAR(512) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  subcategory VARCHAR(128) NULL,
  location VARCHAR(512) NULL,
  importance ENUM('Critical', 'Important', 'Normal', 'Low') NOT NULL DEFAULT 'Normal',
  ocr_text MEDIUMTEXT NULL,
  ocr_confidence DECIMAL(5,4) NULL,
  ocr_status ENUM('pending', 'complete', 'failed') NOT NULL DEFAULT 'pending',
  visual_description TEXT NULL,
  keywords TEXT NULL,
  image_embedding MEDIUMBLOB NULL,
  image_data LONGBLOB NULL,
  confidence DECIMAL(5,4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_images_owner (owner_id),
  INDEX idx_images_category (category),
  INDEX idx_images_subcategory (subcategory),
  INDEX idx_images_importance (importance),
  INDEX idx_images_created (created_at),
  INDEX idx_images_mime_type (mime_type),
  INDEX idx_images_location (location),
  INDEX idx_images_filename (filename),
  FULLTEXT INDEX ft_images_search (filename, ocr_text, visual_description, keywords, category, subcategory, location)
);
