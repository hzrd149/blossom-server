import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ConfigSchema } from "../../src/config/schema.ts";
import { optimizeGif, optimizeImage } from "../../src/optimize/image.ts";
import { extractDimensions } from "../../src/optimize/dimensions.ts";
import { checkAnimation, checkDimensions, metadataGate, ProcessingGate } from "../../src/optimize/limits.ts";
import { probeVideo, runMediaProcess, VIDEO_INPUT_ARGS } from "../../src/optimize/process.ts";
import { createThumbnail } from "../../src/optimize/thumbnail.ts";
import { optimizeVideo } from "../../src/optimize/video.ts";
import sharp from "sharp";

Deno.test("processing gate has no queue and releases only once", () => {
  const gate = new ProcessingGate(1);
  const release = gate.tryAcquire()!;
  assertEquals(gate.available, false);
  assertEquals(gate.tryAcquire(), null);
  release();
  const second = gate.tryAcquire()!;
  release();
  assertEquals(gate.tryAcquire(), null);
  second();
  assertEquals(gate.available, true);
});

Deno.test("input budgets reject oversized dimensions and animation totals", () => {
  checkDimensions(1920, 1080);
  checkAnimation(100, 100, 300);
  for (const [w, h] of [[65000, 65000], [16385, 1], [8000, 8000], [NaN, 1], [0, 1]]) {
    assertThrows(() => checkDimensions(w, h));
  }
  assertThrows(() => checkAnimation(1, 1, 301));
  assertThrows(() => checkAnimation(1000, 1000, 101));
});

Deno.test("subprocess deadlines kill and reap before returning", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const pidPath = `${dir}/pid`;
    await assertRejects(
      () =>
        runMediaProcess(Deno.execPath(), [
          "eval",
          `Deno.writeTextFileSync(${JSON.stringify(pidPath)}, String(Deno.pid)); setInterval(() => {}, 1000)`,
        ], 1000),
      Error,
      "timed out",
    );
    const pid = Number(await Deno.readTextFile(pidPath));
    assertThrows(() => Deno.kill(pid, 0));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("subprocess capture is bounded on both pipes", async () => {
  for (const stream of ["stdout", "stderr"]) {
    await assertRejects(
      () =>
        runMediaProcess(Deno.execPath(), [
          "eval",
          `await Deno.${stream}.write(new Uint8Array(100000));`,
        ], 5000),
      Error,
      "output exceeded limit",
    );
  }
});

Deno.test("video input policy excludes network protocols and script demuxers", () => {
  assertEquals(VIDEO_INPUT_ARGS[VIDEO_INPUT_ARGS.indexOf("-protocol_whitelist") + 1], "file");
  const formats = VIDEO_INPUT_ARGS[VIDEO_INPUT_ARGS.indexOf("-format_whitelist") + 1].split(",");
  for (const excluded of ["hls", "concat", "dash", "srt", "tty"]) assertEquals(formats.includes(excluded), false);
});

Deno.test("video probing rejects playlists and scripts; dimensions remain best effort", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const segment = `${dir}/segment.ts`;
    await runMediaProcess("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=size=32x32:rate=25",
      "-t",
      "1",
      "-c:v",
      "mpeg2video",
      "-threads",
      "1",
      segment,
    ], 10_000);
    for (
      const content of [
        "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:9/dummy.ts\n#EXT-X-ENDLIST\n",
        `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${segment}\n#EXT-X-ENDLIST\n`,
        `ffconcat version 1.0\nfile '${segment}'\n`,
      ]
    ) {
      const path = `${dir}/upload`;
      await Deno.writeTextFile(path, content);
      await assertRejects(() => probeVideo(path));
      assertEquals(await extractDimensions(path, "video/mp4"), null);
    }
    const a = metadataGate.tryAcquire()!;
    const b = metadataGate.tryAcquire()!;
    try {
      assertEquals(await extractDimensions("unused", "video/mp4"), null);
    } finally {
      a();
      b();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("small video still probes, transcodes and thumbnails under restricted policy", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const input = `${dir}/input.mp4`;
    await runMediaProcess("ffmpeg", [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=size=32x32:rate=1",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      input,
    ], 10_000);
    assertEquals(await extractDimensions(input, "video/mp4"), "32x32");
    const config = ConfigSchema.parse({}).media;
    const output = await optimizeVideo(input, config.video, dir);
    assertEquals((await probeVideo(output)).video.width, 32);
    const thumb = await createThumbnail(output, "video/mp4", { ...config.thumbnail, videoSeek: 0 }, dir);
    assertEquals((await sharp(thumb).metadata()).width, 32);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("failed encodes remove their output and oversized image headers are rejected", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const config = ConfigSchema.parse({}).media;
    // Width-only budget avoids allocating a large decoded image.
    const wide = `${dir}/wide.png`;
    await sharp({ create: { width: 16385, height: 1, channels: 3, background: "red" } }).png().toFile(wide);
    await assertRejects(() => optimizeImage(wide, config.image, dir), Error, "dimension");
    // WebP cannot encode a side of 16384, so this fails after creating a temp file.
    const tall = `${dir}/tall.png`;
    await sharp({ create: { width: 1, height: 16384, channels: 3, background: "red" } }).png().toFile(tall);
    await assertRejects(() => optimizeImage(tall, { ...config.image, maxWidth: 1, maxHeight: 16384 }, dir));
    const names = [];
    for await (const entry of Deno.readDir(dir)) names.push(entry.name);
    assertEquals(names.sort(), ["tall.png", "wide.png"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("animated GIF frame budget rejects before output allocation; ordinary animation still works", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const config = ConfigSchema.parse({}).media;
    for (const frames of [2, 301]) {
      const input = `${dir}/${frames}.gif`;
      const pixels = new Uint8Array(frames * 3);
      for (let frame = 0; frame < frames; frame++) pixels[frame * 3] = (frame % 2) * 255;
      await sharp(pixels, {
        raw: { width: 1, height: frames, channels: 3, pageHeight: 1 },
      }).gif({ keepDuplicateFrames: true }).toFile(input);
      assertEquals((await sharp(input).metadata()).pages, frames);
      if (frames === 301) {
        await assertRejects(() => optimizeGif(input, config.image, dir), Error, "animation");
      } else {
        const output = await optimizeGif(input, config.image, dir);
        assertEquals((await sharp(output).metadata()).pages, 2);
        await Deno.remove(output);
      }
    }
    const names = [];
    for await (const entry of Deno.readDir(dir)) names.push(entry.name);
    assertEquals(names.sort(), ["2.gif", "301.gif"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
