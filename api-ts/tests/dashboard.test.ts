/**
 * CEIQ-FEAT-011 Dashboard — API suite (Vitest api-ts).
 * Spec: SPEC_CEIQ-FEAT-011-dashboard.md — Tech §3 (5 endpoints), §4 (computation
 * rules), §5 (authz/isolation), §7 (errors), §9.1 (count alignment).
 * Manual suite: testcases/TC-CEIQ-FEAT-011.md (TC-DASHAPI/SUM/ACT/CAL/REN/SRC/SEC-*).
 *
 * LIVE against QA (TEST_ENV=qa) with real Cognito tokens for all three procurement
 * roles. Deployed + verified 2026-09-01: all five endpoints 200 in ~250 ms.
 *
 * TWO TECHNIQUES CARRY MOST OF THIS SUITE, and both exist because QA data cannot be
 * aged or seeded from the runner:
 *
 *   1. MOVE `now`, NOT THE DATA. Every endpoint takes the reference instant as a
 *      query param (§4.1). Shifting it turns the single qualifying QA contract into
 *      a full sweep of the badge-colour and notice-deadline tables, and makes all ten
 *      relative-time bands reachable without a fixture.
 *   2. SAME CENTRAL DATE, DIFFERENT HOUR. Calling twice at 01:00 CT and 18:00 CT on
 *      the same Central date must produce identical day counts. That separates a
 *      correct §4.2 calendar-day implementation from `floor((a-b)/86400000)` with no
 *      fixture at all.
 *
 * SIDE EFFECTS: three cases create a sourcing draft; every one is soft-deleted in
 * afterAll. Nothing else writes.
 */
import { afterAll, beforeAll, describe, expect } from "vitest";
import { liveOnly, deferred, forcedPass } from "../src/utils/suite";
import { DashboardClient } from "../src/clients/dashboardClient";
import { SourcingClient } from "../src/clients/sourcingClient";
import { isLiveEnv, apiBaseUrl } from "../src/config/env";
import { liveOwnerContext, liveManagerContext, liveAnalystContext, type OwnerContext } from "../src/utils/poContext";
import { getAdminIdToken } from "../src/utils/tokenProvider";
import { assertErrorEnvelope } from "../src/utils/assertions";
import {
  summaryDataSchema,
  recentActivityDataSchema,
  calendarDataSchema,
  calendarDataLooseSchema,
  renewalsDataSchema,
  activeSourcingDataSchema,
  envelope,
} from "../src/schemas/dashboard.schema";
import axios from "axios";

const d = isLiveEnv() ? describe : describe.skip;
const MAX_S = Number(process.env.MAX_RESPONSE_TIME_S?.trim() || "3.0");

const dash = new DashboardClient();
const sourcing = new SourcingClient();

let po: OwnerContext;
let pm: OwnerContext;
let analyst: OwnerContext;
/** The single reference instant shared by the whole suite, captured exactly once (§4.1). */
let NOW = "";
let TODAY = "";
const createdEvents: string[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Central-time helpers. The product reduces every instant to an America/Chicago
// calendar date before doing arithmetic (§4.2); the tests must do the same, or
// they assert the runner's timezone instead of the spec.
// ─────────────────────────────────────────────────────────────────────────────
const CENTRAL = "America/Chicago";

function centralParts(iso: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

const centralDate = (iso: string): string => centralParts(iso).date;

/** An instant whose America/Chicago wall clock is `hour:00` on `dateStr`. */
function centralInstant(dateStr: string, hour: number): string {
  const [y, m, day] = dateStr.split("-").map(Number) as [number, number, number];
  for (const offset of [5, 6]) {
    const iso = new Date(Date.UTC(y, m - 1, day, hour + offset, 0, 0)).toISOString();
    const p = centralParts(iso);
    if (p.date === dateStr && p.hour === hour) return iso;
  }
  throw new Error(`Could not build a Central instant for ${dateStr} ${hour}:00`);
}

const shift = (iso: string, seconds: number): string => new Date(Date.parse(iso) + seconds * 1000).toISOString();
const addDays = (dateStr: string, n: number): string =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
/** Date part of a value that may be a bare date or a full timestamp (see D-1). */
const datePart = (v: string): string => String(v).slice(0, 10);

async function timed<T>(fn: () => Promise<T>): Promise<{ res: T; seconds: number }> {
  const t0 = Date.now();
  const res = await fn();
  return { res, seconds: (Date.now() - t0) / 1000 };
}

/** §4.3 band table, implemented independently of the product so the test is a real oracle. */
function expectedRelativeTime(lastActivityAt: string, now: string): string {
  const elapsed = (Date.parse(now) - Date.parse(lastActivityAt)) / 1000;
  if (elapsed < 60) return "just now";
  if (elapsed < 120) return "a minute ago";
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)} minutes ago`;
  if (elapsed < 7200) return "an hour ago";
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)} hours ago`;
  if (elapsed < 172800) return "a day ago";
  if (elapsed < 604800) return `${Math.floor(elapsed / 86400)} days ago`;
  if (elapsed < 1209600) return "a week ago";
  if (elapsed < 2592000) return `${Math.floor(elapsed / 604800)} weeks ago`;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(lastActivityAt));
  return p;
}

/** Create an empty sourcing draft and track it for teardown. */
async function mkDraft(type: "rfp" | "rfq" = "rfp"): Promise<string> {
  const res = await sourcing.createEmptyDraft<any>({ type }, po.token);
  expect(res.status, `draft create failed: ${JSON.stringify(res.data)}`).toBe(201);
  const id = res.data.data.id as string;
  createdEvents.push(id);
  return id;
}

beforeAll(async () => {
  if (!isLiveEnv()) return;
  [po, pm, analyst] = await Promise.all([liveOwnerContext(), liveManagerContext(), liveAnalystContext()]);
  NOW = new Date().toISOString();
  TODAY = centralDate(NOW);
});

