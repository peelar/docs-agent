import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

type EvalDatabaseState = {
  dataDirectory: string;
  databaseUrl: string;
  migration?: Promise<void>;
};

const stateKey = "__paigeEvalDatabaseState__";
const globals = globalThis as typeof globalThis & {
  [stateKey]?: EvalDatabaseState;
};
const state = globals[stateKey] ??= createEvalDatabaseState();
activateEvalDatabase();

export async function initializeEvalDatabase(
  migrate: () => Promise<unknown>,
): Promise<void> {
  activateEvalDatabase();
  state.migration ??= migrate().then(() => undefined);
  await state.migration;
}

export function evalSandboxSuffix(scope: string): string {
  const normalizedScope = scope.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return `${normalizedScope}-${basename(state.dataDirectory)}`;
}

export function importEvalRuntimeModule<Module>(specifier: string): Promise<Module> {
  return import(specifier) as Promise<Module>;
}

export async function saveEvalWorkspaceSetup<Input>(
  save: (input: Input) => Promise<unknown>,
  input: Input,
): Promise<void> {
  activateEvalDatabase();
  await save(input);
}

export async function clearEvalWorkspaceSetup(
  clear: () => Promise<unknown>,
): Promise<void> {
  activateEvalDatabase();
  await clear();
}

function activateEvalDatabase(): void {
  process.env.DOCS_AGENT_DATABASE_URL = state.databaseUrl;
}

function createEvalDatabaseState(): EvalDatabaseState {
  const workflowDataDirectory = process.env.WORKFLOW_LOCAL_DATA_DIR?.trim();
  const dataDirectory = workflowDataDirectory
    ? join(workflowDataDirectory, "paige-evals")
    : mkdtempSync(join(tmpdir(), "paige-evals-"));
  mkdirSync(dataDirectory, { recursive: true });
  if (!workflowDataDirectory) {
    process.once("exit", () => {
      rmSync(dataDirectory, { force: true, recursive: true });
    });
  }
  return {
    dataDirectory,
    databaseUrl: `file:${join(dataDirectory, "docs-agent.sqlite")}`,
  };
}
