CREATE DATABASE IF NOT EXISTS memoryos;
USE memoryos;

CREATE TABLE IF NOT EXISTS images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  filename VARCHAR(512) NOT NULL,
  file_size BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  ocr_text MEDIUMTEXT NULL,
  visual_description TEXT NULL,
  confidence DECIMAL(5,4) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_images_category (category),
  INDEX idx_images_filename (filename)
);
