import debug from "debug";
import http from "http";
import https from "https";

const log = debug("cdn:discover:parent");
const PARENT_CDNS = process.env.PARENT_CDNS?.split(",") || [];

/**
 * find content by sha256 hash
 * @param {string} hash
 * @param {string|undefined} ext
 * @returns {http.IncomingRequest}
 */
export async function findByHash(hash, ext) {
  log("Looking for", hash + ext);
  for (const cdn of PARENT_CDNS) {
    try {
      return await checkCDN(cdn, hash, ext);
    } catch (e) {}
  }
}

async function checkCDN(cdn, hash, ext) {
  return new Promise((resolve, reject) => {
    const url = new URL(hash + (ext || ""), cdn);
    const backend = url.protocol === "https:" ? https : http;

    backend.get(url.toString(), (res) => {
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
