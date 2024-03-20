import debug from "debug";
import { BlobSearch, HTTPPointer } from "../types.js";
import { config } from "../config.js";
import http from "node:http";
import https from "node:https";

const log = debug("cdn:discover:upstream");

export async function search(search: BlobSearch) {
  log("Looking for", search.hash + search.ext);
  for (const cdn of config.discovery.upstream.domains) {
    try {
      log("Checking", cdn);
      const pointer = await checkCDN(cdn, search);
      if (pointer) {
        log("Found", search.hash, "at", cdn);
        return pointer;
      }
    } catch (e) {}
  }
}

function checkCDN(cdn: string, search: BlobSearch): Promise<HTTPPointer> {
  return new Promise<HTTPPointer>((resolve, reject) => {
    const url = new URL("/" + search.hash, cdn);
    const backend = url.protocol === "https:" ? https : http;

    const request = backend.request(url.toString(), { method: "HEAD", timeout: 5 * 1000 }, () => {});

    request.on("response", (res) => {
      res.destroy();
      if (!res.statusCode) return reject();
      if (res.statusCode < 200 || res.statusCode >= 400) {
        reject(new Error("Not Found"));
      } else {
        resolve({ type: "http", url: url.toString(), hash: search.hash, metadata: { pubkey: search.pubkey } });
      }
    });

    request.on("error", () => request.destroy());

    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Timeout"));
    });

    request.end();
  });
}
