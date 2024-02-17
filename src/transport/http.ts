import http from "node:http";
import https from "node:https";
import { SocksProxyAgent } from "socks-proxy-agent";

import { HTTPPointer } from "../types.js";
import { config } from "../config.js";

export async function readHTTPPointer(pointer: HTTPPointer): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const url = new URL(pointer.url);
    let agent: http.Agent | undefined = undefined;

    if (url.hostname.endsWith(".onion")) {
      if (!config.tor.enabled) throw new Error("Cant load .onion address without tor");

      agent = new SocksProxyAgent(config.tor.proxy);
    }

    (pointer.url.startsWith("https") ? https : http).get(pointer.url, { agent }, (res) => {
      if (!res.statusCode) return reject();
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.destroy();
        reject(res);
      } else resolve(res);
    });
  });
}
