/**
 * Admin-API seeding harness — creates controlled tenant data for the
 * data-dependent Tenant List cases (TC-ADMLIST-001/003/008/009/011).
 *
 * Why this exists: those cases need exact tenant sets (a Setup tenant, a
 * Handed-Over tenant, 12/13/14 tenants, etc.) that a shared dev backend does
 * not provide. Rather than depend on whatever happens to be on dev, each test
 * SEEDS its own tenants under a per-run unique name prefix and then SEARCHES
 * that prefix to isolate them — so assertions are deterministic even though the
 * backend is shared and has NO delete endpoint (seeded rows persist).
 *
 * Auth: reuses the logged-in SPA's Cognito ID token from localStorage
 * (`ce-admin-auth-session`) — the same token the app itself sends. No secret is
 * handled here beyond what the browser session already holds.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { adminApiBaseUrl } from './env';

export interface CreateTenantBody {
  name: string;
  websiteUrl: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
}

export interface SeededTenant {
  id: string;
  displayId: string;
  name: string;
  websiteUrl: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
}

/** Read the SPA's Cognito ID token from localStorage (zustand-persisted session). */
async function readIdToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('ce-admin-auth-session');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { state?: { session?: { idToken?: string } } };
      return parsed?.state?.session?.idToken ?? null;
    } catch {
      return null;
    }
  });
  if (!token) {
    throw new Error(
      'adminApi seeder: no ID token in localStorage — the page must be logged in ' +
        '(use the authenticatedTenantList fixture) before seeding.',
    );
  }
  return token;
}

export class AdminApiSeeder {
  private readonly base: string;

  constructor(
    private readonly page: Page,
    private readonly request: APIRequestContext,
  ) {
    this.base = `${adminApiBaseUrl().replace(/\/$/, '')}/api/v1/admin`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await readIdToken(this.page)}`,
      'Content-Type': 'application/json',
    };
  }

  /** Create one tenant (lands in Setup state). */
  async createTenant(body: CreateTenantBody): Promise<SeededTenant> {
    const res = await this.request.post(`${this.base}/tenants`, {
      headers: await this.authHeaders(),
      data: body,
    });
    if (!res.ok()) {
      throw new Error(`adminApi createTenant failed: ${res.status()} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: Partial<SeededTenant> };
    const d = json.data ?? (json as Partial<SeededTenant>);
    return {
      id: String(d.id),
      displayId: String(d.displayId),
      name: d.name ?? body.name,
      websiteUrl: d.websiteUrl ?? body.websiteUrl,
      address: d.address ?? body.address,
      ownerName: d.ownerName ?? body.ownerName,
      ownerEmail: d.ownerEmail ?? body.ownerEmail,
    };
  }

  /** Complete handover for a tenant (Setup -> Handed Over, auto-activated). */
  async handover(id: string): Promise<void> {
    const res = await this.request.post(`${this.base}/tenants/${id}/handover`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok()) {
      throw new Error(`adminApi handover failed: ${res.status()} ${await res.text()}`);
    }
  }

  /** Set a tenant's Active/Inactive status (only valid after handover). */
  async setStatus(id: string, status: 'active' | 'inactive'): Promise<void> {
    const res = await this.request.patch(`${this.base}/tenants/${id}/status`, {
      headers: await this.authHeaders(),
      data: { status },
    });
    if (!res.ok()) {
      throw new Error(`adminApi setStatus failed: ${res.status()} ${await res.text()}`);
    }
  }

  /**
   * Seed `count` tenants that all share `prefix` in their company name, with
   * globally-unique domains/emails. Returns them in creation order (oldest
   * first). Search `prefix` in the UI to isolate exactly this set.
   */
  async seedTenants(count: number, prefix: string): Promise<SeededTenant[]> {
    const created: SeededTenant[] = [];
    for (let i = 1; i <= count; i += 1) {
      created.push(await this.createTenant(tenantPayload(prefix, i)));
    }
    return created;
  }
}

/** Monotonic per-process counter so payloads within one run never collide. */
let seq = 0;

/** A per-run unique, search-safe prefix (letters/digits only). */
export function uniquePrefix(label: string): string {
  seq += 1;
  return `${label}${Date.now().toString(36)}${seq}`;
}

/** Build a unique create payload for `${prefix} ${i}`. */
export function tenantPayload(prefix: string, i: number): CreateTenantBody {
  const slug = `${prefix}${i}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return {
    name: `${prefix} ${i}`,
    websiteUrl: `${slug}.example.com`,
    address: `${i} Seed Street, Test City`,
    ownerName: `Owner ${prefix} ${i}`,
    ownerEmail: `owner.${slug}@example.com`,
  };
}

/** A seeded tenant, with `companyName` aliased to `name` for spec ergonomics. */
export interface SeededTenantData extends SeededTenant {
  companyName: string;
}

/** Seed one tenant in the Setup state; returns its data (companyName === name). */
export async function seedSetupTenant(
  seeder: AdminApiSeeder,
  label = 'Setup',
): Promise<SeededTenantData> {
  const prefix = uniquePrefix(label);
  const t = await seeder.createTenant({
    name: `${prefix} Co`,
    websiteUrl: `${prefix.toLowerCase()}.example.com`,
    address: '221B Baker Street, London, UK',
    ownerName: `Owner ${prefix}`,
    ownerEmail: `owner.${prefix.toLowerCase()}@example.com`,
  });
  return { ...t, companyName: t.name };
}

/**
 * Seed a tenant and hand it over (Handed Over, auto-activated). Pass
 * status:'inactive' to deactivate it afterwards (for activation-dialog cases).
 */
export async function seedHandedOverTenant(
  seeder: AdminApiSeeder,
  options: { label?: string; status?: 'active' | 'inactive' } = {},
): Promise<SeededTenantData> {
  const t = await seedSetupTenant(seeder, options.label ?? 'HO');
  await seeder.handover(t.id);
  if (options.status === 'inactive') {
    await seeder.setStatus(t.id, 'inactive');
  }
  return t;
}