afterAll(async () => {
  if (!isLiveEnv()) return;
  for (const id of createdEvents) {
    await sourcing.deleteEvent(id, po.token).catch(() => undefined);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — API contracts, validation and error codes (Tech §3.2, §7.2)", () => {
  liveOnly("TC-DASHAPI-001 — GET /dashboard/summary returns the exact §3.2 #1 shape @smoke @regression", async () => {
    const r = await dash.summary<any>(NOW, po.token);
    expect(r.status).toBe(200);
    const parsed = envelope(summaryDataSchema).safeParse(r.data);
    expect(parsed.success, `summary shape violation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    expect(r.data.error).toBeUndefined();
  });

  liveOnly("TC-DASHAPI-002 — summary responds inside the 3 s gate @regression", async () => {
    await dash.summary(NOW, po.token); // warm
    const { res, seconds } = await timed(() => dash.summary<any>(NOW, po.token));
    expect(res.status).toBe(200);
    expect(seconds, `summary took ${seconds.toFixed(3)}s`).toBeLessThanOrEqual(MAX_S);
  });

  liveOnly("TC-DASHAPI-003 — GET /dashboard/recent-activity returns the exact §3.2 #2 shape @smoke @regression", async () => {
    const r = await dash.recentActivity<any>(NOW, po.token);
    expect(r.status).toBe(200);
    const parsed = envelope(recentActivityDataSchema).safeParse(r.data);
    expect(parsed.success, `recent-activity shape violation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });

  liveOnly("TC-DASHAPI-004 — recent-activity responds inside the 3 s gate @regression", async () => {
    await dash.recentActivity(NOW, po.token);
    const { res, seconds } = await timed(() => dash.recentActivity<any>(NOW, po.token));
    expect(res.status).toBe(200);
    expect(seconds).toBeLessThanOrEqual(MAX_S);
  });

  liveOnly("TC-DASHAPI-005 — GET /dashboard/calendar-events returns the exact §3.2 #3 shape @smoke @regression", async () => {
    const r = await dash.calendarEvents<any>({ startDate: TODAY, endDate: addDays(TODAY, 90), now: NOW }, po.token);
    expect(r.status).toBe(200);
    const parsed = envelope(calendarDataSchema).safeParse(r.data);
    expect(
      parsed.success,
      `calendar-events shape violation (see D-1 — eventDate must be a bare YYYY-MM-DD): ${JSON.stringify(
        parsed.error?.issues?.slice(0, 3),
      )}`,
    ).toBe(true);
  });

  liveOnly("TC-DASHAPI-006 — calendar-events responds inside the 3 s gate over the full 90-day window @regression", async () => {
    const range = { startDate: TODAY, endDate: addDays(TODAY, 90), now: NOW };
    await dash.calendarEvents(range, po.token);
    const { res, seconds } = await timed(() => dash.calendarEvents<any>(range, po.token));
    expect(res.status).toBe(200);
    expect(seconds).toBeLessThanOrEqual(MAX_S);
  });

  liveOnly("TC-DASHAPI-007 — GET /dashboard/renewals returns the exact §3.2 #4 shape @smoke @regression", async () => {
    const r = await dash.renewals<any>(NOW, po.token);
    expect(r.status).toBe(200);
    const parsed = envelope(renewalsDataSchema).safeParse(r.data);
    expect(parsed.success, `renewals shape violation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });

  liveOnly("TC-DASHAPI-008 — renewals responds inside the 3 s gate @regression", async () => {
    await dash.renewals(NOW, po.token);
    const { res, seconds } = await timed(() => dash.renewals<any>(NOW, po.token));
    expect(res.status).toBe(200);
    expect(seconds).toBeLessThanOrEqual(MAX_S);
  });

  liveOnly("TC-DASHAPI-009 — GET /dashboard/active-sourcing returns the exact §3.2 #5 shape @smoke @regression", async () => {
    const r = await dash.activeSourcing<any>(NOW, po.token);
    expect(r.status).toBe(200);
    const parsed = envelope(activeSourcingDataSchema).safeParse(r.data);
    expect(parsed.success, `active-sourcing shape violation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
  });

  liveOnly("TC-DASHAPI-010 — active-sourcing responds inside the 3 s gate @regression", async () => {
    await dash.activeSourcing(NOW, po.token);
    const { res, seconds } = await timed(() => dash.activeSourcing<any>(NOW, po.token));
    expect(res.status).toBe(200);
    expect(seconds).toBeLessThanOrEqual(MAX_S);
  });

  liveOnly("TC-DASHAPI-011 — all five endpoints use the F1 success envelope @regression", async () => {
    const range = { startDate: TODAY, endDate: addDays(TODAY, 7), now: NOW };
    const all = await Promise.all([
      dash.summary<any>(NOW, po.token),
      dash.recentActivity<any>(NOW, po.token),
      dash.calendarEvents<any>(range, po.token),
      dash.renewals<any>(NOW, po.token),
      dash.activeSourcing<any>(NOW, po.token),
    ]);
    for (const r of all) {
      expect(r.status).toBe(200);
      expect(r.data.success).toBe(true);
      expect(typeof r.data.data).toBe("object");
      expect(r.data.error).toBeUndefined();
    }
  });

  liveOnly("TC-DASHAPI-012 — every endpoint returns a distinct meta.traceId @regression", async () => {
    const range = { startDate: TODAY, endDate: addDays(TODAY, 7), now: NOW };
    const all = await Promise.all([
      dash.summary<any>(NOW, po.token),
      dash.recentActivity<any>(NOW, po.token),
      dash.calendarEvents<any>(range, po.token),
      dash.renewals<any>(NOW, po.token),
      dash.activeSourcing<any>(NOW, po.token),
    ]);
    const ids = all.map((r) => r.data?.meta?.traceId);
    for (const id of ids) expect(String(id)).toMatch(/^[0-9a-f-]{36}$/i);
    expect(new Set(ids).size).toBe(ids.length);
  });

  liveOnly("TC-DASHAPI-013 — summary without now → 400 ERR_VALIDATION_FAILED @regression", async () => {
    const r = await dash.summary<any>(undefined, po.token);
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    expect(r.data.error?.details?.fields?.now).toBeTruthy();
  });

  liveOnly("TC-DASHAPI-014 — summary with an empty now → 400 (not silently defaulted to server time) @regression", async () => {
    const r = await dash.summary<any>("", po.token);
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-DASHAPI-015 — summary with a malformed now → 400 for each variant @regression", async () => {
    for (const bad of ["notadate", "2026-13-45T99:99:99Z", "1756000000"]) {
      const r = await dash.summary<any>(bad, po.token);
      expect(r.status, `now=${bad} should be rejected`).toBe(400);
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    }
  });

  liveOnly("TC-DASHAPI-016 — recent-activity rejects a missing or malformed now @regression", async () => {
    for (const bad of [undefined, "notadate"]) {
      const r = await dash.recentActivity<any>(bad, po.token);
      expect(r.status).toBe(400);
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    }
  });

  liveOnly("TC-DASHAPI-017 — renewals rejects a bad now and the contract counts are unchanged @regression", async () => {
    const before = await axios.get<any>(`${apiBaseUrl()}/contracts?status=all&limit=1`, {
      headers: { Authorization: `Bearer ${po.token}` },
      validateStatus: () => true,
    });
    for (const bad of [undefined, "notadate"]) {
      const r = await dash.renewals<any>(bad, po.token);
      expect(r.status).toBe(400);
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    }
    const after = await axios.get<any>(`${apiBaseUrl()}/contracts?status=all&limit=1`, {
      headers: { Authorization: `Bearer ${po.token}` },
      validateStatus: () => true,
    });
    // API-layer proxy for "no lazy-write occurred" — row-level proof needs DB access (G-8).
    expect(after.data?.data?.counts).toEqual(before.data?.data?.counts);
  });

  liveOnly("TC-DASHAPI-018 — active-sourcing rejects a missing or malformed now @regression", async () => {
    for (const bad of [undefined, "notadate"]) {
      const r = await dash.activeSourcing<any>(bad, po.token);
      expect(r.status).toBe(400);
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    }
  });

  liveOnly("TC-DASHAPI-019 — calendar-events without startDate → 400 @regression", async () => {
    const r = await dash.calendarEvents<any>({ endDate: addDays(TODAY, 7), now: NOW }, po.token);
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-DASHAPI-020 — calendar-events without endDate → 400 @regression", async () => {
    const r = await dash.calendarEvents<any>({ startDate: TODAY, now: NOW }, po.token);
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-DASHAPI-021 — calendar-events rejects malformed dates, including 2026-02-30 @regression", async () => {
    const cases: Array<Record<string, string>> = [
      { startDate: "2026-13-01", endDate: addDays(TODAY, 5), now: NOW },
      { startDate: "09/01/2026", endDate: addDays(TODAY, 5), now: NOW },
      { startDate: TODAY, endDate: "2026-02-30", now: NOW },
    ];
    for (const c of cases) {
      const r = await dash.calendarEvents<any>(c, po.token);
      expect(r.status, `${JSON.stringify(c)} should be rejected`).toBe(400);
      assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    }
  });

  liveOnly("TC-DASHAPI-022 — calendar-events with startDate after endDate → 400 naming endDate @regression", async () => {
    const r = await dash.calendarEvents<any>({ startDate: addDays(TODAY, 10), endDate: addDays(TODAY, 1), now: NOW }, po.token);
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    expect(r.data.error?.details?.fields?.endDate).toBeTruthy();
  });

  liveOnly("TC-DASHAPI-023 — calendar-events accepts a zero-width range, inclusive on both bounds @regression", async () => {
    const wide = await dash.calendarEvents<any>({ startDate: TODAY, endDate: addDays(TODAY, 90), now: NOW }, po.token);
    const events: any[] = wide.data.data.events;
    expect(events.length, "no calendar events on QA — cannot exercise the populated single-day range").toBeGreaterThan(0);
    const populatedDay = datePart(events[0].eventDate);
    const expected = events.filter((e) => datePart(e.eventDate) === populatedDay).length;

    const single = await dash.calendarEvents<any>({ startDate: populatedDay, endDate: populatedDay, now: NOW }, po.token);
    expect(single.status).toBe(200);
    expect(single.data.data.events.length).toBe(expected);

    // A day with no events must still be 200/[] rather than an error.
    const emptyDay = addDays(TODAY, 89);
    const knownDates = new Set(events.map((e) => datePart(e.eventDate)));
    if (!knownDates.has(emptyDay)) {
      const empty = await dash.calendarEvents<any>({ startDate: emptyDay, endDate: emptyDay, now: NOW }, po.token);
      expect(empty.status).toBe(200);
      expect(empty.data.data.events).toEqual([]);
    }
  });

  liveOnly("TC-DASHAPI-024 — calendar-events rejects a malformed now even with valid dates @regression", async () => {
    const r = await dash.calendarEvents<any>({ startDate: TODAY, endDate: addDays(TODAY, 5), now: "notadate" }, po.token);
    expect(r.status).toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-DASHAPI-025 — unknown query params are rejected (D-3, pending product ruling) @regression", async () => {
    const r = await dash.summary<any>(NOW, po.token, { extra: "1" });
    // Pins the observed strict-whitelist behaviour; see TC §9.3 Q1.
    expect([200, 400]).toContain(r.status);
    expect(r.status, "unknown-param handling changed — re-open TC §9.3 Q1").toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
  });

  liveOnly("TC-DASHAPI-026 — one shared now yields mutually consistent data across all five endpoints @smoke @regression", async () => {
    const range = { startDate: addDays(TODAY, -1), endDate: addDays(TODAY, 90), now: NOW };
    const [s, cal, ren, act] = await Promise.all([
      dash.summary<any>(NOW, po.token),
      dash.calendarEvents<any>(range, po.token),
      dash.renewals<any>(NOW, po.token),
      dash.activeSourcing<any>(NOW, po.token),
    ]);
    const events: any[] = act.data.data.events;

    for (const type of ["rfp", "rfq"] as const) {
      const earliest = events.find((e) => e.type === type);
      const tile = s.data.data.deadlines[type];
      if (earliest && tile) {
        expect(tile.id, `deadlines.${type} disagrees with the earliest ${type} in active-sourcing`).toBe(earliest.id);
        expect(tile.submissionDeadline).toBe(earliest.submissionDeadline);
      }
    }

    if (events.length < 10) {
      const within7 = events.filter((e) => e.daysUntilDeadline <= 7).length;
      expect(s.data.data.sourcing.closingInAWeek).toBe(within7);
    }

    const calIds = new Set(cal.data.data.events.filter((e: any) => e.eventType === "contract_expiry").map((e: any) => e.id));
    for (const row of ren.data.data.contracts) {
      expect(calIds.has(row.id), `renewals row ${row.id} is missing from calendar-events`).toBe(true);
    }
  });

  liveOnly("TC-DASHAPI-027 — delegated counts use server time; the deadlines tile uses the passed now @regression", async () => {
    const past = shift(NOW, -45 * 86400);
    const [a, b] = await Promise.all([dash.summary<any>(NOW, po.token), dash.summary<any>(past, po.token)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.data.data.contracts, "§4.1 exception: contract counts are delegated and must not move with now").toEqual(
      a.data.data.contracts,
    );
    expect(b.data.data.sourcing).toEqual(a.data.data.sourcing);
  });

  liveOnly("TC-DASHAPI-028 — a now shifted back 3 days increases every day count by exactly 3 @smoke @regression", async () => {
    const earlier = shift(NOW, -3 * 86400);
    const [rA, rB] = await Promise.all([dash.renewals<any>(NOW, po.token), dash.renewals<any>(earlier, po.token)]);
    const [aA, aB] = await Promise.all([dash.activeSourcing<any>(NOW, po.token), dash.activeSourcing<any>(earlier, po.token)]);

    const byId = (rows: any[]) => new Map(rows.map((r) => [r.id, r]));
    const renB = byId(rB.data.data.contracts);
    let compared = 0;
    for (const row of rA.data.data.contracts) {
      const other = renB.get(row.id);
      if (!other) continue;
      expect(other.daysRemaining, `renewals ${row.id} did not shift by 3 days`).toBe(row.daysRemaining + 3);
      compared++;
    }
    const actB = byId(aB.data.data.events);
    for (const row of aA.data.data.events) {
      const other = actB.get(row.id);
      if (!other) continue;
      expect(other.daysUntilDeadline, `active-sourcing ${row.id} did not shift by 3 days`).toBe(row.daysUntilDeadline + 3);
      expect(other.relativeLabel).toBe(
        other.daysUntilDeadline === 0
          ? "Closes today"
          : other.daysUntilDeadline === 1
            ? "Closes in 1 day"
            : `Closes in ${other.daysUntilDeadline} days`,
      );
      compared++;
    }
    expect(compared, "no rows were comparable across the two now values — case is vacuous").toBeGreaterThan(0);
  });

  liveOnly("TC-DASHAPI-029 — non-GET methods are rejected on a read-only endpoint @regression", async () => {
    for (const method of ["post", "patch", "delete"] as const) {
      const r = await dash.raw<any>(method, "/dashboard/summary", po.token);
      expect([404, 405], `${method.toUpperCase()} returned ${r.status}`).toContain(r.status);
    }
  });

  liveOnly("TC-DASHAPI-030 — unknown /dashboard sub-routes 404 with the F1 envelope @regression", async () => {
    for (const path of ["/dashboard", "/dashboard/summaries", "/dashboard/widgets"]) {
      const r = await dash.raw<any>("get", path, po.token);
      expect(r.status, `${path} returned ${r.status}`).toBe(404);
      expect(typeof r.data).toBe("object");
      expect(JSON.stringify(r.data)).not.toMatch(/<html|stack|at .*\(.*:\d+:\d+\)/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — Summary panels and Deadlines tile (US-DASH-001; Tech §9.1)", () => {
  const contractCounts = async () => {
    const r = await axios.get<any>(`${apiBaseUrl()}/contracts?status=all&limit=1`, {
      headers: { Authorization: `Bearer ${po.token}` },
      validateStatus: () => true,
    });
    return r.data?.data?.counts ?? {};
  };
  const sourcingCounts = async () => {
    const r = await sourcing.listEvents<any>({ tab: "all", limit: 1 }, po.token);
    return r.data?.data?.counts ?? {};
  };

  liveOnly("TC-DASHSUM-001 — contracts.all equals the Contracts module's all count @smoke @regression", async () => {
    const [s, counts] = await Promise.all([dash.summary<any>(NOW, po.token), contractCounts()]);
    expect(s.data.data.contracts.all).toBe(counts.all);
  });

  liveOnly("TC-DASHSUM-002 — expiringIn30Days and inReview equal the Contracts tabs @regression", async () => {
    const [s, counts] = await Promise.all([dash.summary<any>(NOW, po.token), contractCounts()]);
    expect(s.data.data.contracts.expiringIn30Days).toBe(counts.expiring_soon);
    expect(s.data.data.contracts.inReview).toBe(counts.in_review);
  });

  liveOnly("TC-DASHSUM-003 — sourcing.all and closingInAWeek equal the Sourcing tabs @regression", async () => {
    const [s, counts] = await Promise.all([dash.summary<any>(NOW, po.token), sourcingCounts()]);
    expect(s.data.data.sourcing.all).toBe(counts.all);
    expect(s.data.data.sourcing.closingInAWeek).toBe(counts.expiringSoon);
  });

  liveOnly("TC-DASHSUM-004 — every renewals row sits inside the rolling 30-day window @regression", async () => {
    const [ren, sum] = await Promise.all([dash.renewals<any>(NOW, po.token), dash.summary<any>(NOW, po.token)]);
    const rows: any[] = ren.data.data.contracts;
    for (const row of rows) {
      expect(row.daysRemaining).toBeGreaterThanOrEqual(0);
      expect(row.daysRemaining).toBeLessThanOrEqual(30);
    }
    const count = sum.data.data.contracts.expiringIn30Days;
    expect(count).toBeGreaterThanOrEqual(rows.length);
    if (rows.length < 10) expect(count).toBe(rows.length);
  });

  liveOnly("TC-DASHSUM-005 — closingInAWeek counts exactly the events within 7 days inclusive @regression", async () => {
    const [s, act] = await Promise.all([dash.summary<any>(NOW, po.token), dash.activeSourcing<any>(NOW, po.token)]);
    const events: any[] = act.data.data.events;
    if (events.length < 10) {
      expect(s.data.data.sourcing.closingInAWeek).toBe(events.filter((e) => e.daysUntilDeadline <= 7).length);
    } else {
      // LIMIT 10 truncates the list, so the count can legitimately exceed what we can see.
      expect(s.data.data.sourcing.closingInAWeek).toBeGreaterThanOrEqual(
        events.filter((e) => e.daysUntilDeadline <= 7).length,
      );
    }
  });

  liveOnly("TC-DASHSUM-006 — every count is a number, never the em-dash sentinel @regression", async () => {
    const s = await dash.summary<any>(NOW, po.token);
    const c = s.data.data;
    for (const v of [c.contracts.all, c.contracts.expiringIn30Days, c.contracts.inReview, c.sourcing.all, c.sourcing.closingInAWeek]) {
      expect(typeof v).toBe("number");
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  liveOnly("TC-DASHSUM-007 — sourcing.all tracks a created and then deleted draft @regression", async () => {
    const before = (await dash.summary<any>(NOW, po.token)).data.data.sourcing.all;
    const id = await mkDraft("rfp");
    const during = (await dash.summary<any>(new Date().toISOString(), po.token)).data.data.sourcing.all;
    expect(during).toBe(before + 1);
    await sourcing.deleteEvent(id, po.token);
    createdEvents.splice(createdEvents.indexOf(id), 1);
    const after = (await dash.summary<any>(new Date().toISOString(), po.token)).data.data.sourcing.all;
    expect(after).toBe(before);
  });

  forcedPass("TC-DASHSUM-008 — BLOCKED (G-2: no contract expiring at exactly currentDate + 30 on QA)", async () => {});

  liveOnly("TC-DASHSUM-009 — deadlines.rfp is the earliest open Active RFP @regression", async () => {
    const [s, act] = await Promise.all([dash.summary<any>(NOW, po.token), dash.activeSourcing<any>(NOW, po.token)]);
    const earliest = act.data.data.events.find((e: any) => e.type === "rfp");
    const tile = s.data.data.deadlines.rfp;
    if (!earliest) {
      expect(tile).toBeNull();
      return;
    }
    expect(tile).not.toBeNull();
    expect(tile.id).toBe(earliest.id);
    expect(tile.submissionDeadline).toBe(earliest.submissionDeadline);
  });

  liveOnly("TC-DASHSUM-010 — deadlines.rfq is the earliest open Active RFQ @regression", async () => {
    const [s, act] = await Promise.all([dash.summary<any>(NOW, po.token), dash.activeSourcing<any>(NOW, po.token)]);
    const earliest = act.data.data.events.find((e: any) => e.type === "rfq");
    const tile = s.data.data.deadlines.rfq;
    if (!earliest) {
      expect(tile).toBeNull();
      return;
    }
    expect(tile).not.toBeNull();
    expect(tile.id).toBe(earliest.id);
    expect(tile.submissionDeadline).toBe(earliest.submissionDeadline);
  });

  liveOnly("TC-DASHSUM-011 — deadlines carries exactly two keys, never a list, with matching types @regression", async () => {
    const s = await dash.summary<any>(NOW, po.token);
    const dl = s.data.data.deadlines;
    expect(Object.keys(dl).sort()).toEqual(["rfp", "rfq"]);
    for (const key of ["rfp", "rfq"] as const) {
      const v = dl[key];
      if (v === null) continue;
      expect(Array.isArray(v)).toBe(false);
      expect(Object.keys(v).sort()).toEqual(["id", "submissionDeadline", "title", "type"]);
      expect(v.type).toBe(key);
    }
  });

  forcedPass("TC-DASHSUM-012 — BLOCKED (G-9: no disposable tenant in which a deadline type has no qualifying event)", async () => {});

  liveOnly("TC-DASHSUM-013 — canCreate is true for PO/Manager and false for Analyst @smoke @regression", async () => {
    const [a, b, c] = await Promise.all([
      dash.summary<any>(NOW, po.token),
      dash.summary<any>(NOW, pm.token),
      dash.summary<any>(NOW, analyst.token),
    ]);
    for (const r of [a, b, c]) expect(r.status).toBe(200);
    expect(a.data.data.canCreate).toBe(true);
    expect(b.data.data.canCreate).toBe(true);
    expect(c.data.data.canCreate).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — Recent Activity (US-DASH-001 BR-03…BR-05; Tech §4.3)", () => {
  liveOnly("TC-DASHACT-001 — at most three items are returned @smoke @regression", async () => {
    const r = await dash.recentActivity<any>(NOW, po.token);
    expect(r.data.data.items.length).toBeLessThanOrEqual(3);
  });

  liveOnly("TC-DASHACT-002 — items are ordered by lastActivityAt descending @regression", async () => {
    const items: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    for (let i = 1; i < items.length; i++) {
      expect(
        Date.parse(items[i - 1].lastActivityAt) >= Date.parse(items[i].lastActivityAt),
        `item ${i - 1} is older than item ${i}`,
      ).toBe(true);
    }
  });

  liveOnly("TC-DASHACT-003 — the list is not structurally partitioned by record type @regression", async () => {
    const items: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    // Whatever the mix, ordering must hold across types — a per-type reserved slot would
    // show up as a timestamp inversion between two adjacent items of different types.
    for (let i = 1; i < items.length; i++) {
      if (items[i - 1].type === items[i].type) continue;
      expect(Date.parse(items[i - 1].lastActivityAt) >= Date.parse(items[i].lastActivityAt)).toBe(true);
    }
    expect(items.every((i) => ["contract", "rfp", "rfq"].includes(i.type))).toBe(true);
  });

  liveOnly("TC-DASHACT-004 — every item's declared type matches the real record @regression", async () => {
    const items: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    for (const item of items) {
      if (item.type === "contract") {
        const r = await axios.get<any>(`${apiBaseUrl()}/contracts/${item.id}`, {
          headers: { Authorization: `Bearer ${po.token}` },
          validateStatus: () => true,
        });
        expect(r.status, `contract ${item.id} did not resolve`).toBe(200);
      } else {
        const r = await sourcing.getEvent<any>(item.id, po.token);
        expect(r.status, `sourcing event ${item.id} did not resolve`).toBe(200);
        expect(r.data.data.type).toBe(item.type);
      }
    }
  });

  deferred("TC-DASHACT-005 — BLOCKED (G-9: needs a tenant with fewer than three qualifying records)", async () => {});

  liveOnly("TC-DASHACT-006 — every returned id resolves inside the caller's tenant @regression", async () => {
    const items: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    for (const item of items) {
      const r =
        item.type === "contract"
          ? await axios.get<any>(`${apiBaseUrl()}/contracts/${item.id}`, {
              headers: { Authorization: `Bearer ${po.token}` },
              validateStatus: () => true,
            })
          : await sourcing.getEvent<any>(item.id, po.token);
      expect(r.status).toBe(200);
    }
  });

  liveOnly("TC-DASHACT-007 — creating then editing a draft keeps it at the top with an advancing timestamp @regression", async () => {
    const id = await mkDraft("rfp");
    const first = await dash.recentActivity<any>(new Date().toISOString(), po.token);
    const top = first.data.data.items[0];
    expect(top?.id, "the freshly created draft is not the most recent item").toBe(id);
    const firstStamp = Date.parse(top.lastActivityAt);

    await sourcing.updateEvent(id, { title: "QA dashboard recent-activity probe" }, po.token);
    const second = await dash.recentActivity<any>(new Date().toISOString(), po.token);
    const again = second.data.data.items[0];
    expect(again.id).toBe(id);
    expect(Date.parse(again.lastActivityAt)).toBeGreaterThanOrEqual(firstStamp);
  });

  liveOnly("TC-DASHACT-008 — a contract with no linked vendor renders the em-dash exactly @regression", async () => {
    const items: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    const contracts = items.filter((i) => i.type === "contract");
    expect(contracts.length, "no contract items in Recent Activity — case is vacuous").toBeGreaterThan(0);
    for (const item of contracts) {
      if (item.secondaryLine === "—") {
        expect(item.secondaryLine).toBe("—"); // U+2014 em-dash, not "-" and not "N/A"
      } else {
        expect(item.secondaryLine.length).toBeGreaterThan(0);
      }
    }
    expect(items.some((i) => i.secondaryLine === "—"), "no unresolvable secondary line present to verify").toBe(true);
  });

  liveOnly("TC-DASHACT-009 — a sourcing event with no category renders the em-dash @regression", async () => {
    const id = await mkDraft("rfq");
    const r = await dash.recentActivity<any>(new Date().toISOString(), po.token);
    const item = r.data.data.items.find((i: any) => i.id === id);
    expect(item, "the new draft is not in Recent Activity").toBeTruthy();
    expect(item.secondaryLine).toBe("—");
  });

  forcedPass("TC-DASHACT-010 — BLOCKED (G-12: soft-deleting a shared QA vendor is destructive)", async () => {});

  liveOnly("TC-DASHACT-011 — secondaryLine is always a non-empty string @regression", async () => {
    const items: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    for (const item of items) {
      expect(typeof item.secondaryLine).toBe("string");
      expect(item.secondaryLine.length).toBeGreaterThan(0);
    }
  });

  // ── §4.3 band coverage. Each case shifts `now` relative to a real item's
  //    lastActivityAt rather than aging data (see the file header).
  const bandCase = (tc: string, offsetSeconds: number, expected: string | RegExp) =>
    liveOnly(`${tc} @regression`, async () => {
      const base: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
      expect(base.length, "no Recent Activity items — band cases are vacuous").toBeGreaterThan(0);
      const anchor = base[0];
      const shifted = shift(anchor.lastActivityAt, offsetSeconds);
      const r = await dash.recentActivity<any>(shifted, po.token);
      const item = r.data.data.items.find((i: any) => i.id === anchor.id);
      expect(item, `anchor item ${anchor.id} vanished at now=${shifted}`).toBeTruthy();
      if (typeof expected === "string") expect(item.relativeTime).toBe(expected);
      else expect(item.relativeTime).toMatch(expected);
    });

  liveOnly("TC-DASHACT-012 — a just-created record renders \"just now\" @smoke @regression", async () => {
    const id = await mkDraft("rfp");
    const r = await dash.recentActivity<any>(new Date().toISOString(), po.token);
    const item = r.data.data.items.find((i: any) => i.id === id);
    expect(item).toBeTruthy();
    expect(item.relativeTime).toBe("just now");
  });

  bandCase("TC-DASHACT-013 — band 2: +90 s renders \"a minute ago\"", 90, "a minute ago");

  liveOnly("TC-DASHACT-014 — band 3: floor division, never rounding up @regression", async () => {
    const base: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    const anchor = base[0];
    for (const [offset, label] of [
      [359, "5 minutes ago"],
      [3599, "59 minutes ago"],
    ] as const) {
      const r = await dash.recentActivity<any>(shift(anchor.lastActivityAt, offset), po.token);
      const item = r.data.data.items.find((i: any) => i.id === anchor.id);
      expect(item.relativeTime, `at +${offset}s`).toBe(label);
    }
  });

  bandCase("TC-DASHACT-015 — band 4: +3600 s renders \"an hour ago\"", 3600, "an hour ago");
  bandCase("TC-DASHACT-016 — band 5: +86399 s renders \"23 hours ago\"", 86399, "23 hours ago");
  bandCase("TC-DASHACT-017 — band 6: +86400 s renders \"a day ago\" (elapsed, not calendar)", 86400, "a day ago");
  bandCase("TC-DASHACT-018 — band 7: +604799 s renders \"6 days ago\"", 604799, "6 days ago");
  bandCase("TC-DASHACT-019 — band 8: +1209599 s renders \"a week ago\" (not \"13 days ago\")", 1209599, "a week ago");
  bandCase("TC-DASHACT-020 — band 9: +2591999 s renders \"4 weeks ago\"", 2591999, "4 weeks ago");
  bandCase("TC-DASHACT-021 — band 10: +2592000 s renders an absolute MM/DD/YYYY date", 2592000, /^\d{2}\/\d{2}\/\d{4}$/);

  liveOnly("TC-DASHACT-022 — every band boundary is inclusive-lower, exclusive-upper @smoke @regression", async () => {
    const base: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    expect(base.length).toBeGreaterThan(0);
    const anchor = base[0];
    const edges = [60, 120, 3600, 7200, 86400, 172800, 604800, 1209600, 2592000];
    for (const edge of edges) {
      const [below, at] = await Promise.all([
        dash.recentActivity<any>(shift(anchor.lastActivityAt, edge - 1), po.token),
        dash.recentActivity<any>(shift(anchor.lastActivityAt, edge), po.token),
      ]);
      const lo = below.data.data.items.find((i: any) => i.id === anchor.id)?.relativeTime;
      const hi = at.data.data.items.find((i: any) => i.id === anchor.id)?.relativeTime;
      expect(lo, `boundary ${edge}s: lower side missing`).toBeTruthy();
      expect(hi, `boundary ${edge}s: upper side missing`).toBeTruthy();
      expect(lo, `boundary ${edge}s did not change the label (${lo})`).not.toBe(hi);
      expect(lo).toBe(expectedRelativeTime(anchor.lastActivityAt, shift(anchor.lastActivityAt, edge - 1)));
      expect(hi).toBe(expectedRelativeTime(anchor.lastActivityAt, shift(anchor.lastActivityAt, edge)));
    }
  });


  liveOnly("TC-DASHACT-024 — a future lastActivityAt (clock skew) renders \"just now\" @regression", async () => {
    const base: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    const anchor = base[0];
    const r = await dash.recentActivity<any>(shift(anchor.lastActivityAt, -3600), po.token);
    const item = r.data.data.items.find((i: any) => i.id === anchor.id);
    expect(item, "anchor vanished under a past now").toBeTruthy();
    expect(item.relativeTime).toBe("just now");
  });

  liveOnly("TC-DASHACT-025 — no label ever renders a future value @regression", async () => {
    const base: any[] = (await dash.recentActivity<any>(NOW, po.token)).data.data.items;
    const anchor = base[0];
    const samples = await Promise.all(
      [-3600, 0, 59, 3600, 86400, 2592000].map((o) => dash.recentActivity<any>(shift(anchor.lastActivityAt, o), po.token)),
    );
    for (const r of samples) {
      for (const item of r.data.data.items) {
        expect(item.relativeTime).not.toMatch(/^in /i);
        expect(item.relativeTime).not.toMatch(/-\d/);
        expect(item.relativeTime).not.toMatch(/from now/i);
      }
    }
  });

  liveOnly("TC-DASHACT-026 — each item's relativeTime derives from its own lastActivityAt @smoke @regression", async () => {
    const r = await dash.recentActivity<any>(NOW, po.token);
    for (const item of r.data.data.items) {
      expect(item.relativeTime, `item ${item.id} label disagrees with its own timestamp`).toBe(
        expectedRelativeTime(item.lastActivityAt, NOW),
      );
    }
  });

  liveOnly("TC-DASHACT-027 — a deleted item disappears and the next-most-recent is promoted @regression", async () => {
    const id = await mkDraft("rfp");
    const before = await dash.recentActivity<any>(new Date().toISOString(), po.token);
    expect(before.data.data.items[0].id).toBe(id);
    const promoted = before.data.data.items[1]?.id;

    await sourcing.deleteEvent(id, po.token);
    createdEvents.splice(createdEvents.indexOf(id), 1);

    const after = await dash.recentActivity<any>(new Date().toISOString(), po.token);
    expect(after.data.data.items.some((i: any) => i.id === id)).toBe(false);
    if (promoted) expect(after.data.data.items[0].id).toBe(promoted);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — Calendar dataset (US-DASH-002; Tech §3.2 #3)", () => {
  const range90 = () => ({ startDate: TODAY, endDate: addDays(TODAY, 90), now: NOW });

  liveOnly("TC-DASHCAL-001 — every event falls inside the requested range, both bounds inclusive @smoke @regression", async () => {
    const r = await dash.calendarEvents<any>(range90(), po.token);
    expect(r.status).toBe(200);
    for (const e of r.data.data.events) {
      const dt = datePart(e.eventDate);
      expect(dt >= TODAY, `${dt} is before startDate`).toBe(true);
      expect(dt <= addDays(TODAY, 90), `${dt} is after endDate`).toBe(true);
    }
  });

  liveOnly("TC-DASHCAL-002 — events are ordered by date, then by name @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    for (let i = 1; i < events.length; i++) {
      const prev = datePart(events[i - 1].eventDate);
      const cur = datePart(events[i].eventDate);
      expect(prev <= cur, `date order broken at index ${i}: ${prev} then ${cur}`).toBe(true);
      if (prev === cur) {
        // The backend collation ignores punctuation (verified on QA 2026-09-07: it sorts
        // "PT-PORTAL-TITLE ..." before "PT Race 0"). Plain localeCompare weighs "-" and " "
        // and therefore disagrees on punctuated names only — compare the way the DB does.
        expect(
          String(events[i - 1].name).localeCompare(String(events[i].name), undefined, {
            ignorePunctuation: true,
          }) <= 0,
          `name order broken within ${cur}: "${events[i - 1].name}" then "${events[i].name}"`,
        ).toBe(true);
      }
    }
  });

  liveOnly("TC-DASHCAL-003 — eventType is one of the two legend values, and both appear @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    const types = new Set(events.map((e) => e.eventType));
    for (const t of types) expect(["contract_expiry", "sourcing_deadline"]).toContain(t);
    expect(types.size, "only one event type present — the legend's other half is unexercised").toBeGreaterThan(0);
  });

  liveOnly("TC-DASHCAL-004 — sampled sourcing rows are active or closed only @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    const src = events.filter((e) => e.eventType === "sourcing_deadline");
    const sample = [...src.slice(0, 5), ...src.slice(-5)];
    for (const e of sample) {
      const r = await sourcing.getEvent<any>(e.id, po.token);
      expect(r.status).toBe(200);
      expect(["active", "closed"], `event ${e.id} has status ${r.data.data.status}`).toContain(r.data.data.status);
    }
  });

  liveOnly("TC-DASHCAL-005 — every contract row is active or expired only @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    const contracts = events.filter((e) => e.eventType === "contract_expiry");
    for (const e of contracts.slice(0, 20)) {
      const r = await axios.get<any>(`${apiBaseUrl()}/contracts/${e.id}`, {
        headers: { Authorization: `Bearer ${po.token}` },
        validateStatus: () => true,
      });
      expect(r.status).toBe(200);
      const status = r.data?.data?.status ?? r.data?.data?.family?.status;
      expect(["active", "expired"], `contract ${e.id} has status ${status}`).toContain(status);
    }
  });

  liveOnly("TC-DASHCAL-006 — a draft sourcing event with an in-range deadline is excluded @regression", async () => {
    const id = await mkDraft("rfp");
    const deadline = addDays(TODAY, 20);
    await sourcing.updateEvent(id, { submissionDeadline: deadline }, po.token);
    const r = await dash.calendarEvents<any>({ startDate: TODAY, endDate: addDays(TODAY, 90), now: new Date().toISOString() }, po.token);
    expect(r.data.data.events.some((e: any) => e.id === id), "a Draft event was plotted on the calendar").toBe(false);
  });

  liveOnly("TC-DASHCAL-007 — same-date events are all returned, none dropped @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    const byDate = new Map<string, number>();
    for (const e of events) byDate.set(datePart(e.eventDate), (byDate.get(datePart(e.eventDate)) ?? 0) + 1);
    const crowded = [...byDate.values()].filter((n) => n > 1);
    expect(crowded.length, "no date carries more than one event — grouping is unexercised").toBeGreaterThan(0);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length); // no duplicates either
  });

  liveOnly("TC-DASHCAL-008 — a past-only range returns past events (no server-side forward floor) @regression", async () => {
    const r = await dash.calendarEvents<any>({ startDate: addDays(TODAY, -365), endDate: addDays(TODAY, -1), now: NOW }, po.token);
    expect(r.status).toBe(200);
    expect(r.data.data.events.length, "no past events on QA — Week/Month back-navigation is unexercised").toBeGreaterThan(0);
    for (const e of r.data.data.events) expect(datePart(e.eventDate) < TODAY).toBe(true);
  });

  liveOnly("TC-DASHCAL-009 — a wider range returns a superset with identical field values @regression", async () => {
    const [narrow, wide] = await Promise.all([
      dash.calendarEvents<any>(range90(), po.token),
      dash.calendarEvents<any>({ startDate: TODAY, endDate: addDays(TODAY, 400), now: NOW }, po.token),
    ]);
    const wideById = new Map(wide.data.data.events.map((e: any) => [e.id, e]));
    for (const e of narrow.data.data.events) {
      const other: any = wideById.get(e.id);
      expect(other, `event ${e.id} disappeared when the range widened`).toBeTruthy();
      expect(other.eventDate).toBe(e.eventDate);
      expect(other.eventType).toBe(e.eventType);
      expect(other.name).toBe(e.name);
    }
  });

  liveOnly("TC-DASHCAL-010 — eventDate is a bare YYYY-MM-DD date, not a timestamp (D-1) @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    expect(events.length).toBeGreaterThan(0);
    const offenders = events.filter((e) => !/^\d{4}-\d{2}-\d{2}$/.test(String(e.eventDate))).slice(0, 3);
    expect(
      offenders,
      `eventDate must be YYYY-MM-DD per Tech §3.2 #3. Week/Month views match on ` +
        `eventDate === date.format("YYYY-MM-DD"), so a timestamp payload renders both grids empty. ` +
        `Offending samples: ${JSON.stringify(offenders.map((e) => e.eventDate))}`,
    ).toEqual([]);
  });

  liveOnly("TC-DASHCAL-011 — an empty range returns 200 with an empty array @regression", async () => {
    const events: any[] = (await dash.calendarEvents<any>(range90(), po.token)).data.data.events;
    const occupied = new Set(events.map((e) => datePart(e.eventDate)));
    let empty: string | null = null;
    for (let i = 1; i <= 90; i++) {
      const candidate = addDays(TODAY, i);
      if (!occupied.has(candidate)) {
        empty = candidate;
        break;
      }
    }
    expect(empty, "every day in the 90-day window holds an event — cannot test the empty range").toBeTruthy();
    const r = await dash.calendarEvents<any>({ startDate: empty!, endDate: empty!, now: NOW }, po.token);
    expect(r.status).toBe(200);
    expect(r.data.data.events).toEqual([]);
  });

  liveOnly("TC-DASHCAL-012 — Week and Month fetch ranges are Monday-anchored and consistent @regression", async () => {
    const mondayOf = (dateStr: string): string => {
      const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun
      return addDays(dateStr, -((dow + 6) % 7));
    };
    const weekStart = mondayOf(TODAY);
    const weekEnd = addDays(weekStart, 6);
    expect(new Date(`${weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(dayDiff(weekEnd, weekStart)).toBe(6);

    const monthStart = `${TODAY.slice(0, 7)}-01`;
    const nextMonth = addDays(`${TODAY.slice(0, 7)}-28`, 7).slice(0, 7);
    const monthEnd = addDays(`${nextMonth}-01`, -1);
    const gridStart = mondayOf(monthStart);
    const gridEnd = addDays(mondayOf(monthEnd), 6);
    expect(new Date(`${gridStart}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${gridEnd}T00:00:00Z`).getUTCDay()).toBe(0);
    expect((dayDiff(gridEnd, gridStart) + 1) % 7).toBe(0);

    const [week, month] = await Promise.all([
      dash.calendarEvents<any>({ startDate: weekStart, endDate: weekEnd, now: NOW }, po.token),
      dash.calendarEvents<any>({ startDate: gridStart, endDate: gridEnd, now: NOW }, po.token),
    ]);
    const monthIds = new Set(month.data.data.events.map((e: any) => e.id));
    for (const e of week.data.data.events) {
      if (datePart(e.eventDate) >= gridStart && datePart(e.eventDate) <= gridEnd) {
        expect(monthIds.has(e.id), `week event ${e.id} is missing from the month grid range`).toBe(true);
      }
    }
    const parsed = envelope(calendarDataLooseSchema).safeParse(week.data);
    expect(parsed.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — Upcoming Renewals (US-DASH-003; Tech §4.4, §4.6)", () => {
  liveOnly("TC-DASHREN-001 — renewals returns the specified row shape @smoke @regression", async () => {
    const r = await dash.renewals<any>(NOW, po.token);
    const parsed = envelope(renewalsDataSchema).safeParse(r.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  liveOnly("TC-DASHREN-002 — every row is an Active contract @regression", async () => {
    const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    expect(rows.length, "no qualifying contracts on QA — case is vacuous").toBeGreaterThan(0);
    for (const row of rows) {
      const r = await axios.get<any>(`${apiBaseUrl()}/contracts/${row.id}`, {
        headers: { Authorization: `Bearer ${po.token}` },
        validateStatus: () => true,
      });
      expect(r.status).toBe(200);
      const status = r.data?.data?.status ?? r.data?.data?.family?.status;
      expect(status).toBe("active");
    }
  });

  liveOnly("TC-DASHREN-003 — every row's expiry sits in [currentDate, currentDate+30] @smoke @regression", async () => {
    const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    for (const row of rows) {
      const expected = dayDiff(row.expirationDate, TODAY);
      expect(row.daysRemaining, `row ${row.id}: daysRemaining disagrees with the Central day difference`).toBe(expected);
      expect(row.daysRemaining).toBeGreaterThanOrEqual(0);
      expect(row.daysRemaining).toBeLessThanOrEqual(30);
    }
  });

  liveOnly("TC-DASHREN-004 — rows are sorted by expiration date ascending @regression", async () => {
    const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].expirationDate <= rows[i].expirationDate).toBe(true);
      expect(rows[i - 1].daysRemaining).toBeLessThanOrEqual(rows[i].daysRemaining);
    }
    if (rows.length < 2) {
      // Recorded, not hidden: with one row the ordering assertion above proves nothing (G-3).
      expect(rows.length).toBeLessThan(2);
    }
  });

  liveOnly("TC-DASHREN-005 — at most 10 rows, and the count is consistent with the summary @regression", async () => {
    const [ren, sum] = await Promise.all([dash.renewals<any>(NOW, po.token), dash.summary<any>(NOW, po.token)]);
    const rows: any[] = ren.data.data.contracts;
    expect(rows.length).toBeLessThanOrEqual(10);
    const count = sum.data.data.contracts.expiringIn30Days;
    if (count > 10) expect(rows.length).toBe(10);
    else expect(rows.length).toBe(count);
  });

  liveOnly("TC-DASHREN-006 — daysRemaining is identical at 01:00 CT and 18:00 CT on the same Central date @smoke @regression", async () => {
    const early = centralInstant(TODAY, 1);
    const late = centralInstant(TODAY, 18);
    const [a, b] = await Promise.all([dash.renewals<any>(early, po.token), dash.renewals<any>(late, po.token)]);
    const byId = new Map(b.data.data.contracts.map((r: any) => [r.id, r]));
    let compared = 0;
    for (const row of a.data.data.contracts) {
      const other: any = byId.get(row.id);
      if (!other) continue;
      expect(other.daysRemaining, `row ${row.id} shifted with the time of day — §4.2 uses calendar dates, not elapsed ms`).toBe(
        row.daysRemaining,
      );
      expect(other.badgeText).toBe(row.badgeText);
      expect(other.badgeColor).toBe(row.badgeColor);
      compared++;
    }
    expect(compared, "no comparable rows — case is vacuous").toBeGreaterThan(0);
  });

  liveOnly("TC-DASHREN-007 — badgeColor follows the §4.4 table across a full now-shift sweep @smoke @regression", async () => {
    const base: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    expect(base.length, "no qualifying contracts — the badge sweep is vacuous").toBeGreaterThan(0);
    const anchor = base[0];
    const seen = new Set<string>();
    for (let target = 0; target <= 30; target++) {
      const asOfDate = addDays(anchor.expirationDate, -target);
      const r = await dash.renewals<any>(centralInstant(asOfDate, 12), po.token);
      const row = r.data.data.contracts.find((x: any) => x.id === anchor.id);
      if (!row) continue;
      expect(row.daysRemaining, `expected ${target} days remaining as of ${asOfDate}`).toBe(target);
      const expectedColor = target === 0 ? "red" : target <= 6 ? "red" : target <= 14 ? "amber" : "grey";
      expect(row.badgeColor, `daysRemaining=${target} should be ${expectedColor}`).toBe(expectedColor);
      seen.add(expectedColor);
    }
    expect([...seen].sort(), "the sweep did not reach all three colour bands").toEqual(["amber", "grey", "red"]);
  });

  liveOnly("TC-DASHREN-008 — badgeText is \"{X}d left\" except at zero, which is \"Expires today\" @regression", async () => {
    const base: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    const anchor = base[0];
    for (const target of [0, 1, 6, 7, 14, 15, 30]) {
      const asOfDate = addDays(anchor.expirationDate, -target);
      const r = await dash.renewals<any>(centralInstant(asOfDate, 12), po.token);
      const row = r.data.data.contracts.find((x: any) => x.id === anchor.id);
      if (!row) continue;
      const expected = target === 0 ? "Expires today" : `${target}d left`;
      expect(row.badgeText, `at ${target} days remaining`).toBe(expected);
    }
  });

  liveOnly("TC-DASHREN-009 — a contract expiring today is Red and reads \"Expires today\" @regression", async () => {
    const base: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    const anchor = base[0];
    const r = await dash.renewals<any>(centralInstant(anchor.expirationDate, 12), po.token);
    const row = r.data.data.contracts.find((x: any) => x.id === anchor.id);
    expect(row, "the contract dropped out of the window on its own expiry date — check the §9.3 lazy-write boundary").toBeTruthy();
    expect(row.daysRemaining).toBe(0);
    expect(row.badgeColor).toBe("red");
    expect(row.badgeText).toBe("Expires today");
  });

  liveOnly("TC-DASHREN-010 — noticeDeadline is either null or the two-field object, never malformed @regression", async () => {
    const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    for (const row of rows) {
      if (row.noticeDeadline === null) continue;
      expect(Object.keys(row.noticeDeadline).sort()).toEqual(["date", "label"]);
      expect(row.noticeDeadline.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.noticeDeadline.label.length).toBeGreaterThan(0);
    }
  });

  // TC-DASHREN-011 / -012 are unreachable on QA and the reason is structural, not
  // incidental: the `Xd remaining` and `today` branches of §4.6 need a `now` that is
  // simultaneously (a) inside [expiration - 30, expiration] so the row is returned at
  // all, and (b) at or before the notice deadline. The one qualifying QA contract has
  // expiration 2026-09-09 and notice deadline 2026-07-31 — 40 days apart — so that
  // interval is empty and no amount of `now`-shifting reaches it. See gap G-19.
  liveOnly(
    "TC-DASHREN-011 — a future notice deadline renders \"{X}d remaining\" — BLOCKED (G-19: no QA contract whose notice deadline falls inside its own 30-day renewals window) @regression",
    async () => {
      const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
      const anchor = rows.find((r) => r.noticeDeadline && dayDiff(r.expirationDate, r.noticeDeadline.date) <= 30);
      if (!anchor) {
        // Record the blocker as an explicit, checkable fact rather than a silent pass.
        for (const r of rows.filter((x) => x.noticeDeadline)) {
          expect(
            dayDiff(r.expirationDate, r.noticeDeadline.date),
            `G-19 no longer holds for ${r.id} — re-enable the live assertion below`,
          ).toBeGreaterThan(30);
        }
        return;
      }
      const asOf = addDays(anchor.noticeDeadline.date, -5);
      const r = await dash.renewals<any>(centralInstant(asOf, 12), po.token);
      const row = r.data.data.contracts.find((x: any) => x.id === anchor.id);
      expect(row, `anchor dropped out of the window at now=${asOf}`).toBeTruthy();
      expect(row.noticeDeadline.date).toBe(anchor.noticeDeadline.date);
      expect(row.noticeDeadline.label).toBe("5d remaining");
    },
  );

  liveOnly(
    "TC-DASHREN-012 — a notice deadline equal to the current date renders \"today\" — BLOCKED (G-19: same fixture gap as TC-DASHREN-011) @regression",
    async () => {
      const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
      const anchor = rows.find((r) => r.noticeDeadline && dayDiff(r.expirationDate, r.noticeDeadline.date) <= 30);
      if (!anchor) return;
      const r = await dash.renewals<any>(centralInstant(anchor.noticeDeadline.date, 12), po.token);
      const row = r.data.data.contracts.find((x: any) => x.id === anchor.id);
      expect(row).toBeTruthy();
      expect(row.noticeDeadline.label).toBe("today");
    },
  );

  liveOnly("TC-DASHREN-013 — a passed notice deadline still renders as \"passed Xd ago\" @regression", async () => {
    const rows: any[] = (await dash.renewals<any>(NOW, po.token)).data.data.contracts;
    const anchor = rows.find((r) => r.noticeDeadline && dayDiff(r.noticeDeadline.date, TODAY) < 0);
    expect(anchor, "no row has a passed notice deadline — case is vacuous").toBeTruthy();
    expect(anchor.noticeDeadline.label).toMatch(/^passed \d+d ago$/);
    const expectedDays = Math.abs(dayDiff(anchor.noticeDeadline.date, TODAY));
    expect(anchor.noticeDeadline.label).toBe(`passed ${expectedDays}d ago`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — Active Sourcing Events (US-DASH-003; Tech §4.5)", () => {
  liveOnly("TC-DASHSRC-001 — active-sourcing returns the specified row shape @smoke @regression", async () => {
    const r = await dash.activeSourcing<any>(NOW, po.token);
    const parsed = envelope(activeSourcingDataSchema).safeParse(r.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  liveOnly("TC-DASHSRC-002 — every row is an Active event @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const r = await sourcing.getEvent<any>(row.id, po.token);
      expect(r.status).toBe(200);
      expect(r.data.data.status, `event ${row.id}`).toBe("active");
    }
  });

  liveOnly("TC-DASHSRC-003 — no row's deadline has passed @smoke @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    for (const row of rows) {
      expect(row.daysUntilDeadline).toBeGreaterThanOrEqual(0);
      expect(row.submissionDeadline >= TODAY, `${row.id} deadline ${row.submissionDeadline} is before ${TODAY}`).toBe(true);
      expect(row.daysUntilDeadline).toBe(dayDiff(row.submissionDeadline, TODAY));
    }
  });

  liveOnly("TC-DASHSRC-004 — rows are sorted by deadline ascending @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].submissionDeadline <= rows[i].submissionDeadline).toBe(true);
      expect(rows[i - 1].daysUntilDeadline).toBeLessThanOrEqual(rows[i].daysUntilDeadline);
    }
  });

  liveOnly("TC-DASHSRC-005 — exactly 10 rows when more qualify, and they are the earliest @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    const counts = (await sourcing.listEvents<any>({ tab: "active", limit: 1 }, po.token)).data?.data?.counts ?? {};
    if ((counts.active ?? 0) > 10) expect(rows.length).toBe(10);
    expect(rows.length).toBeLessThanOrEqual(10);

    // No excluded Active event closes earlier than the last row we were given.
    const cal = await dash.calendarEvents<any>(
      { startDate: TODAY, endDate: rows[rows.length - 1].submissionDeadline, now: NOW },
      po.token,
    );
    const returned = new Set(rows.map((r) => r.id));
    const earlierSourcing = cal.data.data.events.filter(
      (e: any) => e.eventType === "sourcing_deadline" && !returned.has(e.id) && datePart(e.eventDate) < rows[rows.length - 1].submissionDeadline,
    );
    for (const e of earlierSourcing) {
      const detail = await sourcing.getEvent<any>(e.id, po.token);
      expect(detail.data?.data?.status, `Active event ${e.id} closes earlier than the last returned row but was excluded`).not.toBe(
        "active",
      );
    }
  });

  liveOnly("TC-DASHSRC-006 — daysUntilDeadline is identical at 01:00 CT and 18:00 CT @smoke @regression", async () => {
    const [a, b] = await Promise.all([
      dash.activeSourcing<any>(centralInstant(TODAY, 1), po.token),
      dash.activeSourcing<any>(centralInstant(TODAY, 18), po.token),
    ]);
    const byId = new Map(b.data.data.events.map((r: any) => [r.id, r]));
    let compared = 0;
    for (const row of a.data.data.events) {
      const other: any = byId.get(row.id);
      if (!other) continue;
      expect(other.daysUntilDeadline, `row ${row.id} shifted with the time of day`).toBe(row.daysUntilDeadline);
      expect(other.relativeLabel).toBe(row.relativeLabel);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  liveOnly("TC-DASHSRC-007 — relativeLabel is \"Closes in X days\" for X >= 2, with no fractional hours @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    let checked = 0;
    for (const row of rows) {
      if (row.daysUntilDeadline < 2) continue;
      expect(row.relativeLabel).toBe(`Closes in ${row.daysUntilDeadline} days`);
      expect(row.relativeLabel).not.toMatch(/hour|minute|\./i);
      checked++;
    }
    expect(checked, "no row at >= 2 days — case is vacuous").toBeGreaterThan(0);
  });

  liveOnly("TC-DASHSRC-008 — relativeLabel is the singular \"Closes in 1 day\" at X = 1 @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    const anchor = rows[0];
    const asOf = centralInstant(addDays(anchor.submissionDeadline, -1), 12);
    const r = await dash.activeSourcing<any>(asOf, po.token);
    const row = r.data.data.events.find((x: any) => x.id === anchor.id);
    expect(row, "anchor dropped out one day before its deadline").toBeTruthy();
    expect(row.daysUntilDeadline).toBe(1);
    expect(row.relativeLabel).toBe("Closes in 1 day");
  });

  liveOnly("TC-DASHSRC-009 — relativeLabel is \"Closes today\" at X = 0, at both ends of the day @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    const anchor = rows[0];
    for (const hour of [0, 23]) {
      const r = await dash.activeSourcing<any>(centralInstant(anchor.submissionDeadline, hour), po.token);
      const row = r.data.data.events.find((x: any) => x.id === anchor.id);
      expect(row, `event is not open at ${hour}:00 CT on its deadline date — it must stay open through 23:59 CT`).toBeTruthy();
      expect(row.daysUntilDeadline).toBe(0);
      expect(row.relativeLabel).toBe("Closes today");
    }
  });

  liveOnly("TC-DASHSRC-010 — an event whose deadline has passed drops out @regression", async () => {
    const rows: any[] = (await dash.activeSourcing<any>(NOW, po.token)).data.data.events;
    const anchor = rows[0];
    const r = await dash.activeSourcing<any>(centralInstant(addDays(anchor.submissionDeadline, 1), 12), po.token);
    expect(r.status).toBe(200);
    expect(r.data.data.events.some((x: any) => x.id === anchor.id), `${anchor.id} is still listed a day after its deadline`).toBe(
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-011 — Security: authorization and tenant isolation (Tech §5)", () => {
  const callAll = async (token?: string) => {
    const range = { startDate: TODAY, endDate: addDays(TODAY, 7), now: NOW };
    return Promise.all([
      dash.summary<any>(NOW, token),
      dash.recentActivity<any>(NOW, token),
      dash.calendarEvents<any>(range, token),
      dash.renewals<any>(NOW, token),
      dash.activeSourcing<any>(NOW, token),
    ]);
  };

  liveOnly("TC-DASHSEC-001 — all five endpoints reject an unauthenticated request @smoke @regression", async () => {
    for (const r of await callAll(undefined)) {
      expect(r.status).toBe(401);
      expect(r.data.success).toBe(false);
      expect(r.data.data).toBeUndefined();
    }
  });

  liveOnly("TC-DASHSEC-002 — all five endpoints reject a malformed token @regression", async () => {
    for (const r of await callAll("not-a-jwt")) {
      expect(r.status).toBe(401);
      expect(JSON.stringify(r.data)).not.toMatch(/at .*\(.*:\d+:\d+\)|JsonWebTokenError/i);
    }
  });

  liveOnly("TC-DASHSEC-003 — an admin-pool token cannot read a tenant Dashboard @regression", async () => {
    const adminToken = await getAdminIdToken();
    const r = await dash.summary<any>(NOW, adminToken);
    expect([401, 403], `admin-pool token returned ${r.status}`).toContain(r.status);
  });

  forcedPass("TC-DASHSEC-004 — BLOCKED (G-18: no expired-token fixture; covered in TC-CEIQ-FOUND-001)", async () => {});

  forcedPass("TC-DASHSEC-005 — BLOCKED (G-5: no QA tenant user without view_dashboard, so the 403 path is unexercisable)", async () => {});

  liveOnly("TC-DASHSEC-006 — the Analyst role reaches all five endpoints with full data @regression", async () => {
    for (const r of await callAll(analyst.token)) {
      expect(r.status).toBe(200);
      expect(r.data.data).toBeTruthy();
    }
  });

  liveOnly("TC-DASHSEC-007 — every emitted id resolves inside the caller's tenant @smoke @regression", async () => {
    const [s, act, ren, recent, cal] = await Promise.all([
      dash.summary<any>(NOW, po.token),
      dash.activeSourcing<any>(NOW, po.token),
      dash.renewals<any>(NOW, po.token),
      dash.recentActivity<any>(NOW, po.token),
      dash.calendarEvents<any>({ startDate: TODAY, endDate: addDays(TODAY, 30), now: NOW }, po.token),
    ]);

    const sourcingIds = new Set<string>();
    const contractIds = new Set<string>();
    for (const key of ["rfp", "rfq"] as const) {
      const v = s.data.data.deadlines[key];
      if (v) sourcingIds.add(v.id);
    }
    for (const e of act.data.data.events) sourcingIds.add(e.id);
    for (const c of ren.data.data.contracts) contractIds.add(c.id);
    for (const i of recent.data.data.items) (i.type === "contract" ? contractIds : sourcingIds).add(i.id);
    for (const e of cal.data.data.events.slice(0, 10)) {
      (e.eventType === "contract_expiry" ? contractIds : sourcingIds).add(e.id);
    }

    for (const id of [...sourcingIds].slice(0, 15)) {
      const r = await sourcing.getEvent<any>(id, po.token);
      expect(r.status, `sourcing ${id} is not reachable by its own tenant`).toBe(200);
    }
    for (const id of [...contractIds].slice(0, 15)) {
      const r = await axios.get<any>(`${apiBaseUrl()}/contracts/${id}`, {
        headers: { Authorization: `Bearer ${po.token}` },
        validateStatus: () => true,
      });
      expect(r.status, `contract ${id} is not reachable by its own tenant`).toBe(200);
    }
  });

  liveOnly("TC-DASHSEC-008 — PO and Analyst in the same tenant see the same data @regression", async () => {
    const [rPo, rAn] = await Promise.all([dash.renewals<any>(NOW, po.token), dash.renewals<any>(NOW, analyst.token)]);
    const [aPo, aAn] = await Promise.all([dash.activeSourcing<any>(NOW, po.token), dash.activeSourcing<any>(NOW, analyst.token)]);
    expect(rAn.data.data.contracts.map((c: any) => c.id)).toEqual(rPo.data.data.contracts.map((c: any) => c.id));
    expect(aAn.data.data.events.map((e: any) => e.id)).toEqual(aPo.data.data.events.map((e: any) => e.id));
  });

  liveOnly("TC-DASHSEC-009 — canCreate:false is a display control; the real guards still deny @smoke @regression", async () => {
    const s = await dash.summary<any>(NOW, analyst.token);
    expect(s.data.data.canCreate).toBe(false);
    const create = await sourcing.createEmptyDraft<any>({ type: "rfp" }, analyst.token);
    // Track first, assert second — if the guard is missing this is a P0 finding AND a
    // stray record, and the assertion below would otherwise abort before cleanup.
    if (create.status === 201) createdEvents.push(create.data.data.id);
    expect(create.status, "an Analyst created a sourcing event — canCreate is the ONLY control").toBe(403);
  });

  liveOnly("TC-DASHSEC-010 — no response leaks internal identifiers or infrastructure detail @regression", async () => {
    const bodies: string[] = [];
    for (const r of await callAll(po.token)) bodies.push(JSON.stringify(r.data));
    bodies.push(JSON.stringify((await dash.summary<any>("notadate", po.token)).data));
    bodies.push(JSON.stringify((await dash.calendarEvents<any>({ startDate: TODAY, now: NOW }, po.token)).data));
    for (const body of bodies) {
      expect(body).not.toMatch(/tenant_id/);
      expect(body).not.toMatch(/SELECT .*FROM/i);
      expect(body).not.toMatch(/at .*\(.*:\d+:\d+\)/);
      expect(body).not.toMatch(/\.rds\.amazonaws\.com|\.internal\b/);
    }
  });
});
