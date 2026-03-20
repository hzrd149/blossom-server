/**
 * clean.ts — Remove all build artifacts so a fresh build is triggered on next startup.
 *
 * Removes:
 *   public/client.js   — Landing page client JS (pre-built by `deno task build-landing`)
 *
 * Run via: deno task clean
 */

const targets = [{ path: "./public/client.js", label: "public/client.js" }];

let cleaned = 0;

for (const { path, label } of targets) {
  try {
    await Deno.remove(path);
    console.log(`  removed  ${label}`);
    cleaned++;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      console.log(`  skipped  ${label} (not found)`);
    } else {
      console.error(`  error    ${label}: ${err}`);
    }
  }
}

console.log(`\nClean complete. ${cleaned} file${cleaned === 1 ? "" : "s"} removed.`);
console.log("Run `deno task build` or start the server to rebuild.");
