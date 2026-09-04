import { z } from 'zod';
import type { RuleConditions } from './types';

/**
 * Runtime validation for the `conditions` JSONB. Validated in code, never by a
 * CHECK constraint: the ids inside are a company's own vocabulary.
 */

const idList = z.union([z.literal('any'), z.array(z.string().uuid()).max(200)]);
const slugList = z.union([z.literal('any'), z.array(z.string().min(1)).max(200)]);

export const tenureOffsetSchema = z.object({
  anchor: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  unit: z.enum(['day', 'week', 'month', 'year']),
  value: z.number().int().min(0).max(1200),
  then: z.literal('first_of_next_month').optional(),
});

export const conditionsSchema = z
  .object({
    departmentIds: idList.optional(),
    roleIds: idList.optional(),
    employeeTypeIds: idList.optional(),
    locationIds: idList.optional(),
    groupIds: slugList.optional(),
    hoursPerWeek: z
      .object({
        op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
        value: z.number().min(0).max(200),
      })
      .optional(),
    tenure: tenureOffsetSchema.optional(),
  })
  .strict();

export function parseConditions(input: unknown): RuleConditions {
  return conditionsSchema.parse(input) as RuleConditions;
}

export function safeParseConditions(input: unknown) {
  return conditionsSchema.safeParse(input);
}
