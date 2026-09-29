USE memoryos;

ALTER TABLE images
  ADD COLUMN classification_evidence JSON NULL AFTER classification_candidates,
  ADD COLUMN classification_margin DECIMAL(8,6) NULL AFTER classification_evidence;
