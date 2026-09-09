/**
 * Axios interceptor that keeps the fixture ledger in step with the API, automatically.
 *
 * Wiring the ledger into each seed helper would mean touching 64 `seedSavedContract` /
 * `createVendor` / `createEvent` call sites and would still miss anything that calls a client
 * directly. Watching the HTTP layer instead catches every creation from one place, and cannot
 * drift out of date when someone adds a new test.
 *
 * Scope: the suite gets this automatically (vitest.setup.ts installs it). A standalone script
 * — `scripts/probe-*.ts` and friends, which leak exactly like a killed run — is covered only
 * if it calls installLedgerInterceptor() itself, since it never loads the vitest setup file.
 *
 * A record is registered on a 2xx CREATE and de-registered on a 2xx DELETE, so a suite whose
 * own teardown works (measured: most of them) leaves the ledger empty and the drain is a no-op.
 * Only what actually survived the run is left behind for the next run to collect.
 */
import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { recordCreated, recordDeleted, type LedgerEntity } from "./fixtureLedger";

/** URL shapes that create something worth cleaning up, in match order. */
const CREATE_ROUTES: Array<{ re: RegExp; entity: LedgerEntity; idFrom: (d: any) => string | undefined; parentFrom?: (m: RegExpMatchArray) => string }> = [
  // POST /admin/tenants/:id/users  → a user inside a tenant (delete needs the tenant id)
  {
    re: /\/admin\/tenants\/([0-9a-f-]{36})\/users\/?$/i,
    entity: "tenantUser",
    idFrom: (d) => d?.data?.id ?? d?.data?.userId,
    parentFrom: (m) => m[1] as string,
  },
  { re: /\/admin\/tenants\/?$/i, entity: "tenant", idFrom: (d) => d?.data?.id ?? d?.data?.tenant?.id },
  { re: /\/contracts\/?$/i, entity: "contract", idFrom: (d) => d?.data?.familyId },
  { re: /\/vendors\/?$/i, entity: "vendor", idFrom: (d) => d?.data?.id ?? d?.data?.vendorId },
  { re: /\/sourcing-events\/?$/i, entity: "sourcingEvent", idFrom: (d) => d?.data?.id ?? d?.data?.eventId },
  // POST /users on the tenant app — the tenant id is not in the URL; the drain resolves it.
  { re: /\/v1\/users\/?$/i, entity: "tenantUser", idFrom: (d) => d?.data?.id ?? d?.data?.userId },
];

/** DELETE shapes: the trailing UUID is the thing that just went away. */
const DELETE_ID_RE = /\/([0-9a-f-]{36})\/?$/i;

let installed = false;

/** Apply the ledger interceptor to one axios instance (or the global default). */
function attach(target: { interceptors: AxiosInstance["interceptors"] }): void {
  target.interceptors.response.use(
    (res: AxiosResponse) => {
      try {
        const method = String(res.config?.method ?? "").toUpperCase();
        const url = String(res.config?.url ?? "");
        const ok = res.status >= 200 && res.status < 300;
        if (!ok) return res;

        if (method === "POST") {
          // Strip the query string so `?foo=` cannot defeat the end-anchored patterns.
          const pathOnly = url.split("?")[0] ?? "";
          for (const route of CREATE_ROUTES) {
            const m = pathOnly.match(route.re);
            if (!m) continue;
            const id = route.idFrom(res.data);
            if (id) recordCreated(route.entity, id, route.parentFrom?.(m));
            break;
          }
        } else if (method === "DELETE") {
          const m = (url.split("?")[0] ?? "").match(DELETE_ID_RE);
          if (m?.[1]) recordDeleted(m[1]);
        }
      } catch {
        /* the ledger must never break a request */
      }
      return res;
    },
    (err: unknown) => Promise.reject(err),
  );
}

export function installLedgerInterceptor(): void {
  if (installed) return;
  installed = true;

  // The global default covers clients that call `axios.get/post` directly.
  attach(axios);

  // …but several clients hold their own `axios.create({ timeout })` instance, and an
  // interceptor on the default is NOT inherited by a created one — which is exactly why the
  // first version of this recorded nothing for the vendor suite. Patch the factory so every
  // instance is covered, including clients added later that nobody remembers to wire up.
  const originalCreate = axios.create.bind(axios);
  (axios as unknown as { create: typeof axios.create }).create = ((config?: unknown) => {
    const instance = originalCreate(config as never);
    attach(instance);
    return instance;
  }) as typeof axios.create;
}
