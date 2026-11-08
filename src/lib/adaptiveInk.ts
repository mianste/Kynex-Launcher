export type Ink = "light" | "dark";
export type InkDecision = {
  ink: Ink;
  changedAt: number;
  pending?: Ink;
  pendingAt?: number;
};

// Keep readable ink stable. A moving background must stay on the other side
// of the threshold before a colour change is accepted.
export function chooseInk(
  previous: InkDecision | undefined,
  white: number,
  black: number,
  now: number,
): InkDecision {
  const best: Ink = white > black ? "light" : "dark";
  if (!previous) return { ink: best, changedAt: now };
  const currentScore = previous.ink === "light" ? white : black;
  const otherScore = previous.ink === "light" ? black : white;
  if (best === previous.ink || currentScore >= 4.5 || otherScore < currentScore * 1.5) {
    return { ink: previous.ink, changedAt: previous.changedAt };
  }
  if (previous.pending !== best) return { ...previous, pending: best, pendingAt: now };
  if (now - previous.pendingAt! >= 600 && now - previous.changedAt >= 1800) {
    return { ink: best, changedAt: now };
  }
  return previous;
}
