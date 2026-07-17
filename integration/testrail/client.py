"""Minimal TestRail API v2 client (stdlib ``urllib`` + HTTP Basic auth).

No third-party HTTP dependency: the publisher runs anywhere Python 3 is
available. SSL uses ``certifi``'s CA bundle when installed, otherwise the
default context. All diagnostics go through ``logging`` (never ``print``).

Sections are cached per (project, suite) after the first ``get_sections`` call
so a publish of many sub-sections issues a single list request.
"""

from __future__ import annotations

import base64
import json
import logging
import ssl
import urllib.error
import urllib.request
from typing import Any

try:
    import certifi
except ImportError:  # pragma: no cover - certifi is optional
    certifi = None  # type: ignore[assignment]

log = logging.getLogger(__name__)


class TestRailError(RuntimeError):
    """Raised when the TestRail API returns a non-2xx response."""


def _ssl_context() -> ssl.SSLContext:
    if certifi is not None:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


class TestRailClient:
    """Thin wrapper over the TestRail v2 REST endpoints used for publishing."""

    def __init__(
        self,
        base_url: str,
        username: str,
        api_key: str,
        project_id: int,
        suite_id: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.project_id = project_id
        self.suite_id = suite_id
        token = base64.b64encode(f"{username}:{api_key}".encode()).decode("ascii")
        self._auth_header = f"Basic {token}"
        self._ctx = _ssl_context()
        self._sections_cache: list[dict[str, Any]] | None = None

    # -- low-level request ---------------------------------------------------

    def _request(self, method: str, endpoint: str, payload: dict | None = None) -> Any:
        url = f"{self.base_url}/index.php?/api/v2/{endpoint}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self._auth_header)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, context=self._ctx) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:  # pragma: no cover - network path
            detail = exc.read().decode("utf-8", "replace")
            raise TestRailError(
                f"TestRail {method} {endpoint} failed: HTTP {exc.code} {detail}"
            ) from exc
        except urllib.error.URLError as exc:  # pragma: no cover - network path
            raise TestRailError(
                f"TestRail {method} {endpoint} failed: {exc.reason}"
            ) from exc
        if not body:
            return None
        return json.loads(body)

    # -- sections ------------------------------------------------------------

    @staticmethod
    def _as_section_list(result: Any) -> list[dict[str, Any]]:
        # Newer TestRail wraps the list in a paginated object.
        if isinstance(result, dict):
            return list(result.get("sections", []))
        return list(result or [])

    def get_sections(
        self, project_id: int | None = None, suite_id: int | None = None
    ) -> list[dict[str, Any]]:
        pid = project_id if project_id is not None else self.project_id
        sid = suite_id if suite_id is not None else self.suite_id
        result = self._request("GET", f"get_sections/{pid}&suite_id={sid}")
        return self._as_section_list(result)

    def _sections(self) -> list[dict[str, Any]]:
        if self._sections_cache is None:
            self._sections_cache = self.get_sections()
        return self._sections_cache

    def _add_section(self, name: str, parent_id: int | None) -> dict[str, Any]:
        payload: dict[str, Any] = {"suite_id": self.suite_id, "name": name}
        if parent_id is not None:
            payload["parent_id"] = parent_id
        created = self._request("POST", f"add_section/{self.project_id}", payload)
        if self._sections_cache is not None and isinstance(created, dict):
            self._sections_cache.append(created)
        return created

    @staticmethod
    def _parent_of(section: dict[str, Any]) -> int | None:
        parent = section.get("parent_id")
        return int(parent) if parent is not None else None

    def get_or_create_root_section(self, name: str) -> int:
        """Return the id of the top-level (parent-less) section ``name``.

        Reuses an existing root section with the same name so a re-publish of
        the same US-* story never creates a duplicate root.
        """
        for section in self._sections():
            if section.get("name") == name and self._parent_of(section) is None:
                log.info("Reusing existing root section %r (id %s)", name, section["id"])
                return int(section["id"])
        created = self._add_section(name, parent_id=None)
        log.info("Created root section %r (id %s)", name, created["id"])
        return int(created["id"])

    def get_or_create_subsection(self, parent_id: int, name: str) -> int:
        """Return the id of sub-section ``name`` under ``parent_id`` (reuse or create)."""
        for section in self._sections():
            if section.get("name") == name and self._parent_of(section) == int(parent_id):
                log.info("Reusing existing sub-section %r (id %s)", name, section["id"])
                return int(section["id"])
        created = self._add_section(name, parent_id=int(parent_id))
        log.info("Created sub-section %r (id %s)", name, created["id"])
        return int(created["id"])

    # -- cases ---------------------------------------------------------------

    def add_case(self, section_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"add_case/{section_id}", payload)

    def get_cases(
        self,
        project_id: int | None = None,
        suite_id: int | None = None,
        section_id: int | None = None,
    ) -> list[dict[str, Any]]:
        pid = project_id if project_id is not None else self.project_id
        sid = suite_id if suite_id is not None else self.suite_id
        endpoint = f"get_cases/{pid}&suite_id={sid}"
        if section_id is not None:
            endpoint += f"&section_id={section_id}"
        result = self._request("GET", endpoint)
        if isinstance(result, dict):
            return list(result.get("cases", []))
        return list(result or [])

    def update_case(self, case_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"update_case/{case_id}", payload)
