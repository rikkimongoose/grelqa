export const POINTS = [10, 6, 4, 3, 2, 1] as const;
export type ClosurePolicy = { comparePlaces: "all-six" | "first-only"; preferLength: "longer" | "shorter"; numbering: "competition" | "dense"; quota: "floor"; singleGroup: "complete" | "blocked" };
// Decisions explicitly confirmed by the user on 1 November 2026.
export function closurePolicy(): ClosurePolicy {
  return { comparePlaces: "all-six", preferLength: "longer", numbering: "dense", quota: "floor", singleGroup: "complete" };
}
export type ClosureStory = { id: string; title: string; groupId: string; participationId: string; userId: string; length: number | null; lengthAlgorithm: string | null;
  status: string; roundStatus: string; globalWithdrawn: boolean; withdrawnAt: string | null; withdrawalReason: string | null };
export type ClosureVote = { id: string; participationId: string; groupId: string; submittedAt: string; entries: { storyId: string; position: number }[] };
export type ClosureMember = { id: string; userId: string; groupId: string | null; mustVote: boolean; exemptAt: string | null; exemptReason: string | null; votingStatus: "submitted" | "exempt" | "not-voted" | "not-eligible" };
export type ClosureResult = { id: string; title: string; groupId: string; points: number | null; place: number | null; counts: number[]; shared: boolean; finalist: boolean; withdrawn: boolean; withdrawalCode: "not-voted" | "withdrawn" | null };
export type ClosureSnapshot = { version: "first-round-closure-v1"; closedAt: string; roundStartedAt: string; deadline: string; outcome: "results" | "failed"; failureReason: "no-stories" | "one-author" | null;
  settings: { points: readonly number[]; policy: ClosurePolicy | null; finalCapacity: number; groupCount: number; quota: number | null; singleRound: boolean };
  groups: { id: string; number: number; capacity: number }[]; results: ClosureResult[];
  audit: { stories: ClosureStory[]; votes: ClosureVote[]; members: ClosureMember[]; nonVotingParticipationIds: string[]; ignoredBallotIds: string[] } };

export function scoreStories(stories: ClosureStory[], votes: ClosureVote[], excludedMembers: Set<string>) {
  return stories.map((story): ClosureResult => {
    const notVoted = excludedMembers.has(story.participationId) && story.roundStatus === "active" && story.status === "admitted" && !story.globalWithdrawn;
    const withdrawn = notVoted || story.globalWithdrawn || story.status !== "admitted" || story.roundStatus !== "active";
    const counts = Array<number>(6).fill(0);
    if (!withdrawn) for (const vote of votes) for (const entry of vote.entries) if (entry.storyId === story.id) counts[entry.position - 1]++;
    return { id: story.id, title: story.title, groupId: story.groupId, points: withdrawn ? null : counts.reduce((sum, count, i) => sum + count * POINTS[i], 0),
      place: null, counts, shared: false, finalist: false, withdrawn, withdrawalCode: notVoted ? "not-voted" : withdrawn ? "withdrawn" : null };
  });
}
export function rankAndQualify(rows: ClosureResult[], stories: ClosureStory[], groups: { id: string }[], finalCapacity: number, policy: ClosurePolicy) {
  const active = stories.filter((story) => !rows.find((row) => row.id === story.id)!.withdrawn);
  const algorithms = new Set(active.map((row) => row.lengthAlgorithm));
  if (active.some((row) => row.length === null || !Number.isSafeInteger(row.length) || row.length < 0) || algorithms.size !== 1 || algorithms.has(null) || algorithms.has("")) throw new Error("Нужны сопоставимые сохранённые длины одной версии; неизвестные длины не пересчитываются.");
  const lengths = new Map(active.map((row) => [row.id, row.length!]));
  const quota = Math.floor(finalCapacity / groups.length);
  if (groups.length > 1 && quota < 1) throw new Error("Число групп превышает вместимость финала: положительная равная квота невозможна.");
  function compare(a: ClosureResult, b: ClosureResult) {
    const points = b.points! - a.points!; if (points) return points;
    for (let index = 0; index < (policy.comparePlaces === "all-six" ? 6 : 1); index++) { const difference = b.counts[index] - a.counts[index]; if (difference) return difference; }
    const difference = lengths.get(b.id)! - lengths.get(a.id)!; return policy.preferLength === "longer" ? difference : -difference;
  }
  for (const group of groups) {
    const sorted = rows.filter((row) => row.groupId === group.id && !row.withdrawn).sort(compare);
    let dense = 0;
    for (const [index, row] of sorted.entries()) {
      const tied = index > 0 && compare(sorted[index - 1], row) === 0;
      if (!tied) dense++;
      row.place = tied ? sorted[index - 1].place : policy.numbering === "competition" ? index + 1 : dense;
      row.shared = (index > 0 && compare(sorted[index - 1], row) === 0) || (index < sorted.length - 1 && compare(row, sorted[index + 1]) === 0);
      // Position of the quota-th work, not dense place number, defines the cutoff.
      row.finalist = groups.length > 1 && (sorted.length <= quota || index < quota || compare(row, sorted[quota - 1]) === 0);
    }
  }
  return quota;
}
