// These limits define the bytes a user reviews and approves. Every stage keeps
// its own check, but all stages must apply the same policy values.
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_DIFF_FILES = 50;

export function isValidPaigeBranch(value: string): boolean {
  return (
    /^paige\/[a-z0-9][a-z0-9._/-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    value.length <= 120
  );
}
