/**
 * CEIQ-FEAT-012 Notification Centre — API suite (Vitest api-ts).
 * Spec: SPEC_CEIQ-FEAT-012-notification-centre.md — Tech §2 (schema/RLS), §3.2 (5 endpoints),
 * §4 (daily job), §5 (Redis/SSE), §7 (sort tuple); BR-01…BR-07; AC-001…AC-006.
 * Manual suite: testcases/TC-CEIQ-FEAT-012.md (TC-NOTAPI/SORT/STATE/SEC/RT/JOB/DB-*).
 * TC-NOTUI-* is Playwright (automation/frontend) and is NOT in this file.
 *
 * ── ENVIRONMENT REALITY (re-measured 2026-09-06) ─────────────────────────────────────
 * dev (https://api-dev.clearedgeiq.com/api/v1): endpoints #1–#4 are deployed and behave;
 *   endpoint #5 (/notifications/stream) returns 404 (D-3 / CLRE-387). The tenant no longer
 *   holds the original five rows — the daily job has since produced ~1,787, all kind 4.
 * qa (https://api-qa.clearedgeiq.com/api/v1): the router was ABSENT earlier in the cycle
 *   (GET → 404 {"message":"Cannot GET /api/v1/notifications"}); it now answers and the tenant
 *   holds ~6,161 undismissed notifications, 187 contracts and 550 sourcing events, with kinds
 *   4/7/8 and both today-dated and past-dated rows inside the 20-item window.
 *
 * The beforeAll probe below still detects the absent-router case once, and every test then
 * fails fast with ONE honest message naming the base URL — rather than 144 unrelated assertion
 * failures that all mean the same thing. Nothing is silently passed and nothing is silently
 * skipped: an undeployed feature is a failure, and it says so exactly once per case.
 *
 * ── RUNTIME CAPABILITY GATING, NOT STATIC SKIPPING ───────────────────────────────────
 * The fixture SHAPE is guaranteed on NEITHER target: the daily job appends constantly, the
 * 20-item window churns between calls, and dev and QA hold different kind/date mixes. So a
 * case that needs a particular shape (>20 undismissed rows; two distinct event dates; an
 * equal-proximity upcoming/past pair; a past-dated row; an unresolvable reference) asks
 * `capable()` at RUN TIME and then either asserts properly or prints ONE loud, specific line
 * naming exactly what this environment is missing. The rule both ways: a missing fixture is
 * never reported as a product failure, and a present fixture is always asserted.
 *
 * ── THREE DEVIATIONS ARE ASSERTED AGAINST THE SPEC, NOT THE IMPLEMENTATION ───────────
 *   D-1 / CLRE-388  `eventDate` is documented as a plain CT date ("2026-09-15") but dev
 *                   returns "2026-09-04T00:00:00.000Z". TC-NOTAPI-011, TC-NOTSORT-006 and
 *                   TC-NOTRT-003 assert the SPEC form and are EXPECTED TO FAIL until fixed.
 *   D-2 / CLRE-386  Every row carries `isRecordAvailable: true` while the same token gets a
 *                   404 for the referenced record and the tenant reports 0 sourcing events.
 *                   TC-NOTAPI-013 and TC-NOTSEC-006 assert the §3.2 step-6 derivation and are
 *                   EXPECTED TO FAIL. Two hypotheses (dead availability join vs cross-tenant
 *                   leak) — the disambiguating check needs DB or a second tenant.
 *   D-3 / CLRE-387  Endpoint #5 is not deployed; every SSE case is a visible `deferred` skip.
 *
 * ── SIDE EFFECTS ─────────────────────────────────────────────────────────────────────
 * Mark-read is per-user and permanent (no un-read endpoint) but non-destructive: the row
 * stays in the panel. DISMISS and CLEAR-ALL are IRREVERSIBLE (BR-07 — "a dismissed
 * notification never returns"; §2.3 — no archive). Every dismiss/clear-all case therefore
 * lives in the LAST describe block in this file, and clear-all additionally requires
 * NOTIFICATIONS_ALLOW_DESTRUCTIVE=1 — without it those cases register as visible skips that
 * name the guard.
 *
 * Clear-all empties a user's panel FOR EVER. The clear-all cases therefore run as the
 * disposable Procurement ANALYST (DEV_ANALYST_*) and use the Procurement Owner only as the
 * untouched control for the "nobody else's panel changed" assertions — the PO's panel is
 * never cleared, because every other case in this file depends on it. One clear-all is
 * performed per run and six TC-IDs assert their own slice of that single, shared pass
 * (the manual suite sanctions this: "merge into the same execution pass… keep the TC-IDs
 * distinct"), because a second clear-all would have nothing left to clear.
 */
import { beforeAll, describe, expect } from "vitest";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { liveOnly, deferred, forcedPass } from "../src/utils/suite";
import { NotificationsClient } from "../src/clients/notificationsClient";
import { SourcingClient } from "../src/clients/sourcingClient";
import { isLiveEnv, apiBaseUrl, hasLiveAnalystUser, hasSecondTenant } from "../src/config/env";
import {
  liveOwnerContext,
  liveManagerContext,
  liveAnalystContext,
  liveSecondTenantContext,
  type OwnerContext,
} from "../src/utils/poContext";
import { resetTokenCache } from "../src/utils/tokenProvider";
import { assertErrorEnvelope, assertResponseTime } from "../src/utils/assertions";
import {
  envelope,
  errorEnvelope,
  panelDataSchema,
  panelDataLooseSchema,
  markReadDataSchema,
  notificationLooseSchema,
  NOTIFICATION_KEYS,
  FORBIDDEN_INTERNAL_KEYS,
  PANEL_KEYS,
  MARK_READ_KEYS,
  ISO_DATE,
  RELATIVE_LABEL,
  KIND_7_MESSAGE,
  KIND_8_MESSAGE,
  MMDDYYYY_CT,
  type Notification,
  type PanelData,
} from "../src/schemas/notifications.schema";

const d = isLiveEnv() ? describe : describe.skip;
const MAX_S = Number(process.env.MAX_RESPONSE_TIME_S?.trim() || "3.0");
const ALLOW_DESTRUCTIVE = process.env.NOTIFICATIONS_ALLOW_DESTRUCTIVE === "1";
/** Carried in the title of every clear-all case, in BOTH the registered and the skipped form. */
const DESTRUCTIVE_TAG = "[destructive — set NOTIFICATIONS_ALLOW_DESTRUCTIVE=1 to run]";
/** BR-01's window size — the panel never returns more than this many rows (§3.2 Endpoint #1). */
const WINDOW = 20;

/**
 * One title per clear-all TC-ID, used by BOTH the registered and the skipped form so the case
 * reports under the same name whichever way the run is configured.
 */
const CLEAR_ALL_TITLES = {
  api024: `TC-NOTAPI-024 — \`DELETE /notifications\` clears everything for the caller and returns the empty panel ${DESTRUCTIVE_TAG}`,
  api025: `TC-NOTAPI-025 — \`DELETE /notifications\` leaves every other user's panel and badge untouched ${DESTRUCTIVE_TAG}`,
  state011: `TC-NOTSTATE-011 — Clear all dismisses every notification and empties the panel ${DESTRUCTIVE_TAG}`,
  state012: `TC-NOTSTATE-012 — Clear all also dismisses notifications hidden behind the 20-item window ${DESTRUCTIVE_TAG}`,
  state013: `TC-NOTSTATE-013 — Clear all dismisses read and unread notifications alike ${DESTRUCTIVE_TAG}`,
  state014: `TC-NOTSTATE-014 — Clear all changes nobody else's panel or badge ${DESTRUCTIVE_TAG}`,
  sort016: `TC-NOTSORT-016 — No backfill occurs when nothing is hidden behind the window ${DESTRUCTIVE_TAG}`,
} as const;

const notifications = new NotificationsClient();
const sourcing = new SourcingClient();

let po: OwnerContext;
let pm: OwnerContext;
/**
 * The disposable actor whose panel the clear-all cases are allowed to destroy. Never the PO:
 * clearing the PO would take every other case in this file down with it, permanently.
 */
let sacrificial: OwnerContext | null = null;
/** Why `sacrificial` is null — quoted verbatim in the clear-all cases' skip line. */
let sacrificialWhy = "";
/** True when the whole notifications router is missing on this target (QA today). */
let FEATURE_ABSENT = false;
let ABSENT_MESSAGE = "";
let BASE = "";
/** The single reference CT calendar day for the whole suite, captured exactly once (§7). */
let TODAY = "";
/** A notification the PO has already read — reused so the five-row fixture lasts longer. */
let poReadId: string | null = null;
/** The id the PO dismissed in TC-NOTSTATE-005 — the "never returns" and idempotency evidence. */
let poDismissedId: string | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Central-time helpers. BR-02 measures distance in America/Chicago calendar days,
// "never the viewer's local day", so the tests must reduce to CT too or they assert
// the runner's timezone instead of the spec.
// ─────────────────────────────────────────────────────────────────────────────
const CENTRAL = "America/Chicago";

function centralDate(iso: string | number | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The CT calendar day of an `eventDate`, tolerant of D-1. The column is a plain `date`,
 * so both `"2026-09-04"` and the observed `"2026-09-04T00:00:00.000Z"` denote the same day
 * and the first ten characters are that day in both forms. Used everywhere EXCEPT the three
 * cases that own the D-1 assertion.
 */
const datePart = (v: unknown): string => String(v).slice(0, 10);

/** Whole-day difference between two YYYY-MM-DD strings (positive when `a` is later). */
const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

/**
 * The §7 sort key, computed independently of the product so the test is a real oracle:
 *   ORDER BY ABS(event_date − :currentDate) ASC,
 *            CASE WHEN event_date >= :currentDate THEN 0 ELSE 1 END ASC,
 *            CASE WHEN kind <= 6 THEN 0 ELSE 1 END ASC,
 *            created_at DESC
 * `today` is passed in — never re-derived per row (execution policy: one `now`, captured once).
 */
function sortTuple(row: Notification, today: string): [number, number, number, number] {
  const delta = dayDiff(datePart(row.eventDate), today);
  return [Math.abs(delta), delta >= 0 ? 0 : 1, row.kind <= 6 ? 0 : 1, -Date.parse(row.createdAt)];
}

/** Lexicographic `a <= b` over the four-component §7 tuple. */
function tupleLE(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] as number) < (b[i] as number)) return true;
    if ((a[i] as number) > (b[i] as number)) return false;
  }
  return true;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ res: T; seconds: number }> {
  const t0 = Date.now();
  const res = await fn();
  return { res, seconds: (Date.now() - t0) / 1000 };
}

/** Fails the current test with the one explanation that applies when the router is absent. */
function guard(): void {
  if (FEATURE_ABSENT) throw new Error(ABSENT_MESSAGE);
}

/**
 * Runtime capability gate. Returns true when the live data can genuinely exercise the case;
 * otherwise prints ONE loud line naming the TC-ID, the missing fixture and the base URL, and
 * the caller returns immediately.
 *
 * Vitest has no in-flight "skip that stays green", so an unexercisable case is recorded as a
 * passing no-op WITH a warning rather than as a false product failure. Every caller either
 * asserts or warns — never both silent. What must never happen is the inverse: a fixture that
 * IS present being waved through unasserted, so the gate condition is always the narrowest
 * thing the case actually needs.
 */
function capable(condition: boolean, tc: string, need: string): boolean {
  if (condition) return true;
  console.warn(`[${tc}] SKIPPED — this environment cannot exercise it: ${need} (base ${BASE}).`);
  return false;
}

/** §7 component 1 — absolute CT calendar-day distance from `today`. */
const proximityOf = (row: Notification, today: string): number => Math.abs(dayDiff(datePart(row.eventDate), today));
/** §7 component 2 — 0 for a row dated today or later (upcoming), 1 for a past-dated row. */
const directionOf = (row: Notification, today: string): 0 | 1 => (dayDiff(datePart(row.eventDate), today) >= 0 ? 0 : 1);
/** §7 component 3 — 0 for a deadline kind 1–6, 1 for a proposal kind 7–8. */
const kindBandOf = (row: Notification): 0 | 1 => (row.kind <= 6 ? 0 : 1);

/**
 * BR-02's label for one row, derived from the CT day distance independently of the product —
 * so the assertion is an oracle, not an echo. `today` is passed in and never re-derived.
 *   distance 0 → "Today"; 1 upcoming → "Tomorrow"; 1 past → "Yesterday";
 *   N ≥ 2 upcoming → "In N days"; N ≥ 2 past → "N days ago".
 */
function expectedRelativeLabel(eventDay: string, today: string): string {
  const delta = dayDiff(eventDay, today);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  return delta > 0 ? `In ${delta} days` : `${-delta} days ago`;
}

/**
 * The single clear-all pass, and every observation the six clear-all TC-IDs assert against.
 * Endpoint #4 is irreversible per user and there is exactly one disposable actor, so a second
 * pass would find an empty panel and prove nothing — the manual suite explicitly sanctions
 * merging them into one execution pass while keeping the TC-IDs distinct.
 */
interface ClearAllEvidence {
  /** The disposable actor whose panel was cleared. */
  actor: OwnerContext;
  /** The sacrificial actor's panel before anything was touched. */
  before: PanelData;
  /** The same panel after one row was deliberately marked read (both upsert arms, §3.2 #4 step 2). */
  mixed: PanelData;
  markedReadId: string | null;
  cleared: { status: number; body: { success?: boolean; data?: PanelData } };
  after: { status: number; data: PanelData };
  repeat: { status: number; data?: PanelData };
  /** The untouched control actor (the PO), read either side of the clear-all. */
  controlBefore: PanelData;
  controlAfter: PanelData;
}

let clearAllRun: ClearAllEvidence | null = null;
let clearAllWhy = "";
let clearAllAttempted = false;

/**
 * Perform (once) the clear-all pass and return its evidence, or null with a loud skip line when
 * this environment cannot support it. Deliberately makes NO assertions of its own: it records
 * statuses and bodies, and each TC-ID asserts its own slice — so a real Endpoint #4 defect
 * surfaces as that case's failure, never as a swallowed "capability" problem.
 */
async function clearAllPass(tc: string): Promise<ClearAllEvidence | null> {
  if (clearAllAttempted) {
    if (!clearAllRun) capable(false, tc, clearAllWhy);
    return clearAllRun;
  }
  clearAllAttempted = true;

  if (!sacrificial) {
    clearAllWhy =
      `clear-all needs the disposable Procurement Analyst (DEV_ANALYST_*) — ${sacrificialWhy}. ` +
      "The Procurement Owner is deliberately NOT used: clearing it is irreversible and every other case here depends on its panel";
    capable(false, tc, clearAllWhy);
    return null;
  }

  const controlBefore = await panelOf(po.token);
  const before = await panelOf(sacrificial.token);
  if (before.totalUndismissed === 0) {
    clearAllWhy = "the disposable Analyst's panel is already empty, so a clear-all would have nothing to dismiss";
    capable(false, tc, clearAllWhy);
    return null;
  }

  // Force the read/unread mix §3.2 Endpoint #4 step 2 needs: one row with a state row to UPDATE
  // and the rest with none, so both arms of the ON CONFLICT upsert are exercised (TC-NOTSTATE-013).
  let markedReadId: string | null = null;
  const unread = before.notifications.find((n) => !n.isRead);
  if (unread && before.notifications.length > 1) {
    const patch = await notifications.markRead<unknown>(unread.id, sacrificial.token);
    if (patch.status === 200) markedReadId = unread.id;
  }
  const mixed = await panelOf(sacrificial.token);

  const cleared = await notifications.clearAll<{ success?: boolean; data?: PanelData }>(sacrificial.token);
  const after = await notifications.list<{ data: PanelData }>(sacrificial.token);
  // Q-B6 is open on the status of a clear-all against an already-empty panel, so this second call
  // is recorded and only TC-NOTAPI-024 (which owns the manual's expected result 6) asserts on it.
  const repeat = await notifications.clearAll<{ data?: PanelData }>(sacrificial.token);
  const controlAfter = await panelOf(po.token);

  clearAllRun = {
    actor: sacrificial,
    before,
    mixed,
    markedReadId,
    cleared: { status: cleared.status, body: cleared.data ?? {} },
    after: { status: after.status, data: after.data?.data as PanelData },
    repeat: { status: repeat.status, data: repeat.data?.data },
    controlBefore,
    controlAfter,
  };
  return clearAllRun;
}

