/**
 * Best-effort thumbnail generation for optimized media outputs.
 *
 * Images use sharp directly. Videos use ffmpeg to extract and encode a single
 * frame. Callers decide whether failures are fatal; /media treats them as
 * optional and simply omits the NIP-94 thumb tag.
 */

import type { ThumbnailConfig } from "../config/schema.ts";
import { debug } from "../middleware/debug.ts";
import { openImage } from "./image-input.ts";
import { runMediaProcess, VIDEO_INPUT_ARGS } from "./process.ts";

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
  tmpDir: string,
): Promise<string> {
  let pipeline = (await openImage(inputPath)).rotate().resize(
    opts.maxWidth,
    opts.maxHeight,
    { fit: "inside", withoutEnlargement: true },
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

async function thumbnailVideo(
  inputPath: string,
  opts: ThumbnailConfig,
  tmpDir: string,
): Promise<string> {
  const outputPath = await Deno.makeTempFile({
    dir: tmpDir,
    suffix: `.${opts.outputFormat}`,
  });
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...VIDEO_INPUT_ARGS,
    "-ss",
    String(opts.videoSeek),
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-vf",
    `scale=w='min(${opts.maxWidth},iw)':h='min(${opts.maxHeight},ih)':force_original_aspect_ratio=decrease`,
    ...ffmpegQuality(opts.outputFormat, opts.quality),
    "-threads",
    "2",
    "-filter_threads",
    "1",
    "-y",
    outputPath,
  ];

  try {
    const { stderr } = await runMediaProcess("ffmpeg", args, 30_000);
    if (stderr.length) debug("[ffmpeg thumbnail stderr]\n" + new TextDecoder().decode(stderr));
    return outputPath;
  } catch (err) {
    await Deno.remove(outputPath).catch(() => {});
    throw err;
  }
}

export async function createThumbnail(
  inputPath: string,
  mime: string | null,
  opts: ThumbnailConfig,
  tmpDir: string,
): Promise<string> {
  await Deno.mkdir(tmpDir, { recursive: true });

  if (!opts.enabled) throw new Error("Thumbnail generation is disabled");
  if (mime?.startsWith("image/")) {
    return await thumbnailImage(inputPath, opts, tmpDir);
  }
  if (mime?.startsWith("video/")) {
    return await thumbnailVideo(inputPath, opts, tmpDir);
  }
  throw new Error(`Unsupported thumbnail MIME type: ${mime ?? "unknown"}`);
}
