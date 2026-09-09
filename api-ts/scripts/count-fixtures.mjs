/**
 * Print server-reported totals per entity for the QA PO's tenant.
 *
 * Used as a before/after probe around a suite run to measure whether that suite's
 * teardown actually returns the tenant to its starting state. Reads the API's own
 * pagination total rather than counting rows, so it is one request per entity and
 * cannot be skewed by page-size quirks.
 */
import axios from "axios";
import dotenv from "dotenv";

dotenv.config({ path: "envs/.env.qa", override: true });
const R = process.env.AWS_REGION, B = process.env.API_BASE_URL;
const H = {
  "Content-Type": "application/x-amz-json-1.1",
  "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
};

const r0 = await axios.post(`https://cognito-idp.${R}.amazonaws.com/`, {
  AuthFlow: "USER_PASSWORD_AUTH",
  ClientId: process.env.COGNITO_TENANT_APP_CLIENT_ID,
  AuthParameters: { USERNAME: process.env.DEV_TENANT_USERNAME, PASSWORD: process.env.DEV_TENANT_PASSWORD },
}, { headers: H, validateStatus: () => true });
const A = { headers: { Authorization: `Bearer ${r0.data.AuthenticationResult.IdToken}` }, validateStatus: () => true, timeout: 30000 };

/** The API exposes the count under a different key per module. */
const total = (d) => d?.pagination?.total ?? d?.pagination?.totalItems ?? d?.pagination?.totalCount ?? d?.totalCount ?? null;

const ENTITIES = [
  ["contracts", "/contracts?page=1"],
  ["vendors", "/vendors?page=1"],
  ["sourcing", "/sourcing-events?page=1"],
  ["users", "/users?page=1"],
];

const out = {};
for (const [label, path] of ENTITIES) {
  const r = await axios.get(`${B}${path}`, A);
  out[label] = r.status === 200 ? total(r.data?.data) : `HTTP ${r.status}`;
}
console.log(JSON.stringify(out));
