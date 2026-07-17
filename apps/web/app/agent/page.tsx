import { AgentChat } from "./agent-chat";
import { assertLocalOperatorAccess } from "@/operator-access";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  assertLocalOperatorAccess();
  return <AgentChat />;
}
