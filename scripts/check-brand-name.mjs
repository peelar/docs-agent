import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoots = [
  "AGENTS.md",
  "README.md",
  ".codex",
  "apps",
  "docs",
  "packages",
  "scripts",
];
const sourceExtensions = new Set([
  ".js",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const excludedDirectories = new Set([
  ".eve",
  ".next",
  ".output",
  ".turbo",
  ".vercel",
  "dist",
  "node_modules",
]);
const formerProductNames = [
  new RegExp(`\\b${["docs", "agent"].join("\\s+")}\\b`, "iu"),
  new RegExp(`\\b${["docs", "maintainer", "agent"].join("\\s+")}\\b`, "iu"),
];

const violations = [];

for (const sourceRoot of sourceRoots) {
  await inspect(join(repositoryRoot, sourceRoot));
}

if (violations.length > 0) {
  throw new Error(
    `Use Paige as the human-facing product name:\n${violations.join("\n")}`,
  );
}

console.log("Paige brand-name checks passed.");

async function inspect(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (entries === null) {
    if (sourceExtensions.has(extname(path))) await inspectFile(path);
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await inspect(child);
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      await inspectFile(child);
    }
  }
}

async function inspectFile(path) {
  const lines = (await readFile(path, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    if (formerProductNames.some((pattern) => pattern.test(line))) {
      violations.push(`${relative(repositoryRoot, path)}:${index + 1}`);
    }
  }
}
