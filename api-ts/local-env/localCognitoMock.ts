/**
 * Local Cognito mock for CEIQ-FOUND-001 (F1) — Local environment only.
 *
 * The real clearedge-backend (codebase/clearedge-backend) does RS256 signature
 * verification against a real JWKS endpoint (src/auth/cognito-jwt-verifier.service.ts)
 * — there is no dummy-token bypass in the actual code, despite the backend README's
 * claim of one. To exercise the real guards locally without AWS Cognito, this module:
 *
 *   1. Generates (once) a disposable RSA keypair, persisted to keypair.json (gitignored —
 *      it is a local-only throwaway key, but persistence lets the JWKS server process and
 *      the test-runner process share the same key across separate Node invocations).
 *   2. Serves a JWKS endpoint at two paths (/tenant-pool, /admin-pool) so the app's two
 *      separate verifiers (COGNITO_TENANT_JWKS_URI / COGNITO_ADMIN_JWKS_URI) each get a
 *      distinct issuer, matching the real two-pool design (spec §7.1) — signed with the
 *      same underlying key for simplicity, since both "pools" are our own mock.
 *   3. Exposes signTenantToken / signAdminToken using the exact claim keys the app's
 *      guards read (src/common/constants/auth.constants.ts: custom:tenant_id,
 *      custom:role_id; src/auth/cognito-jwt.types.ts: custom:admin).
 */
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8, exportJWK } from "jose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYPAIR_PATH = path.resolve(__dirname, "keypair.json");
const KID = "local-mock-key-1";

// Host the app uses to reach this mock. Defaults to "localhost" (app + mock on the same host).
// When the backend runs in Docker, the container cannot reach the host's "localhost" — set
// LOCAL_COGNITO_HOST=host.docker.internal so the minted `iss` matches the app's JWKS/issuer
// config (which must point at the same host). Both pools listen on the one mock server (:4001).
const MOCK_HOST = process.env.LOCAL_COGNITO_HOST?.trim() || "localhost";
export const TENANT_POOL_ISSUER = `http://${MOCK_HOST}:4001/tenant-pool`;
export const ADMIN_POOL_ISSUER = `http://${MOCK_HOST}:4001/admin-pool`;
export const TENANT_POOL_JWKS_URI = `${TENANT_POOL_ISSUER}/.well-known/jwks.json`;
export const ADMIN_POOL_JWKS_URI = `${ADMIN_POOL_ISSUER}/.well-known/jwks.json`;

interface PersistedKeypair {
  privateKeyPem: string;
  publicKeyPem: string;
}

function loadOrCreateKeypair(): PersistedKeypair {
  if (existsSync(KEYPAIR_PATH)) {
    return JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")) as PersistedKeypair;
  }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const persisted: PersistedKeypair = {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  writeFileSync(KEYPAIR_PATH, JSON.stringify(persisted, null, 2));
  return persisted;
}

export async function getSigningKey() {
  const { privateKeyPem } = loadOrCreateKeypair();
  return importPKCS8(privateKeyPem, "RS256");
}

async function getPublicJwk() {
  const { publicKeyPem } = loadOrCreateKeypair();
  const jwk = await exportJWK(createPublicKey(publicKeyPem));
  return { ...jwk, kid: KID, use: "sig", alg: "RS256" };
}

export async function signTenantToken(claims: {
  sub: string;
  tenantId: string;
  roleId?: string;
  email?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const key = await getSigningKey();
  const expEpoch = Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 3600);
  return new SignJWT({
    email: claims.email ?? "test.user@example.test",
    client_id: "local-tenant-client",
    "custom:tenant_id": claims.tenantId,
    ...(claims.roleId !== undefined ? { "custom:role_id": claims.roleId } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setSubject(claims.sub)
    .setIssuer(TENANT_POOL_ISSUER)
    .setIssuedAt()
    .setExpirationTime(expEpoch)
    .sign(key);
}

export async function signAdminToken(claims: {
  sub: string;
  email?: string;
  admin?: boolean;
  expiresInSeconds?: number;
}): Promise<string> {
  const key = await getSigningKey();
  const expEpoch = Math.floor(Date.now() / 1000) + (claims.expiresInSeconds ?? 3600);
  return new SignJWT({
    email: claims.email ?? "admin@venturedive.test",
    client_id: "local-admin-client",
    // Cognito custom attributes are always strings; the admin guard checks
    // custom:admin === "true" (backend commit 310dc68, dev pull 2026-07-10),
    // so mint a string, not a boolean.
    "custom:admin": String(claims.admin ?? true),
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setSubject(claims.sub)
    .setIssuer(ADMIN_POOL_ISSUER)
    .setIssuedAt()
    .setExpirationTime(expEpoch)
    .sign(key);
}

export function tamperToken(token: string): string {
  const parts = token.split(".");
  const sig = parts[2] ?? "";
  const flippedChar = sig.at(-1) !== "A" ? "A" : "B";
  return `${parts[0]}.${parts[1]}.${flippedChar}${sig.slice(1)}`;
}

export async function startJwksServer(): Promise<void> {
  const jwk = await getPublicJwk();
  const server = createServer((req, res) => {
    if (req.url === "/tenant-pool/.well-known/jwks.json" || req.url === "/admin-pool/.well-known/jwks.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(4001, () => {
    // eslint-disable-next-line no-console
    console.log("Local Cognito JWKS mock listening on http://localhost:4001");
    // eslint-disable-next-line no-console
    console.log(`  Tenant pool JWKS: ${TENANT_POOL_JWKS_URI}`);
    // eslint-disable-next-line no-console
    console.log(`  Admin pool JWKS:  ${ADMIN_POOL_JWKS_URI}`);
  });
}

