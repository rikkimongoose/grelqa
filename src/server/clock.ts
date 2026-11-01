import { AsyncLocalStorage } from "node:async_hooks";
const clocks = new AsyncLocalStorage<() => Date>();
export function currentTime() { return new Date(+(clocks.getStore()?.() ?? new Date())); }
// Server/test dependency injection; never accept a clock or timestamp from HTTP payloads.
export function withClock<T>(clock: () => Date, work: () => T): T { return clocks.run(clock, work); }
