import { existsSync } from "node:fs";
import { join } from "node:path";

export function brandResolver(repositoryRoot) {
  const icon = join(
    repositoryRoot,
    "assets",
    "paige",
    "paige-magpie-512.png",
  );
  if (!existsSync(icon)) {
    throw new Error(`Paige brand icon is missing at ${icon}.`);
  }

  return {
    icon,
    name: "Paige",
  };
}
