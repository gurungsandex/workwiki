import { isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { departments, employeeTypes, groups, locations, roles, tenureAnchors } from '@/db/schema';
import { emptyVocabulary, type Vocabulary } from './sentence';

/** The names the sentence renderer needs. Rows, always — never a hardcoded list. */
export async function loadVocabulary(): Promise<Vocabulary> {
  const vocabulary = emptyVocabulary();
  const [depts, roleRows, types, sites, groupRows, anchors] = await Promise.all([
    db.select({ id: departments.id, name: departments.name }).from(departments),
    db.select({ id: roles.id, name: roles.name }).from(roles),
    db.select({ id: employeeTypes.id, name: employeeTypes.name }).from(employeeTypes),
    db.select({ id: locations.id, name: locations.name }).from(locations),
    db.select({ id: groups.id, name: groups.name }).from(groups).where(isNull(groups.archivedAt)),
    db.selectDistinct({ key: tenureAnchors.key }).from(tenureAnchors),
  ]);

  for (const row of depts) vocabulary.departments.set(row.id, row.name);
  for (const row of roleRows) vocabulary.roles.set(row.id, row.name);
  for (const row of types) vocabulary.employeeTypes.set(row.id, row.name);
  for (const row of sites) vocabulary.locations.set(row.id, row.name);
  for (const row of groupRows) vocabulary.groups.set(row.id, row.name);
  for (const row of anchors) {
    if (!vocabulary.anchors.has(row.key)) vocabulary.anchors.set(row.key, row.key.replace(/_/g, ' '));
  }
  return vocabulary;
}
