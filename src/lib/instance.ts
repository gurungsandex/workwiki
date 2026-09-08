import { db } from '@/db/client';
import { instance } from '@/db/schema';

export interface InstanceSettings {
  displayName: string | null;
  legalName: string | null;
  timeZone: string;
  accentColor: string | null;
  setupCompletedAt: Date | null;
  emailDomainAllowlist: string[];
  enquiriesEmail: string | null;
  mainPhone: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  firstContactName: string | null;
  firstContactEmail: string | null;
  firstContactPhone: string | null;
}

/**
 * The one instance row. Absent means the setup wizard has not run — which is
 * the whole empty state, and cannot be skipped.
 */
export async function instanceSettings(): Promise<InstanceSettings | null> {
  try {
    const [row] = await db
      .select({
        displayName: instance.displayName,
        legalName: instance.legalName,
        timeZone: instance.timeZone,
        accentColor: instance.accentColor,
        setupCompletedAt: instance.setupCompletedAt,
        emailDomainAllowlist: instance.emailDomainAllowlist,
        enquiriesEmail: instance.enquiriesEmail,
        mainPhone: instance.mainPhone,
        city: instance.city,
        region: instance.region,
        country: instance.country,
        firstContactName: instance.firstContactName,
        firstContactEmail: instance.firstContactEmail,
        firstContactPhone: instance.firstContactPhone,
      })
      .from(instance)
      .limit(1);
    return row ?? null;
  } catch {
    // Before migrations have run there is no table to read. The health check
    // reports that; the layout should not crash on it.
    return null;
  }
}

/** The company's name, or a neutral word. Never an invented company name. */
export function companyName(settings: InstanceSettings | null): string {
  return settings?.displayName?.trim() || 'Handbook';
}

/** Blank company fields are hidden from employees, never shown as empty cards. */
export function filled<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}
