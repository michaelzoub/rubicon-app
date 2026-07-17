export type CompletionOutcome = "pending" | "success" | "failure" | "cancelled";

export function nextCelebrationKey(current: number, outcome: CompletionOutcome): number {
  return outcome === "success" ? current + 1 : current;
}
