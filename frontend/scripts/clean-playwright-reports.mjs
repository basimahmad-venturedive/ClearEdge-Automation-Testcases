/**
 * Flush prior Playwright run artifacts before every execution
 * (rules/execution.rules — "Flush reports before every execution").
 *
 * Deletes:
 *   - automation/reports/playwright-html/   (HTML reporter output)
 *   - automation/frontend/reports/last-run.json (JSON reporter output)
 *
 * Invoked by `npm run clean:reports` (and therefore by `npm test` /
 * `npm run test:headed`). Both deletes are force+recursive so a missing
 * target is not an error.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const targets = [
  // automation/reports/playwright-html
  path.resolve(here, '..', '..', 'reports', 'playwright-html'),
  // automation/frontend/reports/last-run.json
  path.resolve(here, '..', 'reports', 'last-run.json'),
];

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
}
