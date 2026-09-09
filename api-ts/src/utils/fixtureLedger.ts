/**
 * Disk-backed ledger of every record this harness creates on a live target.
 *
 * WHY THIS EXISTS. Per-suite teardown already works: measured on QA 2026-09-09, four
 * consecutive clean runs (vendorDirectory, sourcingEvents, userManagement, contracts.create)
 * each returned the tenant to its exact starting counts — 875 vendors in, 875 out. Yet the
 * tenant still grows every day (102 contracts and 69 vendors created on 2026-09-09 alone).
 *
 * The gap is runs that never finish normally. `afterAll`/`afterEach` do not run when the
 * process is killed — a CI timeout, a Ctrl-C, an OOM — and everything that run created is
 * then orphaned with no record of it anywhere. Ad-hoc probe scripts leak the same way.
 *
 * So the ledger is written to DISK as each record is created, not held in memory:
 *   - created  -> append `{entity, id, runId, at}`
 *   - deleted  -> the entry is dropped
 * A killed run therefore leaves a manifest behind, and the NEXT run drains it during
 * globalSetup (see global-setup.ts). That is what makes cleanup survive abnormal exit.
 *
 * It records only ids the harness itself created, which is the whole point: sweeping a
 * shared tenant by "fixture-looking name" is guesswork — vendor fixtures are
 * `faker.company.name()` plus five random chars and are indistinguishable from real data.
 * An id we wrote down is not a guess.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type LedgerEntity = "contract" | "vendor" | "sourcingEvent" | "tenantUser" | "tenant";

export interface LedgerEntry {
  entity: LedgerEntity;
  id: string;
  /** Parent id where deletion needs one (tenantUser lives under a tenant). */
  parentId?: string;
  runId: string;
  at: string;
}

/**
 * Locate api-ts without `__dirname` or `import.meta`.
 *
 * Vitest transpiles this module to CJS (where `__dirname` exists) but `tsx` loads it as real
 * ESM (where it does not) — and `import.meta` is a syntax error in the CJS output, so neither
 * works for both. Walking up from cwd for the marker file is the one approach that does.
 * FIXTURE_LEDGER_DIR overrides it when a caller runs from somewhere unusual.
 */
function apiTsRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "vitest.config.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const LEDGER_DIR = process.env.FIXTURE_LEDGER_DIR ?? path.join(apiTsRoot(), ".artifacts");
const LEDGER_FILE = path.join(LEDGER_DIR, "fixture-ledger.jsonl");

/** One id per process, so a drain can tell "mine" from "a previous run's leftovers". */
export const RUN_ID = process.env.FIXTURE_RUN_ID ?? randomUUID();

function ensureDir(): void {
  if (!fs.existsSync(LEDGER_DIR)) fs.mkdirSync(LEDGER_DIR, { recursive: true });
}

/**
 * Record a created record. Append-only and synchronous on purpose: an async write can be
 * lost by the very SIGKILL this ledger exists to survive.
 */
export function recordCreated(entity: LedgerEntity, id: string, parentId?: string): void {
  if (!id) return;
  try {
    ensureDir();
    const entry: LedgerEntry = { entity, id, parentId, runId: RUN_ID, at: new Date().toISOString() };
    fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* the ledger must never break a test */
  }
}

/** Drop an id once it has actually been deleted, so a drain does not retry it. */
export function recordDeleted(id: string): void {
  if (!id) return;
  try {
    if (!fs.existsSync(LEDGER_FILE)) return;
    const kept = readLedger().filter((e) => e.id !== id);
    writeLedger(kept);
  } catch {
    /* never break a test */
  }
}

export function readLedger(): LedgerEntry[] {
  try {
    if (!fs.existsSync(LEDGER_FILE)) return [];
    return fs
      .readFileSync(LEDGER_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}

export function writeLedger(entries: LedgerEntry[]): void {
  try {
    ensureDir();
    fs.writeFileSync(LEDGER_FILE, entries.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
  } catch {
    /* ignore */
  }
}

export function ledgerPath(): string {
  return LEDGER_FILE;
}
