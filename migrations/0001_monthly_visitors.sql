-- Additive migration: preview D1 lacks this table; production already has it.
CREATE TABLE IF NOT EXISTS monthly_visitors (
  month TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (month, visitor_hash)
);
