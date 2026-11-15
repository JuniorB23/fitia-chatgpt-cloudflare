CREATE TABLE IF NOT EXISTS daily_summaries (
  date TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