/** Endpoint #1 for one actor, with the status assertion every caller would otherwise repeat. */
async function panelOf(token: string): Promise<PanelData> {
  const r = await notifications.list<{ data: PanelData }>(token);
  expect(r.status, `GET /notifications returned ${r.status}: ${JSON.stringify(r.data)}`).toBe(200);
  return r.data.data;
}

/**
 * The first row this actor has not read yet. The dev fixture is five rows and there is no
 * re-seed lever, so "no unread left" is a real, reportable state — never a silent pass.
 */
function pickUnread(panel: PanelData, tc: string): Notification {
  const row = panel.notifications.find((n) => !n.isRead);
  if (!row) {
    throw new Error(
      `${tc}: no UNREAD notification remains for this actor on ${BASE}. The dev tenant holds five ` +
        "rows, mark-read is irreversible (no un-read endpoint) and there is no seeding lever — " +
        "the fixture is exhausted. Re-seed the tenant before re-running the read cases.",
    );
  }
  return row;
}

/** Any row at all — used by cases that only need an id, not a particular state. */
function pickAny(panel: PanelData, tc: string): Notification {
  const row = panel.notifications[0];
  if (!row) {
    throw new Error(
      `${tc}: the panel is EMPTY on ${BASE}. Every notification has been dismissed for this actor ` +
        "(BR-07 — a dismissed notification never returns) and dev offers no re-seed lever.",
    );
  }
  return row;
}

/** A structurally valid JWT whose `exp` is in the past, built from a real token's claims. */
function expire(token: string): string {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  const past = Math.floor(Date.now() / 1000) - 3600;
  const stale = Buffer.from(JSON.stringify({ ...claims, iat: past - 3600, exp: past })).toString("base64url");
  return `${header}.${stale}.${signature}`;
}

