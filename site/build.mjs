// Assembles the publishable page in site/dist: the static files, the deployment addresses, and (with
// --snapshot) a copy of the live state so the page fills at once and survives a public RPC outage.
//   node site/build.mjs [--snapshot]

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const site = dirname(fileURLToPath(import.meta.url));
const dist = join(site, "dist");
const deploymentPath = join(site, "..", "deployments", "testnet.json");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of ["index.html", "styles.css", "js"]) await cp(join(site, entry), join(dist, entry), { recursive: true });
const deployment = JSON.parse(await readFile(deploymentPath, "utf8"));
await writeFile(join(dist, "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
await writeFile(join(dist, ".nojekyll"), "");

// The page always asks for snapshot.json; `null` means there is none.
await writeFile(join(dist, "snapshot.json"), "null\n");
if (process.argv.includes("--snapshot")) {
  const { loadState } = await import("./js/chain.js");
  try {
    const state = await loadState(deployment);
    await writeFile(join(dist, "snapshot.json"), JSON.stringify(state));
    console.log(`snapshot: ${Object.keys(state.proposals).length} proposals, Base block ${state.base.head.block}, Lasna block ${state.lasna.head.block}`);
  } catch (error) {
    // The page works without a snapshot; a testnet outage must not block publishing.
    console.warn(`snapshot skipped: ${error.message}`);
  }
}
console.log(`built ${dist}`);
