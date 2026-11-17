// Writes settings.schema.json from lib/settings/definitions.ts.
// `--check` fails when the committed file is out of date instead.
import { readFileSync, writeFileSync } from "node:fs";
import { seedJsonSchema } from "../lib/settings/definitions.ts";

const path = new URL("../settings.schema.json", import.meta.url);
const next = `${JSON.stringify(seedJsonSchema(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {}
  if (current !== next) {
    console.error("settings.schema.json is out of date; run pnpm settings:schema");
    process.exit(1);
  }
} else {
  writeFileSync(path, next);
  console.log("wrote settings.schema.json");
}
