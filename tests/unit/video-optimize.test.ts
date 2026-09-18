import { assertEquals } from "@std/assert";
import type { VideoOptimizeConfig } from "../../src/config/schema.ts";
import { buildVideoArgs } from "../../src/optimize/video.ts";

const baseOpts: VideoOptimizeConfig = {
  quality: 90,
  maxHeight: 1080,
  maxFps: 30,
  format: "mp4",
  audioCodec: "aac",
  videoCodec: "libx264",
  keepMetadata: false,
};

Deno.test("buildVideoArgs: strips metadata by default", () => {
  const args = buildVideoArgs("/tmp/in.mp4", "/tmp/out.mp4", baseOpts, 30);

  assertEquals(args.includes("-map_metadata"), true);
  assertEquals(args.includes("-map_chapters"), true);

  // Both must be output options: after the input path, before the output path.
  const inputIdx = args.indexOf("/tmp/in.mp4");
  const outputIdx = args.lastIndexOf("/tmp/out.mp4");
  const mapIdx = args.indexOf("-map_metadata");
  assertEquals(mapIdx > inputIdx, true);
  assertEquals(mapIdx < outputIdx, true);
});

Deno.test("buildVideoArgs: keepMetadata preserves container metadata", () => {
  const args = buildVideoArgs(
    "/tmp/in.mp4",
    "/tmp/out.mp4",
    { ...baseOpts, keepMetadata: true },
    30,
  );

  assertEquals(args.includes("-map_metadata"), false);
  assertEquals(args.includes("-map_chapters"), false);
});

Deno.test("buildVideoArgs: CRF mapping, fps clamp target and format extras", () => {
  const args = buildVideoArgs("/tmp/in.mp4", "/tmp/out.mp4", baseOpts, 25);

  // quality=90 → CRF=round(51 − 0.9×51)=5
  assertEquals(args[args.indexOf("-crf") + 1], "5");
  // probed fps (25) wins over maxFps when lower
  assertEquals(args[args.indexOf("-r") + 1], "25");
  // mp4 container extras are still applied
  assertEquals(args.includes("-movflags"), true);
  assertEquals(args.includes("+faststart"), true);
});
