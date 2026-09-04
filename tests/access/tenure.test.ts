import { describe, it, expect } from 'vitest';
import {
  addMonths,
  applyOffset,
  firstOfNextMonth,
  localMidnightUTC,
  parsePlainDate,
  formatPlainDate,
  tenureSatisfied,
  unlockInstant,
} from '@/lib/access/tenure';
import type { TenureOffset } from '@/lib/access/types';

const d = parsePlainDate;
const f = formatPlainDate;

describe('month arithmetic clamps', () => {
  const cases: [string, number, string][] = [
    // The spec's own example.
    ['2026-01-31', 1, '2026-02-28'],
    // Leap year: the clamp lands on the 29th.
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2026-05-31', 1, '2026-06-30'],
    // A day that exists in the target month is untouched.
    ['2026-01-15', 1, '2026-02-15'],
    // Year rollover.
    ['2026-11-30', 2, '2027-01-30'],
    ['2026-12-31', 1, '2027-01-31'],
    // 12 months is a year.
    ['2026-02-29', 12, '2027-02-28'],
  ];
  for (const [from, months, want] of cases) {
    it(`${from} + ${months} month(s) = ${want}`, () => {
      expect(f(addMonths(d(from), months))).toBe(want);
    });
  }
});

describe('first_of_next_month composes AFTER the offset', () => {
  it('the spec worked example: hire 15 Jan + 12 months, then first of next month', () => {
    const offset: TenureOffset = {
      anchor: 'hire_date',
      unit: 'month',
      value: 12,
      then: 'first_of_next_month',
    };
    // 2026-01-15 + 12 months = 2027-01-15, then first of next month = 2027-02-01.
    expect(f(applyOffset(d('2026-01-15'), offset))).toBe('2027-02-01');
  });

  it('is not applied before the offset', () => {
    // Applying `then` first would give 2026-02-01 + 12m = 2027-02-01 by luck here,
    // so use a case where order is distinguishable.
    const offset: TenureOffset = {
      anchor: 'hire_date',
      unit: 'day',
      value: 60,
      then: 'first_of_next_month',
    };
    // 2026-01-15 + 60 days = 2026-03-16, then first of next month = 2026-04-01.
    // Wrong order would be: first of next month = 2026-02-01, +60d = 2026-04-02.
    expect(f(applyOffset(d('2026-01-15'), offset))).toBe('2026-04-01');
  });

  it('still advances a date already on the first of a month', () => {
    // 1 March + 0 days is 1 March; "first of the month FOLLOWING" is 1 April.
    expect(f(firstOfNextMonth(d('2026-03-01')))).toBe('2026-04-01');
  });

  it('rolls the year over', () => {
    expect(f(firstOfNextMonth(d('2026-12-05')))).toBe('2027-01-01');
  });
});

describe('unit conversion', () => {
  it('days', () => {
    expect(f(applyOffset(d('2026-01-15'), { anchor: 'h', unit: 'day', value: 90 })))
      .toBe('2026-04-15');
  });
  it('weeks', () => {
    expect(f(applyOffset(d('2026-01-01'), { anchor: 'h', unit: 'week', value: 2 })))
      .toBe('2026-01-15');
  });
  it('years clamp on a leap day', () => {
    expect(f(applyOffset(d('2028-02-29'), { anchor: 'h', unit: 'year', value: 1 })))
      .toBe('2029-02-28');
  });
  it('zero offset is the anchor itself (from their first day)', () => {
    expect(f(applyOffset(d('2026-06-01'), { anchor: 'h', unit: 'day', value: 0 })))
      .toBe('2026-06-01');
  });
});

