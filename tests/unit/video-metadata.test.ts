import { assertEquals } from "@std/assert";
import { ConfigSchema } from "../../src/config/schema.ts";
import { runMediaProcess } from "../../src/optimize/process.ts";
import { optimizeVideo } from "../../src/optimize/video.ts";

Deno.test("video transcodes strip source metadata and chapters unless explicitly kept", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const metadata = `${dir}/metadata.txt`;
    await Deno.writeTextFile(
      metadata,
      [
        ";FFMETADATA1",
        "title=Private title",
        "location=+12.3456+123.4567/",
        "[CHAPTER]",
        "TIMEBASE=1/1000",
        "START=0",
        "END=1000",
        "title=Private chapter",
      ].join("\n") + "\n",
    );
    const input = `${dir}/input.mkv`;
    await runMediaProcess("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=size=32x32:rate=1",
      "-f",
      "ffmetadata",
      "-i",
      metadata,
      "-map",
      "0:v:0",
      "-map_metadata",
      "1",
      "-map_chapters",
      "1",
      "-metadata:s:v:0",
      "title=Private stream",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      input,
    ], 10_000);
    const probe = async (path: string) => {
      const { stdout } = await runMediaProcess("ffprobe", [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        "-of",
        "json",
        path,
      ], 10_000);
      return JSON.parse(new TextDecoder().decode(stdout));
    };
    const source = await probe(input);
    assertEquals(source.format.tags.title, "Private title");
    assertEquals(source.chapters.length, 1);
    const defaults = ConfigSchema.parse({}).media.video;
    for (const format of ["mp4", "mkv", "webm"] as const) {
      for (const keepMetadata of [false, true]) {
        const output = await optimizeVideo(input, {
          ...defaults,
          format,
          keepMetadata,
          ...(format === "webm" ? { videoCodec: "vp9", audioCodec: "opus" } : {}),
        }, dir);
        const result = await probe(output);
        const tags = Object.fromEntries(
          Object.entries(result.format.tags).map(([key, value]) => [key.toLowerCase(), value]),
        );
        assertEquals(tags.title, keepMetadata ? "Private title" : undefined, `${format}: title`);
        assertEquals(tags.location, keepMetadata ? "+12.3456+123.4567/" : undefined, `${format}: location`);
        assertEquals(result.chapters.length, keepMetadata ? 1 : 0, `${format}: chapters`);
        if (!keepMetadata) {
          for (const stream of result.streams) {
            assertEquals(stream.tags?.title, undefined, `${format}: stream title`);
          }
        }
      }
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
