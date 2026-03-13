/**
 * optimizeMedia() — MIME detection + dispatch to image or video optimizer.
 *
 * MIME detection order:
 *   1. Extension-based via @std/media-types getType()
 *   2. Magic-byte fallback via npm:file-type fileTypeFromBuffer()
 *   3. Unknown → throw Error("Unsupported file type")
 */

import { typeByExtension } from "@std/media-types";
import { extname } from "@std/path";
import { fileTypeFromBuffer } from "file-type";
import type { MediaConfig } from "../config/schema.ts";
import { optimizeGif, optimizeImage } from "./image.ts";
import { optimizeVideo } from "./video.ts";

/**
 * Detects MIME type of a file on disk.
 * Tries extension first, then reads the first 4096 bytes for magic-byte detection.
 */
async function detectMimeType(filePath: string): Promise<string | null> {
  // 1. Extension-based: strip the leading dot from the extension
  const ext = extname(filePath).replace(/^\./, "");
  if (ext) {
    const extMime = typeByExtension(ext);
    if (extMime) return extMime;
  }

  // 2. Magic-byte fallback
  const file = await Deno.open(filePath, { read: true });
  try {
    const buf = new Uint8Array(4096);
    const n = await file.read(buf);
    if (n === null) return null;
    const result = await fileTypeFromBuffer(buf.subarray(0, n));
    return result?.mime ?? null;
  } finally {
    file.close();
  }
}

/**
 * Detects, validates, and optimizes/transcodes the file at inputPath.
 * Returns the path to the optimized output temp file.
 *
 * Throws Error("Unsupported file type") if the MIME type cannot be determined
 * or is not a supported image/video type.
 *
 * Wraps the full pipeline in try/catch; on failure deletes any partial output
 * temp file before rethrowing with "Optimization failed: <message>" prefix.
 */
export async function optimizeMedia(
  inputPath: string,
  config: MediaConfig,
): Promise<string> {
  const mime = await detectMimeType(inputPath);

  if (!mime) {
    throw new Error("Unsupported file type: could not determine MIME type");
  }

  let outputPath: string | null = null;

  try {
    if (mime === "image/gif") {
      outputPath = await optimizeGif(inputPath, config.image);
    } else if (
      mime === "image/jpeg" ||
      mime === "image/png" ||
      mime === "image/webp"
    ) {
      outputPath = await optimizeImage(inputPath, config.image);
    } else if (mime.startsWith("video/")) {
      outputPath = await optimizeVideo(inputPath, config.video);
    } else {
      throw new Error(`Unsupported file type: ${mime}`);
    }
  } catch (err) {
    // Clean up any partial output before rethrowing
    if (outputPath) {
      await Deno.remove(outputPath).catch(() => {});
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Optimization failed: ${msg}`);
  }

  return outputPath;
}
