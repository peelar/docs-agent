import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseSetupCommand,
  setupCommandUsage,
} from "../src/setup-command.ts";
import { migrateDocsAgentDatabase } from "../src/db/client.ts";
import { getReadinessReport } from "../src/readiness.ts";
import {
  saveValidatedWorkspaceOnboarding,
  WorkspaceOnboardingValidationError,
} from "../src/workspace-onboarding.ts";

const localEnvPath = fileURLToPath(
  new URL("../../../apps/agent/.env.local", import.meta.url),
);
if (existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);

try {
  const command = parseSetupCommand(process.argv.slice(2));

  if (command.kind === "help") {
    console.log(setupCommandUsage);
  } else if (command.kind === "status") {
    await migrateDocsAgentDatabase();
    console.log(JSON.stringify(await getReadinessReport(), null, 2));
  } else {
    try {
      await migrateDocsAgentDatabase();
      const saved = await saveValidatedWorkspaceOnboarding({
        setup: command.input,
        actor: {
          id: `paige:setup-cli:${command.operatorLogin.toLowerCase()}`,
          githubLogin: command.operatorLogin,
        },
        abortSignal: AbortSignal.timeout(15_000),
      });
      console.log(JSON.stringify({
        saved: true,
        validation: saved.validation,
        repositoryUrl:
          saved.state.workingRepositoryInput?.workingDocumentationRepository.source.url,
      }, null, 2));
    } catch (error) {
      if (error instanceof WorkspaceOnboardingValidationError) {
        console.error(JSON.stringify({
          saved: false,
          error: error.message,
          validation: error.validation,
        }, null, 2));
        process.exitCode = 1;
      } else {
        throw error;
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`\n${setupCommandUsage}`);
  process.exitCode = 1;
}
