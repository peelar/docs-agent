import { defineDynamic, defineSkill } from "eve/skills";

import { resolveDynamicCapabilities } from "../lib/capability-resolution";

export default defineDynamic({ events: { "turn.started": async (event, context) => {
  const resolution = await resolveDynamicCapabilities(event, context);
  const humanContext = ["eve", "slack", "linear"].includes(resolution.contextClass);
  const repositoryContext = resolution.capabilityFamilies.includes("repository.read") ||
    resolution.capabilityFamilies.includes("draft.edit");
  if (!humanContext && !repositoryContext) return null;
  return defineSkill({
    description: "Use for repository-backed documentation investigation, intervention decisions, reversible drafting, and checked diffs.",
    markdown: [
      "# Docs Maintenance",
      "",
      "## Route the work",
      "",
      "1. Follow the current dynamic setup instructions. Reuse configured setup.",
      "2. Establish the requested reader outcome, change context, source evidence, and likely documentation surface.",
      "3. Inspect the working documentation repository before deciding. Compose the `working_repository` list, search, and line-range read modes around the evidence the task actually needs. Materialization is implicit.",
      "",
      "## Decide and author",
      "",
      "- Verify relevant current pages and nearby conventions. A no-change conclusion still needs repository evidence and a clean diff.",
      "- Use `working_repository` validators and `run_validators` only for optional read-only inspection when no authoring draft is being prepared. `run_validators` executes only requested trusted ids, accepts no command, and does not mutate the repository. For a draft check, pass the named id in `authoring_workspace` prepare `checks` so the result, including failure, remains attached to the draft. Inspect status and the bounded draft diff through `working_repository`.",
      "- Preserve release scope. When evidence introduces behavior in a patch release but the target page covers a broader release line, make the version boundary explicit instead of implying the behavior existed in every earlier patch.",
      "- Use `get_docs_profile` before writing. Pass only existing repository paths as task examples; omit a new target until it exists.",
      "- Record the smallest reader-solving choice with `docs_work_manage` using the typed `decide` operation.",
      "- Keep localized changes inline. For substantial work, record a typed `plan` before drafting. Reuse one stable source task reference across the decision, plan, and authoring draft. Do not substitute a signal id for that task reference.",
      "- For an explicit repository task, decide and plan directly. Do not search for, create, or start durable signal work merely because the task is substantial. When a signal genuinely originated the request, keep that signal and Eve session and use `docs_work_manage` to start and update the original work.",
      "- Use `authoring_workspace` for every localized, signal-backed, or multi-file draft. Take each update hash from the full-file `contentHash` returned by `working_repository` read; use `createOnly` only for a new target. Link a verified signal when it originated the draft. Link owned work and the ready content plan for substantial work. A revised plan makes the active draft stale: abandon that draft by id, replan, and author again.",
      "- Prepare checks and the exact diff through the same authoring draft. Inspect a failed structured batch result before retrying. Do not call the authoring capability for read-only investigation or when no documentation change is requested.",
      "- Stop when evidence or a consequential product decision is missing.",
      "",
      "## Report and publish",
      "",
      "Answer the request or state the documentation decision first. Include the evidence, pages considered, checks, changed files or clean diff, and remaining uncertainty that support it. Sandbox drafting needs no approval. Publishing always requires explicit approval through `publish_working_repository_pr`. Publication derives any signal relation from the prepared draft; do not attach a different signal during writeback.",
    ].join("\n"),
  });
} } });
