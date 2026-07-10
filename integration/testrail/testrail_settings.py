"""Typed environment accessor for the TestRail integration.

Every credential and instance detail comes from automation/integration/testrail/.env
(never committed) — never hardcode a URL, email, or API key in source, per
.claude/rules/secrets-and-env.rules.md.
"""
from __future__ import annotations

import os
import pathlib

from dotenv import load_dotenv

_ENV_PATH = pathlib.Path(__file__).parent / ".env"
load_dotenv(_ENV_PATH)

_ENV_HINT = "automation/integration/testrail/.env (copy from .env.example)"


class MissingTestRailConfigError(RuntimeError):
    pass


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise MissingTestRailConfigError(f"{name} is not set. Populate it in {_ENV_HINT}.")
    return value


def testrail_url() -> str:
    return _required("TESTRAIL_URL").rstrip("/")


def testrail_username() -> str:
    return _required("TESTRAIL_USERNAME")


def testrail_password() -> str:
    return _required("TESTRAIL_PASSWORD")


def testrail_project_id() -> int:
    return int(_required("TESTRAIL_PROJECT_ID"))


def testrail_suite_id() -> int | None:
    value = os.environ.get("TESTRAIL_SUITE_ID", "").strip()
    return int(value) if value else None


def testrail_api_template_id() -> int:
    return int(os.environ.get("TESTRAIL_API_TEMPLATE_ID", "6"))


def testrail_integration_enabled() -> bool:
    return os.environ.get("TESTRAIL_INTEGRATION", "0").strip() == "1"


def testrail_run_suite_name() -> str:
    return os.environ.get("TESTRAIL_RUN_SUITE_NAME", "").strip()


def testrail_run_timezone_label() -> str:
    return os.environ.get("TESTRAIL_RUN_TIMEZONE_LABEL", "PKT")


def testrail_result_comment() -> str:
    return os.environ.get("TESTRAIL_RESULT_COMMENT", "Automated pytest pass")
