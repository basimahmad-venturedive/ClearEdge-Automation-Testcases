/**
 * Request payloads + factories for CEIQ-FEAT-003 (User Management).
 * SPEC §4.2. Spec-pinned constants use UPPER_SNAKE_CASE; factories return fresh
 * dicts with Faker-generated unique fields so tests stay independent.
 *
 * No inline request-body literals in test files (api-automation.rules §Test data).
 */
import { faker } from "@faker-js/faker";

export type ManagedRole = "procurement_manager" | "procurement_analyst";

export interface CreateUserBody {
  role: ManagedRole;
  name: string;
  email: string;
}

export interface EditUserBody {
  name: string;
  role: ManagedRole;
  email: string;
}

export interface StatusBody {
  status: "active" | "inactive";
}

/** Fresh, valid create payload with a unique email (default role = manager per §5.5). */
export function newCreateUser(overrides: Partial<CreateUserBody> = {}): CreateUserBody {
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  return {
    role: "procurement_manager",
    name: `${first} ${last}`,
    email: faker.internet.email({ firstName: first, lastName: last }).toLowerCase(),
    ...overrides,
  };
}

/** Fresh, valid edit payload (all three fields always submitted — §4.2 PATCH). */
export function newEditUser(overrides: Partial<EditUserBody> = {}): EditUserBody {
  const base = newCreateUser();
  return { name: base.name, role: base.role, email: base.email, ...overrides };
}

// --- Spec-pinned negative / boundary payloads ---

/** Whitespace-only name → ERR_VALIDATION_FAILED (§4.2 create, US-UM-004 edge case). */
export const CREATE_WHITESPACE_NAME: CreateUserBody = {
  role: "procurement_manager",
  name: "   ",
  email: "valid.user@clearedge.com",
};

/** Empty/invalid email → ERR_VALIDATION_FAILED. */
export const CREATE_INVALID_EMAIL: CreateUserBody = {
  role: "procurement_manager",
  name: "Kyle Chancellor",
  email: "not-an-email",
};

/** Name at the 255-char boundary (TC-UMAPI-037). */
export const CREATE_NAME_MAX_255: CreateUserBody = {
  role: "procurement_analyst",
  name: "A".repeat(255),
  email: "max.name@clearedge.com",
};

/** Name one over the boundary (256) — expected reject; contract for exact code is TBD. */
export const CREATE_NAME_OVER_256: CreateUserBody = {
  role: "procurement_analyst",
  name: "A".repeat(256),
  email: "over.name@clearedge.com",
};

/** Special characters in name — must be stored/rendered safely (US-UM-004 edge case). */
export const CREATE_SPECIAL_CHARS_NAME: CreateUserBody = {
  role: "procurement_manager",
  name: "Zoë O'Neil-<script>",
  email: "special.chars@clearedge.com",
};

/**
 * ILIKE injection-shaped search inputs (TC-UMAPI-012). These must be treated as
 * literal text via parameterized query + `%`/`_` escaping — never interpolated.
 */
export const SEARCH_INJECTION_INPUTS: readonly string[] = [
  "100% match",
  "under_score",
  "'; DROP TABLE users;--",
  "%",
  "_",
];

/** Status transition bodies. */
export const STATUS_DEACTIVATE: StatusBody = { status: "inactive" };
export const STATUS_ACTIVATE: StatusBody = { status: "active" };
