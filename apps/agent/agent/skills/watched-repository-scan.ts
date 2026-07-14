import { defineDynamic, defineSkill } from "eve/skills";

import { resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "turn.started": async (event, context) => {
  const resolution = await resolveDynamicCapabilities(event, context);
  if (!["eve", "slack", "linear"].includes(resolution.contextClass)) return null;
  return defineSkill({
    description: "Use for an explicit request to investigate configured watched repositories or releases for a sourced answer or documentation gap.",
    markdown: [
      "# Watched Repository Scan",
      "",
      "Use this procedure when the user asks to investigate watched repositories, releases, or their relationship to current documentation. Compose only the `knowledge.read` and `repository.read` capabilities visible in the current turn.",
      "",
      "## Setup",
      "",
      "- Follow the dynamic setup guidance. Ask only for a source the requested investigation actually needs.",
      "- If setup is already configured, do not ask for the same repository details again.",
      "- Missing or unavailable source access is a visible limit, not empty evidence.",
      "",
      "## Scan",
      "",
      "1. Inspect only the configured sources needed for the question.",
      "2. Preserve release identity, source identity, resolved revision, access mode, paths or URLs, freshness, and uncertainty.",
      "3. Treat watched repositories as read-only source evidence. Never author, branch, commit, or publish there.",
      "4. Inspect the working documentation repository only when the question or requested gap assessment requires current-docs evidence.",
      "5. Keep any later draft or publication limited to the working documentation repository and behind its existing authority boundaries.",
      "",
      "## Report",
      "",
      "Answer the request first. A watched-source investigation may end as a sourced answer, explicit abstention, recommendation, or documentation decision. Do not create durable documentation work merely because the investigation found a possible gap.",
      "",
      "Separate:",
      "",
      "- GitHub release signal provenance.",
      "- Whether the release signal used GitHub App access or public GitHub access.",
      "- Watched-repository source evidence.",
      "- Working-documentation-repository docs evidence.",
      "- Remaining uncertainty.",
      "",
      "When the request is a documentation-gap assessment, use the narrowest valid outcome:",
      "",
      "- `no-docs-change` when verified source terms are already represented in docs.",
      "- `docs-patch` when verified release/source evidence is not represented in docs and the release signal has clear public docs impact.",
      "- `changelog-only` when the evidence suggests a release note but no docs page change.",
      "- `ask-maintainer` when the scan cannot verify behavior or public docs impact.",
      "",
      "If a patch is warranted, recommend a separate working-documentation-repository request. Do not write during the watched repository scan, and do not imply that a recommendation is already durable work.",
    ].join("\n"),
  });
} } });
