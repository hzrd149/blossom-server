import debug from "debug";
import http from "node:http";
import https from "node:https";
import { BlobSearch } from "../types.js";
import { config } from "../config.js";

const log = debug("cdn:discover:upstream");

export async function search(search: BlobSearch) {
  log("Looking for", search.hash, search.ext);
  for (const cdn of config.discovery.upstream.domains) {
    try {
      log("Checking", cdn);
      return await checkCDN(cdn, search);
    } catch (e) {}
  }
}

async function checkCDN(cdn: string, search: BlobSearch): Promise<http.IncomingMessage> {
  const { hash, ext } = search;
  return new Promise((resolve, reject) => {
    const url = new URL(hash + (ext || ""), cdn);
    const backend = url.protocol === "https:" ? https : http;

    backend.get(url.toString(), (res) => {
      if (!res.statusCode) return reject();
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        reject(new Error(res.statusMessage));
      } else {
        resolve(res);
        log("Found", hash + ext || "", "at", cdn);
      }
    });
  });
}
