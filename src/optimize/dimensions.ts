/**
 * extractDimensions() — best-effort pixel dimension probing for images & videos.
 *
 * Returns a BUD blob-descriptor `dim` string ("<width>x<height>", e.g. "640x480")
 * or null when the blob is not a supported visual type, or when dimensions could
 * not be determined (corrupt header, missing ffprobe binary, etc.).
 *
 * This is intentionally non-throwing: a failure here must never fail an upload.
 *
 *   - Images (image/*, incl. animated GIF/WebP): sharp metadata().
 *   - Videos (video/*): the `ffprobe` system binary via Deno.Command.
 *
 * sharp is loaded lazily via dynamic import so it is never required when no
 * image is ever uploaded. ffprobe is a host binary and may be absent — that is
 * treated as "dimensions unknown", not an error.
 */

/** Format a width/height pair as the BUD `dim` string, or null if invalid. */
function formatDim(
  width?: number | null,
  height?: number | null,
): string | null {
  if (
    typeof width !== "number" || typeof height !== "number" ||
    !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0
  ) {
    return null;
  }
  return `${Math.round(width)}x${Math.round(height)}`;
}

/** Probe image dimensions with sharp. Returns null on any failure. */
async function probeImageDim(filePath: string): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(filePath).metadata();
    // For multi-frame inputs sharp reports the single-frame height in `pageHeight`
    // when `animated` is not set; metadata().height is the full canvas height
    // for a single page, which is what we want for the descriptor.
    return formatDim(meta.width, meta.height);
  } catch {
    return null;
  }
}

/** Minimal shape of the ffprobe JSON output we use for dimensions. */
interface FfprobeDimStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

interface FfprobeDimOutput {
  streams: FfprobeDimStream[];
}

/** Probe video dimensions with ffprobe. Returns null on any failure. */
async function probeVideoDim(filePath: string): Promise<string | null> {
  try {
    const cmd = new Deno.Command("ffprobe", {
      args: [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        filePath,
      ],
      stdout: "piped",
      stderr: "null",
    });

    const { success, stdout } = await cmd.output();
    if (!success) return null;

    const json: FfprobeDimOutput = JSON.parse(new TextDecoder().decode(stdout));
    const videoStream = json.streams.find((s) => s.codec_type === "video");
    if (!videoStream) return null;

    return formatDim(videoStream.width, videoStream.height);
  } catch {
    return null;
  }
}

/**
 * Extract the `dim` descriptor for a stored blob, given its on-disk path and
 * MIME type. Returns null for unsupported types or any extraction failure.
 */
export async function extractDimensions(
  filePath: string,
  mimeType: string | null,
): Promise<string | null> {
  if (!mimeType) return null;
  if (mimeType.startsWith("image/")) return await probeImageDim(filePath);
  if (mimeType.startsWith("video/")) return await probeVideoDim(filePath);
  return null;
}
