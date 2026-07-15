#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supervisorPath = join(repositoryRoot, "scripts", "run-supervised-eval.mjs");
const FULL_CASE_WALL_TIMEOUT_MS = 20 * 60 * 1_000;

if (process.argv.length > 2) {
  throw new Error(
    "eval:full accepts no selectors; use `pnpm eval:feature -- <id-or-tag>` for targeted proof",
  );
}

const cases = await discoverEvalCases();
if (cases.length === 0) throw new Error("Eve discovered no eval cases.");

process.stdout.write(
  `Full live eval assurance: ${cases.length} cases, each with an independent supervised budget.\n`,
);

let activeChild;
let requestedSignal;
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    requestedSignal ??= signal;
    activeChild?.kill(signal);
  });
}

for (const [index, evalCase] of cases.entries()) {
  if (requestedSignal) break;
  process.stdout.write(
    `\n[${index + 1}/${cases.length}] ${evalCase.id}: ${evalCase.description ?? "No description"}\n`,
  );
  const result = await runCommand(
    process.execPath,
    [
      supervisorPath,
      "--",
      evalCase.id,
      "--max-concurrency",
      "1",
      "--verbose",
    ],
    {
      ...process.env,
      PAIGE_EVAL_WALL_TIMEOUT_MS:
        process.env.PAIGE_EVAL_FULL_CASE_WALL_TIMEOUT_MS ??
        String(FULL_CASE_WALL_TIMEOUT_MS),
    },
  );
  if (result !== 0) {
    process.exitCode = result;
    break;
  }
}

if (requestedSignal) {
  process.exitCode = requestedSignal === "SIGHUP" ? 129 : requestedSignal === "SIGINT" ? 130 : 143;
} else if (!process.exitCode) {
  process.stdout.write(`\nFull live eval assurance passed (${cases.length}/${cases.length}).\n`);
}

async function discoverEvalCases() {
  const { command, args } = pnpmCommand([
    "--filter",
    "docs-agent",
    "eval",
    "--list",
    "--json",
  ]);
  const { code, stdout, stderr } = await captureCommand(command, args);
  if (code !== 0) {
    throw new Error(`could not discover Eve evals: ${stderr.trim() || stdout.trim()}`);
  }

  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("Eve eval discovery did not return an array.");
  const ids = new Set();
  return parsed.map((entry) => {
    if (
      typeof entry?.id !== "string" ||
      entry.id.length === 0 ||
      ids.has(entry.id)
    ) {
      throw new Error("Eve eval discovery returned a missing or duplicate case id.");
    }
    ids.add(entry.id);
    return {
      description: typeof entry.description === "string" ? entry.description : undefined,
      id: entry.id,
    };
  });
}

function pnpmCommand(args) {
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { command: "pnpm", args };
}

function captureCommand(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      resolvePromise({ code: code ?? 1, signal, stderr, stdout });
    });
  });
}

function runCommand(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    activeChild = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: "inherit",
    });
    activeChild.once("error", rejectPromise);
    activeChild.once("close", (code) => {
      activeChild = undefined;
      resolvePromise(code ?? 1);
    });
  });
}
