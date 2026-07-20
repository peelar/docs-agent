import { resolveRepositoryConfigurationStore } from "../../../../agent/repositories/configuration/database";
import {
  RepositoryConfigurationService,
  summarizeRepositoryConfiguration,
} from "../../../../agent/repositories/configuration/service";
import type { ActiveRepositoryConfiguration } from "../../../../agent/repositories/configuration/types";
import { RepositoryError } from "../../../../agent/repositories/shared/errors";
import {
  isOperatorAccessFailure,
  localOperatorAccess,
} from "@/operator-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return errorResponse(access.status, access.error);
  }

  const result = await resolveRepositoryConfigurationStore()
    .asyncAndThen((store) => store.get());
  if (result.isErr()) return repositoryErrorResponse(result.error);

  return Response.json(
    result.value === undefined
      ? { configured: false }
      : repositoryResponse(result.value),
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request): Promise<Response> {
  const access = localOperatorAccess(request);
  if (isOperatorAccessFailure(access)) {
    return errorResponse(access.status, access.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Expected a repository URL.");
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("repositoryUrl" in body) ||
    typeof body.repositoryUrl !== "string" ||
    !("kind" in body) ||
    (body.kind !== "documentation" && body.kind !== "evidence")
  ) {
    return errorResponse(400, "Expected a repository URL.");
  }
  const repositoryUrl = body.repositoryUrl;
  const kind = body.kind;
  let previousRepository: string | undefined;
  if ("previousRepository" in body) {
    if (typeof body.previousRepository !== "string") {
      return errorResponse(400, "Expected a repository URL.");
    }
    previousRepository = body.previousRepository;
  }

  const storeResult = resolveRepositoryConfigurationStore();
  if (storeResult.isErr()) return repositoryErrorResponse(storeResult.error);

  const service = new RepositoryConfigurationService(
    { abortSignal: request.signal },
    storeResult.value,
  );
  const activeResult = await service.get();
  if (activeResult.isErr()) return repositoryErrorResponse(activeResult.error);

  const active = activeResult.value;
  let documentationRepositoryUrl = repositoryUrl;
  if (kind === "evidence") {
    if (active === undefined) {
      return repositoryErrorResponse(new RepositoryError(
        "REPOSITORY_NOT_CONFIGURED",
        "Connect a documentation repository before adding evidence repositories.",
      ));
    }
    documentationRepositoryUrl = repositoryUrlFor(active.documentationRepository);
  }

  const currentEvidenceRepositoryUrls = active?.evidenceRepositories.map(
    repositoryUrlFor,
  ) ?? [];
  let evidenceRepositoryUrls = currentEvidenceRepositoryUrls;
  if (kind === "evidence") {
    if (previousRepository === undefined) {
      evidenceRepositoryUrls = [...currentEvidenceRepositoryUrls, repositoryUrl];
    } else {
      const previousRepositoryUrl = githubUrlForName(previousRepository);
      const previousIndex = currentEvidenceRepositoryUrls.indexOf(
        previousRepositoryUrl,
      );
      if (previousIndex === -1) {
        return repositoryErrorResponse(new RepositoryError(
          "REPOSITORY_CONFLICT",
          `${previousRepository} is no longer an evidence repository.`,
        ));
      }
      // Replacing in place keeps the operator's source ordering stable.
      evidenceRepositoryUrls = currentEvidenceRepositoryUrls.with(
        previousIndex,
        repositoryUrl,
      );
    }
  }
  const proposal = await service.propose({
    documentationRepositoryUrl,
    evidenceRepositoryUrls,
  });
  if (proposal.isErr()) return repositoryErrorResponse(proposal.error);

  const result = await service.confirm({
    configuration: proposal.value,
    expectedRevision: active?.revision ?? null,
  });
  if (result.isErr()) return repositoryErrorResponse(result.error);

  return Response.json(repositoryResponse(result.value), {
    headers: noStoreHeaders,
  });
}

const noStoreHeaders = { "cache-control": "no-store" };

function repositoryResponse(configuration: ActiveRepositoryConfiguration) {
  const summary = summarizeRepositoryConfiguration(configuration);
  return {
    configured: true,
    repository: summary.documentationRepository,
    evidenceRepositories: summary.evidenceRepositories,
    updatedAt: configuration.updatedAt,
  };
}

function repositoryUrlFor(repository: { owner: string; name: string }): string {
  return `https://github.com/${repository.owner}/${repository.name}`;
}

function githubUrlForName(repository: string): string {
  return `https://github.com/${repository}`;
}

function repositoryErrorResponse(error: RepositoryError): Response {
  const status = error.code === "REPOSITORY_INVALID_INPUT" ? 400 :
    error.code === "REPOSITORY_CONFLICT" ? 409 : 503;
  return errorResponse(status, error.message);
}

function errorResponse(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: noStoreHeaders },
  );
}
