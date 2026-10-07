-- History is append-only: the database itself refuses edits and deletes.
CREATE OR REPLACE FUNCTION history_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'history_events is append-only (% is not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER history_events_no_update_delete
  BEFORE UPDATE OR DELETE ON history_events
  FOR EACH ROW EXECUTE FUNCTION history_events_immutable();
--> statement-breakpoint
CREATE TRIGGER history_events_no_truncate
  BEFORE TRUNCATE ON history_events
  FOR EACH STATEMENT EXECUTE FUNCTION history_events_immutable();
