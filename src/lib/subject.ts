import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { employeeProfiles, groupMembers, instance, locations, tenureAnchors } from '@/db/schema';
import { parseCalendarDate } from '@/lib/access/dates';
import type { Subject } from '@/lib/access/types';

/**
 * Build the evaluator's subject from the one profile row plus its anchors.
 * Every access dimension resolves from `employee_profile`; every date a rule
 * can count from resolves from `tenure_anchor`, `hire_date` included.
 */
export async function loadSubject(userId: string): Promise<Subject | null> {
  const [profile] = await db
    .select({
      userId: employeeProfiles.userId,
      departmentId: employeeProfiles.departmentId,
      roleId: employeeProfiles.roleId,
      employeeTypeId: employeeProfiles.employeeTypeId,
      locationId: employeeProfiles.locationId,
      hireDate: employeeProfiles.hireDate,
      hoursPerWeek: employeeProfiles.hoursPerWeek,
      locationTimeZone: locations.timeZone,
    })
    .from(employeeProfiles)
    .leftJoin(locations, eq(locations.id, employeeProfiles.locationId))
    .where(eq(employeeProfiles.userId, userId))
    .limit(1);

  if (!profile) return null;

  const [anchorRows, groupRows, [settings]] = await Promise.all([
    db
      .select({ key: tenureAnchors.key, date: tenureAnchors.date })
      .from(tenureAnchors)
      .where(eq(tenureAnchors.userId, userId)),
    db.select({ groupId: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId)),
    db.select({ timeZone: instance.timeZone }).from(instance).limit(1),
  ]);

  const anchors: Subject['anchors'] = {};
  for (const row of anchorRows) {
    try {
      anchors[row.key] = parseCalendarDate(row.date);
    } catch {
      // A malformed anchor is not a date to count from. Leaving it out makes
      // the rule an ordinary miss rather than an invented unlock date.
    }
  }
  // hire_date is mirrored into tenure_anchor on save; fall back to the profile
  // so a hand-inserted row still evaluates.
  if (!anchors.hire_date && profile.hireDate) {
    try {
      anchors.hire_date = parseCalendarDate(profile.hireDate);
    } catch {
      /* ignore */
    }
  }

  return {
    userId: profile.userId,
    departmentId: profile.departmentId,
    roleId: profile.roleId,
    employeeTypeId: profile.employeeTypeId,
    locationId: profile.locationId,
    anchors,
    groupIds: groupRows.map((g) => g.groupId),
    hoursPerWeek: profile.hoursPerWeek === null ? null : Number(profile.hoursPerWeek),
    timeZone: profile.locationTimeZone ?? settings?.timeZone ?? 'UTC',
  };
}

/**
 * Every current employee as a subject, in three queries rather than three per
 * person. The rule builder's live match count and the acknowledgment coverage
 * figures both iterate the whole roster, so the N+1 version of this is the
 * difference between a page that renders and one that times out.
 */
export async function loadAllSubjects(): Promise<Subject[]> {
  const [profiles, anchorRows, groupRows, [settings]] = await Promise.all([
    db
      .select({
        userId: employeeProfiles.userId,
        departmentId: employeeProfiles.departmentId,
        roleId: employeeProfiles.roleId,
        employeeTypeId: employeeProfiles.employeeTypeId,
        locationId: employeeProfiles.locationId,
        hireDate: employeeProfiles.hireDate,
        hoursPerWeek: employeeProfiles.hoursPerWeek,
        locationTimeZone: locations.timeZone,
      })
      .from(employeeProfiles)
      .leftJoin(locations, eq(locations.id, employeeProfiles.locationId)),
    db.select({ userId: tenureAnchors.userId, key: tenureAnchors.key, date: tenureAnchors.date }).from(tenureAnchors),
    db.select({ userId: groupMembers.userId, groupId: groupMembers.groupId }).from(groupMembers),
    db.select({ timeZone: instance.timeZone }).from(instance).limit(1),
  ]);

  const anchorsByUser = new Map<string, Subject['anchors']>();
  for (const row of anchorRows) {
    const anchors = anchorsByUser.get(row.userId) ?? {};
    try {
      anchors[row.key] = parseCalendarDate(row.date);
    } catch {
      /* a malformed anchor is not a date to count from */
    }
    anchorsByUser.set(row.userId, anchors);
  }

  const groupsByUser = new Map<string, string[]>();
  for (const row of groupRows) {
    groupsByUser.set(row.userId, [...(groupsByUser.get(row.userId) ?? []), row.groupId]);
  }

  const fallbackZone = settings?.timeZone ?? 'UTC';

  return profiles.map((profile) => {
    const anchors = anchorsByUser.get(profile.userId) ?? {};
    if (!anchors.hire_date && profile.hireDate) {
      try {
        anchors.hire_date = parseCalendarDate(profile.hireDate);
      } catch {
        /* ignore */
      }
    }
    return {
      userId: profile.userId,
      departmentId: profile.departmentId,
      roleId: profile.roleId,
      employeeTypeId: profile.employeeTypeId,
      locationId: profile.locationId,
      anchors,
      groupIds: groupsByUser.get(profile.userId) ?? [],
      hoursPerWeek: profile.hoursPerWeek === null ? null : Number(profile.hoursPerWeek),
      timeZone: profile.locationTimeZone ?? fallbackZone,
    };
  });
}

/**
 * The subject an admin sees content as when they have no employee profile of
 * their own. It matches nothing, so an ungated instance still renders and a
 * gated one shows the admin exactly what an unclassified person would see.
 */
export function anonymousSubject(userId: string, timeZone: string): Subject {
  return {
    userId,
    departmentId: null,
    roleId: null,
    employeeTypeId: null,
    locationId: null,
    anchors: {},
    groupIds: [],
    hoursPerWeek: null,
    timeZone,
  };
}
