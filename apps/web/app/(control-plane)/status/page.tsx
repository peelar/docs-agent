import type { Metadata } from "next";

import { PageHeading } from "../../../components/page-heading";
import { ReadinessBoard } from "../../../components/readiness-board";
import { WorkspaceOnboarding } from "../../../components/workspace-onboarding";
import { resolveReadinessReport } from "../../../lib/readiness";
import { resolveWorkspaceOnboardingInitialState } from "../../../lib/workspace-onboarding";

export const metadata: Metadata = {
  title: "Status",
};

export const dynamic = "force-dynamic";

export default async function StatusPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario } = await searchParams;
  const [report, onboarding] = await Promise.all([
    resolveReadinessReport(scenario),
    resolveWorkspaceOnboardingInitialState(scenario),
  ]);

  return (
    <div className="grid gap-[clamp(2rem,6vw,5rem)]">
      <PageHeading
        index="01"
        title="Status"
        summary="A single place to understand whether Docs Agent is ready and what needs attention."
      />
      <ReadinessBoard report={report} />
      <WorkspaceOnboarding
        initialDraft={onboarding.draft}
        initialLoadError={onboarding.error}
      />
    </div>
  );
}
