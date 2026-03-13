/**
 * Image optimization using npm:sharp.
 * Handles JPEG, PNG, WebP (static) and animated GIF → animated WebP.
 */

import sharp from "sharp";
import type { ImageOptimizeConfig } from "../config/schema.ts";

export type { ImageOptimizeConfig as ImageOptimizeOptions };

/**
 * Optimizes a static image (JPEG/PNG/WebP) using sharp.
 * Returns the path to the optimized temp file.
 * Caller is responsible for deleting the output file on any error.
 */
export async function optimizeImage(
  inputPath: string,
  opts: ImageOptimizeConfig,
): Promise<string> {
  const outputPath = await Deno.makeTempFile({
    suffix: `.${opts.outputFormat}`,
  });

  let pipeline = sharp(inputPath);

  // Strip EXIF unless keepExif is true
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
      pipeline = pipeline.jpeg({ quality: opts.quality, progressive: opts.progressive });
      break;
    case "png":
      pipeline = pipeline.png({ quality: opts.quality, progressive: opts.progressive });
      break;
  }

  await pipeline.toFile(outputPath);
  return outputPath;
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
): Promise<string> {
  const outputPath = await Deno.makeTempFile({
    suffix: `.${opts.outputFormat}`,
  });

  // animated: true preserves all frames
  let pipeline = sharp(inputPath, { animated: true });

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
    pipeline = pipeline.jpeg({ quality: opts.quality, progressive: opts.progressive });
  } else {
    pipeline = pipeline.png({ quality: opts.quality, progressive: opts.progressive });
  }

  await pipeline.toFile(outputPath);
  return outputPath;
}
