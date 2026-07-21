export function hasAtMostWords(value: unknown, maximum: number): boolean {
  return typeof value === "string" &&
    value.trim().split(/\s+/).length <= maximum;
}

export function hasDescriptiveMarkdownLink(
  value: unknown,
  url: string,
): boolean {
  if (typeof value !== "string") return false;
  return value.includes(`](${url})`) && !value.includes(`[${url}](${url})`);
}

export function onlyLinksTo(value: unknown, allowedUrls: readonly string[]): boolean {
  if (typeof value !== "string") return false;
  const urls = [...value.matchAll(/https?:\/\/[^\s)>]+/g)].map(([url]) => url);
  return urls.every((url) => allowedUrls.includes(url));
}
