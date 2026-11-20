import { assertEquals } from "@std/assert";
import { isMediaFile } from "./helpers.ts";

Deno.test("optimization eligibility matches supported image formats and video", () => {
  for (
    const type of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
    ]
  ) {
    assertEquals(isMediaFile(new File([], "input", { type })), true, type);
  }
  for (
    const type of [
      "image/svg+xml",
      "image/avif",
      "image/heic",
      "image/tiff",
      "audio/mpeg",
      "text/plain",
      "",
    ]
  ) {
    assertEquals(isMediaFile(new File([], "input", { type })), false, type);
  }
});
