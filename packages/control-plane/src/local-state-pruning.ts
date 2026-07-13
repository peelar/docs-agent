import { execFileSync } from "node:child_process";
import { existsSync, readlinkSync, readdirSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const localStateNames = new Set([
  ".docs-agent",
  ".env.local",
  ".eve",
  ".vercel",
  ".workflow-data",
]);
const excludedTreeNames = new Set([".git", "node_modules"]);

export type StoppedDevProcess = {
  pid: number;
  command: string;
};

export type LocalStatePruneResult = {
  removedPaths: string[];
  stoppedDevProcesses: StoppedDevProcess[];
};

export type LocalGitState = {
  clean: boolean;
  ahead: number;
  behind: number;
  stashCount: number;
  activeOperations: string[];
};

export async function pruneLocalState(input: {
  repositoryRoot: string;
  stopDevProcesses?: boolean;
}): Promise<LocalStatePruneResult> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const stoppedDevProcesses = input.stopDevProcesses === false
    ? []
    : await stopPaigeDevProcesses(repositoryRoot);
  const removedPaths: string[] = [];

  await removeLocalStateUnder(repositoryRoot, repositoryRoot, removedPaths);

  const remainingPaths = await findLocalStatePaths(repositoryRoot);
  if (remainingPaths.length > 0) {
    throw new Error(
      `Paige local state was recreated during pruning: ${remainingPaths.join(", ")}`,
    );
  }

  return {
    removedPaths: removedPaths.sort(),
    stoppedDevProcesses,
  };
}

export async function findLocalStatePaths(repositoryRoot: string): Promise<string[]> {
  const root = resolve(repositoryRoot);
  const paths: string[] = [];
  await collectLocalStateUnder(root, root, paths);
  return paths.sort();
}

export function inspectLocalGitState(repositoryRoot: string): LocalGitState {
  const root = resolve(repositoryRoot);
  const status = commandOutput("git", ["status", "--porcelain=v2", "--branch"], root);
  const branchLine = status.split("\n").find((line) => line.startsWith("# branch.ab "));
  const branchMatch = branchLine?.match(/\+(\d+) -(\d+)/u);
  const activeOperations = [
    ["MERGE_HEAD", "merge"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
    ["BISECT_LOG", "bisect"],
    ["rebase-apply", "rebase"],
    ["rebase-merge", "rebase"],
    ["sequencer", "sequencer"],
    ["index.lock", "index-lock"],
  ]
    .filter(([marker]) => existsSync(resolve(root, ".git", marker!)))
    .map(([, operation]) => operation!);

  return {
    clean: status.split("\n").every((line) => line === "" || line.startsWith("#")),
    ahead: Number(branchMatch?.[1] ?? 0),
    behind: Number(branchMatch?.[2] ?? 0),
    stashCount: commandOutput("git", ["stash", "list"], root)
      .split("\n")
      .filter(Boolean)
      .length,
    activeOperations: [...new Set(activeOperations)],
  };
}

export function isPaigeDevCommand(command: string): boolean {
  return (
    /\b(?:pnpm|npm|yarn|bun)\b[^\n]*\bdev\b/u.test(command) ||
    /\b(?:turbo\s+run|eve|next)\s+dev\b/u.test(command)
  );
}

async function stopPaigeDevProcesses(
  repositoryRoot: string,
): Promise<StoppedDevProcess[]> {
  const repositoryPids = process.platform === "linux"
    ? linuxProcessesUnder(repositoryRoot)
    : lsofProcessesUnder(repositoryRoot);
  const candidates = repositoryPids
    .map((pid) => ({ pid, command: processCommand(pid) }))
    .filter(({ pid, command }) => pid !== process.pid && isPaigeDevCommand(command));

  if (candidates.length === 0) return [];

  const processChildren = readProcessChildren();
  const toStop = new Set<number>();
  const addTree = (pid: number) => {
    for (const child of processChildren.get(pid) ?? []) addTree(child);
    toStop.add(pid);
  };
  for (const { pid } of candidates) addTree(pid);
  toStop.delete(process.pid);

  for (const pid of toStop) signalProcess(pid, "SIGTERM");
  const deadline = Date.now() + 3_000;
  while ([...toStop].some(processIsAlive) && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  for (const pid of toStop) {
    if (processIsAlive(pid)) signalProcess(pid, "SIGKILL");
  }

  return candidates.sort((left, right) => left.pid - right.pid);
}

async function removeLocalStateUnder(
  root: string,
  directory: string,
  removedPaths: string[],
): Promise<void> {
  for (const entry of await safeReadDirectory(directory)) {
    if (excludedTreeNames.has(entry.name)) continue;
    const entryPath = resolve(directory, entry.name);
    if (localStateNames.has(entry.name)) {
      await rm(entryPath, { recursive: true, force: true });
      removedPaths.push(relative(root, entryPath));
    } else if (entry.isDirectory()) {
      await removeLocalStateUnder(root, entryPath, removedPaths);
    }
  }
}

async function collectLocalStateUnder(
  root: string,
  directory: string,
  paths: string[],
): Promise<void> {
  for (const entry of await safeReadDirectory(directory)) {
    if (excludedTreeNames.has(entry.name)) continue;
    const entryPath = resolve(directory, entry.name);
    if (localStateNames.has(entry.name)) {
      paths.push(relative(root, entryPath));
    } else if (entry.isDirectory()) {
      await collectLocalStateUnder(root, entryPath, paths);
    }
  }
}

async function safeReadDirectory(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

function linuxProcessesUnder(repositoryRoot: string): number[] {
  return readdirSync("/proc", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
    .map((entry) => Number(entry.name))
    .filter((pid) => {
      try {
        return pathIsWithin(repositoryRoot, readlinkSync(`/proc/${pid}/cwd`));
      } catch {
        return false;
      }
    });
}

function lsofProcessesUnder(repositoryRoot: string): number[] {
  const output = commandOutput(
    "lsof",
    ["-a", "-d", "cwd", "+D", repositoryRoot, "-Fp"],
    repositoryRoot,
    true,
  );
  return output
    .split("\n")
    .filter((line) => /^p\d+$/u.test(line))
    .map((line) => Number(line.slice(1)));
}

function readProcessChildren(): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of commandOutput("ps", ["-axo", "pid=,ppid="], undefined).split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/u);
    const pid = Number(pidText);
    const parent = Number(parentText);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }
  return children;
}

function processCommand(pid: number): string {
  return commandOutput("ps", ["-p", String(pid), "-o", "command="], undefined, true).trim();
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ESRCH") throw error;
  }
}

function commandOutput(
  command: string,
  args: string[],
  cwd?: string,
  allowFailure = false,
): string {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

function pathIsWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
