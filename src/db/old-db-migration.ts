import fs from "node:fs/promises";
import { blobDB } from "./db.js";
import logger from "../logger.js";

const log = logger.extend("migration");

type DBSchema = {
  blobs: Record<string, { expiration?: number; pubkeys?: string[]; created: number; mimeType?: string; size: number }>;
  usedTokens: Record<string, number>;
};

const DB_PATH = "database.json";
try {
  const stats = await fs.stat(DB_PATH);
  if (stats) {
    log("Found old database.json file");
    log("Backing up database.json file");
    await fs.copyFile(DB_PATH, "database.old.json");

    const str = await fs.readFile(DB_PATH, { encoding: "utf-8" });
    const data = JSON.parse(str) as DBSchema;

    if (data.blobs) {
      let imported = 0;
      for (const [sha256, blob] of Object.entries(data.blobs)) {
        try {
          blobDB.addBlob({
            sha256,
            type: blob.mimeType ?? "",
            size: blob.size,
            created: blob.created,
          });
          imported++;

          try {
            if (blob.pubkeys) {
              for (const pubkey of blob.pubkeys) {
                blobDB.addOwner(sha256, pubkey);
              }
            }
          } catch (error) {
            log("Error adding owners", sha256);
            if (error instanceof Error) log(error.message);
          }
        } catch (error) {
          log("Error importing", sha256);
          if (error instanceof Error) log(error.message);
        }
      }

      log("Imported", imported, "blobs");
    }

    log("Removing database.json file");
    await fs.rm(DB_PATH);
  }
} catch (error) {}
