/** Numeric-only logical request accounting; not HTTP or commit authority. */
export type LogicalRequestKind = "read" | "poll" | "push";
type Outcome = "succeeded" | "failed" | "canceled";
type Counts = { started: number; succeeded: number; failed: number; canceled: number; logicalInFlight: number };
type Ticket = { kind: LogicalRequestKind; settled: boolean };
const empty = (): Counts => ({ started: 0, succeeded: 0, failed: 0, canceled: 0, logicalInFlight: 0 });
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
export class LogicalRequestLedger {
  private counts: Record<LogicalRequestKind, Counts> = { read: empty(), poll: empty(), push: empty() };
  private complete = true;
  constructor(private readonly epoch: string) {}
  begin(kind: LogicalRequestKind): Ticket | null {
    if (!this.complete) return null;
    const value = this.counts[kind];
    if (!Object.values(value).every(safe) || value.started >= Number.MAX_SAFE_INTEGER ||
        value.logicalInFlight >= Number.MAX_SAFE_INTEGER) { this.complete = false; return null; }
    value.started++; value.logicalInFlight++;
    return { kind, settled: false };
  }
  finish(ticket: Ticket | null, outcome: Outcome): void {
    if (!ticket || ticket.settled) return;
    ticket.settled = true;
    if (!this.complete) return;
    const value = this.counts[ticket.kind];
    if (!Object.values(value).every(safe) || value.logicalInFlight < 1 ||
        value[outcome] >= Number.MAX_SAFE_INTEGER) { this.complete = false; return; }
    value.logicalInFlight--; value[outcome]++;
  }
  snapshot() {
    const classes = this.complete ? Object.freeze({
      read: Object.freeze({ ...this.counts.read }), poll: Object.freeze({ ...this.counts.poll }),
      push: Object.freeze({ ...this.counts.push }),
    }) : null;
    return Object.freeze({ enabled: true as const, complete: this.complete, epoch: this.epoch, classes,
      physicalInFlight: null, durableCommits: null });
  }
}
export const disabledLogicalRequests = Object.freeze({ enabled: false as const, complete: false,
  epoch: null, classes: null, physicalInFlight: null, durableCommits: null });
