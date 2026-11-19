import type { Commit } from "./repo";

export function topologicalStep(commits: Pick<Commit, "sha" | "parents">[], sha: string | null, up: boolean) {
  const i = commits.findIndex((c) => c.sha === sha);
  if (i < 0) {
    return undefined;
  }
  if (up) {
    return commits.find((c) => c.sha === commits[i].parents[0]);
  }
  const above = commits.slice(0, i).reverse();
  return above.find((c) => c.parents[0] === sha) ?? above.find((c) => c.parents.includes(sha as string));
}
