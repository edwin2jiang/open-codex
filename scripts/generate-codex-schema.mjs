import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "generated/codex-schema");

rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });

const version = execFileSync(process.env.CODEX_BIN ?? "codex", ["--version"], {
  encoding: "utf8",
}).trim();

execFileSync(
  process.env.CODEX_BIN ?? "codex",
  ["app-server", "generate-ts", "--out", output],
  { stdio: "inherit" },
);

writeFileSync(
  resolve(output, "VERSION"),
  `${version}\nGenerated at ${new Date().toISOString()}\n`,
);

console.log(`Generated app-server bindings for ${version} in ${output}`);
