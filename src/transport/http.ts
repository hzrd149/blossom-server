import http from "node:http";
import https from "node:https";
import { HTTPPointer } from "../types.js";

export async function readHTTPPointer(pointer: HTTPPointer): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    (pointer.url.startsWith("https") ? https : http).get(pointer.url, (res) => {
      if (!res.statusCode) return reject();
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        reject(res);
      } else resolve(res);
    });
  });
}
