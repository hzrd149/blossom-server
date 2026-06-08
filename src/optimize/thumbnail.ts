/**
 * Best-effort thumbnail generation for optimized media outputs.
 *
 * Images use sharp directly. Videos use ffmpeg to extract and encode a single
 * frame. Callers decide whether failures are fatal; /media treats them as
 * optional and simply omits the NIP-94 thumb tag.
 */

import type { ThumbnailConfig } from "../config/schema.ts";
import { debug } from "../middleware/debug.ts";

function ffmpegQuality(
  format: ThumbnailConfig["outputFormat"],
  quality: number,
): string[] {
  if (format === "png") return [];

  // ffmpeg q:v is inverse quality, 2 is high, 31 is low.
  const q = Math.round(31 - (quality / 100) * 29);
  return ["-q:v", String(Math.min(31, Math.max(2, q)))];
}

async function thumbnailImage(
  inputPath: string,
  opts: ThumbnailConfig,
): Promise<string> {
  const { default: sharp } = await import("sharp");
  const outputPath = await Deno.makeTempFile({
    suffix: `.${opts.outputFormat}`,
  });

  let pipeline = sharp(inputPath).rotate().resize(
    opts.maxWidth,
    opts.maxHeight,
    {
      fit: "inside",
      withoutEnlargement: true,
    },
  );

  switch (opts.outputFormat) {
    case "webp":
      pipeline = pipeline.webp({ quality: opts.quality });
      break;
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: opts.quality, progressive: true });
      break;
    case "png":
      pipeline = pipeline.png({ quality: opts.quality, progressive: true });
      break;
  }

  await pipeline.toFile(outputPath);
  return outputPath;
}

async function thumbnailVideo(
  inputPath: string,
  opts: ThumbnailConfig,
): Promise<string> {
  const outputPath = await Deno.makeTempFile({
    suffix: `.${opts.outputFormat}`,
  });
  const args = [
    "-ss",
    String(opts.videoSeek),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=w='min(${opts.maxWidth},iw)':h='min(${opts.maxHeight},ih)':force_original_aspect_ratio=decrease`,
    ...ffmpegQuality(opts.outputFormat, opts.quality),
    "-y",
    outputPath,
  ];

  const cmd = new Deno.Command("ffmpeg", {
    args,
    stdout: "null",
    stderr: "piped",
  });
  const { success, stderr } = await cmd.output();
  if (!success) {
    const stderrText = new TextDecoder().decode(stderr);
    if (stderrText.length > 0) {
      debug("[ffmpeg thumbnail stderr]\n" + stderrText);
    }
    throw new Error("ffmpeg thumbnail extraction failed");
  }

  return outputPath;
}

export async function createThumbnail(
  inputPath: string,
  mime: string | null,
  opts: ThumbnailConfig,
): Promise<string> {
  if (!opts.enabled) throw new Error("Thumbnail generation is disabled");
  if (mime?.startsWith("image/")) return await thumbnailImage(inputPath, opts);
  if (mime?.startsWith("video/")) return await thumbnailVideo(inputPath, opts);
  throw new Error(`Unsupported thumbnail MIME type: ${mime ?? "unknown"}`);
}
