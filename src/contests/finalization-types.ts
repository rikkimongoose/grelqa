import type { ClosureSnapshot } from "./closure-rules";

// Private immutable audit. Never return this object from a public route.
export type FinalizationSnapshot = {
  version: "contest-finalization-v1";
  completedAt: string;
  round: 1 | 2;
  sourceClosedAt: string;
  sourceHash: string;
  tally: ClosureSnapshot;
  // Frozen public names only for nonwithdrawn, admitted works of a successful contest.
  authors: { storyId: string; name: string }[];
  winners: string[];
};
