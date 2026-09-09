/**
 * Zod response schemas for CEIQ-FEAT-012 (Notification Centre), per spec Tech §3.2.
 *
 * STRICT on everything the spec defines and permissive only about the platform-wide
 * additive envelope keys (`message`, `meta`) that FOUND-001 puts on every response.
 *
 * Where the spec names an exact format the schema encodes that format rather than
 * accepting any string — `event_date` is a plain `date` column (Tech §2.1) and §3.2
 * samples it as `"2026-09-15"`, so `eventDate` is pinned to `YYYY-MM-DD`. Dev currently
 * returns `"2026-09-04T00:00:00.000Z"` (deviation D-1 / CLRE-388); the strict schema is
 * what makes that visible, and `panelDataLooseSchema` exists so the cases that are about
 * something else do not all fail for the same single reason.
 */
import { z } from "zod";

/** The spec form for `eventDate` — a bare CT calendar day, ten characters. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The date form embedded in every BR-03 message body. */
export const MMDDYYYY_CT = /\b\d{2}\/\d{2}\/\d{4} CT\b/;

/** BR-02: exactly one label per row, drawn from this closed set. */
export const RELATIVE_LABEL = /^(Today|Tomorrow|Yesterday|In \d+ days?|\d+ days? ago)$/;

/** BR-03 kind 7 — `{vendorName} submitted a proposal for {eventTitle} on MM/DD/YYYY CT`. */
export const KIND_7_MESSAGE = /^.+ submitted a proposal for .+ on \d{2}\/\d{2}\/\d{4} CT$/;
/** BR-03 kind 8 — `{vendorName} withdrew their proposal for {eventTitle} on MM/DD/YYYY CT`. */
export const KIND_8_MESSAGE = /^.+ withdrew their proposal for .+ on \d{2}\/\d{2}\/\d{4} CT$/;

const uuid = z.string().uuid();
const isoDate = z.string().regex(ISO_DATE, "must be a bare YYYY-MM-DD CT calendar date");
const nonEmpty = z.string().min(1);
const countInt = z.number().int().nonnegative();

/** F1 success envelope — `message` and `meta` are platform-wide additive keys. */
export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      success: z.literal(true),
      data,
    })
    .passthrough();

/** F1 error envelope — `{ success: false, error: { code, message, details? } }`. */
export const errorEnvelope = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: nonEmpty,
        message: nonEmpty,
      })
      .passthrough(),
  })
  .passthrough();

export const notificationKindSchema = z.number().int().min(1).max(8);
export const referenceTypeSchema = z.enum(["contract", "sourcing_event"]);
export const destinationTabSchema = z.enum(["summary", "overview", "vendors_and_responses"]);
export const iconColorSchema = z.enum(["amber", "red", "teal"]);

/**
 * The twelve documented keys of a notification object (Tech §3.2 Endpoint #1).
 * Sorted, so a test can compare `Object.keys(row).sort()` against it directly.
 * Internal columns — `tenant_id`, `thread_key`, `vendor_id`, `proposal_id` — must never
 * appear; `.strict()` below is what enforces that.
 */
export const NOTIFICATION_KEYS: readonly string[] = [
  "createdAt",
  "destinationTab",
  "eventDate",
  "iconColor",
  "id",
  "isRead",
  "isRecordAvailable",
  "kind",
  "message",
  "referenceId",
  "referenceType",
  "relativeLabel",
];

/** Column names that must never surface in the payload, in any casing (TC-NOTAPI-003). */
export const FORBIDDEN_INTERNAL_KEYS: readonly string[] = [
  "tenant_id",
  "tenantid",
  "thread_key",
  "threadkey",
  "vendor_id",
  "vendorid",
  "proposal_id",
  "proposalid",
  "sourcing_event_id",
  "sourcingeventid",
];

export const notificationSchema = z
  .object({
    id: uuid,
    kind: notificationKindSchema,
    referenceType: referenceTypeSchema,
    referenceId: uuid,
    eventDate: isoDate,
    message: nonEmpty,
    destinationTab: destinationTabSchema,
    iconColor: iconColorSchema,
    isRead: z.boolean(),
    isRecordAvailable: z.boolean(),
    relativeLabel: nonEmpty,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

/**
 * Relaxed only in `eventDate`. Used by every case that is about something OTHER than the
 * date serialisation — ordering, counts, per-user state. TC-NOTAPI-011, TC-NOTSORT-006 and
 * TC-NOTRT-003 keep the strict schema and own the D-1 assertion.
 */
export const notificationLooseSchema = notificationSchema.extend({ eventDate: z.string().min(1) });

/** Endpoint #1 payload — and, per §3.2, the body of endpoints #3 and #4 as well. */
export const panelDataSchema = z
  .object({
    notifications: z.array(notificationSchema).max(20),
    unreadCount: countInt,
    totalUndismissed: countInt,
  })
  .strict();

export const panelDataLooseSchema = z
  .object({
    notifications: z.array(notificationLooseSchema).max(20),
    unreadCount: countInt,
    totalUndismissed: countInt,
  })
  .strict();

/** Endpoint #2 acknowledgement — exactly two keys, and `isRead` is always literally true. */
export const markReadDataSchema = z
  .object({
    id: uuid,
    isRead: z.literal(true),
  })
  .strict();

/** The three keys of the panel payload, sorted — for exact key-set comparisons. */
export const PANEL_KEYS: readonly string[] = ["notifications", "totalUndismissed", "unreadCount"];
/** The two keys of the mark-read acknowledgement, sorted. */
export const MARK_READ_KEYS: readonly string[] = ["id", "isRead"];

export type Notification = z.infer<typeof notificationLooseSchema>;
export type PanelData = z.infer<typeof panelDataLooseSchema>;
