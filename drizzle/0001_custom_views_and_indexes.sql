-- Custom migration (§1.4): objects drizzle-kit does not model.
-- location_reports: the place and event reports, for Admin › Content › Places (§3.6).
CREATE VIEW "location_reports" AS
  SELECT * FROM "reports" WHERE "subject_type" IN ('location', 'location_event');
