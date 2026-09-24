import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, isAbsolute, join } from "@std/path";
import { PUBLIC_DIR } from "../../src/routes/landing.tsx";

Deno.test("public assets resolve relative to the source module", async () => {
  const expected = fromFileUrl(new URL("../../public", import.meta.url));

  assert(isAbsolute(PUBLIC_DIR));
  assertEquals(PUBLIC_DIR, expected);
  assert((await Deno.stat(join(PUBLIC_DIR, "favicon.ico"))).isFile);
});
