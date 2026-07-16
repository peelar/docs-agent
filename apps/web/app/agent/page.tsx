import { AgentChat } from "./agent-chat";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  return (
    <AgentChat
      workspaceId={process.env.PAIGE_OPERATOR_WORKSPACE_ID?.trim()}
    />
  );
}
