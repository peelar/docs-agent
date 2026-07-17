import { repositoryConfigurationStore } from "../../../../agent/repositories/configuration/database";
import {
  RepositoryConfigurationService,
  summarizeRepositoryConfiguration,
} from "../../../../agent/repositories/configuration/service";
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

  try {
    const active = await repositoryConfigurationStore().get().match(
      (value) => value,
      raiseRepositoryError,
    );

    return Response.json(
      active === undefined
        ? { configured: false }
        : {
          configured: true,
          repository: summarizeRepositoryConfiguration(active)
            .documentationRepository,
          updatedAt: active.updatedAt,
        },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return repositoryErrorResponse(error);
  }
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
    typeof body.repositoryUrl !== "string"
  ) {
    return errorResponse(400, "Expected a repository URL.");
  }

  try {
    const store = repositoryConfigurationStore();
    const service = new RepositoryConfigurationService(
      { abortSignal: request.signal },
      store,
    );
    const active = await service.get().match(
      (value) => value,
      raiseRepositoryError,
    );
    const evidenceRepositoryUrls = active?.evidenceRepositories.map(
      ({ owner, name }) => `https://github.com/${owner}/${name}`,
    ) ?? [];
    const configuration = await service.propose({
      documentationRepositoryUrl: body.repositoryUrl,
      evidenceRepositoryUrls,
    }).match((value) => value, raiseRepositoryError);
    const saved = await service.confirm({
      configuration,
      expectedRevision: active?.revision ?? null,
    }).match((value) => value, raiseRepositoryError);

    return Response.json(
      {
        configured: true,
        repository: summarizeRepositoryConfiguration(saved)
          .documentationRepository,
        updatedAt: saved.updatedAt,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    return repositoryErrorResponse(error);
  }
}

const noStoreHeaders = { "cache-control": "no-store" };

function repositoryErrorResponse(error: unknown): Response {
  if (error instanceof RepositoryError) {
    const status = error.code === "REPOSITORY_INVALID_INPUT" ? 400 :
      error.code === "REPOSITORY_CONFLICT" ? 409 : 503;
    return errorResponse(status, error.message);
  }

  return errorResponse(503, "Repository setup is temporarily unavailable.");
}

function errorResponse(status: number, error: string): Response {
  return Response.json(
    { error },
    { status, headers: noStoreHeaders },
  );
}

function raiseRepositoryError(error: Error): never {
  throw error;
}
