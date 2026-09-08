import { describe, expect, it } from 'vitest';
import {
  applyOffset,
  describeOffset,
  formatCalendarDate,
  hasElapsed,
  localMidnight,
  parseCalendarDate,
  unlockInstant,
} from '@/lib/access/dates';

const d = (iso: string) => parseCalendarDate(iso);
const iso = formatCalendarDate;

describe('offset arithmetic', () => {
  it('adds days', () => {
    expect(iso(applyOffset(d('2026-01-15'), { anchor: 'hire_date', unit: 'day', value: 90 }))).toBe('2026-04-15');
  });

  it('adds weeks', () => {
    expect(iso(applyOffset(d('2026-01-01'), { anchor: 'hire_date', unit: 'week', value: 2 }))).toBe('2026-01-15');
  });

  it('clamps month arithmetic: 31 January + 1 month is 28 February', () => {
    expect(iso(applyOffset(d('2026-01-31'), { anchor: 'hire_date', unit: 'month', value: 1 }))).toBe('2026-02-28');
  });

  it('clamps into a leap February', () => {
    expect(iso(applyOffset(d('2028-01-31'), { anchor: 'hire_date', unit: 'month', value: 1 }))).toBe('2028-02-29');
  });

  it('adds years, clamping 29 February', () => {
    expect(iso(applyOffset(d('2028-02-29'), { anchor: 'hire_date', unit: 'year', value: 1 }))).toBe('2029-02-28');
  });

  it('crosses a year boundary', () => {
    expect(iso(applyOffset(d('2026-11-20'), { anchor: 'hire_date', unit: 'month', value: 3 }))).toBe('2027-02-20');
  });

  it('applies first_of_next_month after the offset, never before', () => {
    // "first of the month following 60 days after hire"
    const offset = { anchor: 'hire_date', unit: 'day', value: 60, then: 'first_of_next_month' } as const;
    expect(iso(applyOffset(d('2026-01-15'), offset))).toBe('2026-04-01'); // +60d = 16 March
  });

  it('advances even when the offset lands on the first of a month', () => {
    const offset = { anchor: 'hire_date', unit: 'month', value: 1, then: 'first_of_next_month' } as const;
    expect(iso(applyOffset(d('2026-01-01'), offset))).toBe('2026-03-01');
  });

  it('reproduces the spec worked example: 15 Jan + 12 months, then first of next month', () => {
    const offset = { anchor: 'hire_date', unit: 'month', value: 12, then: 'first_of_next_month' } as const;
    expect(iso(applyOffset(d('2026-01-15'), offset))).toBe('2027-02-01');
  });

  it('handles a negative offset (an anchor in the future)', () => {
    expect(iso(applyOffset(d('2026-03-01'), { anchor: 'x', unit: 'day', value: -1 }))).toBe('2026-02-28');
  });
});

describe('local midnight', () => {
  it('is 08:00Z for Los Angeles in winter', () => {
    expect(localMidnight(d('2026-01-15'), 'America/Los_Angeles').toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('is 07:00Z for Los Angeles in summer (DST)', () => {
    expect(localMidnight(d('2026-07-15'), 'America/Los_Angeles').toISOString()).toBe('2026-07-15T07:00:00.000Z');
  });

  it('is 05:00Z for New York in winter', () => {
    expect(localMidnight(d('2026-01-15'), 'America/New_York').toISOString()).toBe('2026-01-15T05:00:00.000Z');
  });

  it('handles a zone ahead of UTC', () => {
    expect(localMidnight(d('2026-01-15'), 'Asia/Tokyo').toISOString()).toBe('2026-01-14T15:00:00.000Z');
  });

  it('handles the spring-forward day, where local midnight still exists', () => {
    // US DST begins 08 March 2026 at 02:00 local; midnight itself is unaffected.
    expect(localMidnight(d('2026-03-08'), 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('handles a zone whose midnight is skipped by DST (Santiago) without moving the day backwards', () => {
    const t = localMidnight(d('2026-09-06'), 'America/Santiago');
    expect(t.toISOString().slice(0, 10)).toBe('2026-09-06');
  });
});

describe('elapsed', () => {
  const offset = { anchor: 'hire_date', unit: 'day', value: 90 } as const;

  it('does not unlock a day early for a west-coast employee', () => {
    // 90 days after 15 January 2026 is 15 April. In Los Angeles that begins at
    // 07:00Z; at 06:59Z it is still 14 April locally.
    expect(hasElapsed(d('2026-01-15'), offset, 'America/Los_Angeles', new Date('2026-04-15T06:59:00Z'))).toBe(false);
    expect(hasElapsed(d('2026-01-15'), offset, 'America/Los_Angeles', new Date('2026-04-15T07:00:00Z'))).toBe(true);
  });

  it('unlocks earlier for an employee further east on the same calendar date', () => {
    expect(hasElapsed(d('2026-01-15'), offset, 'America/New_York', new Date('2026-04-15T05:00:00Z'))).toBe(true);
    expect(hasElapsed(d('2026-01-15'), offset, 'America/Los_Angeles', new Date('2026-04-15T05:00:00Z'))).toBe(false);
  });

  it('reports the unlock instant, not a day count', () => {
    expect(unlockInstant(d('2026-01-15'), offset, 'America/New_York').toISOString()).toBe('2026-04-15T04:00:00.000Z');
  });
});

describe('describeOffset', () => {
  it('speaks the condition builder’s sentence', () => {
    expect(describeOffset({ anchor: 'hire_date', unit: 'day', value: 90 }, 'hire')).toBe('90 days after hire');
    expect(describeOffset({ anchor: 'hire_date', unit: 'month', value: 1 }, 'hire')).toBe('1 month after hire');
    expect(
      describeOffset({ anchor: 'hire_date', unit: 'day', value: 60, then: 'first_of_next_month' }, 'hire'),
    ).toBe('60 days after hire, from the first of the following month');
  });
});
