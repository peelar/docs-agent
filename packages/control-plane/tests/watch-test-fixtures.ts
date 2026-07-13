import { repositoryInputSchema } from "../src/repository-contract.ts";
import { saveWorkingRepositorySetup } from "../src/setup-state.ts";
import {
  WATCH_CAPABILITY_REGISTRY_VERSION,
  type WatchCapabilityRegistry,
  type WatchServiceContext,
} from "../src/watch-service-readiness.ts";

export const READY_WATCH_CAPABILITY_REGISTRY: WatchCapabilityRegistry = {
  version: WATCH_CAPABILITY_REGISTRY_VERSION,
  status: "ready",
  availableCapabilities: [
    "knowledge.read",
    "repository.read",
    "docs_work.manage",
    "draft.edit",
    "follow_up.schedule",
    "provider.deliver",
  ],
};

export const READY_WATCH_SERVICE_CONTEXT: WatchServiceContext = {
  capabilityRegistry: READY_WATCH_CAPABILITY_REGISTRY,
};

export async function prepareWatchWorkspace(): Promise<void> {
  await saveWorkingRepositorySetup(repositoryInputSchema.parse({
    workingDocumentationRepository: {
      source: {
        type: "github-url",
        url: "https://github.com/example/docs.git",
      },
    },
  }));
}
