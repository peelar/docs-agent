import "server-only";

import { approvalDetailSchema, getApprovalDetail, listApprovals, type ApprovalDetail, type ApprovalListItem } from "@docs-agent/control-plane";

const TEST_ENV = "DOCS_AGENT_APPROVAL_TEST_SCENARIOS";
export type ApprovalFilters = { query?: string; state?: ApprovalListItem["displayState"] };
export type ApprovalListResult = { state: "ready"; approvals: ApprovalListItem[] } | { state: "empty" | "invalid-record" | "unauthorized" | "database-error" };
export type ApprovalDetailResult = { state: "ready"; approval: ApprovalDetail } | { state: "missing" | "invalid-record" | "unauthorized" | "database-error" };

export async function resolveApprovalList(filters: ApprovalFilters, scenario?: string): Promise<ApprovalListResult> {
  if (process.env[TEST_ENV] === "1") {
    if (scenario === "empty") return { state: "empty" }; if (scenario === "invalid-record") return { state: "invalid-record" }; if (scenario === "unauthorized") return { state: "unauthorized" }; if (scenario === "database-error") return { state: "database-error" };
    const approvals = fixtures.map(toList).filter((item) => matches(item, filters)); return approvals.length ? { state: "ready", approvals } : { state: "empty" };
  }
  try { const approvals = (await listApprovals()).filter((item) => matches(item, filters)); return approvals.length ? { state: "ready", approvals } : { state: "empty" }; }
  catch (error) { if (error instanceof Error && error.name === "ZodError") return { state: "invalid-record" }; if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) return { state: "unauthorized" }; return { state: "database-error" }; }
}
export async function resolveApprovalDetail(id: string, scenario?: string): Promise<ApprovalDetailResult> {
  if (process.env[TEST_ENV] === "1") { if (scenario === "missing") return { state: "missing" }; if (scenario === "invalid-record") return { state: "invalid-record" }; if (scenario === "unauthorized") return { state: "unauthorized" }; if (scenario === "database-error") return { state: "database-error" }; return { state: "ready", approval: fixtures.find((item) => item.id === id) ?? fixtures[0]! }; }
  try { return { state: "ready", approval: await getApprovalDetail({ id }) }; } catch (error) { if (error instanceof Error && /not found/i.test(error.message)) return { state: "missing" }; if (error instanceof Error && error.name === "ZodError") return { state: "invalid-record" }; if (error instanceof Error && /unauthorized|forbidden/i.test(error.message)) return { state: "unauthorized" }; return { state: "database-error" }; }
}
function matches(item: ApprovalListItem, filters: ApprovalFilters) { if (filters.state && item.displayState !== filters.state) return false; if (!filters.query) return true; return [item.action, item.destination ?? "", item.requester, item.signal?.summary ?? "", item.signal?.id ?? ""].join(" ").toLowerCase().includes(filters.query.toLowerCase()); }
function toList(item: ApprovalDetail): ApprovalListItem { const { exactSideEffect: _sideEffect, evidence: _evidence, decisions: _decisions, ...list } = item; return list; }
const base = { productRunId: "run-approval-201", sessionId: "wrun_approval_201", runId: "turn_0", toolName: "publish_working_repository_pr", action: "Open a GitHub draft pull request", destination: "https://github.com/peelar/saleor-docs", requester: "linear:user-101", signal: { id: "signal-DOCS-201", summary: "Publish the checked metadata permission guide." }, requestedAt: "2026-07-11T10:00:00.000Z", expiresAt: "2026-07-18T10:00:00.000Z", decidedAt: null, updatedAt: "2026-07-11T10:00:00.000Z", exactSideEffect: { baseBranch: "main", branchName: "docs/metadata-permissions", title: "Document metadata permissions", commitMessage: "docs: explain metadata permissions", signalId: "signal-DOCS-201" }, evidence: { report: { decision: "docs-patch", affectedPages: ["docs/api-usage/metadata.mdx"] }, diff: { changedFiles: ["docs/api-usage/metadata.mdx"], additions: 18, deletions: 3 }, checks: { checks: [{ name: "pnpm check", status: "passed" }] } }, decisions: [] };
const fixtures: ApprovalDetail[] = [
  approvalDetailSchema.parse({ ...base, id: "approval-pending", requestId: "approval-pending", status: "pending", displayState: "pending" }),
  approvalDetailSchema.parse({ ...base, id: "approval-expired", requestId: "approval-expired", status: "pending", displayState: "expired", expiresAt: "2026-07-01T10:00:00.000Z" }),
  approvalDetailSchema.parse({ ...base, id: "approval-failed", requestId: "approval-failed", status: "failed", displayState: "failed", updatedAt: "2026-07-11T10:05:00.000Z", decisions: [{ id: "decision-failed", decision: "approve", reason: "Ready to publish.", actorId: "docs-agent:github:1001", actorLogin: "testoperator", status: "failed", failureSummary: "Eve did not accept the approval response.", createdAt: "2026-07-11T10:04:00.000Z", updatedAt: "2026-07-11T10:05:00.000Z" }] }),
  approvalDetailSchema.parse({ ...base, id: "approval-approved", requestId: "approval-approved", status: "approved", displayState: "approved", decidedAt: "2026-07-11T10:06:00.000Z", updatedAt: "2026-07-11T10:06:00.000Z", decisions: [{ id: "decision-approved", decision: "approve", reason: "Report, diff, and checks reviewed.", actorId: "docs-agent:github:1001", actorLogin: "testoperator", status: "submitted", failureSummary: null, createdAt: "2026-07-11T10:06:00.000Z", updatedAt: "2026-07-11T10:06:00.000Z" }] }),
];
