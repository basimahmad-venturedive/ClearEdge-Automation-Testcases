/**
 * CEIQ-FEAT-010 Contract Q&A Chat — API client.
 *
 * Two endpoints (Tech §3.2):
 *   GET  /chat/contracts  → JSON list for the scope picker
 *   POST /chat/message    → text/event-stream (SSE) OR a JSON error envelope
 *
 * The POST is buffered rather than incrementally read: `responseType: "text"` collects
 * the whole stream, then `parseSse` splits it into typed events. Buffering is the right
 * trade-off for assertions about the *event set and its order* (which is what every
 * TC-CHATSTR case checks); it deliberately cannot observe inter-event **timing**, so the
 * keep-alive cadence case (TC-CHATSTR-003) stays MANUAL-ONLY rather than pretending to
 * cover it here.
 *
 * Comment frames (`: keep-alive`) are counted, not discarded, so a future timing-aware
 * reader can be dropped in without changing the assertions.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

export type SseEventType = "session" | "token" | "citation" | "references" | "done" | "error";

export interface SseEvent {
  type: SseEventType | string;
  [k: string]: unknown;
}

export interface ChatStream {
  status: number;
  contentType: string;
  /** true when the server opened an SSE stream (as opposed to returning a JSON error). */
  isStream: boolean;
  /** Parsed JSON body — only populated when `isStream` is false. */
  json: any;
  /** Every parsed event, in arrival order. */
  events: SseEvent[];
  /** Event-type → count, including the synthetic `keepalive` bucket for comment frames. */
  counts: Record<string, number>;
  /** Concatenated `token` text — the assistant's full reply. */
  text: string;
  /** `sessionId` from the `session` event, or null when none was emitted. */
  sessionId: string | null;
  /** Wall-clock milliseconds for the whole request. */
  elapsedMs: number;
  raw: string;
}

export interface SendMessageBody {
  message?: unknown;
  scopeType?: unknown;
  familyId?: unknown;
  sessionId?: unknown;
}

const ENDPOINT_CONTRACTS = "/chat/contracts";
const ENDPOINT_MESSAGE = "/chat/message";

/** Split a buffered SSE body into typed events. Tolerates comment frames and junk. */
export function parseSse(body: string): {
  events: SseEvent[];
  counts: Record<string, number>;
  text: string;
  sessionId: string | null;
} {
  const events: SseEvent[] = [];
  const counts: Record<string, number> = {};
  let text = "";
  let sessionId: string | null = null;

  for (const chunk of body.split("\n\n")) {
    const frame = chunk.trim();
    if (!frame) continue;
    if (frame.startsWith(":")) {
      counts.keepalive = (counts.keepalive ?? 0) + 1;
      continue;
    }
    const payload = frame.replace(/^data:\s*/, "");
    let parsed: SseEvent;
    try {
      parsed = JSON.parse(payload) as SseEvent;
    } catch {
      counts.unparsed = (counts.unparsed ?? 0) + 1;
      continue;
    }
    events.push(parsed);
    const t = String(parsed.type);
    counts[t] = (counts[t] ?? 0) + 1;
    if (t === "token") text += String(parsed.text ?? "");
    if (t === "session" && typeof parsed.sessionId === "string") sessionId = parsed.sessionId;
  }
  return { events, counts, text, sessionId };
}

/**
 * A gateway 502/503/504 carrying an HTML body is the load balancer talking, not the API —
 * this service never returns HTML. Those are retried (bounded, with backoff) so an
 * infrastructure blip cannot masquerade as a product failure in the report. Everything
 * else, including every JSON error envelope and every 5xx from the app itself, is
 * returned untouched: masking a real server error would be far worse than a slow run.
 *
 * Each retry is announced on stderr so the run log shows the instability rather than
 * hiding it — QA flapped repeatedly during the 2026-08-28 execution (see TC file §8).
 */
const GATEWAY_STATUSES = new Set([502, 503, 504]);
const GATEWAY_ATTEMPTS = 4;
const GATEWAY_BACKOFF_MS = 3_000;

function isGatewayBlip(status: number, contentType: string): boolean {
  return GATEWAY_STATUSES.has(status) && !/json|event-stream/i.test(contentType);
}

let gatewayRetries = 0;
/** Total gateway retries performed this run — surfaced in the execution notes. */
export const gatewayRetryCount = (): number => gatewayRetries;

