# ClearEdgeIQ Automation Framework

Enterprise Playwright automation framework supporting **UI** and **API** testing in a single repository. This implementation focuses on the **Login module** as the reference sample.

## Tech Stack

- Playwright + Node.js + JavaScript (ES6)
- Winston Logger
- Extent-style HTML Reports
- TestRail Integration (optional)
- dotenv for environment configuration

## Project Structure

```
Automation/
├── Web/                    # UI automation
│   ├── tests/              # Smoke, Regression, Sanity, Login
│   ├── pages/              # Page Object Model
│   ├── locators/           # Element locators (data-testid)
│   ├── fixtures/           # Playwright fixtures
│   ├── helpers/            # Auth, session, browser helpers
│   ├── utils/              # Smart waits, screenshots
│   └── testdata/           # Test data
├── API/                    # API automation
│   ├── tests/              # Smoke, Regression, Sanity, Login
│   ├── services/           # API service classes
│   ├── payloads/           # Request payloads
│   ├── schemas/            # Response schemas
│   ├── validators/         # Response validators
│   └── fixtures/           # API fixtures
├── common/                 # Shared utilities
│   ├── config/             # Config manager
│   ├── constants/          # Centralized constants
│   ├── logger/             # Winston logger
│   ├── reporters/          # Extent + TestRail reporters
│   ├── testrail/           # TestRail client
│   ├── extent/             # Extent report manager
│   ├── authentication/     # Auth manager
│   └── fixtures/           # testCase helper
├── reports/                # Generated reports
├── logs/                   # Execution logs
├── playwright.config.js
├── package.json
└── .env.example
```

## Setup

```bash
# Install dependencies
npm install

# Install browsers
npm run install:browsers

# Configure environment
cp .env.example .env
# Edit .env with your BASE_URL, API_BASE_URL, and credentials
```

## Commands

| Command | Description |
|---------|-------------|
| `npm test` | Run complete suite |
| `npm run web` | Run all UI tests (Chromium) |
| `npm run api` | Run all API tests |
| `npm run web:login` | Run Login module UI tests |
| `npm run api:login` | Run Login module API tests |
| `npm run web:smoke` | Run UI smoke tests |
| `npm run web:regression` | Run UI regression tests |
| `npm run web:sanity` | Run UI sanity tests |
| `npm run api:smoke` | Run API smoke tests |
| `npm run api:regression` | Run API regression tests |
| `npm run api:sanity` | Run API sanity tests |
| `npm run report` | Open Playwright HTML report |

## Login Module Tests

### UI Tests (14 scenarios)
- **Smoke**: Page load, successful login
- **Regression**: Invalid credentials, empty fields, email validation, forgot password
- **Sanity**: URL check, button state, field input
- **Login**: Session persistence, password masking, remember me

### API Tests (11 scenarios)
- **Smoke**: Token generation, /auth/me profile
- **Regression**: Invalid credentials, missing fields, unauthorized access
- **Sanity**: Endpoint reachability, JSON response
- **Login**: Full auth flow, logout

## Writing Tests

Use the `testCase` helper for standardized TestRail IDs and tags:

```javascript
import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect } from '../../fixtures/webFixtures.js';
import { TAGS } from '../../../common/constants/index.js';

testCase(test, {
  id: 'C10001',
  tags: [TAGS.SMOKE, TAGS.LOGIN, TAGS.UI],
  title: 'Verify login page loads',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await expect(loginPage.emailInput).toBeVisible();
  },
});
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BASE_URL` | Application URL |
| `API_BASE_URL` | API base URL |
| `VALID_USER_EMAIL` | Valid login email |
| `VALID_USER_PASSWORD` | Valid login password |
| `ENABLE_TESTRAIL` | Enable TestRail sync (`true`/`false`) |
| `ENABLE_EXTENT` | Enable Extent report (`true`/`false`) |
| `HEADLESS` | Run headless (`true`/`false`) |

## CI/CD

- **GitHub Actions**: `.github/workflows/playwright.yml`
- **Jenkins**: `Jenkinsfile`
- **Azure DevOps**: `azure-pipelines.yml`

## Locator Strategy

All UI locators use `data-testid` attributes:

```html
<input data-testid="login-email" />
<input data-testid="login-password" />
<button data-testid="login-submit">Sign In</button>
```

## Reports

After execution, reports are available at:
- `reports/playwright/` — Playwright HTML report
- `reports/extent/` — Extent-style summary report
- `logs/` — Winston execution logs
