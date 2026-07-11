const LOOPBACK_IPV4 = /^127(?:\.(\d{1,3})){3}$/;

export function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1"
  ) {
    return true;
  }

  if (!LOOPBACK_IPV4.test(normalized)) return false;

  return normalized
    .split(".")
    .every((part) => Number.parseInt(part, 10) >= 0 && Number.parseInt(part, 10) <= 255);
}

export function isLoopbackHostHeader(host: string | null) {
  if (!host) return false;

  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
