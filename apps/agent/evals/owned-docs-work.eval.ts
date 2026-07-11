import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

const setup = `The working docs repository is https://github.com/peelar/saleor-docs.git at main with docs root docs and sandbox path /workspace/working-docs. Configure it if needed. Treat this as terminal-originated work and create a provider-neutral docs signal when substantial ownership is required.`;

export default [
  defineEval({
    description: "A quick documentation question completes inline",
    tags: ["owned-work", "inline"],
    async test(t) {
      await t.send("In one sentence, what is the difference between a guide and a reference page? Do not inspect a repository.");
      t.succeeded();
      t.notCalledTool("owned_docs_work");
      t.notCalledTool("create_docs_signal");
    },
  }),
  defineEval({
    description: "Substantial work is accepted and continues in one durable turn",
    tags: ["owned-work", "substantial"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nTake ownership of documenting a new administrator migration workflow. Verify the current docs, choose the intervention, plan it, prepare the complete reversible draft, and validate it without waiting for another prompt. Do not publish.`);
      t.succeeded();
      t.calledTool("owned_docs_work", { input: (input) => ownedMode(input, "start"), count: 1 });
      t.calledTool("editorial_recommendation");
      t.calledTool("content_plan");
      t.calledTool("authoring_workspace");
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
  defineEval({
    description: "Missing evidence parks and later resumes the same owned work",
    tags: ["owned-work", "resume"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn the substantial docs work for a claimed public retry-limit change. Slack says the value is 12, but no release, source change, or product decision is available. Park visibly instead of writing.`);
      t.calledTool("owned_docs_work", { input: (input) => ownedMode(input, "start"), count: 1 });
      t.calledTool("owned_docs_work", { input: (input) => ownedAction(input, "park") });
      await t.send("The public release note now confirms the retry limit is 12 and links the merged change. Resume the same work and continue.");
      t.succeeded();
      t.calledTool("owned_docs_work", { input: (input) => ownedAction(input, "resume") });
      t.calledTool("owned_docs_work", { input: (input) => ownedMode(input, "start"), count: 1 });
    },
  }),
  defineEval({
    description: "A correction replans the existing draft",
    tags: ["owned-work", "correction"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn and draft a substantial standalone upgrade guide using verified evidence. Stop after the checked reversible draft; do not publish.`);
      t.calledTool("owned_docs_work", { input: (input) => ownedMode(input, "start"), count: 1 });
      await t.send("Correction: this must be consolidated into the canonical migration guide, not kept as a standalone page. Replan and revise the existing draft.");
      t.succeeded();
      t.calledTool("owned_docs_work", { input: (input) => ownedAction(input, "correct") });
      t.calledTool("editorial_recommendation", { input: (input) => isRecord(input) && input.mode === "revise" });
      t.calledTool("content_plan", { input: (input) => isRecord(input) && input.mode === "revise" });
      t.calledTool("owned_docs_work", { input: (input) => ownedMode(input, "start"), count: 1 });
    },
  }),
  defineEval({
    description: "Routine execution does not spam the channel",
    tags: ["owned-work", "milestones"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn a substantial docs update, inspect the repository, make the reversible edits, run routine checks and report only meaningful milestones. Do not publish.`);
      t.succeeded();
      t.calledTool("owned_docs_work", { input: (input) => ownedAction(input, "record") && nestedField(input, "activityKind") === "routine" });
      t.check(t.reply, satisfies((reply) => {
        const text = String(reply).toLowerCase();
        return !text.includes("i read file") && !text.includes("tool call") && !text.includes("retry 1");
      }, "final channel reply omits routine tool-by-tool narration"));
    },
  }),
  defineEval({
    description: "Publication remains approval-gated",
    tags: ["owned-work", "approval"],
    timeoutMs: 900_000,
    async test(t) {
      await t.send(`${setup}\n\nOwn this substantial documentation task through a checked draft. I have not approved publication or a draft pull request.`);
      t.succeeded();
      t.calledTool("owned_docs_work", { input: (input) => nestedField(input, "milestone") === "approval-requested" });
      t.notCalledTool("publish_working_repository_pr");
    },
  }),
];

function ownedMode(input: unknown, mode: string) { return isRecord(input) && input.mode === mode; }
function ownedAction(input: unknown, action: string) { return isRecord(input) && input.mode === "update" && isRecord(input.update) && input.update.action === action; }
function nestedField(input: unknown, field: string) { return isRecord(input) && isRecord(input.update) ? input.update[field] : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
