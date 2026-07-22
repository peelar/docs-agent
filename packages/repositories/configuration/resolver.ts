import { err, ok } from "neverthrow";

import { RepositoryError } from "../errors.js";
import type { RepositoryResultAsync } from "../errors.js";
import type { RepositoryConfig } from "../types.js";
import { resolveRepositoryConfigurationStore } from "./database.js";
import type { RepositoryConfigurationStore } from "./store.js";

export function resolveRepositoryCatalog(
  store?: RepositoryConfigurationStore,
): RepositoryResultAsync<RepositoryConfig[]> {
  const resolvedStore = store === undefined
    ? resolveRepositoryConfigurationStore()
    : ok(store);
  return resolvedStore.asyncAndThen((configurationStore) =>
    configurationStore.get().andThen((configuration) =>
      configuration === undefined
        ? err(new RepositoryError(
            "REPOSITORY_NOT_CONFIGURED",
            "Connect repositories before using repository access.",
          ))
        : ok([
            ...configuration.evidenceRepositories,
            configuration.documentationRepository,
          ])
    )
  );
}
