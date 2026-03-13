export const unixNow = () => Math.floor(Date.now() / 1000);
export const newExpirationValue = () => (unixNow() + 60 * 5).toString();

export function readBlobAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (result == undefined || typeof result !== "object") {
        reject();
        return;
      }
      resolve(result);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
}

export async function getFileSha256(file) {
  const { bytesToHex } = await import("./lib/@noble/hashes/utils.js");
  const buffer = file instanceof File ? await file.arrayBuffer() : await readBlobAsArrayBuffer(file);
  let hash;
  if (crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    hash = new Uint8Array(hashBuffer);
  } else {
    const { sha256 } = await import("./lib/@noble/hashes/sha256.js");
    hash = sha256.create().update(new Uint8Array(buffer)).digest();
  }
  return bytesToHex(hash);
}

// Copied from https://git.v0l.io/Kieran/dtan/src/branch/main/src/const.ts#L220
export const kiB = Math.pow(1024, 1);
export const MiB = Math.pow(1024, 2);
export const GiB = Math.pow(1024, 3);
export const TiB = Math.pow(1024, 4);
export const PiB = Math.pow(1024, 5);
export const EiB = Math.pow(1024, 6);
export const ZiB = Math.pow(1024, 7);
export const YiB = Math.pow(1024, 8);

export function formatBytes(b, f) {
  f ??= 2;
  if (b >= YiB) return (b / YiB).toFixed(f) + " YiB";
  if (b >= ZiB) return (b / ZiB).toFixed(f) + " ZiB";
  if (b >= EiB) return (b / EiB).toFixed(f) + " EiB";
  if (b >= PiB) return (b / PiB).toFixed(f) + " PiB";
  if (b >= TiB) return (b / TiB).toFixed(f) + " TiB";
  if (b >= GiB) return (b / GiB).toFixed(f) + " GiB";
  if (b >= MiB) return (b / MiB).toFixed(f) + " MiB";
  if (b >= kiB) return (b / kiB).toFixed(f) + " KiB";
  return b.toFixed(f) + " B";
}
