export const MAX_POLL_COUNT = 150;

export type PollingDecision = "schedule" | "hidden" | "paused";

export function pollingDecision(
  count: number,
  hidden: boolean,
  limit = MAX_POLL_COUNT,
): PollingDecision {
  if (hidden) return "hidden";
  if (count >= limit) return "paused";
  return "schedule";
}
