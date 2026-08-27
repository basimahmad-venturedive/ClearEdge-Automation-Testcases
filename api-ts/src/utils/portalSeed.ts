/**
 * Live self-seeding for the CEIQ-FEAT-008 Vendor Submission Portal suite (QA).
 *
 * The portal is unauthenticated: the 32-byte `portal_token` (a path param) is the sole
 * credential and is minted by the Sourcing "invite vendor" action (FEAT-007). This module
 * drives the authenticated PO surface (Sourcing + Vendor Directory) to mint real portal
 * tokens for every proposal state the suite asserts against, so the portal tests run for
 * real on QA with NO skips.
 *
 * Proven-on-QA recipe (all calls verified 200/201):
 *   category : GET /vendor-categories → pick a category that has subcategories
 *   vendor   : POST /vendors (yopmail contact so no real person is emailed)
 *   event    : POST /sourcing-events (draft) → PATCH (fill publish-gate fields) → POST /publish
 *   invite   : POST /sourcing-events/:id/invite { vendorIds:[vendorId] }
 *   token    : GET /sourcing-events/:id/proposals → proposal.portalToken
 *   states   : submit / withdraw (portal) + award / deleteEvent / deleteVendor (PO) build the variants
 *
 * `deadlinePassed` is NOT seedable via the API (server clock enforces the deadline). It is
 * passed through from process.env.PORTAL_TOKEN_DEADLINE (a teammate seeds it). When unset the
 * deadline tests FAIL with a clear reason — they are never skipped.
 *
 * No literal base URLs / secrets / tokens live here — every host comes from the env accessors
 * via the shared clients, and PO auth comes from liveOwnerContext() (real Cognito).
 */
import { SourcingClient } from "../clients/sourcingClient";
import { VendorDirectoryClient } from "../clients/vendorDirectoryClient";
import { PortalClient } from "../clients/portalClient";
import { liveOwnerContext, type OwnerContext } from "./poContext";
import { newVendor, type CategoryPair } from "../payloads/vendorDirectoryPayloads";

const sc = new SourcingClient();
const vc = new VendorDirectoryClient();
const pc = new PortalClient();

// ---------------------------------------------------------------------------
// Module-scoped, lazily-initialised shared context. seedPortalStates() and the
// per-test mintFreshInvited() both reuse the same PO token, category and reusable
// vendor so a whole `vitest run` costs one login + one vendor create.
// ---------------------------------------------------------------------------
let po: OwnerContext | null = null;
let cat: CategoryPair | null = null;
let reusableVendorId: string | null = null;

/** Event ids and vendor ids created during seeding — best-effort deleted by cleanupSeed(). */
const createdEventIds: string[] = [];
const createdVendorIds: string[] = [];

export interface FreshInvited {
  token: string;
  eventId: string;
  proposalId: string;
  questions: Array<{ id: string; questionText: string; sortOrder: number }>;
}

