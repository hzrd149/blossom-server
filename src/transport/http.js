import http from "http";
import https from "https";

/**
 *
 * @param {string} url
 */
export async function getReadStream(url) {
  return new Promise((resolve) => {
    (url.startsWith("https") ? https : http).get(url, (res) => {
      resolve(res);
    });
  });
}
