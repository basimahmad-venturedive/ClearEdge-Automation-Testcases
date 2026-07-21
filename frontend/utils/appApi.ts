/**
 * Main-app (tenant) API seeding harness for User Management (CEIQ-FEAT-003).
 * Creates managed users via `POST /v1/users` so the UM specs have controlled,
 * search-isolated data — the dev tenant has none and there is no delete
 * endpoint (seeded users persist, so tests namespace by a per-run prefix).
 *
 * Auth: reuses the logged-in app's Cognito ID token from the persisted Redux
 * store (`localStorage['persist:ceiq-auth']`) — the same token the app sends.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { appApiBaseUrl } from './env';
import { uniquePrefix } from './adminApi';

// The CREATE request wants the role SLUG (dtos.ts §CreateUserRequestDTO), not the
// display name shown in the UI radios.
export type ManagedUserRole = 'procurement_manager' | 'procurement_analyst';

export interface CreateManagedUserBody {
  name: string;
  email: string;
  role: ManagedUserRole;
}

export interface SeededUser {
  id: string;
  displayId?: string;
  name: string;
  email: string;
  role: string;
}

/** Read the app's Cognito ID token from the persisted Redux store. */
async function readAppIdToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('persist:ceiq-auth');
      if (!raw) return null;
      const outer = JSON.parse(raw) as Record<string, string>;
      let idToken = outer.idToken;
      // redux-persist stores each field JSON-encoded — unwrap the string.
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
      "appApi seeder: no ID token in localStorage['persist:ceiq-auth'] — the PO must be " +
        'logged in (AppLoginPage.loginAsPO) before seeding.',
    );
  }
  return token;
}

export class AppUserSeeder {
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

  /** Create one managed user. */
  async createUser(body: CreateManagedUserBody): Promise<SeededUser> {
    const res = await this.request.post(`${this.base}/v1/users`, {
      headers: await this.authHeaders(),
      data: body,
    });
    if (!res.ok()) {
      throw new Error(`appApi createUser failed: ${res.status()} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { user?: Partial<SeededUser> };
      user?: Partial<SeededUser>;
    };
    const u = json.data?.user ?? json.user ?? {};
    return {
      id: String(u.id ?? ''),
      displayId: u.displayId,
      name: u.name ?? body.name,
      email: u.email ?? body.email,
      role: u.role ?? body.role,
    };
  }

  /**
   * Seed `count` managed users sharing `prefix` in their name, with unique
   * emails. Search `prefix` in the UI to isolate exactly this set.
   */
  async seedUsers(
    count: number,
    prefix: string,
    role: ManagedUserRole = 'procurement_manager',
  ): Promise<SeededUser[]> {
    const created: SeededUser[] = [];
    for (let i = 1; i <= count; i += 1) {
      const slug = `${prefix}${i}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
      created.push(
        await this.createUser({ name: `${prefix} ${i}`, email: `${slug}@example.com`, role }),
      );
    }
    return created;
  }
}

/** A per-run unique, search-safe managed-user name prefix. */
export function uniqueUserPrefix(label: string): string {
  return uniquePrefix(label);
}
