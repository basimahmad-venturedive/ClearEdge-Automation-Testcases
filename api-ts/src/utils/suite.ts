import { test as vitestTest } from "vitest";
import { isLiveEnv, hasDbAccess } from "../config/env";

/**
 * Suite runners with suite-scoped collection control.
 *
 * Every case is declared through one of these instead of Vitest's `test`, so the
 * runner decides — at registration time — whether to REGISTER, SKIP, or DROP it:
 *
 *   - `test`      runs on every environment (data-independent / non-mutating).
 *   - `localOnly` runs on the local Docker backend only (Postgres + JWKS mock).
 *   - `dbOnly`    runs locally AND needs a direct DB connection (TEST_DATABASE_URL).
 *   - `liveOnly`  runs on the dev/live target only (real Cognito/CloudFront).
 *   - `deferred`  never runs (blocked / not yet automatable).
 *
 * Modes (set only by the npm scripts):
 *   - default            a case that can't run in this env registers as `test.skip`
 *                        (visible skip → local/CI traceability parity).
 *   - REGRESSION_ONLY=1  those un-runnable cases are DROPPED (never registered), so a
 *                        regression run reports zero skipped.
 *   - SMOKE_ONLY=1       additionally, any case whose title lacks `@smoke` is DROPPED,
 *                        so a smoke run collects only the smoke set — zero skipped.
 */
type Runner = (name: string, fn?: unknown, timeout?: number) => void;

const REG_ONLY = process.env.REGRESSION_ONLY === "1";
const SMOKE_ONLY = process.env.SMOKE_ONLY === "1";
const isSmoke = (name: string): boolean => /@smoke\b/.test(name);

const run = vitestTest as unknown as Runner;
const skip = vitestTest.skip as unknown as Runner;

/** Build a runner for cases that run in this env iff `runsHere`. */
function make(runsHere: boolean): Runner {
  return (name, fn, timeout) => {
    if (SMOKE_ONLY && !isSmoke(name)) return; // smoke run: only @smoke cases are collected
    if (runsHere) return void run(name, fn as never, timeout);
    if (REG_ONLY || SMOKE_ONLY) return; // suite run: drop un-runnable cases (no skip noise)
    return void skip(name, fn as never, timeout); // normal run: keep as a visible skip
  };
}

export const test: Runner = make(true);
export const localOnly: Runner = make(!isLiveEnv());
export const dbOnly: Runner = make(hasDbAccess() && !isLiveEnv());
export const liveOnly: Runner = make(isLiveEnv());
export const deferred: Runner = make(false);
