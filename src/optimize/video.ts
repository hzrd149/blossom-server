/**
 * Video transcoding using npm:fluent-ffmpeg.
 * Requires the `ffmpeg` binary to be installed on the host system.
 */

import ffmpeg from "fluent-ffmpeg";
import type { FfprobeData } from "fluent-ffmpeg";
import type { VideoOptimizeConfig } from "../config/schema.ts";

export type { VideoOptimizeConfig as VideoOptimizeOptions };

/** Extra output options applied per format regardless of codec choice. */
const FORMAT_EXTRA_ARGS: Partial<Record<"mp4" | "webm" | "mkv", string[]>> = {
  // faststart moves the moov atom to the front so browsers can start
  // playing before the full file is downloaded.
  mp4: ["-movflags", "+faststart"],
};

/**
 * Probe the source video frame rate using ffprobe.
 * Returns the average FPS as a number, or null on failure.
 */
function probeFps(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err: Error | null, metadata: FfprobeData) => {
      if (err || !metadata) {
        resolve(null);
        return;
      }
      const videoStream = metadata.streams.find(
        (s: FfprobeData["streams"][0]) => s.codec_type === "video",
      );
      if (!videoStream?.r_frame_rate) {
        resolve(null);
        return;
      }
      // r_frame_rate is a rational string like "30/1" or "24000/1001"
      const parts = videoStream.r_frame_rate.split("/");
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1] ?? "1");
      if (isNaN(num) || isNaN(den) || den === 0) {
        resolve(null);
        return;
      }
      resolve(num / den);
    });
  });
}

/**
 * Transcodes a video file using ffmpeg.
 * Returns the path to the transcoded temp file.
 * Caller is responsible for deleting the output file on any error.
 *
 * Quality → CRF mapping: CRF = round(51 − (quality / 100) × 51)
 *   quality=100 → CRF=0, quality=90 → CRF≈5, quality=0 → CRF=51
 *
 * Size filter: `?x<maxHeight>` — ffmpeg maintains aspect ratio automatically.
 */
export async function optimizeVideo(
  inputPath: string,
  opts: VideoOptimizeConfig,
): Promise<string> {
  const outputPath = await Deno.makeTempFile({ suffix: `.${opts.format}` });
  const crf = Math.round(51 - (opts.quality / 100) * 51);
  const extraArgs = FORMAT_EXTRA_ARGS[opts.format] ?? [];

  // Probe original FPS; clamp to min(originalFps, maxFps)
  const originalFps = await probeFps(inputPath);
  const targetFps = originalFps !== null
    ? Math.min(originalFps, opts.maxFps)
    : opts.maxFps;

  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .videoCodec(opts.videoCodec)
      .audioCodec(opts.audioCodec)
      // fit-inside: scale to maxHeight, preserve aspect ratio
      .videoFilters(`scale=trunc(oh*a/2)*2:${opts.maxHeight}`)
      .outputOptions([
        `-crf ${crf}`,
        `-r ${targetFps}`,
        ...extraArgs,
      ])
      .output(outputPath);

    cmd.on("end", () => resolve());
    cmd.on("error", (err: Error) => reject(err));
    cmd.run();
  });

  return outputPath;
}
