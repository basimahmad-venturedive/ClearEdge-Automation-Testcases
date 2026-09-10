/**
 * Seeds `automation/frontend/portal-fixture.json` from live QA invitations.
 *
 * WHY THIS EXISTS. The whole FEAT-008 vendor-portal suite (52 Playwright cases) has been
 * skipping since 2026-08-31 on "no seedable portal_token", and CLRE-334 has been blocked on
 * it. A token IS obtainable through the authenticated API after all:
 * `GET /sourcing-events/:id/proposals` returns `portalToken` on every proposal row. This
 * script harvests those, resolves each through the PUBLIC portal endpoint, and writes the
 * per-state fixture that `tests/vendor-portal.spec.ts` reads.
 *
 * The fixture shape is dictated by that spec: `{ states: Record<string, PortalEntry>,
 * invitedPool: PortalEntry[] }`, where each entry carries the token plus the live data the
 * assertions interpolate. States are classified from what each token actually resolves to,
 * never assumed:
 *   invited       — isBlocked false, proposal.status "invited"   (the response-form cases)
 *   submitted     — isBlocked false, proposal.status "submitted" (withdraw-modal cases)
 *   awarded       — proposal.awarded true
 *   rfq           — an RFQ event, for the sparse visibleSections case
 *   eventDeleted  — isBlocked true (any blockedReason renders the same closed UI, AC-02.3)
 *   deadlinePassed— left with token null: it needs a DB backdate, which cannot be done
 *                   through the API. The spec expects null here and fails those cases loudly
 *                   rather than skipping, which is the intended behaviour.
 *
 * IT MINTS RATHER THAN ONLY HARVESTS. Every pre-existing QA invitation resolves BLOCKED
 * (measured 2026-09-08: 44 vendor_deleted, 16 deadline_passed), so a clean `invited` token
 * cannot be found — it has to be created. This invites a fresh vendor to an active event
 * whose deadline is still in the future, which yields isBlocked:false / status:"invited".
 * `submitted` is then produced by submitting through the PUBLIC portal endpoint with one of
 * those minted tokens, since every harvested submitted proposal is blocked too.
 *
 * Tokens are live invitation secrets for a QA tenant. The output file is test data for QA
 * only; treat it like the other .env-adjacent fixtures and do not publish it.
 *
 *   TEST_ENV=qa npx tsx scripts/seed-portal-fixture.ts
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dir, `../envs/.env.${(process.env.TEST_ENV || "local").trim().toLowerCase()}`), override: true });
import fs from "node:fs";
import { SourcingClient } from "../src/clients/sourcingClient";
import { PortalClient } from "../src/clients/portalClient";
import { getTenantIdToken } from "../src/utils/tokenProvider";

const sourcing = new SourcingClient();
const portal = new PortalClient();
const OUT = path.resolve(__dir, "../../frontend/portal-fixture.json");
const POOL_TARGET = Number(process.env.PORTAL_POOL ?? 12);

interface Entry {
  token: string | null;
  eventType: "rfp" | "rfq";
  eventTitle: string;
  deadlineMdy: string;
  vendorName: string;
  issuerName: string;
  issuerEmail: string;
  issuerCompany: string;
  proposalStatus: string;
  awarded: boolean;
  isBlocked: boolean;
  blockedReason: string | null;
  questions: Array<{ id: string; text: string }>;
}

/** "2026-09-08" -> "09/08/2026" — the spec interpolates deadlineMdy as displayed copy. */
function toMdy(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function toEntry(token: string, d: any): Entry {
  const ev = d.event ?? {};
  return {
    token,
    eventType: String(ev.type ?? "rfp").toLowerCase() === "rfq" ? "rfq" : "rfp",
    eventTitle: String(ev.title ?? ""),
    deadlineMdy: toMdy(ev.submissionDeadline),
    vendorName: String(d.vendor?.name ?? ""),
    issuerName: String(d.issuer?.name ?? ""),
    issuerEmail: String(d.issuer?.email ?? ""),
    issuerCompany: String(d.issuer?.company ?? ""),
    proposalStatus: String(d.proposal?.status ?? ""),
    awarded: Boolean(d.proposal?.awarded),
    isBlocked: Boolean(d.isBlocked),
    blockedReason: d.blockedReason ?? null,
    questions: (ev.questions ?? []).map((q: any, i: number) => ({
      id: String(q.id ?? q.questionId ?? `q${i + 1}`),
      text: String(q.text ?? q.question ?? q.label ?? ""),
    })),
  };
}

async function main() {
  const token = await getTenantIdToken();
  // PAGE the list. A single limit=50 call saw 50 of QA's ~890 events and found only 6
  // still open — which starved the pool and left states.rfq empty because no RFQ
  // happened to be in that first page.
  const events: any[] = [];
  const PAGE_SIZE = 50;   // the endpoint rejects anything larger: "limit must not be greater than 50"
  for (let page = 1; page <= 20; page += 1) {
    const res: any = await sourcing.listEvents<any>({ page, limit: PAGE_SIZE } as never, token);
    const batch: any[] = res.data?.data?.events ?? res.data?.data?.items ?? [];
    events.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  console.log(`listed ${events.length} sourcing events`);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Events that can still accept a response: active, deadline today or later. Latest
  // deadline first, so the minted invitations have the most headroom.
  const open = events
    .filter((e) => {
      const dl = e.submissionDeadline ? new Date(String(e.submissionDeadline).slice(0, 10)) : null;
      return /active/i.test(String(e.status)) && dl && dl.getTime() >= today.getTime();
    })
    .sort((a, b) => String(b.submissionDeadline).localeCompare(String(a.submissionDeadline)));
  console.log(`open events (active, deadline >= today): ${open.length}`);

  // ── Mint clean invited proposals ────────────────────────────────────────────────────
  const minted: Entry[] = [];
  /** eventId + proposalId per minted token, parallel to `minted` — needed to AWARD one. */
  const mintedRefs: Array<{ eventId: string; proposalId: string; token: string }> = [];
  const want = POOL_TARGET + 4;            // states.invited + pool + one to submit + one to award
  // Two passes. states.rfq needs an OPEN RFQ and states.invited an event of the other
  // shape, so pass 1 takes a COUPLE from RFQ events only; pass 2 fills the rest from
  // everything else. Ordering by type alone did not work in either direction: whichever
  // type came first supplied all 29 mints and the other state stayed empty.
  const isRfq = (e: any): boolean => String(e.type ?? "").toLowerCase() === "rfq";
  const RFQ_QUOTA = 2;
  const passes: Array<{ events: any[]; cap: number }> = [
    { events: open.filter(isRfq), cap: RFQ_QUOTA },
    { events: open.filter((e) => !isRfq(e)), cap: want },
  ];
  for (const pass of passes) for (const ev of pass.events) {
    if (minted.length >= pass.cap) break;
    if (minted.length >= want) break;
    const cand: any = await sourcing.getInviteVendors<any>(ev.id, token).catch(() => ({ data: {} }));
    const pool: any[] = [...(cand.data?.data?.recommended ?? []), ...(cand.data?.data?.others ?? [])]
      .filter((v: any) => v.alreadyInvited === false);
    for (const v of pool) {
      if (minted.length >= pass.cap) break;
      const inv: any = await sourcing.invite<any>(ev.id, { vendorIds: [v.id] }, token).catch(() => ({ status: 500 }));
      if (inv.status >= 400) continue;
      const props: any = await sourcing.getProposals<any>(ev.id, token).catch(() => ({ data: {} }));
      const mine = (props.data?.data?.proposals ?? []).find((p: any) => (p.vendor?.id ?? p.vendorId) === v.id);
      if (!mine?.portalToken) continue;
      const r: any = await portal.resolve<any>(mine.portalToken).catch(() => ({ status: 0, data: {} }));
      const d = r.data?.data ?? {};
      if (r.status === 200 && d.isBlocked === false && /invited/i.test(String(d.proposal?.status))) {
        minted.push(toEntry(mine.portalToken, d));
        mintedRefs.push({ eventId: ev.id, proposalId: mine.id, token: mine.portalToken });
        console.log(`  minted ${minted.length}/${want}: ${ev.displayId ?? ev.id} + ${v.name} (deadline ${d.event?.submissionDeadline})`);
      }
    }
  }
  console.log(`minted ${minted.length} clean invited invitations\n`);

  // ── Produce one clean SUBMITTED proposal, for the withdraw-modal cases ─────────────
  let submittedEntry: Entry | null = null;
  const donor = minted[minted.length - 1];   // last; minted[length-2] is awarded below
  if (donor?.token) {
    // The submit contract names the field `answerText`; an `answer` key is rejected outright
    // (400 ERR_VALIDATION_FAILED "property answer should not exist", seen 2026-09-10).
    const answers = donor.questions.map((q, i) => ({ questionId: q.id, answerText: `Automated answer ${i + 1}` }));
    const sub: any = await portal.submit<any>(donor.token, {
      price: 125000, deliveryWeeks: 6, answers,
    }).catch((e: any) => ({ status: e?.response?.status ?? "ERR", data: e?.response?.data ?? {} }));
    console.log(`submit via portal -> ${sub.status}`);
    if (sub.status < 400) {
      const r: any = await portal.resolve<any>(donor.token).catch(() => ({ status: 0, data: {} }));
      const d = r.data?.data ?? {};
      if (r.status === 200 && d.isBlocked === false && /submitted/i.test(String(d.proposal?.status))) {
        submittedEntry = toEntry(donor.token, d);
        minted.pop();                       // it is no longer an "invited" entry
        console.log(`  submitted state ready (${submittedEntry.vendorName})`);
      }
    } else {
      console.log(`  could not create a submitted state: ${JSON.stringify(sub.data).slice(0, 200)}`);
    }
  }

  // ── Produce an AWARDED proposal on a still-OPEN event ─────────────────────────────
  // Harvesting cannot supply this: every awarded proposal already in QA sits on a closed
  // or deleted event and resolves isBlocked, so TC-VPUI-049 ("awarded, event OPEN →
  // withdraw disabled, NO closed banner") could never distinguish the two causes. Award
  // is only legal on a SUBMITTED proposal (409 ERR_PROPOSAL_NOT_SUBMITTED otherwise), so
  // this submits first and awards second.
  let awardedEntry: Entry | null = null;
  const awardIdx = minted.length - 2;
  const awardRef = mintedRefs[awardIdx];
  if (awardRef) {
    const answers = minted[awardIdx]!.questions.map((q, i) => ({ questionId: q.id, answerText: `Automated answer ${i + 1}` }));
    const sub: any = await portal.submit<any>(awardRef.token, { price: 118000, deliveryWeeks: 5, answers })
      .catch((e: any) => ({ status: e?.response?.status ?? "ERR", data: e?.response?.data ?? {} }));
    if (sub.status < 400) {
      const aw: any = await sourcing.award<any>(awardRef.eventId, awardRef.proposalId, {}, token)
        .catch((e: any) => ({ status: e?.response?.status ?? "ERR", data: e?.response?.data ?? {} }));
      console.log(`award -> ${aw.status}`);
      if (aw.status < 400) {
        const r: any = await portal.resolve<any>(awardRef.token).catch(() => ({ status: 0, data: {} }));
        const d = r.data?.data ?? {};
        if (r.status === 200 && d.proposal?.awarded) {
          awardedEntry = toEntry(awardRef.token, d);
          console.log(`  awarded state ready (${awardedEntry.vendorName}, blocked=${awardedEntry.isBlocked})`);
        }
      } else {
        console.log(`  could not award: ${JSON.stringify(aw.data).slice(0, 200)}`);
      }
    } else {
      console.log(`  could not submit before awarding: ${JSON.stringify(sub.data).slice(0, 200)}`);
    }
  }

  // ── Harvest the remaining states from existing data ────────────────────────────────
  const harvested: Entry[] = [];
  for (const ev of events) {
    if (harvested.length >= 30) break;
    const props: any = await sourcing.getProposals<any>(ev.id, token).catch(() => ({ data: {} }));
    for (const p of props.data?.data?.proposals ?? []) {
      if (!p.portalToken || harvested.length >= 30) continue;
      const r: any = await portal.resolve<any>(p.portalToken).catch(() => ({ status: 0, data: {} }));
      if (r.status === 200) harvested.push(toEntry(p.portalToken, r.data?.data ?? {}));
    }
  }
  const blocked = harvested.filter((e) => e.isBlocked);
  const awarded = harvested.filter((e) => e.awarded);
  // states.invited and states.rfq must be DIFFERENT events: the RFQ exists to exercise the
  // sparse-visibleSections path, so pointing both at the same token would make TC-VPUI-013
  // assert nothing the other read-only cases do not already cover.
  const mintedRfp = minted.find((e) => e.eventType === "rfp");
  const mintedRfq = minted.find((e) => e.eventType === "rfq");
  const rfqEntry = mintedRfq ?? harvested.find((e) => e.eventType === "rfq" && !e.isBlocked);
  console.log(`harvested ${harvested.length} existing (blocked=${blocked.length}, awarded=${awarded.length})`);

  const nullEntry: Entry = {
    token: null, eventType: "rfp", eventTitle: "", deadlineMdy: "", vendorName: "",
    issuerName: "", issuerEmail: "", issuerCompany: "", proposalStatus: "", awarded: false,
    isBlocked: false, blockedReason: null, questions: [],
  };

  const fixture = {
    states: {
      invited: (rfqEntry && minted[0] === rfqEntry ? mintedRfp : minted[0]) ?? minted[0] ?? nullEntry,
      submitted: submittedEntry ?? nullEntry,
      // A freshly awarded proposal on an OPEN event beats a harvested one, which is
      // always blocked (see above); harvest stays the fallback.
      awarded: awardedEntry ?? awarded[0] ?? nullEntry,
      rfq: rfqEntry ?? nullEntry,
      eventDeleted: blocked[0] ?? nullEntry,
      deadlinePassed: nullEntry,             // needs a DB backdate; spec expects null
    },
    // Drop index 0 (states.invited) and the last two — one was submitted for
    // states.submitted, one submitted AND awarded for states.awarded. Leaving those in
    // the pool would hand a mutating case a proposal that is already submitted.
    invitedPool: minted.slice(1, -2).filter((e) => e !== rfqEntry && e !== mintedRfp),
    seededAt: new Date().toISOString(),
    seededBy: "api-ts/scripts/seed-portal-fixture.ts",
  };

  fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
  for (const [k, v] of Object.entries(fixture.states)) {
    const e = v as Entry;
    console.log(`  states.${k.padEnd(14)} token=${e.token ? `${e.token.slice(0, 8)}\u2026` : "null"} status=${e.proposalStatus || "-"} blocked=${e.isBlocked} deadline=${e.deadlineMdy || "-"} q=${e.questions.length}`);
  }
  console.log(`  invitedPool: ${fixture.invitedPool.length} entries`);
  if (!fixture.states.invited.token) console.log("\nWARNING: no clean invited token — the suite will still skip.");
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
