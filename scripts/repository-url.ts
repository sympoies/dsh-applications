export function normalizeRepositoryUrl(url: string): string {
  return url
    .replace(/^git\+/, "")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}
