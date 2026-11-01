// A nonserializable capability, used only by the standalone scheduler. Not an account/session.
export const schedulerAuthority = Symbol("scheduler");
export type TransitionAuthority = string | typeof schedulerAuthority;
