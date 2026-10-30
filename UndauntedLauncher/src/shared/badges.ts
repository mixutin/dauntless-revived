// Playtime achievements: one badge per milestone of hours played on this PC.

export const BADGE_HOURS = [1, 10, 25, 50, 100, 250, 500, 750, 1000] as const;
export type BadgeHours = (typeof BADGE_HOURS)[number];

export interface BadgeProgress {
  unlocked: BadgeHours[];
  next: BadgeHours | null; // null once every badge is unlocked
  secondsToNext: number;
  fraction: number; // 0..1 from the previous milestone to the next
}

export function badgeProgress(totalSeconds: number): BadgeProgress {
  const s = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const unlocked = BADGE_HOURS.filter((h) => s >= h * 3600);
  const next = BADGE_HOURS.find((h) => s < h * 3600) ?? null;
  if (next === null) return { unlocked, next, secondsToNext: 0, fraction: 1 };
  const from = (unlocked[unlocked.length - 1] ?? 0) * 3600;
  return { unlocked, next, secondsToNext: next * 3600 - s, fraction: (s - from) / (next * 3600 - from) };
}