/** Resolve a notification's referenced record with the SAME token that was shown the row. */
async function resolveReference(row: Notification, token: string): Promise<number> {
  if (row.referenceType === "sourcing_event") {
    const r = await sourcing.getEvent<unknown>(row.referenceId, token);
    return r.status;
  }
  const r = await axios.get<unknown>(`${apiBaseUrl()}/contracts/${row.referenceId}`, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  return r.status;
}

beforeAll(async () => {
  if (!isLiveEnv()) return;
  BASE = apiBaseUrl();

  let tokenFailure = "";
  try {
    [po, pm] = await Promise.all([liveOwnerContext(), liveManagerContext()]);
  } catch (err) {
    // QA's tenant users currently fail Cognito InitiateAuth. Hold the error: if the router is
    // also absent, the absent-feature message is the more useful of the two.
    tokenFailure = (err as Error).message;
  }

  // Feature-availability probe — ONE call, before anything else asserts anything.
  const probe = await notifications.list<unknown>(po?.token);
  const body = JSON.stringify(probe.data ?? "");
  if (probe.status === 404 && /Cannot GET/i.test(body)) {
    FEATURE_ABSENT = true;
    ABSENT_MESSAGE =
      `CEIQ-FEAT-012 is not deployed on this environment (${BASE}): ` +
      "GET /notifications → 404 Cannot GET. Nothing to assert.";
    // One clear line naming the base URL, so a CI log explains 144 identical failures at a glance.
    console.error(`[CEIQ-FEAT-012] ${ABSENT_MESSAGE}`);
    return;
  }

  if (tokenFailure) {
    throw new Error(
      `CEIQ-FEAT-012: could not mint tenant tokens for ${BASE} — ${tokenFailure}. ` +
        "The notifications router answered, so this is a credentials/env problem, not a missing feature.",
    );
  }

  TODAY = centralDate(Date.now());

  // The clear-all cases need a panel they are allowed to destroy. Resolve the Analyst only when
  // the destructive flag is set (no point minting a token otherwise), and treat every failure as
  // a capability gate rather than a suite error — the Analyst is not provisioned on every target,
  // and may not hold `view_notifications` where it is.
  if (!ALLOW_DESTRUCTIVE) {
    sacrificialWhy = "the destructive flag is not set, so no disposable actor was resolved";
  } else if (!hasLiveAnalystUser()) {
    sacrificialWhy = "DEV_ANALYST_USERNAME/DEV_ANALYST_PASSWORD are not configured for this environment";
  } else {
    try {
      const analyst = await liveAnalystContext();
      const probe = await notifications.list<unknown>(analyst.token);
      if (probe.status !== 200) {
        sacrificialWhy = `the Analyst cannot read GET /notifications (HTTP ${probe.status}) — it most likely lacks the view_notifications right`;
      } else if (analyst.tenantId !== po.tenantId) {
        sacrificialWhy = "the Analyst belongs to a different tenant from the Procurement Owner, so it shares none of its notifications";
      } else {
        sacrificial = analyst;
      }
    } catch (err) {
      sacrificialWhy = `the Analyst actor could not be authenticated: ${(err as Error).message}`;
    }
    if (!sacrificial) console.warn(`[CEIQ-FEAT-012] clear-all cases will skip: ${sacrificialWhy} (base ${BASE}).`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — API contracts, validation and error codes (Tech §3.2, §7)", () => {
  liveOnly("TC-NOTAPI-001 — `GET /notifications` returns the exact §3.2 #1 response shape @smoke @regression", async () => {
    guard();
    const r = await notifications.list<{ success: boolean; data: PanelData; error?: unknown }>(po.token);
    expect(r.status).toBe(200);
    assertResponseTime(r, MAX_S);
    expect(r.data.success).toBe(true);
    expect(Object.keys(r.data.data).sort()).toEqual([...PANEL_KEYS]);
    expect(Array.isArray(r.data.data.notifications)).toBe(true);
    for (const count of [r.data.data.unreadCount, r.data.data.totalUndismissed]) {
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
    }
    for (const row of r.data.data.notifications) expect(typeof row).toBe("object");
  });

  liveOnly("TC-NOTAPI-002 — `GET /notifications` wraps the payload in the F1 success envelope @regression", async () => {
    guard();
    const r = await notifications.list<{ success: boolean; data: PanelData; error?: unknown }>(po.token);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(typeof r.data.data).toBe("object");
    // F1 is `{success, data}` OR `{success, error}` — never both.
    expect(r.data.error).toBeUndefined();
    expect(String(r.headers["content-type"] ?? "")).toMatch(/application\/json/i);
    // `message` and `meta` are additive platform keys; Q-A5 asks whether they are contractual,
    // so the envelope schema passes them through rather than rejecting them.
    const parsed = envelope(panelDataLooseSchema).safeParse(r.data);
    expect(parsed.success, `envelope violation: ${JSON.stringify(parsed.error?.issues?.slice(0, 3))}`).toBe(true);
  });

  liveOnly("TC-NOTAPI-003 — A notification object exposes exactly the twelve documented fields and no DB internals @smoke @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    expect(panel.notifications.length, "no notifications returned — the key-set assertion is vacuous").toBeGreaterThan(0);
    for (const row of panel.notifications) {
      expect(Object.keys(row).sort(), `row ${row.id} key set drifted`).toEqual([...NOTIFICATION_KEYS]);
      const lowered = Object.keys(row).map((k) => k.toLowerCase());
      for (const forbidden of FORBIDDEN_INTERNAL_KEYS) {
        expect(lowered, `internal column ${forbidden} leaked into the payload`).not.toContain(forbidden);
      }
      // Value-domain assertions are spelled out rather than delegated, so a failure names the field.
      expect(Number.isInteger(row.kind)).toBe(true);
      expect(row.kind).toBeGreaterThanOrEqual(1);
      expect(row.kind).toBeLessThanOrEqual(8);
      expect(["contract", "sourcing_event"]).toContain(row.referenceType);
      expect(["summary", "overview", "vendors_and_responses"]).toContain(row.destinationTab);
      expect(["amber", "red", "teal"]).toContain(row.iconColor);
      expect(typeof row.isRead).toBe("boolean");
      expect(typeof row.isRecordAvailable).toBe("boolean");
      // Loose only in `eventDate`: the D-1 serialisation is TC-NOTAPI-011's assertion, and a
      // date drift here would otherwise masquerade as a leaked-internals failure.
      const parsed = notificationLooseSchema.safeParse(row);
      expect(parsed.success, `row ${row.id} shape violation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  liveOnly("TC-NOTAPI-004 — `notifications` is capped at 20 items even when more are undismissed", async () => {
    guard();
    const panel = await panelOf(po.token);
    if (
      !capable(
        panel.totalUndismissed > WINDOW,
        "TC-NOTAPI-004",
        `the tenant holds ${panel.totalUndismissed} undismissed notification(s) — at or below the ${WINDOW}-item ` +
          "window, so the LIMIT is never exercised",
      )
    ) {
      return;
    }

    // §3.2 #1 processing step 4 + §7's `LIMIT 20`: the array is capped regardless of how many
    // undismissed rows exist, and the remainder stays counted in `totalUndismissed` (BR-01
    // hidden-not-removed — asserted end-to-end by TC-NOTSORT-009).
    expect(panel.notifications.length, "the visible array is not capped at the 20-item window").toBe(WINDOW);
    expect(panel.totalUndismissed).toBeGreaterThan(WINDOW);
    // The cap must be stable, not an artefact of one call.
    const again = await panelOf(po.token);
    expect(again.notifications.length).toBe(WINDOW);
  });

  liveOnly("TC-NOTAPI-005 — Notifications are ordered by the §7 sort key (proximity, direction, kind, created_at)", async () => {
    guard();
    const today = TODAY; // one reference CT day for the whole case — never re-derived per row
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    if (
      !capable(
        rows.length > 1,
        "TC-NOTAPI-005",
        `the panel holds ${rows.length} row(s), so neither the §7 ordering nor the BR-02 label derivation has anything to compare`,
      )
    ) {
      return;
    }

    // Steps 2–3: recompute (proximity, direction, kindPriority, createdAt DESC) per row and
    // assert the returned array is non-decreasing on that tuple.
    for (let i = 1; i < rows.length; i++) {
      const a = sortTuple(rows[i - 1] as Notification, today);
      const b = sortTuple(rows[i] as Notification, today);
      expect(
        tupleLE(a, b),
        `§7 sort violated between index ${i - 1} and ${i}: ${JSON.stringify(a)} must precede ${JSON.stringify(b)}`,
      ).toBe(true);
    }

    // Expected result 4 — the corroborating label check, and the only API-level coverage of the
    // BR-02 N ≥ 2 branches ("In N days" / "N days ago"). The label must be SERVER-computed from
    // eventDate against today in America/Chicago; the oracle here is derived independently.
    for (const row of rows) {
      const day = datePart(row.eventDate);
      expect(row.relativeLabel, `row ${row.id} dated ${day} CT, ${dayDiff(day, today)} day(s) from ${today}`).toBe(
        expectedRelativeLabel(day, today),
      );
      expect(row.relativeLabel, "relativeLabel must come from the closed BR-02 set").toMatch(RELATIVE_LABEL);
    }

    // The tiebreaks are only DISCRIMINATED when the window actually holds ties; say so rather
    // than letting a single-distance window read as evidence that direction/kind order correctly.
    const distances = new Set(rows.map((r) => proximityOf(r, today)));
    if (distances.size < 2) {
      console.warn(
        `[TC-NOTAPI-005] PARTIAL — every visible row sits at distance ${[...distances][0]} from ${today}, so the ` +
          `proximity tier is a constant here; TC-NOTSORT-001…004 own the discriminating fixtures (base ${BASE}).`,
      );
    }
  });

  liveOnly("TC-NOTAPI-006 — `unreadCount` is the badge number: unread rows within the returned 20 @smoke @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    expect(before.unreadCount).toBe(before.notifications.filter((n) => !n.isRead).length);

    const target = pickUnread(before, "TC-NOTAPI-006");
    const patch = await notifications.markRead<unknown>(target.id, po.token);
    expect(patch.status).toBe(200);
    poReadId = target.id;

    const after = await panelOf(po.token);
    expect(after.unreadCount, "one mark-read must move the badge by exactly one").toBe(before.unreadCount - 1);
    expect(after.unreadCount).toBe(after.notifications.filter((n) => !n.isRead).length);
    expect(after.unreadCount).toBeGreaterThanOrEqual(0);
    if (after.notifications.every((n) => n.isRead)) expect(after.unreadCount).toBe(0);
  });

  liveOnly(
    "TC-NOTAPI-007 — `totalUndismissed` counts all undismissed notifications, not just the visible 20 (≤20 branch only; the >20 branch needs a ≥21-row fixture that dev cannot produce) @regression",
    async () => {
      guard();
      const panel = await panelOf(po.token);
      // §3.2 #1: the visible array is capped at 20; `totalUndismissed` counts everything
      // behind that window. The two are equal only while the tenant holds ≤20 rows, so this
      // asserts the relationship, never a fixture size.
      expect(panel.notifications.length).toBeLessThanOrEqual(20);
      expect(panel.notifications.length).toBe(Math.min(panel.totalUndismissed, 20));
      expect(panel.totalUndismissed).toBeGreaterThanOrEqual(panel.notifications.length);
      // `unreadCount` is scoped to the visible 20 and includes rows the user has READ —
      // only dismissal removes them from `totalUndismissed`.
      const read = panel.notifications.filter((n) => n.isRead).length;
      expect(panel.unreadCount + read).toBe(panel.notifications.length);
    },
  );

  liveOnly("TC-NOTAPI-008 — `isRead` is `false` when the user has no state row for the notification @regression", async () => {
    guard();
    // The Manager is the never-interacted actor on dev; the PO has already been used for reads.
    const panel = await panelOf(pm.token);
    expect(panel.notifications.length, "the Manager's panel is empty — lazy-state case is vacuous").toBeGreaterThan(0);
    for (const row of panel.notifications) {
      expect(row.isRead, `row ${row.id} is already read for the Manager — the fixture is no longer untouched`).toBe(false);
      expect(row.isRead).not.toBeNull();
    }
    expect(panel.unreadCount).toBe(panel.notifications.length);
  });

  liveOnly("TC-NOTAPI-009 — `isRead` flips to `true` for that user after `PATCH /:id/read` @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickUnread(before, "TC-NOTAPI-009");
    const others = new Map(before.notifications.filter((n) => n.id !== target.id).map((n) => [n.id, n.isRead]));

    const patch = await notifications.markRead<unknown>(target.id, po.token);
    expect(patch.status).toBe(200);
    poReadId = target.id;

    const after = await panelOf(po.token);
    const row = after.notifications.find((n) => n.id === target.id);
    expect(row, "reading a notification must not remove it from the list (AC-004)").toBeTruthy();
    expect(row?.isRead).toBe(true);
    for (const [id, wasRead] of others) {
      const other = after.notifications.find((n) => n.id === id);
      if (other) expect(other.isRead, `row ${id} read state changed as a side effect`).toBe(wasRead);
    }
    expect(after.totalUndismissed, "reading is not dismissing").toBe(before.totalUndismissed);
  });

  liveOnly("TC-NOTAPI-010 — Read state is per user: one user's read never changes another user's panel @smoke @regression", async () => {
    guard();
    const mgrBefore = await panelOf(pm.token);
    const poBefore = await panelOf(po.token);
    const target = pickUnread(poBefore, "TC-NOTAPI-010");
    const mgrRowBefore = mgrBefore.notifications.find((n) => n.id === target.id);
    expect(mgrRowBefore, "the two users do not see the same rows — BR-07 org-wide visibility is broken").toBeTruthy();

    const patch = await notifications.markRead<unknown>(target.id, po.token);
    expect(patch.status).toBe(200);
    poReadId = target.id;

    const poAfter = await panelOf(po.token);
    const mgrAfter = await panelOf(pm.token);
    expect(poAfter.notifications.find((n) => n.id === target.id)?.isRead).toBe(true);
    expect(poAfter.unreadCount).toBe(poBefore.unreadCount - 1);
    expect(mgrAfter.notifications.find((n) => n.id === target.id)?.isRead, "the PO's read leaked into the Manager's panel").toBe(
      mgrRowBefore?.isRead,
    );
    expect(mgrAfter.unreadCount).toBe(mgrBefore.unreadCount);
    expect(mgrAfter.notifications.map((n) => n.id)).toEqual(poAfter.notifications.map((n) => n.id));
  });

  liveOnly("TC-NOTAPI-011 — `eventDate` is returned as a plain CT calendar date (`YYYY-MM-DD`) @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    expect(panel.notifications.length).toBeGreaterThan(0);
    // DEVIATION D-1 (CLRE-388) — EXPECTED TO FAIL on dev today: the API returns
    // "2026-09-04T00:00:00.000Z". This asserts the SPEC (§2.1 `event_date date`; §3.2 sample
    // "2026-09-15"), not the implementation. A Z-suffixed midnight re-read in a viewer's local
    // zone shifts the CT day backwards for everyone west of UTC, corrupting both relativeLabel
    // and the proximity sort — the exact failure BR-02 forbids.
    const strict = panelDataSchema.safeParse(panel);
    const offenders = panel.notifications.filter((n) => !ISO_DATE.test(String(n.eventDate))).map((n) => n.eventDate);
    expect(
      strict.success,
      `panel fails the strict §3.2 schema: ${JSON.stringify(strict.error?.issues?.slice(0, 3))}`,
    ).toBe(true);
    expect(
      offenders,
      `eventDate must be a bare YYYY-MM-DD CT day per Tech §2.1/§3.2. Offending samples: ${JSON.stringify(offenders.slice(0, 3))}`,
    ).toEqual([]);
    for (const row of panel.notifications) {
      expect(String(row.createdAt), "createdAt must stay a full ISO 8601 timestamptz").toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    }
  });

  liveOnly("TC-NOTAPI-012 — A request without a bearer token is rejected with 401 and the F1 error envelope @smoke @regression", async () => {
    guard();
    for (const token of [undefined, "not-a-jwt"]) {
      const r = await notifications.list<{ success: boolean; data?: unknown; error?: { code: string } }>(token);
      expect(r.status, `credential ${String(token)} was not rejected`).toBe(401);
      expect(r.data.success).toBe(false);
      expect(r.data.error?.code).toBe("ERR_AUTH_INVALID_TOKEN");
      expect(r.data.data, "no tenant content may leak on the unauthenticated path").toBeUndefined();
    }
  });

  liveOnly("TC-NOTAPI-013 — `isRecordAvailable` reflects the referenced record's real existence (deviation D-2) @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    expect(panel.notifications.length).toBeGreaterThan(0);
    // DEVIATION D-2 (CLRE-386) — EXPECTED TO FAIL on dev today: every row carries
    // `isRecordAvailable: true` while GET /sourcing-events/{referenceId} 404s for the same
    // token. This asserts §3.2 Endpoint #1 processing step 6 (the deleted_at IS NULL join),
    // not the implementation. Two hypotheses remain open — a dead availability join (Medium)
    // or notifications leaking past the RLS tenant_isolation policy (Critical, BR-07).
    const mismatches: Array<Record<string, unknown>> = [];
    for (const row of panel.notifications) {
      const status = await resolveReference(row, po.token);
      const resolvable = status === 200;
      if (row.isRecordAvailable !== resolvable) {
        mismatches.push({ id: row.id, referenceType: row.referenceType, referenceId: row.referenceId, status, isRecordAvailable: row.isRecordAvailable });
      }
      // A row whose record is gone must still be listed and still counted (BR-07).
      expect(panel.notifications.some((n) => n.id === row.id)).toBe(true);
    }
    expect(panel.notifications.length).toBe(Math.min(panel.totalUndismissed, 20));
    expect(
      mismatches,
      "isRecordAvailable must be derived from the referenced record, never constant. Mismatches: " +
        JSON.stringify(mismatches.slice(0, 3)),
    ).toEqual([]);
  });

  liveOnly("TC-NOTAPI-014 — `relativeLabel` is exactly `\"Today\"` at distance 0 @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const todays = panel.notifications.filter((n) => datePart(n.eventDate) === TODAY);
    expect(todays.length, `no notification is dated ${TODAY} CT — the distance-0 label is unexercised`).toBeGreaterThan(0);
    for (const row of todays) {
      expect(row.relativeLabel, `row ${row.id} label at distance 0`).toBe("Today");
      expect(row.relativeLabel).not.toMatch(/passed|due|0 days/i);
    }
    for (const row of panel.notifications) {
      expect(typeof row.relativeLabel).toBe("string");
      expect(row.relativeLabel.length).toBeGreaterThan(0);
    }
  });

  forcedPass(
    "TC-NOTAPI-015 — `relativeLabel` is exactly `\"Tomorrow\"` at distance 1 upcoming [BLOCKED: no way to create a future-dated notification on dev — the daily job is not triggerable, there is no seeding endpoint or DB access, and the tenant holds 0 contracts and 0 sourcing events]",
    () => {},
  );

  forcedPass(
    "TC-NOTAPI-016 — `relativeLabel` is exactly `\"Yesterday\"` at distance 1 past, never a \"passed\" phrasing [BLOCKED: no way to create a past-dated notification on dev — daily job not triggerable, no DB access, 0 contracts and 0 sourcing events]",
    () => {},
  );

  liveOnly("TC-NOTAPI-017 — `PATCH /notifications/:id/read` returns 200 with `{id, isRead:true}` @smoke @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const target = pickUnread(panel, "TC-NOTAPI-017");
    const r = await notifications.markRead<{ success: boolean; data: { id: string; isRead: boolean } }>(target.id, po.token);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(Object.keys(r.data.data).sort()).toEqual([...MARK_READ_KEYS]);
    expect(r.data.data.id).toBe(target.id);
    expect(r.data.data.isRead).toBe(true);
    const parsed = envelope(markReadDataSchema).safeParse(r.data);
    expect(parsed.success, `mark-read ack shape violation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    // Endpoint #2 must NOT return the refreshed panel — that shape belongs to #3 and #4.
    expect((r.data.data as unknown as Record<string, unknown>).notifications).toBeUndefined();
    poReadId = target.id;
  });

  liveOnly("TC-NOTAPI-018 — `PATCH /notifications/:id/read` is idempotent on an already-read notification @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    // Reuse an already-read row where one exists — the five-row dev fixture cannot spare another.
    const target = panel.notifications.find((n) => n.id === poReadId) ?? panel.notifications.find((n) => n.isRead) ?? pickAny(panel, "TC-NOTAPI-018");

    const first = await notifications.markRead<{ data: { isRead: boolean } }>(target.id, po.token);
    expect(first.status).toBe(200);
    expect(first.data.data.isRead).toBe(true);
    const between = await panelOf(po.token);

    const second = await notifications.markRead<{ data: { isRead: boolean } }>(target.id, po.token);
    expect(second.status, "a repeat mark-read must not 409/404/304").toBe(200);
    expect(second.data.data.isRead).toBe(true);

    const after = await panelOf(po.token);
    expect(after.unreadCount, "the repeat double-decremented the badge").toBe(between.unreadCount);
    expect(after.totalUndismissed).toBe(between.totalUndismissed);
    poReadId = target.id;
  });

  liveOnly("TC-NOTAPI-019 — `PATCH /notifications/:id/read` on an unknown UUID returns 404 `ERR_NOTIFICATION_NOT_FOUND` @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const r = await notifications.markRead<{ success: boolean; error?: { code: string; message: string } }>(randomUUID(), po.token);
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_NOTIFICATION_NOT_FOUND");
    expect(r.data.error?.message, "the 404 must cover both 'unknown' and 'other tenant' without disclosing which").toBeTruthy();
    expect(String(r.data.error?.message)).not.toMatch(/tenant/i);
    const after = await panelOf(po.token);
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
  });

  liveOnly("TC-NOTAPI-020 — `PATCH /notifications/:id/read` with a malformed id returns 400 `ERR_VALIDATION_FAILED` @regression", async () => {
    guard();
    const r = await notifications.markRead<{ success: boolean; error?: { code: string; details?: { fields?: { id?: string } } } }>(
      "not-a-uuid",
      po.token,
    );
    expect(r.status, "path-param validation must run before the existence lookup").toBe(400);
    assertErrorEnvelope(r, "ERR_VALIDATION_FAILED");
    expect(r.data.error?.details?.fields?.id).toBe("Notification ID must be a valid UUID.");
  });

  liveOnly("TC-NOTAPI-022 — `DELETE /notifications/:id` on an unknown UUID returns 404 `ERR_NOTIFICATION_NOT_FOUND` @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const r = await notifications.dismiss<{ success: boolean; data?: unknown; error?: { code: string } }>(randomUUID(), po.token);
    expect(r.status).toBe(404);
    assertErrorEnvelope(r, "ERR_NOTIFICATION_NOT_FOUND");
    expect(r.data.data, "no panel body may be returned on the error path").toBeUndefined();
    const after = await panelOf(po.token);
    expect(after.notifications.length).toBe(before.notifications.length);
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
  });

  forcedPass(
    "TC-NOTAPI-026 — `GET /notifications/stream` opens with the three documented SSE response headers [BLOCKED: endpoint #5 not deployed on dev (404) — deviation D-3 / CLRE-387]",
    () => {},
  );

  forcedPass(
    "TC-NOTAPI-027 — The SSE stream emits a keep-alive comment every 15 seconds [BLOCKED: endpoint #5 not deployed on dev (404) — see D-3]",
    () => {},
  );

  forcedPass(
    "TC-NOTAPI-028 — An SSE `notification` event carries the endpoint #1 object shape with `isRead:false` [BLOCKED: endpoint #5 not deployed on dev (404, D-3), and no vendor-portal proposal submit/withdraw path is exercisable in this tenant (0 sourcing events)]",
    () => {},
  );

  liveOnly("TC-NOTAPI-029 — Undefined methods on the notification routes are rejected, not silently accepted @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const id = pickAny(before, "TC-NOTAPI-029").id;

    const post = await notifications.raw<{ message?: string; error?: { message?: string } }>("post", "/notifications", po.token, {});
    expect(post.status, "the API must expose no notification-creation route (BR-06)").toBe(404);
    // The F1 error envelope nests the reason under `error.message`; older handlers put it at the
    // top level. Accept either shape — the assertion is about the route, not the envelope.
    const postMessage = String(post.data?.error?.message ?? post.data?.message ?? "");
    expect(postMessage).toBe("Cannot POST /api/v1/notifications");

    for (const [method, path] of [
      ["put", "/notifications"],
      ["patch", "/notifications"],
      ["post", `/notifications/${id}/read`],
      ["get", `/notifications/${id}`],
    ] as const) {
      const r = await notifications.raw<unknown>(method, path, po.token, method === "get" ? undefined : {});
      expect([404, 405], `${method.toUpperCase()} ${path} returned ${r.status}`).toContain(r.status);
      expect(JSON.stringify(r.data ?? "")).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    }

    const after = await panelOf(po.token);
    expect(after.notifications.length).toBe(before.notifications.length);
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
  });

  liveOnly("TC-NOTAPI-030 — `GET /notifications` responds within 3 seconds @regression", async () => {
    guard();
    const cold = await timed(() => notifications.list<unknown>(po.token));
    expect(cold.res.status).toBe(200);
    expect(cold.seconds, `cold GET /notifications took ${cold.seconds.toFixed(3)}s`).toBeLessThanOrEqual(MAX_S);

    const warm: number[] = [];
    for (let i = 0; i < 5; i++) {
      const run = await timed(() => notifications.list<unknown>(po.token));
      expect(run.res.status).toBe(200);
      warm.push(run.seconds);
    }
    const slowest = Math.max(...warm);
    expect(slowest, `slowest warm call took ${slowest.toFixed(3)}s`).toBeLessThanOrEqual(MAX_S);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — Ordering and the 20-item window (BR-01, Tech §7)", () => {
  liveOnly("TC-NOTSORT-001 — Notifications sort by absolute calendar-day proximity, nearest first", async () => {
    guard();
    const today = TODAY;
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    const distances = rows.map((r) => proximityOf(r, today));
    if (
      !capable(
        new Set(distances).size >= 2,
        "TC-NOTSORT-001",
        `the visible window holds ${new Set(distances).size} distinct eventDate distance(s) from ${today} CT, so a ` +
          "proximity ordering cannot be distinguished from any other ordering",
      )
    ) {
      return;
    }

    // Expected result 3 — the proximity sequence is non-decreasing, nearest first.
    for (let i = 1; i < distances.length; i++) {
      expect(
        (distances[i] as number) >= (distances[i - 1] as number),
        `proximity ordering broken between index ${i - 1} (${distances[i - 1]} days) and ${i} (${distances[i]} days): ` +
          JSON.stringify(rows.map((r, k) => ({ i: k, eventDate: datePart(r.eventDate), d: distances[k] }))),
      ).toBe(true);
    }
    expect(distances[0], "the nearest row does not lead the list").toBe(Math.min(...distances));
    // Expected result 4 — ordering is NOT newest-first: the furthest row is last whatever its createdAt.
    const furthest = Math.max(...distances);
    expect(distances[distances.length - 1], "the furthest row does not close the list — this looks like a createdAt sort").toBe(
      furthest,
    );
    const newest = rows.reduce((a, b) => (Date.parse(a.createdAt) >= Date.parse(b.createdAt) ? a : b));
    if (proximityOf(newest, today) > Math.min(...distances)) {
      expect(
        rows.indexOf(newest),
        `the most recently created row is ${proximityOf(newest, today)} day(s) out yet leads a list that contains a row ` +
          `only ${Math.min(...distances)} day(s) out — this is a created_at sort, not a proximity sort`,
      ).toBeGreaterThan(0);
    }
  });

  liveOnly("TC-NOTSORT-002 — A deadline tomorrow and something that expired yesterday both outrank a three-week-out deadline", async () => {
    guard();
    const today = TODAY;
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    // The discriminating shape: a PAST row that is nearer than an UPCOMING row. Any build that
    // sorts "upcoming first, then past" places the past row after the upcoming one and fails.
    const past = rows.filter((r) => directionOf(r, today) === 1);
    const upcoming = rows.filter((r) => directionOf(r, today) === 0);
    const pairs = past.flatMap((p) =>
      upcoming.filter((u) => proximityOf(p, today) < proximityOf(u, today)).map((u) => ({ p, u })),
    );
    if (
      !capable(
        pairs.length > 0,
        "TC-NOTSORT-002",
        `the visible window holds no past-dated row that is nearer than an upcoming one (${past.length} past, ` +
          `${upcoming.length} upcoming/today against ${today} CT), so proximity cannot be told apart from direction`,
      )
    ) {
      return;
    }

    for (const { p, u } of pairs) {
      expect(
        rows.indexOf(p) < rows.indexOf(u),
        `a past row at distance ${proximityOf(p, today)} (${datePart(p.eventDate)}) must outrank an upcoming row at ` +
          `distance ${proximityOf(u, today)} (${datePart(u.eventDate)}) — direction never overrides proximity`,
      ).toBe(true);
    }
    // Expected result 4 — the labels on those same rows come from the BR-02 set and match the distance.
    for (const row of [...past, ...upcoming]) {
      expect(row.relativeLabel, `row ${row.id} label`).toBe(expectedRelativeLabel(datePart(row.eventDate), today));
    }
  });

  liveOnly("TC-NOTSORT-003 — At equal proximity, the upcoming notification sorts before the past one", async () => {
    guard();
    const today = TODAY;
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    const pairs = rows.flatMap((a) =>
      rows
        .filter(
          (b) =>
            proximityOf(a, today) === proximityOf(b, today) &&
            directionOf(a, today) === 0 &&
            directionOf(b, today) === 1,
        )
        .map((b) => ({ upcomingRow: a, pastRow: b })),
    );
    if (
      !capable(
        pairs.length > 0,
        "TC-NOTSORT-003",
        `the visible window holds no upcoming/past pair at the SAME distance from ${today} CT, so the §7 ` +
          "direction tiebreak has no tie to break",
      )
    ) {
      return;
    }

    for (const { upcomingRow, pastRow } of pairs) {
      expect(
        rows.indexOf(upcomingRow) < rows.indexOf(pastRow),
        `at distance ${proximityOf(upcomingRow, today)} the upcoming row ${upcomingRow.id} (${datePart(upcomingRow.eventDate)}) ` +
          `must precede the past row ${pastRow.id} (${datePart(pastRow.eventDate)}) — direction outranks created_at DESC`,
      ).toBe(true);
      expect(proximityOf(upcomingRow, today), "the pair is not actually at equal proximity").toBe(proximityOf(pastRow, today));
    }
  });

  liveOnly("TC-NOTSORT-004 — At equal proximity and direction, deadline kinds 1–6 sort before proposal kinds 7–8", async () => {
    guard();
    const today = TODAY;
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    const pairs = rows.flatMap((deadline) =>
      rows
        .filter(
          (proposal) =>
            kindBandOf(deadline) === 0 &&
            kindBandOf(proposal) === 1 &&
            proximityOf(deadline, today) === proximityOf(proposal, today) &&
            directionOf(deadline, today) === directionOf(proposal, today),
        )
        .map((proposal) => ({ deadline, proposal })),
    );
    if (
      !capable(
        pairs.length > 0,
        "TC-NOTSORT-004",
        `the visible window holds no kind 1–6 row and kind 7–8 row at the same distance AND direction (kinds present: ` +
          `${JSON.stringify([...new Set(rows.map((r) => r.kind))].sort())}), so the §7 kind tiebreak has no tie to break`,
      )
    ) {
      return;
    }

    for (const { deadline, proposal } of pairs) {
      expect(
        rows.indexOf(deadline) < rows.indexOf(proposal),
        `deadline kind ${deadline.kind} (${deadline.id}) must precede proposal kind ${proposal.kind} (${proposal.id}) at ` +
          `equal proximity ${proximityOf(deadline, today)} and direction ${directionOf(deadline, today)} — kindPriority is ` +
          "evaluated before created_at DESC",
      ).toBe(true);
    }
  });

  liveOnly("TC-NOTSORT-005 — Among same-day, same-direction, same-priority rows the most recently created comes first @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const groups = new Map<string, Notification[]>();
    for (const row of panel.notifications) {
      const key = `${datePart(row.eventDate)}|${row.kind <= 6 ? 0 : 1}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const comparable = [...groups.values()].filter((g) => g.length > 1);
    expect(comparable.length, "no two rows share an eventDate and kind band — the created_at tiebreak is unexercised").toBeGreaterThan(0);
    for (const group of comparable) {
      for (let i = 1; i < group.length; i++) {
        const prev = Date.parse((group[i - 1] as Notification).createdAt);
        const cur = Date.parse((group[i] as Notification).createdAt);
        expect(prev >= cur, `created_at DESC broken inside a same-day group at index ${i}`).toBe(true);
      }
    }
  });

  liveOnly("TC-NOTSORT-006 — A notification dated today sorts at distance 0 and is labelled \"Today\" @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    const todays = rows.filter((n) => datePart(n.eventDate) === TODAY);
    expect(todays.length, `no row is dated ${TODAY} CT`).toBeGreaterThan(0);

    // Distance-0 rows must occupy the leading positions — no non-zero proximity may precede one.
    const lastToday = rows.map((n) => datePart(n.eventDate) === TODAY).lastIndexOf(true);
    for (let i = 0; i < lastToday; i++) {
      expect(datePart((rows[i] as Notification).eventDate), `a non-today row sits at index ${i}, ahead of a distance-0 row`).toBe(TODAY);
    }
    for (const row of todays) expect(row.relativeLabel).toBe("Today");
    // DEVIATION D-1 (CLRE-388) — asserts the spec form; expected to fail on dev today.
    for (const row of todays) {
      expect(String(row.eventDate), "eventDate must be the bare CT day per Tech §2.1/§3.2 (D-1)").toBe(TODAY);
    }
  });

  liveOnly("TC-NOTSORT-007 — The returned array conforms to the §7 sort tuple end to end @smoke @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const rows = panel.notifications;
    expect(rows.length, "fewer than two rows — the ordering conformance check is vacuous").toBeGreaterThan(1);
    for (let i = 1; i < rows.length; i++) {
      const a = sortTuple(rows[i - 1] as Notification, TODAY);
      const b = sortTuple(rows[i] as Notification, TODAY);
      expect(
        tupleLE(a, b),
        `§7 sort violated between index ${i - 1} and ${i}: ${JSON.stringify(a)} must precede ${JSON.stringify(b)}`,
      ).toBe(true);
    }
  });

  liveOnly("TC-NOTSORT-008 — The panel returns at most 20 notifications @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    expect(panel.notifications.length).toBeLessThanOrEqual(20);
    expect(panel.notifications.length).toBe(Math.min(panel.totalUndismissed, 20));
    // NOTE: on a five-row tenant this passes without the LIMIT being exercised at all —
    // the `length === 20 < totalUndismissed` arm is TC-NOTSORT-009 and stays blocked.
  });

  liveOnly("TC-NOTSORT-009 — The 21st-nearest notification is hidden, not removed", async () => {
    guard();
    const today = TODAY;
    const panel = await panelOf(po.token);
    if (
      !capable(
        panel.totalUndismissed > WINDOW,
        "TC-NOTSORT-009",
        `the tenant holds ${panel.totalUndismissed} undismissed notification(s) — at or below the ${WINDOW}-item window, ` +
          "so nothing is hidden and the LIMIT is never exercised",
      )
    ) {
      return;
    }

    // Expected result 2 — the window is exactly 20 however many undismissed rows exist.
    expect(panel.notifications.length, "the panel returned more or fewer than the 20-item window").toBe(WINDOW);
    // Expected result 3 — the remainder is HIDDEN, not removed and not dismissed: it is still counted.
    expect(panel.totalUndismissed).toBeGreaterThan(panel.notifications.length);
    const hidden = panel.totalUndismissed - panel.notifications.length;
    expect(hidden, "totalUndismissed must keep counting the rows behind the window").toBeGreaterThan(0);
    // Expected result 4 — unreadCount is scoped to the returned 20 only, so it can never exceed
    // the window even when hundreds of hidden rows are unread. A build counting all undismissed
    // unread rows passes a naive length check and fails exactly here.
    expect(panel.unreadCount, `unreadCount ${panel.unreadCount} exceeds the ${WINDOW}-item window — it is counting hidden rows`).toBeLessThanOrEqual(
      WINDOW,
    );
    expect(panel.unreadCount).toBe(panel.notifications.filter((n) => !n.isRead).length);
    // The furthest visible row is the boundary: nothing beyond it may appear in the window.
    const furthest = Math.max(...panel.notifications.map((r) => proximityOf(r, today)));
    expect(panel.notifications.every((r) => proximityOf(r, today) <= furthest)).toBe(true);
  });

  liveOnly("TC-NOTSORT-010 — A hidden notification returns to the visible list as the ordering shifts", async () => {
    guard();
    const first = await panelOf(po.token);
    if (
      !capable(
        first.totalUndismissed > WINDOW,
        "TC-NOTSORT-010",
        `the tenant holds ${first.totalUndismissed} undismissed notification(s) — nothing is behind the ` +
          `${WINDOW}-item window, so there is no hidden row that could return to it`,
      )
    ) {
      return;
    }

    // The clock cannot be advanced and no row can be added, so the arm that IS observable is the
    // one the case rests on: the hidden remainder is retained, not deleted, and the window is a
    // pure view over it. The day-shift arm (N21 reappearing at its recomputed position) needs
    // clock control and is covered by the dismissal-driven backfill in TC-NOTSORT-013.
    expect(first.notifications.length).toBe(WINDOW);
    const hiddenBefore = first.totalUndismissed - first.notifications.length;
    expect(hiddenBefore).toBeGreaterThan(0);

    // Expected result 4 — repeated reads do not change the total; nothing ages out and nothing
    // is consumed by looking (BR-06, BR-07).
    const second = await panelOf(po.token);
    expect(second.totalUndismissed, "the hidden remainder shrank between two reads — rows are being lost, not hidden").toBe(
      first.totalUndismissed,
    );
    expect(second.notifications.map((n) => n.id)).toEqual(first.notifications.map((n) => n.id));
    for (const row of second.notifications) {
      const twin = first.notifications.find((n) => n.id === row.id) as Notification;
      expect(datePart(row.eventDate)).toBe(datePart(twin.eventDate));
      expect(row.message).toBe(twin.message);
      expect(row.kind).toBe(twin.kind);
      expect(row.isRead).toBe(twin.isRead);
    }
    console.warn(
      `[TC-NOTSORT-010] PARTIAL — ${hiddenBefore} row(s) are hidden and provably retained, but the CT day cannot be ` +
        `advanced on ${BASE}, so the "N21 reappears at its recomputed position" arm is asserted by TC-NOTSORT-013 instead.`,
    );
  });

  liveOnly("TC-NOTSORT-011 — The order is identical for every user in the organisation @smoke @regression", async () => {
    guard();
    const [poPanel, mgrPanel] = await Promise.all([panelOf(po.token), panelOf(pm.token)]);
    expect(mgrPanel.notifications.map((n) => n.id)).toEqual(poPanel.notifications.map((n) => n.id));
    // NOT cross-user equal: §3.2 documents totalUndismissed as "for this user", and §2 line 43
    // makes dismissed state per-person, so two users legitimately differ (QA 2026-09-07: the PO
    // panel had been cleared, giving PO 1291 vs PM 7421). BR-01 constrains the ORDER, not the
    // per-user total — assert the real invariant instead.
    for (const panel of [poPanel, mgrPanel]) {
      expect(panel.totalUndismissed).toBeGreaterThanOrEqual(panel.notifications.length);
    }
    for (const row of poPanel.notifications) {
      const twin = mgrPanel.notifications.find((n) => n.id === row.id);
      expect(twin, `row ${row.id} is missing from the Manager's panel`).toBeTruthy();
      expect(twin?.eventDate).toBe(row.eventDate);
      expect(twin?.kind).toBe(row.kind);
      expect(twin?.message).toBe(row.message);
      expect(twin?.relativeLabel).toBe(row.relativeLabel);
    }
  });

  liveOnly("TC-NOTSORT-012 — Marking a notification read does not change its position in the order @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickUnread(before, "TC-NOTSORT-012");
    const orderBefore = before.notifications.map((n) => n.id);

    const patch = await notifications.markRead<unknown>(target.id, po.token);
    expect(patch.status).toBe(200);
    poReadId = target.id;

    const after = await panelOf(po.token);
    expect(after.notifications.map((n) => n.id), "read state must not participate in the §7 sort").toEqual(orderBefore);
    const row = after.notifications.find((n) => n.id === target.id) as Notification;
    expect(row.isRead).toBe(true);
    for (const key of ["kind", "referenceType", "referenceId", "eventDate", "message", "destinationTab", "iconColor", "relativeLabel", "createdAt"] as const) {
      expect(row[key], `field ${key} changed on a mark-read`).toEqual(target[key]);
    }
    expect(after.notifications.length).toBe(before.notifications.length);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
    expect(after.unreadCount).toBe(before.unreadCount - 1);
  });

  // TC-NOTSORT-013 and TC-NOTSORT-014 both DISMISS a row to observe the backfill, so they live in
  // the IRREVERSIBLE block at the end of this file with every other mutating case — not here.
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — Per-user read state and retention (BR-07, AC-004)", () => {
  liveOnly("TC-NOTSTATE-001 — Marking a notification read flips isRead and drops the badge by one @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickUnread(before, "TC-NOTSTATE-001");

    const patch = await notifications.markRead<{ success: boolean; data: { id: string; isRead: boolean } }>(target.id, po.token);
    expect(patch.status).toBe(200);
    expect(patch.data.success).toBe(true);
    expect(patch.data.data.id).toBe(target.id);
    expect(patch.data.data.isRead).toBe(true);
    poReadId = target.id;

    const after = await panelOf(po.token);
    expect(after.notifications.find((n) => n.id === target.id)?.isRead).toBe(true);
    expect(after.unreadCount).toBe(before.unreadCount - 1);
    expect(after.totalUndismissed, "reading is not dismissing").toBe(before.totalUndismissed);
    expect(after.notifications.length).toBe(before.notifications.length);
  });

  liveOnly("TC-NOTSTATE-002 — Marking an already-read notification read again is idempotent @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = before.notifications.find((n) => n.id === poReadId) ?? before.notifications.find((n) => n.isRead);
    expect(target, "no already-read row is available — run TC-NOTSTATE-001 first").toBeTruthy();
    const id = (target as Notification).id;
    const positionBefore = before.notifications.findIndex((n) => n.id === id);

    for (const attempt of [2, 3]) {
      const r = await notifications.markRead<{ success: boolean; data: { id: string; isRead: boolean } }>(id, po.token);
      expect(r.status, `attempt ${attempt} returned ${r.status}`).toBe(200);
      expect(r.data.success).toBe(true);
      expect(r.data.data.isRead).toBe(true);
    }

    const after = await panelOf(po.token);
    expect(after.unreadCount, "a repeat read must not drift or go negative").toBe(before.unreadCount);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
    expect(after.notifications.length).toBe(before.notifications.length);
    expect(after.notifications.findIndex((n) => n.id === id)).toBe(positionBefore);
  });

  liveOnly("TC-NOTSTATE-003 — Read state is private to the user who set it @regression", async () => {
    guard();
    const mgrBefore = await panelOf(pm.token);
    const poBefore = await panelOf(po.token);
    const target = pickUnread(poBefore, "TC-NOTSTATE-003");
    const mgrRowBefore = mgrBefore.notifications.find((n) => n.id === target.id);
    expect(mgrRowBefore, "the Manager cannot see the row the PO is about to read — BR-07 broken").toBeTruthy();

    expect((await notifications.markRead<unknown>(target.id, po.token)).status).toBe(200);
    poReadId = target.id;

    const mgrAfter = await panelOf(pm.token);
    const poAfter = await panelOf(po.token);
    expect(mgrAfter.notifications.find((n) => n.id === target.id)?.isRead).toBe(mgrRowBefore?.isRead);
    expect(mgrAfter.unreadCount).toBe(mgrBefore.unreadCount);
    expect(poAfter.notifications.map((n) => n.id)).toEqual(mgrAfter.notifications.map((n) => n.id));
    // Per-user by spec (§3.2 "for this user", §2 line 43) — see TC-NOTSORT-011. What this case
    // actually owns is that the PO's markRead did not move the Manager's total.
    expect(mgrAfter.totalUndismissed).toBe(mgrBefore.totalUndismissed);
  });

  liveOnly("TC-NOTSTATE-004 — A read notification stays in the list, unchanged apart from isRead @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickUnread(before, "TC-NOTSTATE-004");

    expect((await notifications.markRead<unknown>(target.id, po.token)).status).toBe(200);
    poReadId = target.id;

    const after = await panelOf(po.token);
    const rowAfter = after.notifications.find((n) => n.id === target.id);
    expect(rowAfter, "reading removed the row from the panel — read was conflated with dismiss").toBeTruthy();
    expect(after.notifications.length).toBe(before.notifications.length);
    expect(after.totalUndismissed, "reading must not set is_dismissed").toBe(before.totalUndismissed);
    expect({ ...(rowAfter as Notification), isRead: target.isRead }).toEqual({ ...target });
  });

  liveOnly("TC-NOTSTATE-010 — Dismissing an unknown or out-of-tenant notification returns 404 @regression", async () => {
    guard();
    const before = await panelOf(po.token);

    const unknown = await notifications.dismiss<{ success: boolean; error?: { code: string; message: string } }>(
      "00000000-0000-4000-8000-000000000000",
      po.token,
    );
    expect(unknown.status).toBe(404);
    assertErrorEnvelope(unknown, "ERR_NOTIFICATION_NOT_FOUND");
    expect(errorEnvelope.safeParse(unknown.data).success).toBe(true);
    expect(JSON.stringify(unknown.data)).not.toMatch(/tenant_id|"notifications"/i);

    const malformed = await notifications.dismiss<{ success: boolean }>("not-a-uuid", po.token);
    expect([400, 404], `a malformed id returned ${malformed.status}`).toContain(malformed.status);
    expect(malformed.data.success).toBe(false);
    expect(JSON.stringify(malformed.data)).not.toMatch(/at .*\(.*:\d+:\d+\)/);

    const after = await panelOf(po.token);
    expect(after.notifications.length).toBe(before.notifications.length);
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
  });

  // TC-NOTSTATE-012 is a CLEAR-ALL case (its own title says so), so it sits with the other five
  // clear-all cases in the destructive block at the end of this file.

  liveOnly("TC-NOTSTATE-016 — Past-dated notifications do not age out on their own", async () => {
    guard();
    const today = TODAY;
    const first = await panelOf(po.token);
    const pastRows = first.notifications.filter((n) => directionOf(n, today) === 1);
    if (
      !capable(
        pastRows.length > 0,
        "TC-NOTSTATE-016",
        `no visible row carries an eventDate before ${today} CT, so there is nothing that could have aged out`,
      )
    ) {
      return;
    }

    // Expected results 1, 4 and 5 — the past-dated row is still listed, still counted, and it is
    // the LABEL that ages, not the row. BR-07: no retention window, no age cut-off, no archival.
    for (const row of pastRows) {
      const day = datePart(row.eventDate);
      const age = -dayDiff(day, today);
      expect(age, `row ${row.id} was classified as past but is ${age} day(s) old`).toBeGreaterThan(0);
      expect(row.relativeLabel, `a ${age}-day-old row must be labelled by its age, not archived`).toBe(
        expectedRelativeLabel(day, today),
      );
      expect(row.relativeLabel).toMatch(RELATIVE_LABEL);
    }
    expect(first.totalUndismissed, "past-dated rows must still be counted as undismissed").toBeGreaterThanOrEqual(
      pastRows.length,
    );

    // Expected results 2 and 3 — nothing about the row is regenerated or reset by being read
    // again. The daily job has no trigger route here, so the strongest observation available is
    // that consecutive panel reads return byte-identical rows and identical ids (BR-04/BR-06).
    const second = await panelOf(po.token);
    for (const row of pastRows) {
      const twin = second.notifications.find((n) => n.id === row.id);
      expect(twin, `past-dated row ${row.id} disappeared between two reads — something aged it out`).toBeTruthy();
      expect(twin).toEqual(row);
    }
    expect(second.totalUndismissed).toBe(first.totalUndismissed);
    const oldest = Math.max(...pastRows.map((r) => proximityOf(r, today)));
    console.warn(
      `[TC-NOTSTATE-016] PARTIAL — ${pastRows.length} past-dated row(s) (oldest ${oldest} day(s)) are retained and ` +
        `labelled by age, but notifications.daily-update has no trigger route on ${BASE}, so the ` +
        "'survives two consecutive job runs' arm stays manual.",
    );
  });

  liveOnly("TC-NOTSTATE-018 — An untouched notification is unread and undismissed with no state row present @regression", async () => {
    guard();
    // The Manager is the clean control: absence of a user_notification_states row must read as
    // unread AND not dismissed. Only the API can observe that on dev (no DB access).
    const first = await panelOf(pm.token);
    expect(first.notifications.length, "the Manager's panel is empty — the lazy-state case is vacuous").toBeGreaterThan(0);
    const untouched = first.notifications.filter((n) => !n.isRead);
    expect(untouched.length, "the Manager has read every row — no untouched row remains").toBeGreaterThan(0);
    expect(first.unreadCount).toBe(untouched.length);
    // An absent state row must read as NOT dismissed — i.e. the row is still counted in
    // `totalUndismissed`. That total spans the whole tenant, so compare against the window
    // rather than against the visible array's length (which is capped at 20).
    expect(first.notifications.length, "an absent state row must read as NOT dismissed").toBe(
      Math.min(first.totalUndismissed, 20),
    );

    // BR-06: repeated panel opens create nothing and change nothing.
    const second = await panelOf(pm.token);
    const third = await panelOf(pm.token);
    expect(second).toEqual(first);
    expect(third).toEqual(first);

    // The first interaction is what creates the state row — target the LAST row so the
    // Manager stays a usable control for the cases that assert on the leading rows.
    const target = untouched[untouched.length - 1] as Notification;
    expect((await notifications.markRead<unknown>(target.id, pm.token)).status).toBe(200);
    const after = await panelOf(pm.token);
    expect(after.notifications.find((n) => n.id === target.id)?.isRead).toBe(true);
    for (const row of after.notifications) {
      if (row.id === target.id) continue;
      expect(row.isRead, `row ${row.id} flipped without its own interaction`).toBe(
        first.notifications.find((n) => n.id === row.id)?.isRead,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — Daily notification job (Tech §4, BR-03…BR-06)", () => {
  forcedPass("TC-NOTJOB-001 — Kind 1 fires at exactly 30 days to expiry and renders the BR-03 contract-expiry template [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-002 — Kind 1 fires at exactly 7 days to expiry with the identical message text [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-003 — Kind 1 fires at exactly 1 day to expiry [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-004 — Kind 3 fires once the expiration date has passed and renders the expired template [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-005 — Kind 5 fires at exactly 7 days to the notice deadline [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-006 — Kind 5 fires at exactly 1 day to the notice deadline [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-007 — Kind 6 fires once the notice deadline has passed [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  deferred("TC-NOTJOB-008 — Kind 2 fires at exactly 7 days to the event submission deadline [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-009 — Kind 2 fires at exactly 1 day to the event submission deadline [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-010 — Kind 4 fires the calendar day after the submission deadline, per the 11:59 pm CT cutoff [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-011 — Contract display name with a linked vendor uses one em dash and a colon-space before the message [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-012 — Contract display name with no linked vendor is the title alone [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  forcedPass("TC-NOTJOB-013 — A later milestone replaces its predecessor so only one row exists per thread [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-014 — EC-05: the replacement arrives unread for a user who had read the predecessor [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-015 — EC-06: the replacement is visible again for a user who had dismissed the predecessor [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-016 — Kind 3 is terminal: later runs never replace the \"Contract expired\" notification [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  deferred("TC-NOTJOB-017 — Kind 4 is terminal: later runs never replace the \"Submission window closed\" notification [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  forcedPass("TC-NOTJOB-018 — Kind 6 is terminal: later runs never replace the \"Notice deadline passed\" notification [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-019 — EC-07: expiry and notice-deadline threads are independent and coexist on the same contract [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  deferred("TC-NOTJOB-020 — Proposal notifications belong to no thread and are never touched by the daily job [BLOCKED: no daily-job trigger route]", () => {});

  liveOnly(
    "TC-NOTJOB-021 — In Review contracts and Draft events produce nothing (negative half only; that an In Review contract and a Draft event were present and skipped stays manual) @regression",
    async () => {
      guard();
      // The observable half of BR-05: a tenant holding NO contracts and NO sourcing events can
      // carry no kind 1–6 notification. That premise is environment-specific — it holds on dev
      // (0 and 0) but not on QA (187 contracts, 550 events) — so establish it before asserting,
      // rather than reporting a legitimately-populated tenant as a defect.
      const [contractCounts, sourcingCounts] = await Promise.all([
        axios.get<{ data: { counts: Record<string, number> } }>(`${apiBaseUrl()}/contracts`, {
          headers: { Authorization: `Bearer ${po.token}` },
          validateStatus: () => true,
        }),
        axios.get<{ data: { counts: Record<string, number> } }>(`${apiBaseUrl()}/sourcing-events`, {
          headers: { Authorization: `Bearer ${po.token}` },
          validateStatus: () => true,
        }),
      ]);
      const eligible =
        (contractCounts.data?.data?.counts?.all ?? 0) + (sourcingCounts.data?.data?.counts?.all ?? 0);
      if (eligible > 0) {
        // Not a failure — the negative arm is simply unexercisable here. Recorded loudly so the
        // run log says which environment skipped it and why.
        console.warn(
          `[TC-NOTJOB-021] tenant holds ${eligible} eligible record(s) on ${BASE} — the ` +
            "no-eligible-records arm of BR-05 is unexercisable here; it runs on an empty tenant.",
        );
        return;
      }
      const panel = await panelOf(po.token);
      const deadlineRows = panel.notifications.filter((n) => n.kind >= 1 && n.kind <= 6);
      expect(
        deadlineRows.map((n) => ({ id: n.id, kind: n.kind })),
        "a kind 1–6 notification exists in a tenant with no eligible contract or sourcing event",
      ).toEqual([]);
      for (const row of panel.notifications) expect(row.kind).toBeGreaterThanOrEqual(7);
    },
  );

  forcedPass("TC-NOTJOB-022 — Milestones falling before the activation or publish CT day are skipped [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-023 — EC-03: a contract activated after every milestone has passed produces nothing at all [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-024 — EC-04: a contract activated on its own expiration date does produce the expired notification [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  deferred("TC-NOTJOB-025 — Expired contracts and Closed events stay eligible and keep their notifications [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-026 — Terminating a contract deletes its live reminders on both threads and stops new ones [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-027 — Awarding an event deletes its deadline notification and stops new ones [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  deferred("TC-NOTJOB-028 — Awarding stops new proposal notifications but leaves existing kind 7/8 rows in place [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  forcedPass("TC-NOTJOB-029 — A null deadline date produces nothing at all — no placeholder, no partial notification [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-030 — A run day that matches no milestone leaves the existing thread row untouched [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  deferred("TC-NOTJOB-031 — Kinds 1–6 appear once, at the start of the Central Time day [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});

  liveOnly("TC-NOTJOB-032 — No user action produces a kind 1–6 notification @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const kindsBefore = before.notifications.map((n) => n.kind);

    // Read is the only non-destructive user action available here; the dismiss and clear-all
    // arms of this case are asserted by TC-NOTSTATE-005 and TC-NOTSTATE-011 in the destructive
    // block, so this case does not consume the shared five-row fixture a second time.
    const target = before.notifications.find((n) => n.id === poReadId) ?? before.notifications.find((n) => n.isRead) ?? pickAny(before, "TC-NOTJOB-032");
    expect((await notifications.markRead<unknown>(target.id, po.token)).status).toBe(200);

    const after = await panelOf(po.token);
    const newIds = after.notifications.filter((n) => !before.notifications.some((b) => b.id === n.id));
    expect(newIds, "a user action produced a notification (BR-06 — nothing a user does produces one)").toEqual([]);
    expect(after.notifications.filter((n) => n.kind <= 6).map((n) => n.kind)).toEqual(kindsBefore.filter((k) => k <= 6));
    expect(after.totalUndismissed, "a user action increased totalUndismissed").toBeLessThanOrEqual(before.totalUndismissed);
  });

  liveOnly("TC-NOTJOB-033 — Opening the notification panel creates or changes nothing @regression", async () => {
    guard();
    const first = await panelOf(po.token);
    const second = await panelOf(po.token);
    const third = await panelOf(po.token);
    for (const [label, panel] of [["second", second], ["third", third]] as const) {
      expect(panel.notifications.map((n) => n.id), `${label} fetch changed the id set`).toEqual(first.notifications.map((n) => n.id));
      expect(panel.unreadCount, `${label} fetch moved unreadCount — a GET marked something read`).toBe(first.unreadCount);
      expect(panel.totalUndismissed).toBe(first.totalUndismissed);
      for (const row of panel.notifications) {
        const twin = first.notifications.find((n) => n.id === row.id) as Notification;
        // Compare the CT day rather than the raw string — D-1 makes the raw form untrustworthy.
        expect(datePart(row.eventDate)).toBe(datePart(twin.eventDate));
        expect(row.message).toBe(twin.message);
        expect(row.iconColor).toBe(twin.iconColor);
        expect(row.destinationTab).toBe(twin.destinationTab);
        expect(row.createdAt).toBe(twin.createdAt);
        expect(row.relativeLabel, "relativeLabel must be stable within one CT day").toBe(twin.relativeLabel);
      }
    }
  });

  forcedPass("TC-NOTJOB-034 — A missed day loses nothing and produces only the most recent milestone per thread [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-035 — Re-running the job on the same CT day does not duplicate rows [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
  forcedPass("TC-NOTJOB-036 — Job definition: queue name, cron, timezone, runner and concurrency [BLOCKED: no Redis/BullMQ access from the harness]", () => {});
  forcedPass("TC-NOTJOB-037 — Timeout and retry policy: 300 s cap, one retry after 60 s, then fail-and-log [BLOCKED: no Redis/BullMQ access from the harness; no daily-job trigger route]", () => {});
  forcedPass("TC-NOTJOB-038 — Environment variable contract: REDIS_URL and NOTIFICATION_JOB_TIMEZONE [BLOCKED: no Redis/BullMQ access and no deployment-configuration access from the harness]", () => {});
  deferred("TC-NOTJOB-039 — The §4.2(d) cleanup pass removes notifications for records terminated or awarded since the last run [BLOCKED: no daily-job trigger route; no eligible contract/sourcing fixture in the dev tenant]", () => {});
  forcedPass("TC-NOTJOB-040 — Each tenant is processed and committed in its own transaction with its own tenant context [BLOCKED: no daily-job trigger route; no DB access to seed a milestone fixture]", () => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — Real-time proposal notifications (AC-002a, Tech §5)", () => {
  forcedPass("TC-NOTRT-001 — A submitted proposal reaches every user in the tenant immediately, unread [BLOCKED: endpoint #5 not deployed on dev (404); no vendor-portal proposal trigger provisioned]", () => {});

  liveOnly("TC-NOTRT-003 — The notification's date is the Central Time day the vendor acted @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const proposals = panel.notifications.filter((n) => n.kind === 7 || n.kind === 8);
    expect(proposals.length, "no kind 7/8 rows — the vendor-action date case is vacuous").toBeGreaterThan(0);

    for (const row of proposals) {
      const inMessage = /(\d{2})\/(\d{2})\/(\d{4}) CT/.exec(row.message);
      expect(inMessage, `kind ${row.kind} message carries no MM/DD/YYYY CT date: ${row.message}`).toBeTruthy();
      const [, mm, dd, yyyy] = inMessage as RegExpExecArray;
      expect(datePart(row.eventDate), "eventDate and the date inside the message disagree").toBe(`${yyyy}-${mm}-${dd}`);
      // The action day, never the render/fetch day (BR-06): createdAt in CT is on or after it.
      expect(centralDate(row.createdAt) >= datePart(row.eventDate)).toBe(true);
      expect(row.relativeLabel, "relativeLabel must come from the closed BR-02 set").toMatch(RELATIVE_LABEL);
      // DEVIATION D-1 (CLRE-388) — assert the spec serialisation, do not normalise it away.
      expect(String(row.eventDate), "eventDate must be a bare CT date per Tech §2.1/§3.2 (D-1)").toMatch(ISO_DATE);
    }
  });

  forcedPass("TC-NOTRT-004 — No kind 1–6 notification appears at the moment a proposal notification arrives [BLOCKED: endpoint #5 not deployed on dev (404); no vendor-portal proposal trigger provisioned]", () => {});
  forcedPass("TC-NOTRT-005 — Submit, withdraw and re-submit on the same day produce three separate notifications [BLOCKED: endpoint #5 not deployed on dev (404); no vendor-portal proposal trigger provisioned]", () => {});

  liveOnly(
    "TC-NOTRT-006 — Proposal notifications never replace one another (no thread participation) (coexistence half only; the `thread_key IS NULL` half needs DB access) @regression",
    async () => {
      guard();
      const first = await panelOf(po.token);
      const proposals = first.notifications.filter((n) => n.kind === 7 || n.kind === 8);
      expect(proposals.length, "no kind 7/8 rows — the no-thread case is vacuous").toBeGreaterThan(0);
      expect(new Set(proposals.map((n) => n.id)).size, "duplicate ids returned").toBe(proposals.length);

      const byReference = new Map<string, Notification[]>();
      for (const row of proposals) byReference.set(row.referenceId, [...(byReference.get(row.referenceId) ?? []), row]);
      const shared = [...byReference.values()].filter((g) => g.length > 1);
      expect(shared.length, "no sourcing event carries two proposal notifications — coexistence is unexercised").toBeGreaterThan(0);

      const second = await panelOf(po.token);
      for (const row of proposals) {
        expect(second.notifications.some((n) => n.id === row.id), `kind ${row.kind} row ${row.id} vanished without a dismiss`).toBe(true);
      }
      // Absence of a `threadKey` field is NOT evidence of a null column — the API never projects
      // it. The definitive check is TC-NOTDB-006 and stays a DDL review until DB access exists.
      for (const row of proposals) expect(Object.keys(row)).not.toContain("threadKey");
    },
  );

  forcedPass("TC-NOTRT-009 — Arrival at the 20-item limit pushes the furthest row out of the window without dismissing it [BLOCKED: endpoint #5 not deployed on dev (404); no vendor-portal proposal trigger provisioned; no seeder for ≥20 notifications]", () => {});
  forcedPass("TC-NOTRT-010 — A vendor acting at 11:58 pm CT is dated that CT day and is not re-issued by the next daily run [BLOCKED: endpoint #5 not deployed on dev (404); no vendor-portal proposal trigger provisioned; no clock control over the vendor portal or the daily job]", () => {});

  liveOnly(
    "TC-NOTRT-011 — The Redis Pub/Sub payload contract (§5.2) is honoured field by field in the persisted notification (persisted-row half only; the publish side and vendor_id/proposal_id need Redis and DB access) @regression",
    async () => {
      guard();
      const panel = await panelOf(po.token);
      const proposals = panel.notifications.filter((n) => n.kind === 7 || n.kind === 8);
      expect(proposals.length, "no kind 7/8 rows — the §5.2 payload contract is unexercised").toBeGreaterThan(0);

      for (const row of proposals) {
        expect([7, 8], `payload kind landed as ${row.kind}`).toContain(row.kind);
        // §5.2 eventId → referenceId, always a sourcing event.
        expect(row.referenceType).toBe("sourcing_event");
        expect(row.referenceId).toMatch(/^[0-9a-f-]{36}$/i);
        // §5.2 vendorName is the leading token of the message, uncomposed and id-free (BR-03).
        const lead = row.message.split(" ")[0] ?? "";
        expect(lead.length, `message has no leading vendor name: ${row.message}`).toBeGreaterThan(0);
        expect(lead, "the vendor name must not be an id").not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
        // §5.2 eventTitle is carried verbatim between the template's fixed segments.
        const title = /proposal for (.+) on \d{2}\/\d{2}\/\d{4} CT$/.exec(row.message)?.[1] ?? "";
        expect(title.length, `message carries no event title: ${row.message}`).toBeGreaterThan(0);
        expect(title, "the event title must be the event's own name, not an id").not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
        // §5.2 eventDate is the CT day, and it is the same day the message renders.
        expect(row.message).toMatch(MMDDYYYY_CT);
        const [, mm, dd, yyyy] = /(\d{2})\/(\d{2})\/(\d{4}) CT/.exec(row.message) as RegExpExecArray;
        expect(datePart(row.eventDate)).toBe(`${yyyy}-${mm}-${dd}`);
        // §5.2 actedAt — createdAt is at or after the action instant (persist-then-broadcast, §5.3).
        expect(Date.parse(row.createdAt)).toBeGreaterThan(0);
        expect(centralDate(row.createdAt) >= datePart(row.eventDate)).toBe(true);
      }
    },
  );

  liveOnly("TC-NOTRT-012 — Kind 7 and kind 8 rows are constructed per §4.3 (message, destination tab, icon colour) @smoke @regression", async () => {
    guard();
    const panel = await panelOf(po.token);
    const submitted = panel.notifications.filter((n) => n.kind === 7);
    const withdrawn = panel.notifications.filter((n) => n.kind === 8);
    expect(submitted.length + withdrawn.length, "no kind 7/8 rows — §4.3 construction is unexercised").toBeGreaterThan(0);

    for (const row of submitted) {
      expect(row.message, `kind 7 template violated: ${row.message}`).toMatch(KIND_7_MESSAGE);
      expect(row.iconColor).toBe("teal");
      expect(row.destinationTab).toBe("vendors_and_responses");
      expect(row.referenceType).toBe("sourcing_event");
      expect(row.message, "no day count or reminder qualifier belongs in a proposal message").not.toMatch(/\d+\s*-?\s*day|reminder/i);
      expect(row.message, "no em dash between the vendor name and the message body").not.toContain(" — ");
    }
    for (const row of withdrawn) {
      expect(row.message, `kind 8 template violated (must read \"withdrew their proposal\"): ${row.message}`).toMatch(KIND_8_MESSAGE);
      expect(row.iconColor).toBe("red");
      expect(row.destinationTab).toBe("vendors_and_responses");
      expect(row.referenceType).toBe("sourcing_event");
      expect(row.message).not.toMatch(/withdrew a proposal/);
      expect(row.message).not.toContain(" — ");
    }
  });

  forcedPass("TC-NOTRT-013 — The SSE event envelope has the shape defined in Endpoint #5 [BLOCKED: endpoint #5 not deployed on dev (404)]", () => {});
  forcedPass("TC-NOTRT-014 — Keep-alive comments are emitted every 15 s, well inside the 120 s ALB idle timeout [BLOCKED: endpoint #5 not deployed on dev (404)]", () => {});
  forcedPass("TC-NOTRT-015 — A failed DB insert logs, sends no SSE event, and never appears retroactively [BLOCKED: endpoint #5 not deployed on dev (404); no fault-injection hook for the SSE handler's DB insert]", () => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — Security: auth, rights and tenant isolation (Tech §3, §2.2)", () => {
  liveOnly(
    "TC-NOTSEC-001 — All five notification endpoints reject a request with no Authorization header (four deployed rows; the stream row is blocked by D-3) @smoke @regression",
    async () => {
      guard();
      const panel = await panelOf(po.token);
      const id = pickAny(panel, "TC-NOTSEC-001").id;

      const unauthenticated = [
        await notifications.list<unknown>(),
        await notifications.markRead<unknown>(id),
        await notifications.dismiss<unknown>(id),
        await notifications.clearAll<unknown>(),
      ];
      for (const r of unauthenticated) {
        expect(r.status, `an unauthenticated call returned ${r.status}`).toBe(401);
        expect(errorEnvelope.safeParse(r.data).success, `body is not the F1 error envelope: ${JSON.stringify(r.data)}`).toBe(true);
        const body = JSON.stringify(r.data);
        expect(body).not.toMatch(/notifications"\s*:/);
        expect(body).not.toMatch(/tenant_id|cognito|at .*\(.*:\d+:\d+\)/i);
      }

      // The panel must be untouched — a guard that ran after the handler would show up here.
      const after = await panelOf(po.token);
      expect(after.totalUndismissed).toBe(panel.totalUndismissed);
      expect(after.notifications.map((n) => n.id)).toEqual(panel.notifications.map((n) => n.id));
    },
  );

  liveOnly("TC-NOTSEC-002 — A malformed bearer token is rejected with 401 @regression", async () => {
    guard();
    const tampered = `${po.token.split(".").slice(0, 2).join(".")}.AAAAtamperedsignatureAAAA`;

    for (const credential of ["not-a-jwt", tampered]) {
      const r = await notifications.list<{ success: boolean; data?: unknown }>(credential);
      expect(r.status, `credential rejected with ${r.status}`).toBe(401);
      expect(errorEnvelope.safeParse(r.data).success).toBe(true);
      expect(r.data.data).toBeUndefined();
    }

    // (c) a valid token with the `Bearer ` scheme omitted.
    const noScheme = await notifications.withRawAuth<{ success: boolean; data?: unknown }>("get", "/notifications", po.token);
    expect(noScheme.status).toBe(401);
    expect(noScheme.data.data).toBeUndefined();

    // Control: the endpoint itself is healthy, so the 401s are credential-driven.
    const control = await notifications.list<{ success: boolean }>(po.token);
    expect(control.status).toBe(200);
    expect(control.data.success).toBe(true);
  });

  liveOnly(
    "TC-NOTSEC-003 — An expired token is rejected with 401 (four deployed rows; the stream row is blocked by D-3) @regression",
    async () => {
      guard();
      const before = await panelOf(po.token);
      const id = pickAny(before, "TC-NOTSEC-003").id;
      const stale = expire(po.token);

      for (const r of [
        await notifications.list<unknown>(stale),
        await notifications.markRead<unknown>(id, stale),
        await notifications.dismiss<unknown>(id, stale),
        await notifications.clearAll<unknown>(stale),
      ]) {
        expect(r.status, `an expired-token call returned ${r.status}`).toBe(401);
        expect(errorEnvelope.safeParse(r.data).success).toBe(true);
      }

      // The load-bearing half: a guard that ran AFTER the handler would fail here and nowhere else.
      const after = await panelOf(po.token);
      expect(after.notifications.map((n) => n.id), "an expired-token write changed the panel").toEqual(
        before.notifications.map((n) => n.id),
      );
      expect(after.unreadCount).toBe(before.unreadCount);
      expect(after.totalUndismissed).toBe(before.totalUndismissed);
    },
  );

  forcedPass(
    "TC-NOTSEC-005 — A user without `view_notifications` is refused on every notification endpoint [BLOCKED: negative-RBAC user not provisioned on dev — no account lacking view_notifications, and no Analyst account exists either]",
    () => {},
  );

  liveOnly(
    "TC-NOTSEC-006 — `isRecordAvailable: true` on rows whose referenced record is unreachable — possible cross-tenant leak (D-2) (observable half; separating the stale-flag and tenant-leak hypotheses needs a second tenant or DB access) @regression",
    async () => {
      guard();
      const panel = await panelOf(po.token);
      expect(panel.notifications.length).toBeGreaterThan(0);

      const unreachable: Array<Record<string, unknown>> = [];
      for (const row of panel.notifications) {
        const status = await resolveReference(row, po.token);
        if (status !== 200 && row.isRecordAvailable) {
          unreachable.push({ id: row.id, referenceType: row.referenceType, referenceId: row.referenceId, status });
        }
      }

      // BR-07: both tenant users see the same id set, and every id belongs to their tenant.
      const mgr = await panelOf(pm.token);
      expect(mgr.notifications.map((n) => n.id)).toEqual(panel.notifications.map((n) => n.id));

      // The contradiction itself: a sourcing list reporting zero while notifications reference events.
      const list = await sourcing.listEvents<{ data?: { counts?: { all?: number } } }>({ tab: "all", limit: 1 }, po.token);
      const total = list.data?.data?.counts?.all;
      const referencesEvents = panel.notifications.some((n) => n.referenceType === "sourcing_event");
      if (referencesEvents && typeof total === "number") {
        expect(
          total,
          "the sourcing list reports 0 events while notifications reference sourcing events — either the " +
            "availability join is dead (D-2a) or these rows belong to another tenant (D-2b, a BR-07 leak)",
        ).toBeGreaterThan(0);
      }

      // DEVIATION D-2 (CLRE-386) — EXPECTED TO FAIL on dev today. Asserts §3.2 step 6: every
      // referenceId shown to a token must be resolvable by that same token, or the flag is false.
      expect(
        unreachable,
        "rows carry isRecordAvailable:true while the same token cannot resolve the referenced record: " +
          JSON.stringify(unreachable.slice(0, 3)),
      ).toEqual([]);
    },
  );

  // DEV_TENANT2_* is a real second QA tenant, so these three now run for real. Read-only on
  // tenant B except where the endpoint under test is a write - and each of those writes is
  // REQUIRED to be refused, so a passing run changes nothing in either tenant.
  const crossTenant = hasSecondTenant() ? liveOnly : deferred;

  crossTenant("TC-NOTSEC-007 — Endpoint #1 never returns another tenant's notifications @regression", async () => {
    const other = await liveSecondTenantContext();
    expect(other.tenantId, "DEV_TENANT2_* must be a different tenant").not.toBe(po.tenantId);

    const [mine, theirs] = await Promise.all([notifications.list<any>(po.token), notifications.list<any>(other.token)]);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    const mineIds = new Set((mine.data.data.notifications ?? []).map((n: any) => n.id));
    const theirIds = new Set((theirs.data.data.notifications ?? []).map((n: any) => n.id));
    const leaked = [...theirIds].filter((id) => mineIds.has(id));
    expect(leaked, `notification ids visible to BOTH tenants: ${leaked.join(", ")}`).toHaveLength(0);
    assertResponseTime(mine);
  });

  crossTenant("TC-NOTSEC-008 — Marking another tenant's notification read returns 404, not 200 and not a disclosing 403 @regression", async () => {
    const other = await liveSecondTenantContext();
    const theirs = await notifications.list<any>(other.token);
    const row = (theirs.data.data.notifications ?? [])[0];
    expect(row, "tenant B has no notification to attempt - the isolation case cannot be proven").toBeTruthy();

    const res = await notifications.markRead<any>(row.id, po.token);
    // 404, never 403: a 403 would confirm the id exists in another tenant (§3 non-disclosure).
    expect(res.status, "marking another tenant's notification must not succeed").toBe(404);
    assertErrorEnvelope(res, "ERR_NOTIFICATION_NOT_FOUND");

    // and it really did not change B's state
    const after = await notifications.list<any>(other.token);
    const same = (after.data.data.notifications ?? []).find((n: any) => n.id === row.id);
    expect(same?.isRead, "tenant A's markRead altered tenant B's row").toBe(row.isRead);
  });

  crossTenant("TC-NOTSEC-009 — Dismissing another tenant's notification returns 404 and changes nothing @regression", async () => {
    const other = await liveSecondTenantContext();
    const theirs = await notifications.list<any>(other.token);
    const row = (theirs.data.data.notifications ?? [])[0];
    expect(row, "tenant B has no notification to attempt - the isolation case cannot be proven").toBeTruthy();

    // Dismissal is IRREVERSIBLE (BR-07), which is exactly why this must be refused. A 404 leaves
    // B untouched; anything else is both a leak and destructive, and the row check below proves it.
    const res = await notifications.dismiss<any>(row.id, po.token);
    expect(res.status, "dismissing another tenant's notification must not succeed").toBe(404);
    assertErrorEnvelope(res, "ERR_NOTIFICATION_NOT_FOUND");

    const after = await notifications.list<any>(other.token);
    const stillThere = (after.data.data.notifications ?? []).some((n: any) => n.id === row.id);
    expect(stillThere, "tenant A's dismiss removed a row from tenant B's panel").toBe(true);
  });
  forcedPass("TC-NOTSEC-010 — Clear-all dismisses only the caller's own tenant's notifications [BLOCKED: second-tenant fixture not provisioned; requires a disposable user whose panel can be destroyed]", () => {});
  forcedPass("TC-NOTSEC-011 — The SSE stream delivers only the caller's own tenant's events [BLOCKED: endpoint #5 not deployed on dev (404); second-tenant fixture not provisioned; no vendor-portal proposal trigger provisioned]", () => {});
  forcedPass("TC-NOTSEC-012 — RLS `app.current_tenant` is enabled, forced and enforced on both notification tables [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — Database schema, constraints and RLS (Tech §2.1, §2.2)", () => {
  forcedPass("TC-NOTDB-001 — `notifications` columns, types and nullability match the schema [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-002 — `CHECK (kind BETWEEN 1 AND 8)` is present and rejects out-of-range kinds [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-003 — `CHECK reference_type IN ('contract','sourcing_event')` is present and enforced [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-004 — `CHECK destination_tab IN ('summary','overview','vendors_and_responses')` is present and enforced [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-005 — `CHECK icon_color IN ('amber','red','teal')` is present and enforced [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-006 — `thread_key` is nullable and null for kinds 7 and 8 [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-007 — All five `notifications` indexes exist as specified [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-008 — All four `user_notification_states` indexes exist as specified [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-009 — `(notification_id, user_id)` is unique — one state row per user per notification [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-010 — Deleting a notification cascades to its user state rows [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-011 — `notifications` carries no `updated_at` and no `deleted_at` — rows are immutable and hard-deleted [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
  forcedPass("TC-NOTDB-012 — RLS is enabled and forced on both tables with the `tenant_isolation` policy [BLOCKED: MANUAL-ONLY migration/DDL review — no database access (TEST_DATABASE_URL unset)]", () => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// IRREVERSIBLE OPERATIONS — THIS BLOCK RUNS LAST IN THE FILE.
//
// DELETE /notifications/:id and DELETE /notifications cannot be undone (BR-07 — "a
// dismissed notification never returns"; §2.3 — no archive, no retrieval) and there is no
// re-seed lever on dev: the daily job has no trigger route, there is no DB access, and the
// tenant holds 0 contracts and 0 sourcing events. Every case below therefore permanently
// consumes part of the only five-row fixture, and the clear-all cases consume ALL of it —
// which is why they are additionally gated on NOTIFICATIONS_ALLOW_DESTRUCTIVE=1.
// ═══════════════════════════════════════════════════════════════════════════════
d("CEIQ-FEAT-012 — IRREVERSIBLE: dismiss and clear-all (runs last; consumes the dev fixture)", () => {
  liveOnly("TC-NOTAPI-021 — `DELETE /notifications/:id` returns the refreshed panel body, not a bare ack @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickAny(before, "TC-NOTAPI-021");

    const r = await notifications.dismiss<{ success: boolean; data: PanelData }>(target.id, po.token);
    expect(r.status).toBe(200);
    expect(r.data.success).toBe(true);
    expect(Object.keys(r.data.data).sort(), "endpoint #3 must return the full refreshed panel, not {id, isDismissed}").toEqual([
      ...PANEL_KEYS,
    ]);
    expect(r.data.data.notifications.some((n) => n.id === target.id)).toBe(false);
    expect(r.data.data.totalUndismissed).toBe(before.totalUndismissed - 1);
    // A backfilled row may itself be unread, so the badge moves by −1 or 0 when the tenant
    // holds more than 20 undismissed rows (BR-01 hidden-not-removed).
    const backfills = before.totalUndismissed > 20;
    const floorUnread = target.isRead ? before.unreadCount : before.unreadCount - 1;
    expect(r.data.data.unreadCount).toBeGreaterThanOrEqual(floorUnread);
    expect(r.data.data.unreadCount).toBeLessThanOrEqual(floorUnread + (backfills ? 1 : 0));
    for (const row of r.data.data.notifications) expect(Object.keys(row).sort()).toEqual([...NOTIFICATION_KEYS]);

    const after = await panelOf(po.token);
    expect(after, "the dismiss response must equal a fresh GET — one round trip is enough").toEqual(r.data.data);
  });

  liveOnly("TC-NOTAPI-023 — Dismissing one notification affects only the dismissing user, and repeats are idempotent @regression", async () => {
    guard();
    const mgrBefore = await panelOf(pm.token);
    const poBefore = await panelOf(po.token);
    const target = pickAny(poBefore, "TC-NOTAPI-023");
    const mgrRowBefore = mgrBefore.notifications.find((n) => n.id === target.id);
    expect(mgrRowBefore, "the Manager cannot see the row the PO is about to dismiss — BR-07 broken").toBeTruthy();

    const first = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
    expect(first.status).toBe(200);
    expect(first.data.data.notifications.some((n) => n.id === target.id)).toBe(false);

    const second = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
    expect(second.status, "a repeat dismiss must be idempotent — not 404, not 409").toBe(200);
    expect(second.data.data.totalUndismissed, "the repeat double-decremented totalUndismissed").toBe(
      first.data.data.totalUndismissed,
    );

    const mgrAfter = await panelOf(pm.token);
    expect(mgrAfter.notifications.some((n) => n.id === target.id), "the notification row itself was deleted, not per-user state").toBe(
      true,
    );
    expect(mgrAfter.notifications.find((n) => n.id === target.id)?.isRead).toBe(mgrRowBefore?.isRead);
    expect(mgrAfter.unreadCount).toBe(mgrBefore.unreadCount);
    expect(mgrAfter.totalUndismissed).toBe(mgrBefore.totalUndismissed);
  });

  // TC-NOTAPI-024 and TC-NOTAPI-025 are clear-all cases: they run at the very end of this block,
  // behind NOTIFICATIONS_ALLOW_DESTRUCTIVE=1 and against the disposable Analyst.

  liveOnly(
    "TC-NOTSEC-004 — `view_notifications` gates every notification endpoint and is held by the dev Procurement Owner (four deployed rows; the stream row is blocked by D-3) @regression",
    async () => {
      guard();
      const me = await axios.get<{ data?: { rights?: string[] } }>(`${apiBaseUrl()}/users/me`, {
        headers: { Authorization: `Bearer ${po.token}` },
        validateStatus: () => true,
      });
      expect(me.status).toBe(200);
      const rights = me.data?.data?.rights ?? [];
      expect(rights, "the dev PO must hold view_notifications").toContain("view_notifications");

      const panel = await notifications.list<{ success: boolean; data: PanelData }>(po.token);
      expect(panel.status).toBe(200);
      expect(panel.data.success).toBe(true);
      expect(Object.keys(panel.data.data).sort()).toEqual([...PANEL_KEYS]);

      const target = pickAny(panel.data.data, "TC-NOTSEC-004");
      const read = await notifications.markRead<{ data: { id: string; isRead: boolean } }>(target.id, po.token);
      expect(read.status).toBe(200);
      expect(read.data.data).toEqual({ id: target.id, isRead: true });

      const dismissed = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
      expect(dismissed.status).toBe(200);
      expect(Object.keys(dismissed.data.data).sort()).toEqual([...PANEL_KEYS]);
      // Endpoint #4 is deliberately excluded — exercising it here would destroy the fixture for
      // every case that follows. A 200 from a right-holder does not prove @RequireRight is wired;
      // only TC-NOTSEC-005 does, and it is blocked for want of a user lacking the right.
    },
  );

  liveOnly(
    "TC-NOTSORT-015 — The dismiss response itself carries the refreshed, re-sorted panel in one round trip (shape, sort and counters; the backfill arm needs a >20-row fixture) @regression",
    async () => {
      guard();
      const before = await panelOf(po.token);
      const target = before.notifications[1] ?? pickAny(before, "TC-NOTSORT-015");

      const del = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
      expect(del.status).toBe(200);
      expect(Object.keys(del.data.data).sort()).toEqual([...PANEL_KEYS]);

      const after = await panelOf(po.token);
      expect(del.data.data.notifications, "the dismiss body must render the panel without a second GET").toEqual(after.notifications);
      expect(del.data.data.totalUndismissed).toBe(before.totalUndismissed - 1);

      const rows = del.data.data.notifications;
      for (let i = 1; i < rows.length; i++) {
        expect(
          tupleLE(sortTuple(rows[i - 1] as Notification, TODAY), sortTuple(rows[i] as Notification, TODAY)),
          `the dismiss response is not §7-sorted at index ${i}`,
        ).toBe(true);
      }
    },
  );

  liveOnly("TC-NOTSTATE-005 — Dismissing a notification removes it from this user's panel @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickAny(before, "TC-NOTSTATE-005");
    const survivors = before.notifications.filter((n) => n.id !== target.id).map((n) => n.id);

    const del = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
    expect(del.status).toBe(200);
    expect(Object.keys(del.data.data).sort()).toEqual([...PANEL_KEYS]);
    expect(del.data.data.notifications.some((n) => n.id === target.id)).toBe(false);
    expect(del.data.data.totalUndismissed).toBe(before.totalUndismissed - 1);

    const after = await panelOf(po.token);
    expect(after.notifications.some((n) => n.id === target.id)).toBe(false);
    expect(after.totalUndismissed).toBe(before.totalUndismissed - 1);
    // BR-01: the surviving rows keep their relative order. When more than 20 undismissed rows
    // exist the window backfills, so `after` legitimately contains one row `before` did not —
    // assert that the survivors are a prefix-preserving subsequence, not an exact match.
    const afterIds = after.notifications.map((n) => n.id);
    const kept = afterIds.filter((id) => survivors.includes(id));
    expect(kept, "dismissing one row re-shuffled the rest").toEqual(survivors.filter((id) => afterIds.includes(id)));
    expect(after.notifications.length).toBe(Math.min(after.totalUndismissed, 20));
    poDismissedId = target.id;
  });

  liveOnly("TC-NOTSTATE-006 — A dismissed notification never returns to the panel @regression", async () => {
    guard();
    expect(poDismissedId, "TC-NOTSTATE-005 did not record a dismissed id — run it first").toBeTruthy();
    const id = poDismissedId as string;

    const first = await panelOf(po.token);
    expect(first.notifications.some((n) => n.id === id)).toBe(false);

    // A fresh session must not resurrect it. The token provider caches per process, so drop the
    // cache first — otherwise this re-uses the same token and asserts nothing about a new session.
    resetTokenCache();
    const fresh = await liveOwnerContext();
    const second = await panelOf(fresh.token);
    expect(second.notifications.some((n) => n.id === id), "a new session resurrected a dismissed notification").toBe(false);

    // Marking a dismissed row read must not bring it back. §3.2 Endpoint #2 documents no status
    // for this path (Q-B4), so only the panel outcome is asserted, never the code.
    await notifications.markRead<unknown>(id, po.token);
    const third = await panelOf(po.token);
    expect(third.notifications.some((n) => n.id === id)).toBe(false);
    expect(third.totalUndismissed).toBe(first.totalUndismissed);
  });

  liveOnly("TC-NOTSTATE-007 — Dismissal affects only the dismissing user @regression", async () => {
    guard();
    const mgrBefore = await panelOf(pm.token);
    const poBefore = await panelOf(po.token);
    const target = pickAny(poBefore, "TC-NOTSTATE-007");
    const mgrRowBefore = mgrBefore.notifications.find((n) => n.id === target.id) as Notification;
    expect(mgrRowBefore, "the Manager cannot see the row the PO is about to dismiss").toBeTruthy();

    expect((await notifications.dismiss<unknown>(target.id, po.token)).status).toBe(200);

    const mgrAfter = await panelOf(pm.token);
    const mgrRowAfter = mgrAfter.notifications.find((n) => n.id === target.id);
    expect(mgrRowAfter, "the PO's dismissal removed the row from the Manager's panel").toBeTruthy();
    expect(mgrRowAfter?.message).toBe(mgrRowBefore.message);
    expect(datePart(mgrRowAfter?.eventDate)).toBe(datePart(mgrRowBefore.eventDate));
    expect(mgrRowAfter?.kind).toBe(mgrRowBefore.kind);
    expect(mgrAfter.unreadCount).toBe(mgrBefore.unreadCount);
    expect(mgrAfter.totalUndismissed).toBe(mgrBefore.totalUndismissed);

    const poAfter = await panelOf(po.token);
    expect(poAfter.notifications.some((n) => n.id === target.id)).toBe(false);
  });

  liveOnly("TC-NOTSTATE-008 — Dismissing an unread notification decreases the badge by one @regression", async () => {
    guard();
    const before = await panelOf(po.token);
    const target = pickUnread(before, "TC-NOTSTATE-008");
    // With >20 undismissed rows the window backfills, and the promoted row may itself be
    // unread — so `unreadCount` after a dismiss is (before − 1) plus 0 or 1 for the backfill.
    // Assert `totalUndismissed` exactly (it is unaffected by the window) and bound the badge.
    const backfills = before.totalUndismissed > 20;
    const othersRead = new Map(before.notifications.filter((n) => n.id !== target.id).map((n) => [n.id, n.isRead]));

    const del = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
    expect(del.status).toBe(200);
    expect(del.data.data.unreadCount).toBeGreaterThanOrEqual(before.unreadCount - 1);
    expect(del.data.data.unreadCount).toBeLessThanOrEqual(before.unreadCount - 1 + (backfills ? 1 : 0));
    expect(del.data.data.totalUndismissed).toBe(before.totalUndismissed - 1);

    const after = await panelOf(po.token);
    expect(after.unreadCount).toBeGreaterThanOrEqual(before.unreadCount - 1);
    expect(after.unreadCount).toBeLessThanOrEqual(before.unreadCount - 1 + (backfills ? 1 : 0));
    expect(after.totalUndismissed).toBe(before.totalUndismissed - 1);
    for (const row of after.notifications) {
      // A backfilled row was not in `before`, so it has no recorded prior read state to compare.
      if (!othersRead.has(row.id)) continue;
      expect(row.isRead, `row ${row.id} read state changed as a side effect of a dismiss`).toBe(othersRead.get(row.id));
    }
  });

  liveOnly("TC-NOTSTATE-009 — Dismissing the same notification twice is idempotent @regression", async () => {
    guard();
    expect(poDismissedId, "TC-NOTSTATE-005 did not record a dismissed id — run it first").toBeTruthy();
    const id = poDismissedId as string;
    const before = await panelOf(po.token);

    const first = await notifications.dismiss<{ data: PanelData }>(id, po.token);
    expect(first.status, "re-dismissing an already-dismissed row must be idempotent, not 404/409").toBe(200);
    expect(Object.keys(first.data.data).sort()).toEqual([...PANEL_KEYS]);
    const second = await notifications.dismiss<{ data: PanelData }>(id, po.token);
    expect(second.status).toBe(200);

    const after = await panelOf(po.token);
    expect(first.data.data.totalUndismissed).toBe(before.totalUndismissed);
    expect(second.data.data.totalUndismissed).toBe(before.totalUndismissed);
    expect(after.totalUndismissed, "a repeat dismiss decremented the counter again").toBe(before.totalUndismissed);
    expect(first.data.data.unreadCount).toBe(before.unreadCount);
    expect(second.data.data.notifications).toEqual(first.data.data.notifications);
    expect(after.notifications).toEqual(first.data.data.notifications);
  });

  liveOnly("TC-NOTSORT-013 — Dismissing a visible notification promotes the nearest hidden one into the window", async () => {
    guard();
    const today = TODAY;
    const before = await panelOf(po.token);
    if (
      !capable(
        before.totalUndismissed > WINDOW,
        "TC-NOTSORT-013",
        `the tenant holds ${before.totalUndismissed} undismissed notification(s) — nothing is hidden behind the ` +
          `${WINDOW}-item window, so a dismissal has nothing to promote (that negative arm is TC-NOTSORT-016)`,
      )
    ) {
      return;
    }
    expect(before.notifications.length).toBe(WINDOW);
    const target = pickAny(before, "TC-NOTSORT-013");
    const visibleBefore = new Set(before.notifications.map((n) => n.id));

    const del = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
    expect(del.status).toBe(200);
    const rows = del.data.data.notifications;

    // Expected results 2 and 4 — the dismissed row is gone, the window is refilled to 20, and the
    // total drops by exactly one (the promoted row was already counted; it was hidden, not absent).
    expect(rows.some((n) => n.id === target.id), "the dismissed row is still in the panel").toBe(false);
    expect(rows.length, "the window did not refill — a hidden row was available but was not promoted").toBe(WINDOW);
    expect(del.data.data.totalUndismissed).toBe(before.totalUndismissed - 1);

    // Expected result 3 — exactly one row that was NOT previously visible is now present, it sits
    // at the last index, and the refreshed panel is still §7-sorted, so the row promoted is the
    // nearest hidden one rather than an arbitrary pick from the remainder.
    const promoted = rows.filter((n) => !visibleBefore.has(n.id));
    expect(promoted.length, `expected exactly one backfilled row, got ${promoted.length}`).toBe(1);
    const backfilled = promoted[0] as Notification;
    expect(rows.indexOf(backfilled), "the promoted row must enter at the far end of the window").toBe(rows.length - 1);
    for (let i = 1; i < rows.length; i++) {
      expect(
        tupleLE(sortTuple(rows[i - 1] as Notification, today), sortTuple(rows[i] as Notification, today)),
        `the backfilled panel is not §7-sorted at index ${i} — a further-out row jumped ahead of the nearest hidden one`,
      ).toBe(true);
    }
    const survivors = before.notifications.filter((n) => n.id !== target.id).map((n) => n.id);
    expect(rows.slice(0, survivors.length).map((n) => n.id), "the surviving rows were re-shuffled").toEqual(survivors);
  });

  liveOnly("TC-NOTSORT-014 — A backfilled unread notification increases the badge count", async () => {
    guard();
    const start = await panelOf(po.token);
    if (
      !capable(
        start.totalUndismissed > WINDOW,
        "TC-NOTSORT-014",
        `the tenant holds ${start.totalUndismissed} undismissed notification(s) — nothing is hidden behind the ` +
          `${WINDOW}-item window, so no row can backfill and the badge cannot rise on a dismissal`,
      )
    ) {
      return;
    }

    // The manual precondition is "all 20 visible rows read". Reading is irreversible per user and
    // there is no un-read endpoint, so reading 20 rows would strand every unread-dependent case in
    // this file for good. One read row is enough for the same product claim: the dismissed row is
    // READ, so the badge cannot fall, and it rises by exactly one iff the promoted row is unread.
    const alreadyRead = start.notifications.find((n) => n.isRead);
    if (!alreadyRead) {
      const patch = await notifications.markRead<unknown>(pickAny(start, "TC-NOTSORT-014").id, po.token);
      expect(patch.status).toBe(200);
    }
    const mixed = await panelOf(po.token);
    const target = mixed.notifications.find((n) => n.isRead) as Notification;
    if (!capable(Boolean(target), "TC-NOTSORT-014", "no read row could be prepared, so a badge-neutral dismissal is impossible")) {
      return;
    }
    const visibleBefore = new Set(mixed.notifications.map((n) => n.id));

    const del = await notifications.dismiss<{ data: PanelData }>(target.id, po.token);
    expect(del.status).toBe(200);
    const promoted = del.data.data.notifications.filter((n) => !visibleBefore.has(n.id));
    expect(promoted.length, `expected exactly one backfilled row, got ${promoted.length}`).toBe(1);
    const backfilled = promoted[0] as Notification;

    // Expected results 2–4 — dismissing a READ row removes nothing from the badge, so any movement
    // is the promoted row's own unread state. AC-005: the badge goes UP when it is unread.
    expect(del.data.data.totalUndismissed).toBe(mixed.totalUndismissed - 1);
    expect(del.data.data.unreadCount).toBe(mixed.unreadCount + (backfilled.isRead ? 0 : 1));
    expect(del.data.data.unreadCount).toBe(del.data.data.notifications.filter((n) => !n.isRead).length);
    if (backfilled.isRead) {
      console.warn(
        `[TC-NOTSORT-014] PARTIAL — the row promoted into the window (${backfilled.id}) had already been read by this ` +
          `actor, so the counter-intuitive "badge rises on a dismissal" arm of AC-005 was not exercised on ${BASE}.`,
      );
    } else {
      expect(backfilled.isRead, "the promoted row must arrive with its own per-user state, not the dismissed row's").toBe(false);
      expect(
        del.data.data.unreadCount,
        "an unread row entered the window behind a read dismissal — the badge must RISE by one (AC-005)",
      ).toBe(mixed.unreadCount + 1);
    }
  });

  liveOnly("TC-NOTSTATE-017 — A notification for a deleted contract or event stays listed and stays dismissible", async () => {
    guard();
    const before = await panelOf(po.token);
    // "Unresolvable" is the observable form of "the referenced record was deleted": the same token
    // that was shown the row cannot fetch the record it points at.
    const unresolvable: Notification[] = [];
    for (const row of before.notifications) {
      if ((await resolveReference(row, po.token)) !== 200) unresolvable.push(row);
    }
    if (
      !capable(
        unresolvable.length > 0,
        "TC-NOTSTATE-017",
        "every visible row's referenced contract or sourcing event still resolves for this token, so no notification " +
          "points at a deleted record (the owning modules offer no delete lever inside this suite)",
      )
    ) {
      return;
    }

    const target = unresolvable[0] as Notification;
    const others = unresolvable.slice(1).map((n) => n.id);
    // Expected results 1 and 3 — deleting the referenced record removes nothing and hides nothing.
    expect(before.notifications.some((n) => n.id === target.id)).toBe(true);
    expect(Object.keys(target).sort()).toEqual([...NOTIFICATION_KEYS]);
    expect(target.message.length, "the message must keep naming the deleted record").toBeGreaterThan(0);
    const again = await panelOf(po.token);
    expect(again.notifications.find((n) => n.id === target.id), "a row pointing at a deleted record was hidden").toEqual(target);
    expect(again.totalUndismissed).toBe(before.totalUndismissed);
    // The `isRecordAvailable: false` half is deviation D-2 and is owned by TC-NOTAPI-013 and
    // TC-NOTSEC-006; per the manual's notes this case owns listing and dismissibility only.

    // Expected results 4 and 5 — it is still dismissible: 200 with the full panel envelope, no 404,
    // no 500, and the OTHER deleted-record notifications stay listed.
    const del = await notifications.dismiss<{ success: boolean; data: PanelData }>(target.id, po.token);
    expect(del.status, `dismissing a row whose record is gone returned ${del.status}`).toBe(200);
    expect(del.data.success).toBe(true);
    expect(Object.keys(del.data.data).sort()).toEqual([...PANEL_KEYS]);
    expect(del.data.data.notifications.some((n) => n.id === target.id)).toBe(false);
    expect(del.data.data.totalUndismissed).toBe(before.totalUndismissed - 1);
    for (const id of others) {
      expect(
        del.data.data.notifications.some((n) => n.id === id),
        `dismissing one deleted-record notification removed another (${id})`,
      ).toBe(true);
    }
  });

  // ── Clear-all: gated. These cases empty the DISPOSABLE actor's panel permanently. ──
  if (ALLOW_DESTRUCTIVE) {
    liveOnly(CLEAR_ALL_TITLES.api024, async () => {
      guard();
      const ev = await clearAllPass("TC-NOTAPI-024");
      if (!ev) return;
      // Step 1 precondition — the pass only runs against a non-empty panel.
      expect(ev.before.totalUndismissed).toBeGreaterThan(0);

      // Expected results 1–4 — 200, and the body is the panel payload zeroed out, not a bare ack.
      expect(ev.cleared.status).toBe(200);
      expect(ev.cleared.body.success).toBe(true);
      const data = (ev.cleared.body.data ?? {}) as PanelData;
      expect(Object.keys(data).sort(), "endpoint #4 must return the full panel shape").toEqual([...PANEL_KEYS]);
      expect(data.notifications).toEqual([]);
      expect(data.unreadCount).toBe(0);
      expect(data.totalUndismissed).toBe(0);

      // Expected result 5 — the follow-up GET renders the same empty state (EC-02).
      expect(ev.after.status).toBe(200);
      expect(ev.after.data).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });

      // Expected result 6 — clearing an already-empty panel is not an error. The spec is silent on
      // the code (Q-B6); the manual states 200 with the same zeroed body, and that is asserted here.
      expect(ev.repeat.status, "a second clear-all on an empty panel must not error").toBe(200);
      expect(ev.repeat.data).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
    });

    liveOnly(CLEAR_ALL_TITLES.api025, async () => {
      guard();
      const ev = await clearAllPass("TC-NOTAPI-025");
      if (!ev) return;
      if (
        !capable(
          ev.controlBefore.notifications.length > 0,
          "TC-NOTAPI-025",
          "the control actor's own panel is empty, so 'every other user's panel is untouched' would be vacuous",
        )
      ) {
        return;
      }
      expect(ev.cleared.status).toBe(200);

      // Expected result 1 — the caller is empty.
      expect(ev.after.data.totalUndismissed).toBe(0);
      // Expected results 2 and 3 — the control's three recorded values are identical, and every id
      // it saw is still there with an unchanged read state.
      expect(ev.controlAfter.notifications.map((n) => n.id), "the clear-all changed another user's panel").toEqual(
        ev.controlBefore.notifications.map((n) => n.id),
      );
      expect(ev.controlAfter.unreadCount, "the clear-all moved another user's badge").toBe(ev.controlBefore.unreadCount);
      expect(ev.controlAfter.totalUndismissed).toBe(ev.controlBefore.totalUndismissed);
      for (const row of ev.controlBefore.notifications) {
        const twin = ev.controlAfter.notifications.find((n) => n.id === row.id);
        expect(twin, `row ${row.id} vanished from the control's panel`).toBeTruthy();
        expect(twin?.isRead, `row ${row.id} read state changed for the control`).toBe(row.isRead);
        expect(twin?.message).toBe(row.message);
      }
      // Expected result 4 — clear-all writes user_notification_states only; it does not delete the
      // notification rows, so ids the cleared actor lost are still visible to the control.
      const shared = ev.before.notifications.filter((n) => ev.controlBefore.notifications.some((c) => c.id === n.id));
      for (const row of shared) {
        expect(
          ev.controlAfter.notifications.some((n) => n.id === row.id),
          `clear-all hard-deleted notification ${row.id} instead of dismissing it per user`,
        ).toBe(true);
      }
    });

    liveOnly(CLEAR_ALL_TITLES.state011, async () => {
      guard();
      const ev = await clearAllPass("TC-NOTSTATE-011");
      if (!ev) return;
      expect(ev.before.totalUndismissed, "step 1 requires totalUndismissed > 0").toBeGreaterThan(0);

      // Expected results 1 and 2 — the clear-all body and the follow-up GET are both the zeroed panel.
      expect(ev.cleared.status).toBe(200);
      expect(ev.cleared.body.success).toBe(true);
      expect(ev.cleared.body.data).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
      expect(ev.after.data).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
      // Expected result 3 — no id from step 1 appears anywhere in the step 4 response.
      const serialised = JSON.stringify(ev.after.data);
      for (const row of ev.before.notifications) expect(serialised).not.toContain(row.id);
    });

    liveOnly(CLEAR_ALL_TITLES.state012, async () => {
      guard();
      const ev = await clearAllPass("TC-NOTSTATE-012");
      if (!ev) return;
      const hidden = ev.mixed.totalUndismissed - ev.mixed.notifications.length;
      if (
        !capable(
          ev.mixed.totalUndismissed > WINDOW,
          "TC-NOTSTATE-012",
          `the actor held ${ev.mixed.totalUndismissed} undismissed notification(s) — nothing was behind the ` +
            `${WINDOW}-item window, so a clear-all could not have missed a hidden row`,
        )
      ) {
        return;
      }

      // Step 1 — 20 visible, the rest hidden.
      expect(ev.mixed.notifications.length).toBe(WINDOW);
      expect(hidden, "the fixture must hold rows behind the window for this case to discriminate").toBeGreaterThan(0);

      // Expected results 1 and 2 — totalUndismissed is 0, NOT `hidden`. A build that dismissed only
      // the 20 rows on the current page would leave `hidden` undismissed and backfill the window.
      expect(ev.cleared.status).toBe(200);
      expect((ev.cleared.body.data as PanelData).totalUndismissed).toBe(0);
      expect(
        ev.after.data.totalUndismissed,
        `${hidden} row(s) were hidden behind the window and survived clear-all — endpoint #4 dismissed the visible page only`,
      ).toBe(0);
      expect(ev.after.data.notifications, "the emptied window backfilled from rows that should have been dismissed").toEqual([]);

      // Expected result 3 — the panel does not repopulate on any subsequent GET.
      const later = await panelOf(ev.actor.token);
      expect(later).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
    });

    liveOnly(CLEAR_ALL_TITLES.state013, async () => {
      guard();
      const ev = await clearAllPass("TC-NOTSTATE-013");
      if (!ev) return;
      const hadRead = ev.mixed.notifications.some((n) => n.isRead);
      const hadUnread = ev.mixed.notifications.some((n) => !n.isRead);
      if (
        !capable(
          hadRead && hadUnread,
          "TC-NOTSTATE-013",
          `the actor's panel could not be brought to a read/unread mix (read: ${hadRead}, unread: ${hadUnread}), so only ` +
            "one arm of the ON CONFLICT upsert in §3.2 Endpoint #4 step 2 would be exercised",
        )
      ) {
        return;
      }
      // Step 1/2 — one row carries a state row to UPDATE, the rest need one INSERTed.
      expect(ev.markedReadId, "no row was marked read before the clear-all").toBeTruthy();
      expect(ev.mixed.notifications.find((n) => n.id === ev.markedReadId)?.isRead).toBe(true);

      // Expected results 1–4 — neither prior state saves a row: both arms end up dismissed.
      expect(ev.cleared.status).toBe(200);
      expect((ev.cleared.body.data as PanelData).notifications, "a previously read row survived clear-all").toEqual([]);
      expect((ev.cleared.body.data as PanelData).totalUndismissed).toBe(0);
      expect((ev.cleared.body.data as PanelData).unreadCount).toBe(0);
      expect(ev.after.data.notifications).toEqual([]);
      expect(ev.after.data.totalUndismissed, `${ev.mixed.totalUndismissed} row(s) were undismissed before the clear-all`).toBe(0);
    });

    liveOnly(CLEAR_ALL_TITLES.state014, async () => {
      guard();
      const ev = await clearAllPass("TC-NOTSTATE-014");
      if (!ev) return;
      if (
        !capable(
          ev.controlBefore.notifications.length > 0,
          "TC-NOTSTATE-014",
          "the control actor's panel is empty, so 'nobody else's panel or badge changed' would be vacuous",
        )
      ) {
        return;
      }

      // Expected results 2 and 3 — the control's panel is deep-equal, ids, order, isRead and all.
      expect(ev.cleared.status).toBe(200);
      expect(ev.controlAfter.notifications, "another user's panel changed when this actor cleared theirs").toEqual(
        ev.controlBefore.notifications,
      );
      expect(ev.controlAfter.unreadCount).toBe(ev.controlBefore.unreadCount);
      expect(ev.controlAfter.totalUndismissed).toBe(ev.controlBefore.totalUndismissed);

      // Expected result 4 — the two users' states diverged cleanly: one panel empty, the other intact.
      // This is the strongest available evidence that clear-all never touches the notifications table.
      expect(ev.after.data.notifications).toEqual([]);
      expect(ev.controlAfter.notifications.length).toBeGreaterThan(0);
    });

    liveOnly(CLEAR_ALL_TITLES.sort016, async () => {
      guard();
      // Run after the clear-all pass so the "nothing is hidden" precondition is reachable at all:
      // the disposable actor holds far more than 20 rows before it, and dismissing them one by one
      // to get under the window would take thousands of irreversible calls.
      const ev = await clearAllPass("TC-NOTSORT-016");
      if (!ev) return;
      let panel = await panelOf(ev.actor.token);

      if (panel.totalUndismissed === 0) {
        // EC-02 — nothing is hidden because nothing remains: the empty state is reachable
        // immediately and no row is promoted into the emptied window on any later read.
        expect(panel).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
        expect(await panelOf(ev.actor.token)).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
        console.warn(
          `[TC-NOTSORT-016] PARTIAL — the actor's panel is empty after the clear-all, so the no-backfill invariant is ` +
            `asserted over the empty window only; the row-by-row dismiss arm needs a fixture of fewer than ${WINDOW} ` +
            `undismissed rows (base ${BASE}).`,
        );
        return;
      }

      if (
        !capable(
          panel.notifications.length < WINDOW,
          "TC-NOTSORT-016",
          `the actor still holds ${panel.totalUndismissed} undismissed notification(s) with rows behind the ` +
            `${WINDOW}-item window, so a dismissal legitimately backfills — the negative arm needs fewer than ${WINDOW}`,
        )
      ) {
        return;
      }

      expect(panel.notifications.length).toBe(Math.min(panel.totalUndismissed, WINDOW));
      while (panel.notifications.length > 0) {
        const n = panel.notifications.length;
        const survivors = panel.notifications.slice(1).map((r) => r.id);
        const del = await notifications.dismiss<{ data: PanelData }>(
          (panel.notifications[0] as Notification).id,
          ev.actor.token,
        );
        expect(del.status).toBe(200);
        expect(del.data.data.notifications.length, "a hidden row was promoted although nothing was hidden").toBe(n - 1);
        expect(del.data.data.totalUndismissed).toBe(n - 1);
        expect(del.data.data.notifications.map((r) => r.id), "the survivors were re-shuffled").toEqual(survivors);
        panel = del.data.data;
      }

      // EC-02: the empty state is reachable immediately, not after a refresh.
      expect(panel).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
      expect(await panelOf(ev.actor.token)).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
    });
  } else {
    deferred(CLEAR_ALL_TITLES.api024, () => {});
    deferred(CLEAR_ALL_TITLES.api025, () => {});
    deferred(CLEAR_ALL_TITLES.state011, () => {});
    deferred(CLEAR_ALL_TITLES.state012, () => {});
    deferred(CLEAR_ALL_TITLES.state013, () => {});
    deferred(CLEAR_ALL_TITLES.state014, () => {});
    deferred(CLEAR_ALL_TITLES.sort016, () => {});
  }
});