/**
 * Thrown transport failures worth replaying. `installNetworkRetry` covers these for
 * idempotent methods only, and deliberately will not replay a POST. Here a POST replay is
 * safe in test terms — the worst case is an extra append-only `chat_sessions` row — and the
 * alternative is far worse: an ECONNRESET inside `beforeAll` throws, and Vitest then reports
 * all 118 cases as SKIPPED. A skipped case reads as coverage that does not exist, so one
 * dropped socket must not be allowed to delete the entire suite's result. That happened on
 * the 2026-08-31 QA runs.
 */
const TRANSPORT_ERROR = /ECONNRESET|ETIMEDOUT|ECONNABORTED|EPIPE|socket hang up|socket disconnected|Network Error|aborted/i;

async function withGatewayRetry<T extends { status: number }>(
  label: string,
  attempt: (n: number) => Promise<T>,
  contentTypeOf: (r: T) => string,
): Promise<T> {
  let last!: T;
  for (let n = 1; n <= GATEWAY_ATTEMPTS; n++) {
    try {
      last = await attempt(n);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      const code = String((e as { code?: string })?.code ?? "");
      if (!TRANSPORT_ERROR.test(msg) && !TRANSPORT_ERROR.test(code)) throw e;
      if (n === GATEWAY_ATTEMPTS) throw e;
      gatewayRetries += 1;
      process.stderr.write(`[chat] transport ${code || msg} on ${label} - retry ${n}/${GATEWAY_ATTEMPTS - 1}
`);
      await new Promise((r) => setTimeout(r, GATEWAY_BACKOFF_MS * n));
      continue;
    }
    if (!isGatewayBlip(last.status, contentTypeOf(last))) return last;
    if (n === GATEWAY_ATTEMPTS) break;
    gatewayRetries += 1;
    process.stderr.write(`[chat] gateway ${last.status} on ${label} — retry ${n}/${GATEWAY_ATTEMPTS - 1}
`);
    await new Promise((r) => setTimeout(r, GATEWAY_BACKOFF_MS * n));
  }
  return last;
}

export class ChatClient {
  /**
   * Resolved lazily, not in a field initializer: the singleton below is constructed at
   * import time, which for a standalone script is before its `dotenv.config()` has run.
   * An eager `apiBaseUrl()` therefore threw "API_BASE_URL is not set" on import.
   */
  private get base(): string {
    return apiBaseUrl();
  }

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token !== undefined) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /** GET /chat/contracts — scope-picker list. */
  async contracts<T = any>(token?: string): Promise<AxiosResponse<T>> {
    return withGatewayRetry(
      "GET /chat/contracts",
      () =>
        axios.get<T>(`${this.base}${ENDPOINT_CONTRACTS}`, {
          headers: this.headers(token),
          validateStatus: () => true,
        } as never),
      (r) => String(r.headers?.["content-type"] ?? ""),
    );
  }

  /** GET /chat/contracts with a raw query string appended (unknown-param handling). */
  async contractsRaw<T = any>(token: string, rawQuery: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${ENDPOINT_CONTRACTS}?${rawQuery}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    } as never);
  }

  /** Arbitrary GET under /chat — used to assert that restore/history endpoints do NOT exist. */
  async rawGet<T = any>(token: string, path: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${path}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    } as never);
  }

  /**
   * POST /chat/message. Returns a normalised {@link ChatStream} for both outcomes —
   * an SSE stream and a JSON error envelope — so a caller never has to branch on
   * content-type before asserting a status code.
   */
  async send(body: SendMessageBody, token?: string, timeoutMs = 150_000): Promise<ChatStream> {
    const started = Date.now();
    const res: AxiosResponse<any> = await withGatewayRetry(
      "POST /chat/message",
      () =>
        axios.post(`${this.base}${ENDPOINT_MESSAGE}`, body, {
          headers: this.headers(token),
          validateStatus: () => true,
          timeout: timeoutMs,
          responseType: "text",
        } as never),
      (r) => String((r as AxiosResponse).headers?.["content-type"] ?? ""),
    );
    const elapsedMs = Date.now() - started;
    const contentType = String(res.headers?.["content-type"] ?? "");
    const isStream = contentType.includes("text/event-stream");
    const raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");

    if (!isStream) {
      let json: any = res.data;
      if (typeof json === "string") {
        try {
          json = JSON.parse(json);
        } catch {
          /* leave as text — a non-JSON, non-SSE body is itself a finding */
        }
      }
      return {
        status: res.status, contentType, isStream: false, json,
        events: [], counts: {}, text: "", sessionId: null, elapsedMs, raw,
      };
    }

    const { events, counts, text, sessionId } = parseSse(raw);
    return {
      status: res.status, contentType, isStream: true, json: undefined,
      events, counts, text, sessionId, elapsedMs, raw,
    };
  }

  /** Convenience: send and require an accepted stream, returning it. */
  async sendOk(body: SendMessageBody, token: string, timeoutMs?: number): Promise<ChatStream> {
    const s = await this.send(body, token, timeoutMs);
    if (!s.isStream || s.status !== 200) {
      throw new Error(
        `expected an SSE stream, got ${s.status} ${s.contentType}: ${JSON.stringify(s.json).slice(0, 300)}`,
      );
    }
    return s;
  }
}

