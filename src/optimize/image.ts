/**
 * Image optimization using npm:sharp.
 * Handles JPEG, PNG, WebP (static) and animated GIF → animated WebP.
 *
 * sharp is loaded lazily via dynamic import so it is never required when the
 * media endpoint is disabled.
 */

import type { ImageOptimizeConfig } from "../config/schema.ts";
import { openImage } from "./image-input.ts";

export type { ImageOptimizeConfig as ImageOptimizeOptions };

/**
 * Optimizes a static image (JPEG/PNG/WebP) using sharp.
 * Returns the path to the optimized temp file.
 * Removes partial output on error.
 */
export async function optimizeImage(
  inputPath: string,
  opts: ImageOptimizeConfig,
  tmpDir: string,
): Promise<string> {
  let pipeline = (await openImage(inputPath)).rotate();

  // rotate() normalizes orientation so we can safely strip EXIF

  if (opts.keepExif) {
    pipeline = pipeline.withMetadata();
  } else {
    pipeline = pipeline.withMetadata({ exif: {} });
  }

  // Resize to fit inside the bounding box without upscaling
  pipeline = pipeline.resize(opts.maxWidth, opts.maxHeight, {
    fit: "inside",
    withoutEnlargement: true,
  });

  // Encode to target format
  switch (opts.outputFormat) {
    case "webp":
      pipeline = pipeline.webp({ quality: opts.quality });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({
        quality: opts.quality,
        progressive: opts.progressive,
      });
      break;
    case "png":
      pipeline = pipeline.png({
        quality: opts.quality,
        progressive: opts.progressive,
      });
      break;
  }

  const outputPath = await Deno.makeTempFile({
    dir: tmpDir,
    suffix: `.${opts.outputFormat}`,
  });
  try {
    await pipeline.toFile(outputPath);
    return outputPath;
  } catch (err) {
    await Deno.remove(outputPath).catch(() => {});
    throw err;
  }
}

/**
 * Optimizes an animated GIF using sharp's animated WebP path.
 * When outputFormat is "webp" (default), sharp produces an animated WebP.
 * For other formats the GIF is treated as a static image (first frame).
 * Returns the path to the optimized temp file.
 */
export async function optimizeGif(
  inputPath: string,
  opts: ImageOptimizeConfig,
  tmpDir: string,
): Promise<string> {
  let pipeline = (await openImage(inputPath, opts.outputFormat === "webp")).rotate();
  if (opts.keepExif) {
    pipeline = pipeline.withMetadata();
  } else {
    pipeline = pipeline.withMetadata({ exif: {} });
  }

  pipeline = pipeline.resize(opts.maxWidth, opts.maxHeight, {
    fit: "inside",
    withoutEnlargement: true,
  });

  if (opts.outputFormat === "webp") {
    // delay is per-frame delay in ms — derived from the fps cap.
    // Sharp clamps individual frame delays to this value when they are shorter.
    const delay = Math.round(1000 / opts.fps);
    pipeline = pipeline.webp({ quality: opts.quality, delay });
  } else if (opts.outputFormat === "jpeg") {
    pipeline = pipeline.jpeg({
      quality: opts.quality,
      progressive: opts.progressive,
    });
  } else {
    pipeline = pipeline.png({
      quality: opts.quality,
      progressive: opts.progressive,
    });
  }

  const outputPath = await Deno.makeTempFile({
    dir: tmpDir,
    suffix: `.${opts.outputFormat}`,
  });
  try {
    await pipeline.toFile(outputPath);
    return outputPath;
  } catch (err) {
    await Deno.remove(outputPath).catch(() => {});
    throw err;
  }
}
