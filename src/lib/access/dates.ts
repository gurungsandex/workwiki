/**
 * Tenure and eligibility date arithmetic.
 *
 * Pure: no database, no clock of its own, no I/O. Every unlock date in the
 * product is produced here, so the rules are stated once:
 *
 *  - Offsets are structured `{ anchor, unit, value, then? }`, never a day count.
 *  - Month and year arithmetic clamps (31 January + 1 month = 28 February).
 *  - `then: 'first_of_next_month'` composes *after* the offset, never before,
 *    and always advances to the first day of the following month.
 *  - The resulting calendar date becomes an instant at *local midnight in the
 *    location's timezone*, so a rule never unlocks a day early for an employee
 *    on a western clock.
 */

export type OffsetUnit = 'day' | 'week' | 'month' | 'year';
export type OffsetThen = 'first_of_next_month';

export interface Offset {
  /** Slug of a `tenure_anchor` row — `hire_date` and any admin-invented key. */
  anchor: string;
  unit: OffsetUnit;
  value: number;
  then?: OffsetThen;
}

/** A calendar date with no time and no zone: what a `date` column holds. */
export interface CalendarDate {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCalendarDate(value: string): CalendarDate {
  const match = ISO_DATE.exec(value);
  if (!match) throw new RangeError(`Not an ISO calendar date: ${value}`);
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = { year: Number(y), month: Number(m), day: Number(d) };
  if (date.month < 1 || date.month > 12) throw new RangeError(`Month out of range: ${value}`);
  if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    throw new RangeError(`Day out of range: ${value}`);
  }
  return date;
}

export function formatCalendarDate(date: CalendarDate): string {
  const m = String(date.month).padStart(2, '0');
  const d = String(date.day).padStart(2, '0');
  return `${date.year}-${m}-${d}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Add whole months, clamping the day to the target month's length. */
function addMonths(date: CalendarDate, months: number): CalendarDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Add whole days by way of the UTC calendar — no timezone is involved yet. */
function addDays(date: CalendarDate, days: number): CalendarDate {
  const ms = Date.UTC(date.year, date.month - 1, date.day) + days * 86_400_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function firstOfNextMonth(date: CalendarDate): CalendarDate {
  const next = addMonths({ ...date, day: 1 }, 1);
  return { year: next.year, month: next.month, day: 1 };
}

/** Apply an offset to an anchor date. Calendar arithmetic only. */
export function applyOffset(anchor: CalendarDate, offset: Offset): CalendarDate {
  let result: CalendarDate;
  switch (offset.unit) {
    case 'day':
      result = addDays(anchor, offset.value);
      break;
    case 'week':
      result = addDays(anchor, offset.value * 7);
      break;
    case 'month':
      result = addMonths(anchor, offset.value);
      break;
    case 'year':
      result = addMonths(anchor, offset.value * 12);
      break;
  }
  if (offset.then === 'first_of_next_month') result = firstOfNextMonth(result);
  return result;
}

const OFFSET_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = OFFSET_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    OFFSET_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

/** Offset, in ms, of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

/**
 * The instant at which a calendar date begins in `timeZone`.
 * Two passes settle the DST fixed point; a date that does not exist locally
 * (spring-forward midnight) resolves to the first instant that does.
 */
export function localMidnight(date: CalendarDate, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
  let ts = naive - zoneOffsetMs(naive, timeZone);
  ts = naive - zoneOffsetMs(ts, timeZone);
  return new Date(ts);
}

/** Validate an IANA zone once, at the edge, so bad config fails loudly. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * When does `offset` from `anchorDate` become true for someone in `timeZone`?
 * Returns the instant of local midnight on the computed calendar date.
 */
export function unlockInstant(anchorDate: CalendarDate, offset: Offset, timeZone: string): Date {
  return localMidnight(applyOffset(anchorDate, offset), timeZone);
}

/** Has the offset elapsed at instant `at`? */
export function hasElapsed(anchorDate: CalendarDate, offset: Offset, timeZone: string, at: Date): boolean {
  return at.getTime() >= unlockInstant(anchorDate, offset, timeZone).getTime();
}

/** Render an offset the way the condition builder speaks: "90 days after hire". */
export function describeOffset(offset: Offset, anchorLabel: string): string {
  const unit = offset.value === 1 ? offset.unit : `${offset.unit}s`;
  const base = `${offset.value} ${unit} after ${anchorLabel}`;
  return offset.then === 'first_of_next_month' ? `${base}, from the first of the following month` : base;
}
