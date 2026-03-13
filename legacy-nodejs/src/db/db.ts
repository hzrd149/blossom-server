import Database from "better-sqlite3";
import { BlossomSQLite } from "blossom-server-sdk/metadata/sqlite";
import { config } from "../config.js";
import { mkdirp } from "mkdirp";
import { dirname } from "path";

await mkdirp(dirname(config.databasePath));

export const db = new Database(config.databasePath);
export const blobDB = new BlossomSQLite(db);

db.prepare(
  `CREATE TABLE IF NOT EXISTS accessed (
		blob TEXT(64) PRIMARY KEY,
		timestamp INTEGER NOT NULL
	)`,
).run();

db.prepare("CREATE INDEX IF NOT EXISTS accessed_timestamp ON accessed (timestamp)").run();

export default db;
