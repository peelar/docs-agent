const maximumTitleLength = 80;

export function agentSessionTitle(firstMessage: string): string {
  const normalized = firstMessage.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return "Untitled session";
  if (normalized.length <= maximumTitleLength) return normalized;
  return `${normalized.slice(0, maximumTitleLength - 1).trimEnd()}…`;
}
