import type { Metadata } from "next";

import { PageHeading } from "../../components/page-heading";
import { EmptyState } from "../../components/state-panel";

export const metadata: Metadata = {
  title: "Signals",
};

export default function SignalsPage() {
  return (
    <div className="page-stack">
      <PageHeading
        index="02"
        title="Signals"
        summary="The durable work queue for evidence, documentation impact, and the next careful action."
      />
      <EmptyState
        kicker="Signal service pending"
        title="No signal data is loaded in this shell."
        body="The queue will appear after the shared read service is connected. This placeholder does not invent operational records."
      />
    </div>
  );
}
