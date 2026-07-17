"""TestRail integration — Step E manual-case publisher.

Modules:
    testrail_settings   TESTRAIL_* env accessors (python-dotenv).
    client              TestRail API v2 client (urllib + Basic auth).
    tc_id               TC-ID helpers + testrail_map.json load/save.
    parse_tc_markdown   Parse a testcases/TC-*.md into publishable cases.
    coverage_review_gate  Five-Lens publish gate.
    publish_manual_cases  CLI orchestrator (--file / --folder / --dry-run).
"""
