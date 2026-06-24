# Framework Architecture — ClearEdgeIQ Automation

## Overview

This document describes the architecture of the Enterprise Playwright Automation Framework built for ClearEdgeIQ. The framework follows Page Object Model (UI) and Service Layer (API) patterns with shared utilities.

## Design Principles

- **SOLID** — Single responsibility per class (BasePage, LoginPage, LoginApiService)
- **DRY** — Shared config, logger, constants, and testCase helper
- **KISS** — No over-abstraction; straightforward Playwright patterns
- **Independent tests** — Each test sets up its own state
- **Environment-driven** — All URLs and credentials from `.env`

## Layer Architecture

```
┌─────────────────────────────────────────────────┐
│                  Test Layer                      │
│  Web/tests/Login  │  API/tests/Login            │
├─────────────────────────────────────────────────┤
│              Fixture Layer                       │
│  webFixtures (loginPage) │ apiFixtures (loginApi)│
├─────────────────────────────────────────────────┤
│           Page Object / Service Layer            │
│  LoginPage, BasePage     │  LoginApiService       │
├─────────────────────────────────────────────────┤
│              Helper / Utility Layer              │
│  AuthHelper, SessionMgr  │  TokenManager, Validator│
├─────────────────────────────────────────────────┤
│              Common Infrastructure               │
│  Config, Logger, Constants, Reporters, TestRail  │
└─────────────────────────────────────────────────┘
```

## UI Framework Components

| Component | Purpose |
|-----------|---------|
| `BasePage` | Shared navigation, click, fill, wait, screenshot |
| `LoginPage` | Login-specific actions and assertions |
| `loginLocators` | Centralized `data-testid` selectors |
| `AuthHelper` | UI login + storage state persistence |
| `SessionManager` | Reuse authenticated sessions |
| `BrowserManager` | Browser lifecycle management |
| `NetworkInterceptor` | Mock/intercept API during UI tests |
| `smartWaits` | Network idle, API response waits |

## API Framework Components

| Component | Purpose |
|-----------|---------|
| `BaseApiClient` | HTTP methods via Playwright APIRequestContext |
| `LoginApiService` | Login, logout, refresh, /me endpoints |
| `RequestBuilder` | Fluent request construction |
| `ResponseValidator` | Status, body, property assertions |
| `loginSchema` | Response schema validation |
| `TokenManager` | Access/refresh token storage |
| `AuthManager` | End-to-end API authentication flow |

## Reporting Flow

1. Playwright executes tests with `list` + `html` reporters
2. `extentReporter` collects results and generates HTML summary
3. `testrailReporter` creates a Test Run and syncs results (if enabled)
4. Winston logger writes to `logs/` throughout execution

## TestRail Integration

- Controlled by `ENABLE_TESTRAIL=true` in `.env`
- Creates timestamped test run on suite start
- Reads TestRail Case ID from test annotations
- Updates only final result after retries
- Attaches failure message, duration, and status

## Login Module Coverage

The Login module serves as the reference implementation for future modules (User, Employee, etc.). Each new module should follow the same structure:

```
Web/tests/{Module}/     API/tests/{Module}/
Web/pages/{Module}Page  API/services/{module}ApiService
Web/locators/           API/payloads/
Web/testdata/           API/testdata/
```

## Coding Standards

1. Never use hard waits (`page.waitForTimeout`)
2. Always prefer `data-testid` locators
3. No hardcoded credentials — use `.env`
4. Use `testCase()` helper for TestRail ID and tags
5. Log key steps via `logStep()` from Winston logger
6. Independent tests — no execution order dependency
