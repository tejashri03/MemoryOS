USE memoryos;

ALTER TABLE images
  ADD COLUMN image_width INT UNSIGNED NULL AFTER file_size,
  ADD COLUMN image_height INT UNSIGNED NULL AFTER image_width;
