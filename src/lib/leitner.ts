import type { Progress } from "./types";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** box → delay before the item is due again */
export const INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 30 * DAY];
export const MAX_BOX = INTERVALS.length - 1;

export const progressKey = (cityId: string, streetId: string) => `${cityId}:${streetId}`;

export function emptyProgress(): Progress {
  return { box: 0, due: 0, seen: 0, correct: 0, lastAt: 0 };
}

export function applyAnswer(p: Progress | undefined, ok: boolean, now = Date.now()): Progress {
  const prev = p ?? emptyProgress();
  const box = ok ? Math.min(MAX_BOX, prev.box + 1) : 0;
  return {
    box,
    due: now + INTERVALS[box],
    seen: prev.seen + 1,
    correct: prev.correct + (ok ? 1 : 0),
    lastAt: now,
  };
}

/**
 * Pick the streets for a session: due items first (lowest box first), then
 * never-seen items, then not-yet-due items with the lowest boxes.
 */
export function pickSession(
  ids: string[],
  getProgress: (id: string) => Progress | undefined,
  size: number,
  now = Date.now(),
): string[] {
  const rank = (id: string) => {
    const p = getProgress(id);
    if (!p) return [1, 0, Math.random()] as const; // unseen
    if (p.due <= now) return [0, p.box, Math.random()] as const; // due
    return [2, p.box, p.due] as const; // scheduled later
  };
  const ranked = ids.map((id) => ({ id, r: rank(id) }));
  ranked.sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2]);
  return ranked.slice(0, size).map((x) => x.id);
}

export function summarize(ids: string[], getProgress: (id: string) => Progress | undefined, now = Date.now()) {
  let due = 0, unseen = 0, mastered = 0;
  for (const id of ids) {
    const p = getProgress(id);
    if (!p) unseen++;
    else if (p.due <= now) due++;
    if (p && p.box >= MAX_BOX - 1) mastered++;
  }
  return { due, unseen, mastered, total: ids.length };
}
