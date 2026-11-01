export type FinalRoundSnapshot = {
  version: "final-admission-v1"; preparedAt: string; sourceClosedAt: string; sourceHash: string;
  startAt: string; endAt: string; groupId: string; storyIds: string[];
  members: { participationId: string; userId: string }[];
  // Historical policy at preparation; current revocation is recorded in Participation, not switched by this value.
  withdrawalRights: "preserve" | "unresolved" | "revoke";
};
