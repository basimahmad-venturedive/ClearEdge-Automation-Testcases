/**
 * Sourcing seeder — creates/deletes draft events via the app API so the detail/edit UI
 * specs have a real event to open without driving the (slow, mutating) create+publish UI.
 *
 * Auth: reuses the logged-in app's Cognito ID token from the persisted Redux store
 * (`localStorage['persist:ceiq-auth']`) — the same token the app sends. The page must be
 * authenticated (the `po` project's storageState) before seeding.
 */
import type { Page, APIRequestContext } from '@playwright/test';
import { appApiBaseUrl } from './env';

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
      "sourcingApi seeder: no ID token in localStorage['persist:ceiq-auth'] — the PO must " +
        'be logged in (open /sourcing) before seeding.',
    );
  }
  return token;
}

export interface SeededEvent {
  id: string;
  displayId: string;
}

export class SourcingApi {
  private readonly base: string;
  constructor(
    private readonly page: Page,
    private readonly request: APIRequestContext,
  ) {
    this.base = appApiBaseUrl().replace(/\/$/, '');
  }

  private async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await readAppIdToken(this.page)}`, 'Content-Type': 'application/json' };
  }

  /** Create an empty draft ("Skip to manual") of the given type. */
  async createDraft(type: 'rfp' | 'rfq' = 'rfp'): Promise<SeededEvent> {
    const res = await this.request.post(`${this.base}/v1/sourcing-events`, {
      headers: await this.headers(),
      data: { type },
    });
    if (!res.ok()) throw new Error(`sourcingApi.createDraft failed: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    return { id: body.data.id, displayId: body.data.displayId };
  }

  /** Pick a primary category with at least one subcategory (for the publish gate). */
  private async pickCategory(): Promise<{ primaryId: string; subId: string }> {
    const res = await this.request.get(`${this.base}/v1/vendor-categories`, { headers: await this.headers() });
    const cats = (await res.json()).data.categories as Array<{ id: string; subcategories: Array<{ id: string }> }>;
    const withSub = cats.find((c) => (c.subcategories?.length ?? 0) > 0);
    if (!withSub) throw new Error('sourcingApi: no vendor category with a subcategory on this tenant');
    return { primaryId: withSub.id, subId: withSub.subcategories[0]!.id };
  }

  /** PATCH a draft with all publish-gate fields (required + criteria weights = 100). */
  private async makePublishReady(id: string): Promise<void> {
    const cat = await this.pickCategory();
    const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const res = await this.request.patch(`${this.base}/v1/sourcing-events/${id}`, {
      headers: await this.headers(),
      data: {
        title: `QA Sourcing ${Date.now()}`,
        primaryCategoryId: cat.primaryId,
        subcategoryId: cat.subId,
        timelineWeeks: 10,
        submissionDeadline: deadline,
        scopeOfWork: 'QA automation seeded event — scope of work.',
        evaluationCriteria: [
          { name: 'Functional fit & capability', weight: 50, sortOrder: 1 },
          { name: 'Pricing & value for money', weight: 50, sortOrder: 2 },
        ],
      },
    });
    if (!res.ok()) throw new Error(`sourcingApi.patch failed: ${res.status()} ${await res.text()}`);
  }

  /** Seed a DRAFT that satisfies the publish gate (for testing Publish from the UI). */
  async createPublishReadyDraft(): Promise<SeededEvent> {
    const draft = await this.createDraft('rfp');
    await this.makePublishReady(draft.id);
    return draft;
  }

  /** Seed an ACTIVE (published) RFP event: publish-ready draft → publish. */
  async createPublishedEvent(): Promise<SeededEvent> {
    const draft = await this.createPublishReadyDraft();
    const pub = await this.request.post(`${this.base}/v1/sourcing-events/${draft.id}/publish`, {
      headers: await this.headers(),
      data: {},
    });
    if (!pub.ok()) throw new Error(`sourcingApi.publish failed: ${pub.status()} ${await pub.text()}`);
    return draft;
  }

  /** Soft-delete an event (cleanup). Best-effort — never throws. */
  async deleteEvent(id: string): Promise<void> {
    try {
      await this.request.delete(`${this.base}/v1/sourcing-events/${id}`, { headers: await this.headers() });
    } catch {
      /* best-effort cleanup */
    }
  }
}
