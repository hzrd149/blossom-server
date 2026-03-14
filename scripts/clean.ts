/**
 * clean.ts — Remove all build artifacts so a fresh build is triggered on next startup.
 *
 * Removes:
 *   admin/dist/     — React Admin SPA (rebuilt by `deno task build-admin`)
 *   landing/dist/   — Landing page client JS (rebuilt by `deno task build-landing`)
 *
 * Run via: deno task clean
 */

const targets = [
  { path: "./admin/dist", label: "admin/dist" },
  { path: "./landing/dist", label: "landing/dist" },
];

let cleaned = 0;

for (const { path, label } of targets) {
  try {
    await Deno.remove(path, { recursive: true });
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

console.log(`\nClean complete. ${cleaned} director${cleaned === 1 ? "y" : "ies"} removed.`);
console.log("Run `deno task build` or start the server to rebuild.");
