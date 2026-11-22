/**
 * Common subprocess boundary for untrusted media. Only self-contained video
 * containers are accepted: no playlists, concat scripts or nested subtitle
 * demuxers. This is not an OS filesystem sandbox; deploy under a restricted user.
 */
import { MAX_INPUT_PIXELS } from "./limits.ts";

export const VIDEO_INPUT_ARGS = [
  "-protocol_whitelist",
  "file",
  "-format_whitelist",
  "mov,matroska,webm,avi,mpegts,mpeg,mpegvideo,ogg,flv",
  "-probesize",
  "5000000",
  "-analyzeduration",
  "5000000",
  "-threads",
  "2",
  "-max_pixels",
  String(MAX_INPUT_PIXELS),
];

const MAX_CAPTURE_BYTES = 64 * 1024;

/** Kill on deadline or excessive output, drain both pipes and reap before returning. */
export async function runMediaProcess(
  executable: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: Uint8Array; stderr: Uint8Array }> {
  const child = new Deno.Command(executable, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let failure: Error | undefined;
  const stop = (reason: string) => {
    failure ??= new Error(reason);
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may already have exited; still collect status and drain pipes.
    }
  };
  const timer = setTimeout(() => stop("Media processing timed out"), timeoutMs);
  async function capture(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
      if (size + chunk.length > MAX_CAPTURE_BYTES) {
        stop("Media process output exceeded limit");
        continue;
      }
      size += chunk.length;
      chunks.push(chunk);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
  try {
    const [stdout, stderr, status] = await Promise.all([
      capture(child.stdout),
      capture(child.stderr),
      child.status,
    ]);
    if (failure) throw failure;
    if (!status.success) throw new Error(`${executable} failed to process media`);
    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
    try {
      child.kill("SIGKILL");
    } catch {
      // Already reaped.
    }
    await child.status;
  }
}

export interface VideoMetadata {
  width: number;
  height: number;
  r_frame_rate?: string;
  duration?: string;
}

export async function probeVideo(inputPath: string): Promise<{ video: VideoMetadata; duration: number }> {
  const { stdout } = await runMediaProcess("ffprobe", [
    "-v",
    "error",
    ...VIDEO_INPUT_ARGS,
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,duration:format=duration",
    "-of",
    "json",
    "-i",
    inputPath,
  ], 10_000);
  const data = JSON.parse(new TextDecoder().decode(stdout));
  const video: VideoMetadata | undefined = data.streams?.[0];
  if (!video) throw new Error("No video stream found");
  return { video, duration: Number(data.format?.duration ?? video.duration) };
}
