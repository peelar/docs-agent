import type { Metadata } from "next";

import { PageHeading } from "../../components/page-heading";
import { EmptyState } from "../../components/state-panel";

export const metadata: Metadata = {
  title: "Status",
};

export default function StatusPage() {
  return (
    <div className="page-stack">
      <PageHeading
        index="01"
        title="Status"
        summary="A single place to understand whether Docs Agent is ready and what needs attention."
      />
      <EmptyState
        kicker="Service boundary pending"
        title="Readiness checks are not connected yet."
        body="The shell is ready for the shared control-plane service. No database or runtime result is being inferred in the meantime."
      />
    </div>
  );
}
