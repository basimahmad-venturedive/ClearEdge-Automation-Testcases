/**
 * CEIQ-FEAT-007 Sourcing Events — API core suite (Vitest api-ts).
 * Spec: SPEC_CEIQ-FEAT-007-sourcing-events.md §5 (17 endpoints), §6 error codes.
 * Manual suite: testcases/TC-CEIQ-FEAT-007.md (TC-SRCAPI-*).
 *
 * LIVE against QA (TEST_ENV=qa) via a real Procurement-Owner Cognito token
 * (liveOwnerContext). Deployed + verified 2026-07-30: GET /sourcing-events → 200.
 * SIDE-EFFECT-FREE: every draft created here is soft-deleted in afterAll.
 *
 * This is the CORE pass (list / create-draft / generate / detail / validation / auth).
 * Edit/publish-gate/invite/proposals/comparison/award/retry + async-AI-state cases are a
 * follow-up expansion (see testcases/TC-CEIQ-FEAT-007.md §4 matrix).
 */
import { afterAll, beforeAll, describe, expect } from "vitest";
import { liveOnly, deferred } from "../src/utils/suite";
import { SourcingClient } from "../src/clients/sourcingClient";
import { VendorDirectoryClient } from "../src/clients/vendorDirectoryClient";
import { isLiveEnv, hasLiveAnalystUser } from "../src/config/env";
import { liveOwnerContext, liveAnalystContext, type OwnerContext } from "../src/utils/poContext";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";

const d = isLiveEnv() ? describe : describe.skip;
const NONEXISTENT_UUID = "00000000-0000-4000-8000-000000000000";

const client = new SourcingClient();
const vendorClient = new VendorDirectoryClient();
let po: OwnerContext;
let cat: { primaryId: string; subId: string } | null = null;
let vendorId: string | null = null;
const created: string[] = [];

