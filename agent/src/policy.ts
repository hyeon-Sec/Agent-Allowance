/** The deployed contract uses a resettable window, not a sliding last-24-hours total. */
export function windowStatus(windowStart: number, spent: number, dailyLimit: number, chainNow: number) {
  const end = windowStart + 86_400_000;
  const expired = chainNow >= end;
  const currentSpent = expired ? 0 : spent;
  return {
    spentInWindowSui: currentSpent / 1e9,
    remainingInWindowSui: Math.max(dailyLimit - currentSpent, 0) / 1e9,
    // An expired window restarts on the next spend attempt, not on a browser refresh.
    windowResetsAt: expired ? null : end,
    windowExpired: expired,
    windowMode: "resetting-24h" as const,
  };
}
