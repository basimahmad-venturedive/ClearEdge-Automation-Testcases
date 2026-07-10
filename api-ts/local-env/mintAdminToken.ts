import { signAdminToken, signTenantToken } from "./localCognitoMock";

const admin = await signAdminToken({ sub: "test-admin-1", email: "admin@test.local" });
console.log("ADMIN_TOKEN=" + admin);