function futureDate(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Poll an event's async-status field until it reaches a terminal value (or the budget runs out). */
async function pollStatus(id: string, field: string, terminal: string[], maxMs = 90000, stepMs = 5000): Promise<string> {
  let status = "";
  for (let waited = 0; waited <= maxMs; waited += stepMs) {
    const d = await client.getEvent<any>(id, po.token);
    status = d.data?.data?.[field] ?? "";
    if (terminal.includes(status)) return status;
    await sleep(stepMs);
  }
  return status;
}

/** Create an empty draft via the PO and track it for cleanup. Returns the create response. */
async function mkDraft(type: "rfp" | "rfq" = "rfp"): Promise<any> {
  const res = await client.createEmptyDraft<any>({ type }, po.token);
  if (res.status === 201) created.push(res.data.data.id);
  return res;
}

/** PATCH a draft with every publish-gate-required field + criteria weights summing to 100. */
async function fillPublishable(id: string): Promise<any> {
  return client.updateEvent<any>(id, {
    title: "QA publishable draft",
    primaryCategoryId: cat?.primaryId,
    subcategoryId: cat?.subId,
    budget: 5000,
    timelineWeeks: 10,
    submissionDeadline: futureDate(30),
    scopeOfWork: "Automated QA scope of work.",
    evaluationCriteria: [
      { name: "Functional fit", weight: 60, sortOrder: 1 },
      { name: "Pricing", weight: 40, sortOrder: 2 },
    ],
  }, po.token);
}

/** Create → fill → publish a fresh event; returns its id (tracked for cleanup). */
async function mkPublished(): Promise<string> {
  const c = await mkDraft("rfp");
  const id = c.data.data.id as string;
  await fillPublishable(id);
  await client.publishEvent(id, po.token);
  return id;
}

d("CEIQ-FEAT-007 Sourcing Events — API core (QA)", () => {
  beforeAll(async () => {
    po = await liveOwnerContext();
    const catRes = await client.getCategories<any>(po.token);
    if (catRes.status === 200) {
      const cats = catRes.data.data.categories as Array<{ id: string; subcategories: Array<{ id: string }> }>;
      const withSub = cats.find((c) => (c.subcategories?.length ?? 0) > 0);
      if (withSub) cat = { primaryId: withSub.id, subId: withSub.subcategories[0]!.id };
    }
    // An active vendor to invite (invite #8 needs a real vendor id — no DB, no portal).
    const vl = await vendorClient.listVendors<any>({}, po.token);
    if (vl.status === 200) {
      const active = (vl.data.data.vendors ?? []).find((v: any) => v.status !== "inactive") ?? vl.data.data.vendors?.[0];
      if (active) vendorId = active.id;
    }
  });

  afterAll(async () => {
    for (const id of created) {
      try { await client.deleteEvent(id, po.token); } catch { /* best-effort cleanup */ }
    }
  });

  // ─────────────────────────────── List (#3) ───────────────────────────────
  liveOnly("TC-SRCAPI-014 — GET /sourcing-events returns 200 with events/counts/pagination shape @smoke @regression", async () => {
    const res = await client.listEvents<any>({}, po.token);
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.success).toBe(true);
    const data = res.data.data;
    expect(Array.isArray(data.events)).toBe(true);
    for (const k of ["all", "draft", "active", "expiringSoon", "closed", "awarded"]) {
      expect(typeof data.counts[k]).toBe("number");
    }
    expect(data.pagination).toHaveProperty("page");
    expect(data.pagination).toHaveProperty("limit");
    expect(data.pagination).toHaveProperty("total");
  });

  liveOnly("TC-SRCAPI-017 — list pagination honours page/limit query @regression", async () => {
    const res = await client.listEvents<any>({ page: 1, limit: 10 }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.data.pagination.page).toBe(1);
    expect(res.data.data.pagination.limit).toBe(10);
  });

  liveOnly("TC-SRCAPI-006 — GET /sourcing-events without a token → 401 @regression", async () => {
    const res = await client.listEvents<any>({}, undefined);
    assertResponseTime(res);
    expect(res.status).toBe(401);
  });

  // ──────────────────── Create empty draft "Skip to manual" (#2) ────────────────────
  liveOnly("TC-SRCAPI-002 — POST /sourcing-events (type=rfp) creates a Draft (SEV- id, aiGenerationStatus null) @smoke @regression", async () => {
    const res = await mkDraft("rfp");
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    const ev = res.data.data;
    expect(ev.status).toBe("draft");
    expect(ev.type).toBe("rfp");
    expect(ev.aiGenerationStatus).toBeNull();
    expect(String(ev.displayId)).toMatch(/^SEV-\d+$/);
  });

  liveOnly("TC-SRCAPI-003 — POST /sourcing-events (type=rfq) creates a Draft with empty additionalDetails @regression", async () => {
    const res = await mkDraft("rfq");
    assertResponseTime(res);
    expect(res.status).toBe(201);
    expect(res.data.data.type).toBe("rfq");
    expect(Array.isArray(res.data.data.additionalDetails)).toBe(true);
    expect(res.data.data.additionalDetails.length).toBe(0);
  });

  liveOnly("TC-SRCAPI-009 — POST /sourcing-events invalid type → 400 ERR_VALIDATION_FAILED @regression", async () => {
    const res = await client.createEmptyDraft<any>({ type: "banana" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-SRCAPI-010 — POST /sourcing-events missing type → 400 @regression", async () => {
    const res = await client.createEmptyDraft<any>({}, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
    expect(res.data.success).toBe(false);
  });

  // ──────────────────── Generate AI draft (#1) ────────────────────
  liveOnly("TC-SRCAPI-001 — POST /generate enqueues an AI draft (201, status draft, aiGenerationStatus pending) @smoke @regression", async () => {
    const prompt = "Automated QA probe: source an HR payroll platform for ~200 staff.";
    const res = await client.generateDraft<any>({ eventType: "rfp", prompt }, po.token);
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    const ev = res.data.data;
    if (ev?.id) created.push(ev.id);
    expect(ev.status).toBe("draft");
    expect(ev.aiGenerationStatus).toBe("pending");
    expect(ev.aiGenerationPrompt).toBe(prompt);
  });

  liveOnly("TC-SRCAPI-004 — POST /generate missing prompt → 400 ERR_VALIDATION_FAILED @regression", async () => {
    const res = await client.generateDraft<any>({ eventType: "rfp" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-SRCAPI-005 — POST /generate invalid eventType → 400 @regression", async () => {
    const res = await client.generateDraft<any>({ eventType: "xxx", prompt: "hi" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
  });

  // ──────────────────── Detail (#4) ────────────────────
  liveOnly("TC-SRCAPI-026 — GET /sourcing-events/:id returns the created draft detail @smoke @regression", async () => {
    const create = await mkDraft("rfp");
    expect(create.status).toBe(201);
    const id = create.data.data.id;
    const res = await client.getEvent<any>(id, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.data.id).toBe(id);
    expect(res.data.data.status).toBe("draft");
    expect(Array.isArray(res.data.data.qualifications)).toBe(true);
    expect(res.data.data.qualifications.length).toBe(5);
  });

  liveOnly("TC-SRCAPI-027 — GET /sourcing-events/:id nonexistent → 404 ERR_EVENT_NOT_FOUND @regression", async () => {
    const res = await client.getEvent<any>(NONEXISTENT_UUID, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_EVENT_NOT_FOUND");
  });

  // ──────────────────────────── Edit draft (#5) ────────────────────────────
  liveOnly("TC-SRCAPI-032 — PATCH title updates the draft; GET reflects it @smoke @regression", async () => {
    const c = await mkDraft("rfp");
    const id = c.data.data.id;
    const upd = await client.updateEvent<any>(id, { title: "QA edited title" }, po.token);
    assertResponseTime(upd);
    expect(upd.status, JSON.stringify(upd.data)).toBe(200);
    const get = await client.getEvent<any>(id, po.token);
    expect(get.data.data.title).toBe("QA edited title");
  });

  liveOnly("TC-SRCAPI-034 — PATCH submissionDeadline in the past → 400 @regression", async () => {
    const c = await mkDraft("rfp");
    const res = await client.updateEvent<any>(c.data.data.id, { submissionDeadline: "2000-01-01" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
  });

  liveOnly("TC-SRCAPI-035 — PATCH evaluationCriteria with <2 items → 400 @regression", async () => {
    const c = await mkDraft("rfp");
    const res = await client.updateEvent<any>(c.data.data.id, {
      evaluationCriteria: [{ name: "Only one", weight: 100, sortOrder: 1 }],
    }, po.token);
    expect(res.status).toBe(400);
  });

  liveOnly("TC-SRCAPI-037 — PATCH additionalDetails on an RFQ → 400 (RFP-only field) @regression", async () => {
    const c = await mkDraft("rfq");
    const res = await client.updateEvent<any>(c.data.data.id, {
      additionalDetails: [{ sectionKey: "introduction", content: "x" }],
    }, po.token);
    expect(res.status).toBe(400);
  });

  liveOnly("TC-SRCAPI-038 — PATCH nonexistent event → 404 ERR_EVENT_NOT_FOUND @regression", async () => {
    const res = await client.updateEvent<any>(NONEXISTENT_UUID, { title: "x" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_EVENT_NOT_FOUND");
  });

  // ──────────────────────────── Publish gate (#6) ────────────────────────────
  liveOnly("TC-SRCAPI-044 — publish a fully-filled draft (criteria=100) → active + aiSummaryStatus pending @smoke @regression", async () => {
    expect(cat, "category taxonomy must load for the publish happy-path").not.toBeNull();
    const c = await mkDraft("rfp");
    const id = c.data.data.id;
    const fill = await fillPublishable(id);
    expect(fill.status, `fill: ${JSON.stringify(fill.data)}`).toBe(200);
    const pub = await client.publishEvent<any>(id, po.token);
    assertResponseTime(pub);
    expect([200, 201], `publish: ${JSON.stringify(pub.data)}`).toContain(pub.status);
    const get = await client.getEvent<any>(id, po.token);
    expect(get.data.data.status).toBe("active");
    expect(get.data.data.aiSummaryStatus).toBe("pending");
  });

  liveOnly("TC-SRCAPI-045 — publish a bare draft → 400 ERR_MISSING_REQUIRED_FIELDS @regression", async () => {
    const c = await mkDraft("rfp");
    const res = await client.publishEvent<any>(c.data.data.id, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_MISSING_REQUIRED_FIELDS");
  });

  liveOnly("TC-SRCAPI-046 — publish with criteria weights ≠ 100 → 400 ERR_CRITERIA_WEIGHT_INVALID @regression", async () => {
    expect(cat).not.toBeNull();
    const c = await mkDraft("rfp");
    const id = c.data.data.id;
    await client.updateEvent<any>(id, {
      title: "QA", primaryCategoryId: cat!.primaryId, subcategoryId: cat!.subId,
      timelineWeeks: 8, submissionDeadline: futureDate(20), scopeOfWork: "scope",
      evaluationCriteria: [
        { name: "A", weight: 50, sortOrder: 1 },
        { name: "B", weight: 40, sortOrder: 2 },
      ],
    }, po.token);
    const res = await client.publishEvent<any>(id, po.token);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_CRITERIA_WEIGHT_INVALID");
  });

  liveOnly("TC-SRCAPI-047 — publish nonexistent event → 404 @regression", async () => {
    const res = await client.publishEvent<any>(NONEXISTENT_UUID, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
  });

  liveOnly("TC-SRCAPI-036 — editing an Active event → 409 ERR_EVENT_NOT_EDITABLE @regression", async () => {
    expect(cat).not.toBeNull();
    const id = await mkPublished();
    const res = await client.updateEvent<any>(id, { title: "cannot edit active" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EVENT_NOT_EDITABLE");
  });

  // ──────────────────────────── Read tabs on a published event (#9 / #12) ────────────────────────────
  liveOnly("TC-SRCAPI-062 — GET proposals on a published event with no submissions → 200 empty roster @regression", async () => {
    expect(cat).not.toBeNull();
    const id = await mkPublished();
    const res = await client.getProposals<any>(id, po.token);
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.success).toBe(true);
  });

  liveOnly("TC-SRCAPI-074 — GET comparison with no submissions → 200, null AI tradeoff summary @regression", async () => {
    expect(cat).not.toBeNull();
    const id = await mkPublished();
    const res = await client.getComparison<any>(id, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.data.aiTradeoffSummary ?? null).toBeNull();
  });

  // ──────────────────────────── Delete (#15) ────────────────────────────
  liveOnly("TC-SRCAPI-090 — DELETE soft-deletes an event; subsequent GET → 404 @smoke @regression", async () => {
    const c = await client.createEmptyDraft<any>({ type: "rfp" }, po.token);
    const id = c.data.data.id;
    const del = await client.deleteEvent<any>(id, po.token);
    assertResponseTime(del);
    expect([200, 204]).toContain(del.status);
    const get = await client.getEvent<any>(id, po.token);
    expect(get.status).toBe(404);
  });

  liveOnly("TC-SRCAPI-092 — DELETE nonexistent event → 404 @regression", async () => {
    const res = await client.deleteEvent<any>(NONEXISTENT_UUID, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
  });

  // ──────────────────────────── Retry generation (#1a) — negative ────────────────────────────
  liveOnly("TC-SRCAPI-093 — retry-generation on a non-failed (manual) event → 409 ERR_RETRY_NOT_APPLICABLE @regression", async () => {
    const c = await mkDraft("rfp"); // manual draft: ai_generation_status = null
    const res = await client.retryGeneration<any>(c.data.data.id, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_RETRY_NOT_APPLICABLE");
  });

  // ──────────────────────────── Auth / RBAC ────────────────────────────
  liveOnly("TC-SRCAPI-048 — create without a token → 401 @smoke @regression", async () => {
    const res = await client.createEmptyDraft<any>({ type: "rfp" }, undefined);
    assertResponseTime(res);
    expect(res.status).toBe(401);
  });

  const analystOnly = hasLiveAnalystUser() ? liveOnly : deferred;
  analystOnly("TC-SRCAPI-049 — Analyst (view_sourcing only) cannot create an event → 403 @regression", async () => {
    const an = await liveAnalystContext();
    const res = await client.createEmptyDraft<any>({ type: "rfp" }, an.token);
    assertResponseTime(res);
    expect(res.status).toBe(403);
  });

  // ──────────────────────────── Invite modal + send invitations (#7 / #8) ────────────────────────────
  liveOnly("TC-SRCAPI-053 — GET invite modal (#7) returns recommended + others vendor lists @regression", async () => {
    expect(cat).not.toBeNull();
    const id = await mkPublished();
    const res = await client.getInviteVendors<any>(id, po.token);
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(Array.isArray(res.data.data.recommended)).toBe(true);
    expect(Array.isArray(res.data.data.others)).toBe(true);
  });

  liveOnly("TC-SRCAPI-057 — POST invite (#8) invites an active vendor → invitedCount ≥ 1 @smoke @regression", async () => {
    expect(vendorId, "a QA vendor must exist to invite").not.toBeNull();
    const id = await mkPublished();
    const res = await client.invite<any>(id, { vendorIds: [vendorId] }, po.token);
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.data.invitedCount).toBeGreaterThanOrEqual(1);
  });

  liveOnly("TC-SRCAPI-058 — POST invite on a DRAFT event → 409 ERR_EVENT_NOT_ACTIVE @regression", async () => {
    const c = await mkDraft("rfp");
    const res = await client.invite<any>(c.data.data.id, { vendorIds: [vendorId ?? NONEXISTENT_UUID] }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EVENT_NOT_ACTIVE");
  });

  liveOnly("TC-SRCAPI-060 — POST invite with only a nonexistent vendor id → 400 ERR_NO_VALID_VENDORS @regression", async () => {
    const id = await mkPublished();
    const res = await client.invite<any>(id, { vendorIds: [NONEXISTENT_UUID] }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_NO_VALID_VENDORS");
  });

  // ──────────────────────────── Proposals & proposal detail (#9 / #10) ────────────────────────────
  liveOnly("TC-SRCAPI-063 — after invite, GET proposals (#9) lists the invited vendor (status invited, portalToken) @regression", async () => {
    expect(vendorId).not.toBeNull();
    const id = await mkPublished();
    await client.invite<any>(id, { vendorIds: [vendorId] }, po.token);
    const res = await client.getProposals<any>(id, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const proposals = res.data.data.proposals;
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    const p = proposals.find((x: any) => x.vendor?.id === vendorId) ?? proposals[0];
    expect(p.status).toBe("invited");
    expect(p.portalToken).toBeTruthy();
  });

  liveOnly("TC-SRCAPI-066 — GET proposal detail (#10) for an invited proposal → 200 status invited @regression", async () => {
    expect(vendorId).not.toBeNull();
    const id = await mkPublished();
    await client.invite<any>(id, { vendorIds: [vendorId] }, po.token);
    const list = await client.getProposals<any>(id, po.token);
    const pid = list.data.data.proposals[0].id;
    const res = await client.getProposal<any>(id, pid, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.data.status).toBe("invited");
  });

  liveOnly("TC-SRCAPI-067 — GET proposal detail with a nonexistent proposalId → 404 ERR_PROPOSAL_NOT_FOUND @regression", async () => {
    const id = await mkPublished();
    const res = await client.getProposal<any>(id, NONEXISTENT_UUID, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_PROPOSAL_NOT_FOUND");
  });

  // ──────────────────────────── Award — negatives (#13) ────────────────────────────
  liveOnly("TC-SRCAPI-081 — award a nonexistent proposal → 404 ERR_PROPOSAL_NOT_FOUND @regression", async () => {
    const id = await mkPublished();
    const res = await client.award<any>(id, NONEXISTENT_UUID, {}, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_PROPOSAL_NOT_FOUND");
  });

  liveOnly("TC-SRCAPI-082 — award an invited (not submitted) proposal → 409 ERR_PROPOSAL_NOT_SUBMITTED @regression", async () => {
    expect(vendorId).not.toBeNull();
    const id = await mkPublished();
    await client.invite<any>(id, { vendorIds: [vendorId] }, po.token);
    const list = await client.getProposals<any>(id, po.token);
    const pid = list.data.data.proposals[0].id;
    const res = await client.award<any>(id, pid, {}, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_PROPOSAL_NOT_SUBMITTED");
  });

  // ──────────────────────────── Internal notes (#14) ────────────────────────────
  liveOnly("TC-SRCAPI-086 — PATCH internal notes (#14) → 200; GET detail reflects it @regression", async () => {
    const c = await mkDraft("rfp");
    const id = c.data.data.id;
    const note = `QA note ${Date.now()}`;
    const res = await client.updateNotes<any>(id, { internalNotes: note }, po.token);
    assertResponseTime(res);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.data.internalNotes).toBe(note);
    const get = await client.getEvent<any>(id, po.token);
    expect(get.data.data.internalNotes).toBe(note);
  });

  liveOnly("TC-SRCAPI-087 — PATCH internal notes with an empty string clears them → 200 @regression", async () => {
    const c = await mkDraft("rfp");
    const res = await client.updateNotes<any>(c.data.data.id, { internalNotes: "" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    expect(res.data.data.internalNotes).toBe("");
  });

  liveOnly("TC-SRCAPI-088 — PATCH notes on a nonexistent event → 404 @regression", async () => {
    const res = await client.updateNotes<any>(NONEXISTENT_UUID, { internalNotes: "x" }, po.token);
    assertResponseTime(res);
    expect(res.status).toBe(404);
  });

  // ──────────────────────────── Async AI state machines — completion via polling (§6) ────────────────────────────
  liveOnly("TC-SRCAPI-094 — AI draft generation completes (aiGenerationStatus pending → completed) @regression", async () => {
    const g = await client.generateDraft<any>({ eventType: "rfp", prompt: "QA: source an HR payroll platform for 200 staff." }, po.token);
    expect(g.status).toBe(201);
    const id = g.data.data.id; created.push(id);
    expect(g.data.data.aiGenerationStatus).toBe("pending");
    const final = await pollStatus(id, "aiGenerationStatus", ["completed", "failed"]);
    expect(final, "AI draft generation should reach a terminal state").not.toBe("pending");
    expect(final).toBe("completed");
  }, 120000);

  liveOnly("TC-SRCAPI-095 — AI summary generation completes after publish (aiSummaryStatus pending → completed) @regression", async () => {
    expect(cat).not.toBeNull();
    const id = await mkPublished();
    const afterPublish = await client.getEvent<any>(id, po.token);
    expect(afterPublish.data.data.aiSummaryStatus).toBe("pending");
    const final = await pollStatus(id, "aiSummaryStatus", ["completed", "failed"]);
    expect(final).not.toBe("pending");
    expect(final).toBe("completed");
  }, 120000);

  // ── Residual — genuinely require the VENDOR PORTAL (separate vendor-facing app we don't drive) or a forced failure, NOT DB access ──
  deferred("TC-SRCAPI-079/080 — award SUCCESS (#13) + comparison with data (#12) [needs a vendor-portal-SUBMITTED proposal; only the portal moves a proposal invited→submitted]", () => {});
  deferred("TC-SRCAPI-070..073 — submitted-proposal content (#10 submission body) + attachment presigned URL (#11) [needs a vendor-portal submission + a real S3 attachment]", () => {});
  deferred("TC-SRCAPI-096 — AI tradeoff-summary completion + retry-after-failure (#16/#17) [tradeoff needs ≥1 submitted proposal; retry needs a forced 'failed' state we cannot induce via the API]", () => {});
});
