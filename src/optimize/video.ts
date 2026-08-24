/**
 * Video transcoding using the `ffmpeg` and `ffprobe` system binaries directly
 * via Deno.Command. No npm wrapper dependency required.
 *
 * Requires `ffmpeg` and `ffprobe` to be installed on the host system.
 */

import type { VideoOptimizeConfig } from "../config/schema.ts";
import { debug } from "../middleware/debug.ts";

export type { VideoOptimizeConfig as VideoOptimizeOptions };

/** Extra output options applied per format regardless of codec choice. */
const FORMAT_EXTRA_ARGS: Partial<Record<"mp4" | "webm" | "mkv", string[]>> = {
  // faststart moves the moov atom to the front so browsers can start
  // playing before the full file is downloaded.
  mp4: ["-movflags", "+faststart"],
};

/** Minimal shape of the ffprobe JSON output we actually use. */
interface FfprobeStream {
  codec_type?: string;
  r_frame_rate?: string;
}

interface FfprobeOutput {
  streams: FfprobeStream[];
}

/**
 * Probe the source video frame rate using ffprobe.
 * Returns the average FPS as a number, or null on failure.
 */
async function probeFps(inputPath: string): Promise<number | null> {
  try {
    const cmd = new Deno.Command("ffprobe", {
      args: [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        inputPath,
      ],
      stdout: "piped",
      stderr: "null",
    });

    const { success, stdout } = await cmd.output();
    if (!success) return null;

    const json: FfprobeOutput = JSON.parse(new TextDecoder().decode(stdout));
    const videoStream = json.streams.find((s) => s.codec_type === "video");
    if (!videoStream?.r_frame_rate) return null;

    // r_frame_rate is a rational string like "30/1" or "24000/1001"
    const parts = videoStream.r_frame_rate.split("/");
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1] ?? "1");
    if (isNaN(num) || isNaN(den) || den === 0) return null;

    return num / den;
  } catch {
    return null;
  }
}

/**
 * Builds the ffmpeg argument list for a /media video transcode.
 * Pure function — exported so unit tests can assert on the exact invocation
 * without running ffmpeg.
 *
 * Quality → CRF mapping: CRF = round(51 − (quality / 100) × 51)
 *   quality=100 → CRF=0, quality=90 → CRF≈5, quality=0 → CRF=51
 *
 * Size filter: `?x<maxHeight>` — ffmpeg maintains aspect ratio automatically.
 *
 * When `opts.keepMetadata` is false (the default), the output options
 * `-map_metadata -1 -map_chapters -1` are included: container metadata
 * (titles, encoder tags, creation info) and chapters are stripped from the
 * transcoded file — mirroring the image pipeline's EXIF stripping.
 */
export function buildVideoArgs(
  inputPath: string,
  outputPath: string,
  opts: VideoOptimizeConfig,
  targetFps: number,
): string[] {
  const crf = Math.round(51 - (opts.quality / 100) * 51);
  const extraArgs = FORMAT_EXTRA_ARGS[opts.format] ?? [];

  return [
    "-i",
    inputPath,
    "-vcodec",
    opts.videoCodec,
    "-acodec",
    opts.audioCodec,
    // fit-inside: scale to maxHeight, preserve aspect ratio
    "-vf",
    `scale=trunc(oh*a/2)*2:${opts.maxHeight}`,
    "-crf",
    String(crf),
    "-r",
    String(targetFps),
    // output options: strip container metadata + chapters unless kept
    ...(opts.keepMetadata
      ? []
      : ["-map_metadata", "-1", "-map_chapters", "-1"]),
    ...extraArgs,
    "-y", // overwrite output without prompting (temp file already exists)
    outputPath,
  ];
}

/**
 * Transcodes a video file using ffmpeg.
 * Returns the path to the transcoded temp file.
 * Caller is responsible for deleting the output file on any error.
 */
export async function optimizeVideo(
  inputPath: string,
  opts: VideoOptimizeConfig,
  tmpDir: string,
): Promise<string> {
  const outputPath = await Deno.makeTempFile({
    dir: tmpDir,
    suffix: `.${opts.format}`,
  });

  // Probe original FPS; clamp to min(originalFps, maxFps)
  const originalFps = await probeFps(inputPath);
  const targetFps = originalFps !== null
    ? Math.min(originalFps, opts.maxFps)
    : opts.maxFps;

  const args = buildVideoArgs(inputPath, outputPath, opts, targetFps);

  const cmd = new Deno.Command("ffmpeg", {
    args,
    stdout: "null",
    stderr: "piped",
  });

  const { success, stderr } = await cmd.output();

  if (!success) {
    const stderrText = new TextDecoder().decode(stderr);
    if (stderrText.length > 0) {
      debug("[ffmpeg stderr]\n" + stderrText);
    }
    throw new Error(`ffmpeg exited with non-zero status`);
  }

  return outputPath;
}
