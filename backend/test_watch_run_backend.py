"""The watch-submitted-run backdating exception, and the check that backs it.

resolve_run_start and watch_start_mismatch (app/anticheat.py) are the only
new decisions this feature adds to the server: everything else a watch run
goes through is the SAME /end-run pipeline, and the SAME anti-cheat checks,
every phone run already goes through (validate_run, _overlaps_another_run).
This file is deliberately narrow — it exercises exactly the two functions
that are new, the same way test_devtools.py exercises the dev allowlist:
pure, no database, no server.

    python test_watch_run_backend.py
"""

import sys
from datetime import datetime, timedelta, timezone

from app.anticheat import HARD_REASONS, is_verified, resolve_run_start, watch_start_mismatch
from app.schemas import GpsPoint

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{(' - ' + str(detail)) if detail else ''}")
    return ok


NOW = datetime(2026, 1, 1, 12, 0, 0)


def point(t):
    return GpsPoint(lat=1.35, lon=103.82, t=t)


def main():
    print("watch-submitted run: backdating + timestamp corroboration")

    # --- resolve_run_start ---------------------------------------------------

    check(
        "no claimed start: always now, no source, for anyone",
        resolve_run_start(None, None, is_dev=False, now=NOW, max_backdate_s=3600)
        == (NOW, None),
    )
    check(
        "a bare backdated start (no source) is dropped for an ordinary account",
        resolve_run_start(
            NOW - timedelta(minutes=30), None, is_dev=False, now=NOW, max_backdate_s=3600
        )
        == (NOW, None),
    )
    check(
        "source=watch alone, from a NON-dev account, is still dropped outside is_dev",
        resolve_run_start(
            NOW - timedelta(minutes=30), "bogus", is_dev=False, now=NOW, max_backdate_s=3600
        )
        == (NOW, None),
    )
    dev_started, dev_source = resolve_run_start(
        NOW - timedelta(hours=5), None, is_dev=True, now=NOW, max_backdate_s=3600
    )
    check(
        "a dev account's claimed start is always honoured, whatever the window",
        dev_started == NOW - timedelta(hours=5) and dev_source is None,
        (dev_started, dev_source),
    )
    watch_started, watch_source = resolve_run_start(
        NOW - timedelta(minutes=30), "watch", is_dev=False, now=NOW, max_backdate_s=3600
    )
    check(
        "a watch-sourced start inside the window is honoured, and tagged",
        watch_started == NOW - timedelta(minutes=30) and watch_source == "watch",
        (watch_started, watch_source),
    )
    outside_started, outside_source = resolve_run_start(
        NOW - timedelta(hours=10), "watch", is_dev=False, now=NOW, max_backdate_s=3600
    )
    check(
        "a watch-sourced start OUTSIDE the window falls back to now, untagged",
        outside_started == NOW and outside_source is None,
        (outside_started, outside_source),
    )
    check(
        "a watch-sourced start in the FUTURE is refused (negative age)",
        resolve_run_start(
            NOW + timedelta(minutes=5), "watch", is_dev=False, now=NOW, max_backdate_s=3600
        )
        == (NOW, None),
    )
    check(
        "the window boundary itself is inclusive",
        resolve_run_start(
            NOW - timedelta(seconds=3600), "watch", is_dev=False, now=NOW, max_backdate_s=3600
        )
        == (NOW - timedelta(seconds=3600), "watch"),
    )

    # --- watch_start_mismatch -------------------------------------------------

    check(
        "no points at all is a mismatch — nothing corroborates the claim",
        watch_start_mismatch([], NOW, tolerance_s=300),
    )
    agreeing = [point(NOW + timedelta(seconds=10)), point(NOW + timedelta(minutes=20))]
    check(
        "points starting within tolerance of the claimed start: no mismatch",
        not watch_start_mismatch(agreeing, NOW, tolerance_s=300),
    )
    borderline = [point(NOW + timedelta(seconds=300)), point(NOW + timedelta(minutes=20))]
    check(
        "exactly at the tolerance boundary: still agrees",
        not watch_start_mismatch(borderline, NOW, tolerance_s=300),
    )
    disagreeing = [point(NOW + timedelta(minutes=15)), point(NOW + timedelta(minutes=40))]
    check(
        "points starting well after the claimed start: a mismatch",
        watch_start_mismatch(disagreeing, NOW, tolerance_s=300),
    )
    before_claim = [point(NOW - timedelta(minutes=10)), point(NOW + timedelta(minutes=5))]
    check(
        "points starting well BEFORE the claimed start: also a mismatch",
        watch_start_mismatch(before_claim, NOW, tolerance_s=300),
    )
    check(
        "only the EARLIEST point is checked, not the latest — a long run's own "
        "last fix is naturally far from its start and must not be flagged for it",
        not watch_start_mismatch(
            [point(NOW), point(NOW + timedelta(hours=2))], NOW, tolerance_s=300
        ),
    )

    # --- wired into anti-cheat's hard-reason set -------------------------------

    check(
        "watch_start_mismatch is a HARD reason — it unverifies the run",
        "watch_start_mismatch" in HARD_REASONS
        and not is_verified(["watch_start_mismatch"]),
    )
    check(
        "a run with no flags at all stays verified",
        is_verified([]),
    )

    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        for f in FAILURES:
            print(f"  FAILED: {f}")
        sys.exit(1)
    print("ALL WATCH-RUN BACKEND CHECKS PASSED")


if __name__ == "__main__":
    main()
