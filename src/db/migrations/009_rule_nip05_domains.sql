-- NIP-05 domain allowlists for database-managed storage rules: a JSON array of
-- normalized domains or NULL. Fetched member pubkeys are never stored here.
ALTER TABLE storage_rules ADD COLUMN nip05_domains TEXT;