describe('unlock is local midnight in the subject timezone', () => {
  it('does not unlock a day early for a west-coast employee', () => {
    const anchors = { hire_date: d('2026-01-01') };
    const offset: TenureOffset = { anchor: 'hire_date', unit: 'day', value: 0 };

    const la = unlockInstant(anchors, offset, 'America/Los_Angeles')!;
    const ny = unlockInstant(anchors, offset, 'America/New_York')!;

    // Local midnight in LA is 08:00 UTC in January; in NY it is 05:00 UTC.
    expect(la.toISOString()).toBe('2026-01-01T08:00:00.000Z');
    expect(ny.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    // The western employee unlocks LATER in absolute time, never earlier.
    expect(la.getTime()).toBeGreaterThan(ny.getTime());
  });

  it('at 2026-01-01T06:00Z the NY employee is unlocked and the LA one is not', () => {
    const anchors = { hire_date: d('2026-01-01') };
    const offset: TenureOffset = { anchor: 'hire_date', unit: 'day', value: 0 };
    const at = new Date('2026-01-01T06:00:00Z');

    expect(tenureSatisfied(anchors, offset, 'America/New_York', at)).toBe(true);
    expect(tenureSatisfied(anchors, offset, 'America/Los_Angeles', at)).toBe(false);
  });

  it('handles a spring-forward transition (US DST starts 8 March 2026)', () => {
    const at = localMidnightUTC(d('2026-03-08'), 'America/New_York');
    // 8 March 2026 00:00 EST = 05:00 UTC; the 02:00->03:00 jump is later that day.
    expect(at.toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('handles a fall-back transition (US DST ends 1 November 2026)', () => {
    const at = localMidnightUTC(d('2026-11-01'), 'America/New_York');
    // 1 November 2026 00:00 is still EDT = 04:00 UTC.
    expect(at.toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });

  it('handles a zone with a half-hour offset', () => {
    const at = localMidnightUTC(d('2026-06-01'), 'Asia/Kolkata');
    expect(at.toISOString()).toBe('2026-05-31T18:30:00.000Z');
  });

  it('handles a southern-hemisphere DST zone', () => {
    const at = localMidnightUTC(d('2026-01-15'), 'Australia/Sydney');
    // AEDT is UTC+11 in January.
    expect(at.toISOString()).toBe('2026-01-14T13:00:00.000Z');
  });

  it('is exact at the boundary instant, not a second early', () => {
    const anchors = { hire_date: d('2026-01-01') };
    const offset: TenureOffset = { anchor: 'hire_date', unit: 'day', value: 90 };
    const unlock = unlockInstant(anchors, offset, 'America/New_York')!;

    expect(tenureSatisfied(anchors, offset, 'America/New_York', unlock)).toBe(true);
    expect(
      tenureSatisfied(anchors, offset, 'America/New_York', new Date(unlock.getTime() - 1)),
    ).toBe(false);
  });
});

describe('missing and future anchors', () => {
  it('a rule naming an anchor the subject lacks never unlocks', () => {
    const offset: TenureOffset = { anchor: 'transfer_date', unit: 'day', value: 30 };
    expect(unlockInstant({ hire_date: d('2020-01-01') }, offset, 'UTC')).toBeNull();
    expect(
      tenureSatisfied({ hire_date: d('2020-01-01') }, offset, 'UTC', new Date('2099-01-01')),
    ).toBe(false);
  });

  it('a hire date in the future is simply not yet satisfied', () => {
    const anchors = { hire_date: d('2027-01-01') };
    const offset: TenureOffset = { anchor: 'hire_date', unit: 'day', value: 0 };
    expect(tenureSatisfied(anchors, offset, 'UTC', new Date('2026-09-04'))).toBe(false);
  });

  it('an admin-invented anchor works exactly like a built-in one', () => {
    const anchors = { benefits_eligibility_date: d('2026-05-10') };
    const offset: TenureOffset = {
      anchor: 'benefits_eligibility_date',
      unit: 'month',
      value: 1,
    };
    expect(unlockInstant(anchors, offset, 'UTC')!.toISOString())
      .toBe('2026-06-10T00:00:00.000Z');
  });
});