export const chatClient = new ChatClient();

// ---------------------------------------------------------------------------
// Assertion helpers shared across the chat suite
// ---------------------------------------------------------------------------

/** Ordered list of event types, for sequence assertions. */
export const typeSequence = (s: ChatStream): string[] => s.events.map((e) => String(e.type));

/** Index of the last `token` event, or -1. */
export const lastTokenIndex = (s: ChatStream): number =>
  typeSequence(s).lastIndexOf("token");

/** Index of the first event of a given type, or -1. */
export const firstIndexOf = (s: ChatStream, type: string): number =>
  typeSequence(s).indexOf(type);

/** Distinct `[Cn]` marker indices used in the reply text, ascending. */
export function contractMarkers(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\[C(\d+)\]/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** Distinct bare `[n]` source-marker indices (excluding `[Cn]`), ascending. */
export function sourceMarkers(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** The mandated fixed copy from the spec, asserted by containment (see TC file §0). */
export const COPY = {
  /** AC-16 — nothing found. */
  declineNoData:
    "I couldn't find anything in your contracts that answers this. Try rephrasing, or check the Contracts tab directly.",
  /** AC-17 — sourcing / vendors redirect. */
  declineOtherModule:
    "I'm focused on contract-related questions — clauses, risks, renewals, and payment terms. For sourcing events or vendor details, check the Sourcing or Vendors tab.",
  /** AC-17 — entirely unrelated. */
  declineOffTopic:
    "I'm ClearEdgeIQ Agent, and I can only help with questions about your contracts. Try asking about clauses, risks, renewals, or payment terms.",
  /** AC-15 / §8.1 — named contract while in General scope. */
  deflectToScopePicker:
    "To ask about a specific contract, please select it from the scope control below.",
  /** AC-15 / §8.2 — portfolio question while contract-scoped. */
  deflectToGeneral:
    "That's a portfolio-wide question. Please switch to 'General questions' using the scope control below, and I can help with that there.",
  /** §4.1 step 5 / §8.5 — tool round-trip guard fallback. */
  toolGuardFallback:
    "I wasn't able to find that information. Try rephrasing your question.",
  /** §3.2 / §4.2 — user-facing stream failure. */
  streamError: "Something went wrong. Please try again.",
} as const;

/** Case-insensitive, whitespace-normalised containment — resilient to markdown emphasis. */
export function containsCopy(haystack: string, needle: string): boolean {
  const norm = (s: string) =>
    s.replace(/[*_`]/g, "").replace(/\s+/g, " ").replace(/[‘’]/g, "'").trim().toLowerCase();
  return norm(haystack).includes(norm(needle));
}

/**
 * True when the reply looks like a truncated pre-tool preamble (BUG-CHAT-002's signature:
 * the model announces a tool call, the loop guard fires, and the announcement is published
 * as the whole answer).
 *
 * The tell is a **dangling** ending — a trailing colon, or a very short fragment with no
 * sentence-terminating punctuation. Length alone is NOT a signal: "No contracts are
 * expiring in the next 30 days." is 46 characters and a perfectly complete answer. An
 * earlier version of this helper used a bare `length < 80` floor and failed
 * TC-CHATCONV-029 on exactly that reply — a false positive that would have been reported
 * as a product defect.
 */
export function looksTruncated(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  // A lead-in with nothing after it is the clearest truncation signal.
  if (t.endsWith(":")) return true;
  if (/[.!?)\]"']$/.test(t)) return false;
  // A LIST-form answer legitimately ends without sentence punctuation, e.g.
  //   "**1 contract** expires in the next 30 days:
  //    - CON-1263-001 - expires in **3 days**, $50,000 total value"
  // That is complete prose in this product's answer style, and treating it as truncated
  // produced a false failure on TC-CHATCONV-029 (2026-09-06) against a correct answer.
  const lastLine = (t.split(/\n/).pop() ?? "").trim();
  if (/^([-*\u2022]|\d+[.)])\s+/.test(lastLine)) return false;
  // Otherwise, only a SHORT unpunctuated tail suggests the stream stopped mid-thought.
  return t.length < 120;
}
