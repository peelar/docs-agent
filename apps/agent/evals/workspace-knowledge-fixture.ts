import type { RepositoryInput } from "@docs-agent/control-plane/agent";

export function workspaceKnowledgeEvalSetup(sandboxSuffix: string): RepositoryInput {
  return {
    workingDocumentationRepository: {
      source: { type: "github-url", url: "https://github.com/peelar/saleor-docs.git" },
      ref: "main",
      docsRoot: "docs",
      sandboxPath: `/workspace/working-docs-${sandboxSuffix}`,
      accessMode: "sandbox-write",
      allowedActions: [
        "clone",
        "read",
        "search",
        "patch",
        "run-checks",
        "export-diff",
        "publish-pr",
      ],
      provenanceLabel: "working-documentation-repository",
    },
    watchedRepositories: [],
    contextRepositories: [{
      id: "saleor-source",
      name: "Saleor source",
      description: "Current Saleor API implementation used as read-only source evidence.",
      source: { type: "github-url", url: "https://github.com/saleor/saleor.git" },
      ref: "main",
      sandboxPath: `/workspace/context/saleor-source-${sandboxSuffix}`,
      pathFilters: ["saleor/graphql/**", "saleor/core/editorjs/**"],
      accessMode: "sandbox-read",
      allowedActions: ["clone", "read", "search"],
      provenanceLabel: "context-repository:saleor/saleor",
      evidenceClass: "source-code-or-merged-change",
      canSupportPublicDocsClaim: true,
    }],
    externalContext: [],
  };
}
