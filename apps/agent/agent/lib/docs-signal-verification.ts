import type { ToolContext } from "eve/tools";
import { z } from "zod";

import {
  docsSignalDetailSchema,
  getDocsSignal,
  transitionDocsSignalLifecycle,
} from "./docs-signals";
import { assertDocsSignalTransitionReady } from "./docs-signal-lifecycle";
import { repositoryActionRecordSchema } from "./repository-materialization";
import {
  repositoryCheckResultSchema,
  repositoryMaterializationSchema,
} from "./repository-workflow-contract";
import { loadOrMaterializeRepositoryWorkflowState } from "./working-repository-lifecycle";
import { saveRepositoryWorkflowState } from "./repository-workflow-state";
import { WorkingRepositoryService } from "./working-repository-service";

const currentDocsPageVerificationSchema = z.object({
  path: z.string(),
  found: z.boolean(),
  contentPreview: z.string().optional(),
  error: z.string().optional(),
});

const currentDocsSearchResultSchema = z.object({
  query: z.string(),
  matched: z.boolean(),
  outputPreview: z.string(),
  error: z.string().optional(),
});

export const verifyDocsSignalCurrentDocsInputSchema = z.object({
  signalId: z.string().trim().min(1),
  docsPages: z.array(z.string().trim().min(1)).default([]),
  searchQueries: z.array(z.string().trim().min(1)).default([]),
  maxSearchQueries: z.number().int().min(1).max(8).default(5),
});

export const verifyDocsSignalCurrentDocsResultSchema = z.object({
  signal: docsSignalDetailSchema,
  materialization: repositoryMaterializationSchema,
  consideredPages: z.array(currentDocsPageVerificationSchema),
  searchResults: z.array(currentDocsSearchResultSchema),
  checks: z.array(repositoryCheckResultSchema),
  changedFiles: z.array(z.string()),
  noDiff: z.boolean(),
  actionProvenance: z.array(repositoryActionRecordSchema),
  verificationSummary: z.string(),
});

export type VerifyDocsSignalCurrentDocsInput = z.infer<
  typeof verifyDocsSignalCurrentDocsInputSchema
>;
export type VerifyDocsSignalCurrentDocsResult = z.infer<
  typeof verifyDocsSignalCurrentDocsResultSchema
>;

export async function verifyDocsSignalCurrentDocs(
  input: VerifyDocsSignalCurrentDocsInput,
  ctx: ToolContext,
): Promise<VerifyDocsSignalCurrentDocsResult> {
  const parsed = verifyDocsSignalCurrentDocsInputSchema.parse(input);
  const signal = await getDocsSignal({ id: parsed.signalId });
  assertDocsSignalTransitionReady({
    authority: "verification",
    from: signal.status,
    to: "docs-verified",
    missingEvidence: signal.missingEvidence,
  });
  const state = await loadOrMaterializeRepositoryWorkflowState(ctx);
  const repository = state.repositoryInput.workingDocumentationRepository;
  const actionProvenance = [...state.actionProvenance];
  const service = new WorkingRepositoryService({
    ctx,
    repository,
    materialization: state.materialization,
    actionProvenance,
  });

  const docsPages = unique([
    ...parsed.docsPages,
    ...signal.likelyDocsPages,
  ]).slice(0, 10);
  const searchQueries = unique([
    ...parsed.searchQueries,
    ...signal.likelyDocsConcepts,
    ...signal.productSurfaces,
    ...signal.extractedClaims,
  ]).slice(0, parsed.maxSearchQueries);

  if (docsPages.length === 0 && searchQueries.length === 0) {
    throw new Error(
      "Current docs verification needs at least one likely docs page, docs concept, product surface, extracted claim, or explicit search query.",
    );
  }

  const consideredPages = [];
  for (const page of docsPages) {
    try {
      const content = await service.read({ path: page, maxCharacters: 2_000 });
      consideredPages.push({
        path: page,
        found: true,
        contentPreview: content.content,
      });
    } catch (error) {
      consideredPages.push({
        path: page,
        found: false,
        error: formatUnknownError(error),
      });
    }
  }

  const searchResults = [];
  for (const query of searchQueries) {
    try {
      const output = await service.search({ query, kind: "literal", limit: 20 });
      const outputPreview = output.matches
        .map((match) => `${match.path}:${match.line}:${match.excerpt}`)
        .join("\n");
      searchResults.push({
        query,
        matched: output.matches.length > 0,
        outputPreview: truncate(outputPreview, 2_000),
      });
    } catch (error) {
      searchResults.push({
        query,
        matched: false,
        outputPreview: "",
        error: formatUnknownError(error),
      });
    }
  }

  const status = await service.status(4_000);
  const checks = [{
    name: "status" as const,
    command: "git status --short --untracked-files=all",
    exitCode: 0,
    status: "passed" as const,
    stdout: status.status,
    stderr: "",
  }];
  const diff = await service.diff();
  const changedFiles = diff.changedFiles;
  const verificationSummary = [
    `Verified current docs for signal ${signal.id} in ${repository.source.url}.`,
    `${consideredPages.filter((page) => page.found).length}/${consideredPages.length} likely docs pages were readable.`,
    `${searchResults.filter((result) => result.matched).length}/${searchResults.length} search queries matched current docs.`,
    changedFiles.length === 0
      ? "No working-tree diff was produced by verification."
      : `Verification observed existing working-tree changes: ${changedFiles.join(", ")}.`,
  ].join(" ");

  const updatedSignal = await transitionDocsSignalLifecycle({
    id: signal.id,
    status: "docs-verified",
    reason: verificationSummary,
    actor: "docs-agent:current-docs-verification",
    links: [],
    artifacts: [
      {
        kind: "verification-report",
        label: "Current docs verification",
        metadata: {
          repositoryUrl: repository.source.url,
          ref: repository.ref,
          docsRoot: repository.docsRoot,
          consideredPages: consideredPages.map((page) => ({
            path: page.path,
            found: page.found,
            error: page.error,
          })),
          searchQueries: searchResults.map((result) => ({
            query: result.query,
            matched: result.matched,
            error: result.error,
          })),
          checks: checks.map((check) => ({
            name: check.name,
            status: check.status,
            exitCode: check.exitCode,
          })),
          noDiff: diff.noDiff,
        },
      },
    ],
    metadata: {
      repositoryUrl: repository.source.url,
      ref: repository.ref,
      docsRoot: repository.docsRoot,
      noDiff: diff.noDiff,
    },
  }, "verification");

  const result = verifyDocsSignalCurrentDocsResultSchema.parse({
    signal: updatedSignal,
    materialization: state.materialization,
    consideredPages,
    searchResults,
    checks,
    changedFiles,
    noDiff: diff.noDiff,
    actionProvenance,
    verificationSummary,
  });
  await saveRepositoryWorkflowState({ ...state, actionProvenance });
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 20)}\n...[truncated]`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
