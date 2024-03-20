import debug from "debug";
import followRedirects from "follow-redirects";
import { BlobSearch, HTTPPointer } from "../types.js";
import { config } from "../config.js";
const { http, https } = followRedirects;

const log = debug("cdn:discover:upstream");

export async function search(search: BlobSearch) {
  log("Looking for", search.hash + search.ext);
  for (const cdn of config.discovery.upstream.domains) {
    try {
      log("Checking", cdn);
      return await checkCDN(cdn, search);
    } catch (e) {}
  }
}

async function checkCDN(cdn: string, search: BlobSearch): Promise<HTTPPointer> {
  const { hash, ext, pubkey } = search;
  return new Promise<HTTPPointer>((resolve, reject) => {
    const url = new URL(hash, cdn);
    const backend = url.protocol === "https:" ? https : http;

    const request = backend.request(url.toString(), { method: "HEAD", timeout: 5 * 1000 }, (res) => {
      if (!res.statusCode) return reject();
      if (res.statusCode < 200 || res.statusCode >= 400) {
        res.destroy();
        reject(new Error("Not Found"));
      } else {
        log("Found", hash + ext || "", "at", cdn);
        resolve({ type: "http", url: url.toString(), hash: search.hash, metadata: { pubkey } });
      }
    });

    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Timeout"));
    });
  });
}
