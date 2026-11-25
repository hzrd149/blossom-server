-- Reports survive content deletion and dismissal until explicitly cleaned up.
ALTER TABLE reports ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1));
CREATE INDEX IF NOT EXISTS reports_dismissed ON reports (dismissed);
