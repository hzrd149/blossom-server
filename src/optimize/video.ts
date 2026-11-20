/**
 * Video transcoding using the `ffmpeg` and `ffprobe` system binaries directly
 * via Deno.Command. No npm wrapper dependency required.
 *
 * Requires `ffmpeg` and `ffprobe` to be installed on the host system.
 */

import type { VideoOptimizeConfig } from "../config/schema.ts";
import { debug } from "../middleware/debug.ts";
import { checkDimensions, MAX_OUTPUT_BYTES, MAX_VIDEO_SECONDS } from "./limits.ts";
import { probeVideo, runMediaProcess, VIDEO_INPUT_ARGS } from "./process.ts";

export type { VideoOptimizeConfig as VideoOptimizeOptions };

/** Extra output options applied per format regardless of codec choice. */
const FORMAT_EXTRA_ARGS: Partial<Record<"mp4" | "webm" | "mkv", string[]>> = {
  // faststart moves the moov atom to the front so browsers can start
  // playing before the full file is downloaded.
  mp4: ["-movflags", "+faststart"],
};

/**
 * Transcodes a video file using ffmpeg.
 * Returns the path to the transcoded temp file.
 * Removes partial output on error.
 *
 * Quality → CRF mapping: CRF = round(51 − (quality / 100) × 51)
 *   quality=100 → CRF=0, quality=90 → CRF≈5, quality=0 → CRF=51
 *
 * Fit inside the configured height and the fixed output budget, preserving aspect ratio.
 */
export async function optimizeVideo(
  inputPath: string,
  opts: VideoOptimizeConfig,
  tmpDir: string,
): Promise<string> {
  const { video, duration } = await probeVideo(inputPath);
  checkDimensions(video.width, video.height);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) {
    throw new Error(`Video duration must be known and at most ${MAX_VIDEO_SECONDS} seconds`);
  }
  const [num, den = 1] = (video.r_frame_rate ?? "").split("/").map(Number);
  const originalFps = num / den;
  const maxFps = Math.min(opts.maxFps, 60);
  const targetFps = Number.isFinite(originalFps) && originalFps > 0 ? Math.min(originalFps, maxFps) : maxFps;
  const outputPath = await Deno.makeTempFile({
    dir: tmpDir,
    suffix: `.${opts.format}`,
  });
  const crf = Math.round(51 - (opts.quality / 100) * 51);
  const extraArgs = FORMAT_EXTRA_ARGS[opts.format] ?? [];

  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    ...VIDEO_INPUT_ARGS,
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-sn",
    "-dn",
    "-vcodec",
    opts.videoCodec,
    "-acodec",
    opts.audioCodec,
    // fit-inside: scale to maxHeight, preserve aspect ratio
    "-vf",
    `scale=w='min(${Math.min(opts.maxHeight * 2, 3840)},iw)':h='min(${
      Math.min(opts.maxHeight, 2160)
    },ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    "-crf",
    String(crf),
    "-r",
    String(targetFps),
    "-threads",
    "2",
    "-filter_threads",
    "1",
    "-t",
    String(MAX_VIDEO_SECONDS),
    "-fs",
    String(MAX_OUTPUT_BYTES),
    // Disable automatic copying of source metadata and chapters, not encoder-generated tags.
    ...(opts.keepMetadata ? [] : ["-map_metadata", "-1", "-map_chapters", "-1"]),
    ...extraArgs,
    "-y", // overwrite output without prompting (temp file already exists)
    outputPath,
  ];

  try {
    const { stderr } = await runMediaProcess("ffmpeg", args, 300_000);
    if (stderr.length) debug("[ffmpeg stderr]\n" + new TextDecoder().decode(stderr));
    if ((await Deno.stat(outputPath)).size >= MAX_OUTPUT_BYTES) {
      throw new Error("Optimized video exceeds output size limit");
    }
    return outputPath;
  } catch (err) {
    await Deno.remove(outputPath).catch(() => {});
    throw err;
  }
}