/** YYYY-MM-DD, `days` in the future (default 30) — a valid submission deadline. */
function futureDate(days = 30): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function fail(step: string, res: { status: number; data: unknown }): never {
  throw new Error(`[portalSeed] ${step} failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
}

async function ensurePo(): Promise<OwnerContext> {
  if (!po) po = await liveOwnerContext();
  return po;
}

async function ensureCategory(): Promise<CategoryPair> {
  if (cat) return cat;
  const owner = await ensurePo();
  const res = await sc.getCategories<any>(owner.token);
  if (res.status !== 200) fail("GET /vendor-categories", res);
  const categories = (res.data?.data?.categories ?? []) as Array<{
    id: string;
    subcategories?: Array<{ id: string }>;
  }>;
  const withSub = categories.find((c) => (c.subcategories?.length ?? 0) > 0);
  if (!withSub) throw new Error("[portalSeed] no category with subcategories found on QA");
  cat = { primaryCategoryId: withSub.id, subcategoryId: withSub.subcategories![0]!.id };
  return cat;
}

/**
 * Create a vendor with a unique yopmail primary-contact address (so no real person is
 * emailed on submit). Tracked for cleanup. Used for the reusable vendor and the dedicated
 * vendor-deleted fixture.
 */
async function createVendor(): Promise<string> {
  const owner = await ensurePo();
  const category = await ensureCategory();
  const body = newVendor(category);
  const unique = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  body.primaryContact.email = `clearedge-vp-qa-${unique}@yopmail.com`;
  const res = await vc.createVendor<any>(body, owner.token);
  if (res.status !== 201) fail("POST /vendors", res);
  const id = res.data.data.id as string;
  createdVendorIds.push(id);
  return id;
}

async function ensureReusableVendor(): Promise<string> {
  if (!reusableVendorId) reusableVendorId = await createVendor();
  return reusableVendorId;
}

/** Create → fill → publish a fresh event (rfp/rfq). Returns its id (tracked for cleanup). */
async function createPublishedEvent(type: "rfp" | "rfq" = "rfp"): Promise<string> {
  const owner = await ensurePo();
  const category = await ensureCategory();

  const draft = await sc.createEmptyDraft<any>({ type }, owner.token);
  if (draft.status !== 201) fail(`POST /sourcing-events (${type})`, draft);
  const id = draft.data.data.id as string;
  createdEventIds.push(id);

  const upd = await sc.updateEvent<any>(
    id,
    {
      title: `VP seed ${type} ${Date.now()}`,
      primaryCategoryId: category.primaryCategoryId,
      subcategoryId: category.subcategoryId,
      budget: 5000,
      timelineWeeks: 10,
      submissionDeadline: futureDate(30),
      scopeOfWork: "seed",
      evaluationCriteria: [
        { name: "Fit", weight: 60, sortOrder: 1 },
        { name: "Price", weight: 40, sortOrder: 2 },
      ],
      vendorQuestions: [{ questionText: "Q1?", sortOrder: 1 }],
    },
    owner.token,
  );
  if (upd.status !== 200) fail(`PATCH /sourcing-events/${id}`, upd);

  const pub = await sc.publishEvent<any>(id, owner.token);
  if (![200, 201].includes(pub.status)) fail(`POST /sourcing-events/${id}/publish`, pub);
  return id;
}

/** Invite a vendor to a published event and read back its minted portal token + proposal id. */
async function inviteAndToken(eventId: string, vendorId: string): Promise<{ proposalId: string; token: string }> {
  const owner = await ensurePo();
  const inv = await sc.invite<any>(eventId, { vendorIds: [vendorId] }, owner.token);
  if (inv.status !== 200) fail(`POST /sourcing-events/${eventId}/invite`, inv);

  const props = await sc.getProposals<any>(eventId, owner.token);
  if (props.status !== 200) fail(`GET /sourcing-events/${eventId}/proposals`, props);
  const list = (props.data?.data?.proposals ?? props.data?.data ?? []) as Array<any>;
  const p = list.find((x) => (x.vendor?.id ?? x.vendorId) === vendorId) ?? list[0];
  if (!p?.portalToken) {
    throw new Error(`[portalSeed] no portalToken on proposal for event ${eventId}: ${JSON.stringify(props.data)}`);
  }
  return { proposalId: p.id as string, token: p.portalToken as string };
}

/** Resolve a portal token to read its event's real question ids (needed to build valid answers). */
async function resolveQuestions(token: string): Promise<FreshInvited["questions"]> {
  const res = await pc.resolve<any>(token);
  if (res.status !== 200) fail("GET /api/portal/:token (resolve for questions)", res);
  return (res.data?.data?.event?.questions ?? []) as FreshInvited["questions"];
}

/** One answer per question, keyed by the event's real question ids. */
export function answersFor(fresh: FreshInvited): Array<{ questionId: string; answerText: string }> {
  return fresh.questions.map((q) => ({ questionId: q.id, answerText: `Seeded answer ${q.sortOrder}` }));
}

/**
 * Mint a brand-new invited proposal (fresh event, reusable vendor) and return its token,
 * event id, proposal id, and real questions. Mutating tests (submit/withdraw/resubmit) call
 * this so they never interfere with each other or with the shared read tokens.
 */
export async function mintFreshInvited(): Promise<FreshInvited> {
  // A DISTINCT vendor per proposal (unique yopmail): mutating submit/withdraw tests must be
  // fully independent — a shared vendor across many rapid submits proved unstable on QA.
  const vendorId = await createVendor();
  const eventId = await createPublishedEvent("rfp");
  const { proposalId, token } = await inviteAndToken(eventId, vendorId);
  const questions = await resolveQuestions(token);
  return { token, eventId, proposalId, questions };
}

/** Submit a fresh invited proposal with valid answers (no attachment) → active submission. */
async function submitFresh(fresh: FreshInvited): Promise<void> {
  const res = await pc.submit<any>(fresh.token, {
    price: 5000,
    deliveryWeeks: 10,
    answers: answersFor(fresh),
  });
  if (res.status !== 201) fail(`POST /api/portal/:token/submit (${fresh.eventId})`, res);
}

/**
 * Mint and return portal tokens for every proposal state the suite asserts against.
 * Keys: invited, submitted, withdrawn, awarded, eventDeleted, vendorDeleted, rfq, tenantA,
 * plus deadlinePassed passed through from process.env.PORTAL_TOKEN_DEADLINE.
 */
export async function seedPortalStates(): Promise<Record<string, string>> {
  await ensurePo();
  await ensureCategory();
  await ensureReusableVendor();

  const result: Record<string, string> = {};

  // invited — a plain invited proposal (shared read token).
  const invited = await mintFreshInvited();
  result.invited = invited.token;

  // submitted — invited then submit.
  const submitted = await mintFreshInvited();
  await submitFresh(submitted);
  result.submitted = submitted.token;

  // withdrawn — invited then submit then withdraw.
  const withdrawn = await mintFreshInvited();
  await submitFresh(withdrawn);
  const w = await pc.withdraw<any>(withdrawn.token);
  if (w.status !== 200) fail("DELETE /api/portal/:token/submit (withdraw seed)", w);
  result.withdrawn = withdrawn.token;

  // awarded — invited then submit then PO award.
  const awarded = await mintFreshInvited();
  await submitFresh(awarded);
  const aw = await sc.award<any>(awarded.eventId, awarded.proposalId, {}, po!.token);
  if (![200, 201].includes(aw.status)) fail("POST award (awarded seed)", aw);
  result.awarded = awarded.token;

  // eventDeleted — invited then PO deletes the event → resolve isBlocked event_deleted.
  const evDel = await mintFreshInvited();
  const de = await sc.deleteEvent<any>(evDel.eventId, po!.token);
  if (![200, 204].includes(de.status)) fail("DELETE event (eventDeleted seed)", de);
  result.eventDeleted = evDel.token;

  // vendorDeleted — dedicated vendor, invited, then PO deletes the vendor → vendor_deleted.
  const dedicatedVendorId = await createVendor();
  const vdEvent = await createPublishedEvent("rfp");
  const { token: vdToken } = await inviteAndToken(vdEvent, dedicatedVendorId);
  const dv = await vc.deleteVendor<any>(dedicatedVendorId, po!.token);
  if (![200, 204].includes(dv.status)) fail("DELETE vendor (vendorDeleted seed)", dv);
  result.vendorDeleted = vdToken;

  // rfq — an invited proposal on an RFQ event (visibleSections should be empty). Best-effort:
  // if RFQ publish behaves differently, TC-VPAPI-008 fails clearly rather than skipping.
  try {
    const rfqEvent = await createPublishedEvent("rfq");
    const { token: rfqToken } = await inviteAndToken(rfqEvent, reusableVendorId!);
    result.rfq = rfqToken;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[portalSeed] rfq state seed failed (TC-VPAPI-008 will fail, not skip): ${(e as Error).message}`);
    result.rfq = "";
  }

  // tenantA — RLS / cross-tenant read cases only need a valid single-tenant invited token.
  result.tenantA = invited.token;

  // deadlinePassed — NOT seedable via API; passed through from the env (teammate-seeded).
  const deadline = process.env.PORTAL_TOKEN_DEADLINE?.trim();
  if (deadline) {
    result.deadlinePassed = deadline;
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[portalSeed] PORTAL_TOKEN_DEADLINE is not set — the deadline-blocked tests " +
        "(TC-VPAPI-007/019/030/051, TC-VPSEC-010/012) will FAIL with a clear reason, never skip.",
    );
    result.deadlinePassed = "";
  }

  return result;
}

/** Best-effort teardown: delete every event and vendor created during seeding. */
export async function cleanupSeed(): Promise<void> {
  const owner = po;
  if (!owner) return;
  for (const id of createdEventIds) {
    try {
      await sc.deleteEvent(id, owner.token);
    } catch {
      /* best-effort */
    }
  }
  for (const id of createdVendorIds) {
    try {
      await vc.deleteVendor(id, owner.token);
    } catch {
      /* best-effort */
    }
  }
  createdEventIds.length = 0;
  createdVendorIds.length = 0;
}
