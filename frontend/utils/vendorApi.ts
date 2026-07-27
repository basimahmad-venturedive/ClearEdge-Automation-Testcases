/**
 * Main-app (tenant) API seeding harness for Vendor Directory (CEIQ-FEAT-005).
 * Creates vendors via `POST /v1/vendors` so the dataset-dependent Overview specs
 * (sort, pagination, primary-only filter) have controlled, search-isolated data
 * on the shared dev tenant. Unlike managed users, vendors HAVE a delete endpoint
 * (`DELETE /v1/vendors/:id`), so every seeded vendor is cleaned up.
 *
 * Auth: reuses the logged-in app's Cognito ID token from the persisted Redux
 * store (`localStorage['persist:ceiq-auth']`) — the same token the app sends.
 * Base URL: APP_API_BASE_URL (the origin the UM seeder already proves works).
 *
 * Mirrors utils/appApi.ts (AppUserSeeder) intentionally.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { appApiBaseUrl } from './env';
import { uniquePrefix } from './adminApi';

export interface SeededVendor {
  id: string;
  name: string;
}

interface SeedCategory {
  id: string;
  name: string;
  subcategories: { id: string; name: string }[];
}

/** Read the app's Cognito ID token from the persisted Redux store. */
async function readAppIdToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('persist:ceiq-auth');
      if (!raw) return null;
      const outer = JSON.parse(raw) as Record<string, string>;
      let idToken = outer.idToken;
      try {
        idToken = JSON.parse(idToken);
      } catch {
        /* already a plain string */
      }
      return idToken || null;
    } catch {
      return null;
    }
  });
  if (!token) {
    throw new Error(
      "vendorApi seeder: no ID token in localStorage['persist:ceiq-auth'] — the PO " +
        'must be logged in (open /vendors) before seeding.',
    );
  }
  return token;
}

export class VendorSeeder {
  private readonly base: string;

  constructor(
    private readonly page: Page,
    private readonly request: APIRequestContext,
  ) {
    this.base = appApiBaseUrl().replace(/\/$/, '');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await readAppIdToken(this.page)}`,
      'Content-Type': 'application/json',
    };
  }

  /** Fetch the vendor category taxonomy (real ids for create payloads). */
  async categories(): Promise<SeedCategory[]> {
    const res = await this.request.get(`${this.base}/v1/vendor-categories`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok()) {
      throw new Error(`vendorApi categories failed: ${res.status()} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { categories?: SeedCategory[] };
      categories?: SeedCategory[];
    };
    return json.data?.categories ?? json.categories ?? [];
  }

  /** Create one vendor with a minimal valid body. */
  async createVendor(name: string, primaryCategoryId: string, subcategoryId: string): Promise<SeededVendor> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const body = {
      name,
      primaryCategoryId,
      subcategoryId,
      website: null,
      notes: null,
      primaryContact: {
        name: `${name} Contact`,
        email: `${slug}@seed.test`,
        phone: '+16502530000',
        address: { streetAddress: null, streetAddressLine2: null, city: null, state: null, zipCode: null },
      },
      secondaryContact: null,
    };
    const res = await this.request.post(`${this.base}/v1/vendors`, {
      headers: await this.authHeaders(),
      data: body,
    });
    if (!res.ok()) {
      throw new Error(`vendorApi createVendor failed: ${res.status()} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: { id?: string; vendor?: { id?: string } }; id?: string };
    const id = json.data?.id ?? json.data?.vendor?.id ?? json.id ?? '';
    return { id: String(id), name };
  }

  async setPrimary(id: string, isPrimary: boolean): Promise<void> {
    const res = await this.request.patch(`${this.base}/v1/vendors/${id}/primary`, {
      headers: await this.authHeaders(),
      data: { isPrimary },
    });
    if (!res.ok()) {
      throw new Error(`vendorApi setPrimary failed: ${res.status()} ${await res.text()}`);
    }
  }

  async deleteVendor(id: string): Promise<void> {
    const res = await this.request.delete(`${this.base}/v1/vendors/${id}`, {
      headers: await this.authHeaders(),
    });
    // Treat already-gone as success so cleanup is idempotent.
    if (!res.ok() && res.status() !== 404) {
      throw new Error(`vendorApi deleteVendor failed: ${res.status()} ${await res.text()}`);
    }
  }

  /**
   * Seed `count` vendors sharing `prefix` in their name (so a UI search isolates
   * exactly this set), each numbered with a zero-padded suffix for deterministic
   * name-sort ordering. Uses the first category + its first subcategory. Returns
   * them in creation order (index 0 created first → oldest).
   */
  async seedVendors(count: number, prefix: string): Promise<SeededVendor[]> {
    const categories = await this.categories();
    const category = categories.find((c) => c.subcategories.length > 0);
    if (!category) throw new Error('vendorApi: no category with a subcategory available to seed');
    const subcategoryId = category.subcategories[0].id;

    const created: SeededVendor[] = [];
    for (let i = 1; i <= count; i += 1) {
      const suffix = String(i).padStart(2, '0');
      created.push(await this.createVendor(`${prefix} ${suffix}`, category.id, subcategoryId));
    }
    return created;
  }
}

/** A per-run unique, search-safe vendor name prefix. */
export function uniqueVendorPrefix(label: string): string {
  return uniquePrefix(label);
}
