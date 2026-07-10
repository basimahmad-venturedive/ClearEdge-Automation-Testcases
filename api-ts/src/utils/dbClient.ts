/** Direct Postgres access for RLS / audit-table assertions. Throws if TEST_DATABASE_URL is unset. */
import { Client } from "pg";
import { testDatabaseUrl } from "../config/env";

export async function withDbClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
