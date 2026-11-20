import { assertEquals } from "@std/assert";
import { UploadIsland } from "../../src/landing/upload-island.tsx";

Deno.test("landing island exposes optimization preset only when media is enabled", async () => {
  for (const mediaEnabled of [false, true]) {
    for (const optimizeByDefault of [false, true]) {
      const html = String(
        await UploadIsland({
          requireAuth: true,
          uploadEnabled: true,
          mediaEnabled,
          mediaRequireAuth: true,
          optimizeByDefault,
          mirrorEnabled: true,
          mirrorRequireAuth: true,
        }),
      );
      assertEquals(html.includes(`data-optimize-by-default="${mediaEnabled && optimizeByDefault}"`), true);
    }
  }
});
