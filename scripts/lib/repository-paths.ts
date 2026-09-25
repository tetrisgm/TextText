// Source references begin at a path boundary. Shell expansions are runtime
// paths, so neither $release/... nor ${release}/... names a repository file.
const PATH_RE =
  /(?<![\w$./-])((?:src|mac|scripts|release|plugins|docs)\/[A-Za-z0-9._/[\]-]*\.[A-Za-z0-9]{1,5})\b/g;

export function repositoryPathsInText(text: string): string[] {
  return [...text.matchAll(PATH_RE)].map(([, path]) => path.replace(/\.$/, ""));
}
