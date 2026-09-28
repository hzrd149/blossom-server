import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, isAbsolute, join } from "@std/path";
import { PUBLIC_DIR, warnIfStylesheetMissing } from "../../src/routes/landing.tsx";

Deno.test("public assets resolve relative to the source module", async () => {
  const expected = fromFileUrl(new URL("../../public", import.meta.url));

  assert(isAbsolute(PUBLIC_DIR));
  assertEquals(PUBLIC_DIR, expected);
  assert((await Deno.stat(join(PUBLIC_DIR, "favicon.ico"))).isFile);
});

Deno.test("missing stylesheet warns without failing startup", async () => {
  const tmpDir = await Deno.makeTempDir();
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    const found = await warnIfStylesheetMissing(join(tmpDir, "missing.css"));
    assertEquals(found, false);
    assertEquals(warnings.length, 1);
    assert(String(warnings[0][0]).includes("pages will be unstyled"));
  } finally {
    console.warn = originalWarn;
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("stylesheet path that is not a file warns without failing startup", async () => {
  const tmpDir = await Deno.makeTempDir();
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    const found = await warnIfStylesheetMissing(tmpDir);
    assertEquals(found, false);
    assertEquals(warnings.length, 1);
    assert(String(warnings[0][0]).includes("is not a file"));
  } finally {
    console.warn = originalWarn;
    await Deno.remove(tmpDir, { recursive: true });
  }
});
