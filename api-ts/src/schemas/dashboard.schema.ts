/**
 * Zod response schemas for CEIQ-FEAT-011 (Dashboard), per spec Tech §3.2.
 *
 * These are STRICT on the fields the spec defines and permissive only about the
 * platform-wide additive envelope keys (`message`, `meta`) that FOUND-001 puts on
 * every response. Where the spec names an exact format — `YYYY-MM-DD` for dates,
 * the three badge colours, the two calendar event types — the schema encodes that
 * format rather than accepting any string, because a format drift here is exactly
 * the class of defect this suite exists to find (see D-1 in the TC file).
 */
import { z } from "zod";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MMDDYYYY = /^\d{2}\/\d{2}\/\d{4}$/;

const uuid = z.string().uuid();
const isoDate = z.string().regex(ISO_DATE, "must be a bare YYYY-MM-DD date");
const nonEmpty = z.string().min(1);

export const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      success: z.literal(true),
      data,
    })
    .passthrough(); // `message` + `meta` are platform-wide additive keys

export const sourcingTypeSchema = z.enum(["rfp", "rfq"]);

export const deadlineSchema = z
  .object({
    id: uuid,
    type: sourcingTypeSchema,
    title: nonEmpty,
    submissionDeadline: isoDate,
  })
  .strict();

export const summaryDataSchema = z
  .object({
    contracts: z
      .object({
        all: z.number().int().nonnegative(),
        expiringIn30Days: z.number().int().nonnegative(),
        inReview: z.number().int().nonnegative(),
      })
      .strict(),
    sourcing: z
      .object({
        all: z.number().int().nonnegative(),
        closingInAWeek: z.number().int().nonnegative(),
      })
      .strict(),
    deadlines: z
      .object({
        rfp: deadlineSchema.nullable(),
        rfq: deadlineSchema.nullable(),
      })
      .strict(),
    canCreate: z.boolean(),
  })
  .strict();

export const recentActivityItemSchema = z
  .object({
    id: uuid,
    type: z.enum(["contract", "rfp", "rfq"]),
    name: nonEmpty,
    secondaryLine: nonEmpty,
    lastActivityAt: z.string().datetime({ offset: true }),
    relativeTime: nonEmpty,
  })
  .strict();

export const recentActivityDataSchema = z
  .object({ items: z.array(recentActivityItemSchema).max(3) })
  .strict();

export const calendarEventSchema = z
  .object({
    id: uuid,
    name: nonEmpty,
    eventDate: isoDate,
    eventType: z.enum(["contract_expiry", "sourcing_deadline"]),
  })
  .strict();

export const calendarDataSchema = z.object({ events: z.array(calendarEventSchema) }).strict();

export const noticeDeadlineSchema = z
  .object({
    date: isoDate,
    label: nonEmpty,
  })
  .strict();

export const renewalItemSchema = z
  .object({
    id: uuid,
    name: nonEmpty,
    expirationDate: isoDate,
    daysRemaining: z.number().int(),
    badgeColor: z.enum(["red", "amber", "grey"]),
    badgeText: nonEmpty,
    noticeDeadline: noticeDeadlineSchema.nullable(),
  })
  .strict();

export const renewalsDataSchema = z
  .object({ contracts: z.array(renewalItemSchema).max(10) })
  .strict();

export const activeSourcingItemSchema = z
  .object({
    id: uuid,
    type: sourcingTypeSchema,
    title: nonEmpty,
    submissionDeadline: isoDate,
    daysUntilDeadline: z.number().int().nonnegative(),
    relativeLabel: nonEmpty,
  })
  .strict();

export const activeSourcingDataSchema = z
  .object({ events: z.array(activeSourcingItemSchema).max(10) })
  .strict();

/**
 * A relaxed calendar-event schema used by the cases that are ABOUT something other
 * than the date format — ordering, range, status filters. Without it, D-1 would make
 * every calendar case fail for the same single reason and hide whatever else is wrong.
 * TC-DASHCAL-010 and TC-DASHAPI-005 keep the strict schema and own that assertion.
 */
export const calendarEventLooseSchema = calendarEventSchema.extend({ eventDate: z.string().min(1) });
export const calendarDataLooseSchema = z.object({ events: z.array(calendarEventLooseSchema) }).strict();
