import type { PlainDate, TenureOffset, Timezone } from './types';

/**
 * Tenure and eligibility date arithmetic.
 *
 * Pure. No clock, no database. Every function takes what it needs.
 *
 * Rules (spec §3, "Tenure and date arithmetic"):
 *  - Offsets are structured, never a day count.
 *  - `then` composes AFTER the offset.
 *  - Month arithmetic clamps: 31 January + 1 month = 28 February.
 *  - Arithmetic runs in the subject's timezone at local midnight, so a rule does
 *    not unlock a day early for a west-coast employee.
 */

const MS_PER_DAY = 86_400_000;

export function daysInMonth(year: number, month: number): number {
  // month is 1-12. Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function plainDateToUTC(d: PlainDate): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

export function utcToPlainDate(d: Date): PlainDate {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function parsePlainDate(iso: string): PlainDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Not a plain date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function formatPlainDate(d: PlainDate): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.year, 4)}-${p(d.month)}-${p(d.day)}`;
}

/** Adds months with clamping: 31 Jan + 1 month = 28 Feb (29 in a leap year). */
export function addMonths(d: PlainDate, months: number): PlainDate {
  const total = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d.day, daysInMonth(year, month));
  return { year, month, day };
}

export function addDays(d: PlainDate, days: number): PlainDate {
  return utcToPlainDate(new Date(plainDateToUTC(d).getTime() + days * MS_PER_DAY));
}

/** The first day of the month after `d`. Idempotent only if `d` is not already the 1st. */
export function firstOfNextMonth(d: PlainDate): PlainDate {
  const total = d.year * 12 + (d.month - 1) + 1;
  return { year: Math.floor(total / 12), month: (total % 12) + 1, day: 1 };
}

/**
 * Applies an offset to an anchor date, then the `then` modifier.
 * Returns the plain calendar date on which the subject becomes eligible.
 */
export function applyOffset(anchor: PlainDate, offset: TenureOffset): PlainDate {
  let d: PlainDate;
  switch (offset.unit) {
    case 'day':
      d = addDays(anchor, offset.value);
      break;
    case 'week':
      d = addDays(anchor, offset.value * 7);
      break;
    case 'month':
      d = addMonths(anchor, offset.value);
      break;
    case 'year':
      d = addMonths(anchor, offset.value * 12);
      break;
  }
  if (offset.then === 'first_of_next_month') d = firstOfNextMonth(d);
  return d;
}

/**
 * The UTC instant of local midnight on `date` in `timezone`.
 *
 * Uses Intl to read the zone's offset at that wall time, then corrects. The
 * second pass handles the case where the first guess lands on the other side of
 * a DST transition.
 */
export function localMidnightUTC(date: PlainDate, timezone: Timezone): Date {
  const guess = plainDateToUTC(date);
  let instant = new Date(guess.getTime() - offsetMs(guess, timezone));
  // One correction pass: re-read the offset at the computed instant.
  instant = new Date(guess.getTime() - offsetMs(instant, timezone));
  return instant;
}

/** The timezone's UTC offset, in milliseconds, at a given instant. */
function offsetMs(at: Date, timezone: Timezone): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUTC - at.getTime();
}

/**
 * The instant at which a tenure condition unlocks, for this subject.
 * Returns null when the anchor the rule names is absent from the subject.
 */
export function unlockInstant(
  anchors: Record<string, PlainDate>,
  offset: TenureOffset,
  timezone: Timezone,
): Date | null {
  const anchor = anchors[offset.anchor];
  if (!anchor) return null;
  return localMidnightUTC(applyOffset(anchor, offset), timezone);
}

/** True when `at` is at or past the unlock instant. */
export function tenureSatisfied(
  anchors: Record<string, PlainDate>,
  offset: TenureOffset,
  timezone: Timezone,
  at: Date,
): boolean {
  const unlock = unlockInstant(anchors, offset, timezone);
  // A rule naming an anchor the subject does not have never unlocks.
  if (unlock === null) return false;
  return at.getTime() >= unlock.getTime();
}
