"""TestRail API v2 client — stdlib urllib + Basic auth, per testrail-integration.md scaffold checklist.

No print(); use logging. Credentials come from testrail_settings, never inline.
"""
from __future__ import annotations

import base64
import json
import logging
import urllib.error
import urllib.request

import testrail_settings

logger = logging.getLogger(__name__)


class TestRailApiError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"TestRail API error {status}: {body}")
        self.status = status
        self.body = body


class TestRailClient:
    def __init__(self) -> None:
        self._base_url = testrail_settings.testrail_url()
        user = testrail_settings.testrail_username()
        password = testrail_settings.testrail_password()
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        self._auth_header = f"Basic {token}"

    def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        url = f"{self._base_url}/index.php?/api/v2/{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={"Authorization": self._auth_header, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode()
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()
            logger.error("TestRail API %s %s failed: %s %s", method, path, exc.code, body)
            raise TestRailApiError(exc.code, body) from exc

    # --- Reads -----------------------------------------------------------------
    def get_suite(self, suite_id: int) -> dict:
        return self._request("GET", f"get_suite/{suite_id}")

    def get_sections(self, project_id: int, suite_id: int | None = None) -> list[dict]:
        path = f"get_sections/{project_id}"
        if suite_id is not None:
            path += f"&suite_id={suite_id}"
        result = self._request("GET", path)
        return result.get("sections", result if isinstance(result, list) else [])

    def get_cases(self, project_id: int, suite_id: int | None = None, section_id: int | None = None) -> list[dict]:
        path = f"get_cases/{project_id}"
        if suite_id is not None:
            path += f"&suite_id={suite_id}"
        if section_id is not None:
            path += f"&section_id={section_id}"
        result = self._request("GET", path)
        return result.get("cases", result if isinstance(result, list) else [])

    # --- Writes ------------------------------------------------------------------
    def add_section(self, project_id: int, name: str, suite_id: int | None = None, parent_id: int | None = None) -> dict:
        path = f"add_section/{project_id}"
        payload: dict = {"name": name}
        if suite_id is not None:
            payload["suite_id"] = suite_id
        if parent_id is not None:
            payload["parent_id"] = parent_id
        return self._request("POST", path, payload)

    def get_or_create_root_section(self, project_id: int, name: str, suite_id: int | None = None) -> dict:
        """Reuses an existing top-level section with this name; never creates a duplicate."""
        for section in self.get_sections(project_id, suite_id):
            if section.get("parent_id") is None and section.get("name") == name:
                logger.info("Reusing existing TestRail section %r (id=%s)", name, section["id"])
                return section
        logger.info("Creating new TestRail root section %r", name)
        return self.add_section(project_id, name, suite_id=suite_id)

    def get_or_create_child_section(
        self, project_id: int, name: str, parent_id: int, suite_id: int | None = None
    ) -> dict:
        for section in self.get_sections(project_id, suite_id):
            if section.get("parent_id") == parent_id and section.get("name") == name:
                return section
        return self.add_section(project_id, name, suite_id=suite_id, parent_id=parent_id)

    def add_case(self, section_id: int, title: str, **fields) -> dict:
        return self._request("POST", f"add_case/{section_id}", {"title": title, **fields})

    def update_case(self, case_id: int, **fields) -> dict:
        return self._request("POST", f"update_case/{case_id}", fields)

    def add_run(self, project_id: int, name: str, suite_id: int | None, case_ids: list[int]) -> dict:
        payload: dict = {"name": name, "include_all": False, "case_ids": case_ids}
        if suite_id is not None:
            payload["suite_id"] = suite_id
        return self._request("POST", f"add_run/{project_id}", payload)

    def add_results_for_cases(self, run_id: int, results: list[dict]) -> dict:
        return self._request("POST", f"add_results_for_cases/{run_id}", {"results": results})
