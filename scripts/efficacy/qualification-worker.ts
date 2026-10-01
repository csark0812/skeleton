import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ownerActive, STORAGE_ENV, type StorageManifest } from "./qualification-storage.ts";

// Do not start artifact-producing work before the supervisor journals this process.
const payload = process.env[STORAGE_ENV];
const entry = process.argv[2];
if (!(payload && entry)) throw new Error("Qualification worker requires a supervised entrypoint.");
const deadline = Date.now() + 5000;
while (true) {
	const manifest = JSON.parse(
		readFileSync(join(dirname(payload), "owner.json"), "utf8"),
	) as StorageManifest;
	if (manifest.child?.pid === process.pid) break;
	if (!ownerActive(manifest.owner) || Date.now() > deadline)
		throw new Error("Qualification supervisor did not register its worker.");
	await new Promise((done) => setTimeout(done, 20));
}
process.argv.splice(1, 1);
await import(pathToFileURL(entry).href);
