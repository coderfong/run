"""The economy contract, server side.

Asserts `app/economy.py` + `app/geospatial.py` satisfy every vector in
`../economy-contract.json`. The frontend asserts the same file from the other
side (`frontend/scripts/check-economy-contract.mjs`), which is what stops the
two implementations drifting apart again — the running screen previewed a
retired formula for long enough to promise ~5x the land actually granted, and
nothing caught it because nothing compared them.

Pure functions only: no server, no database. Run it anywhere.

    python test_economy_contract.py
"""

import json
import os
import sys

from app import economy
from app.config import settings
from app.geospatial import claim_area_m2

CONTRACT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "economy-contract.json")

FAILURES = []
PASSES = []


def check(label, ok, detail=""):
    (PASSES if ok else FAILURES).append(label)
    if not ok:
        print(f"  FAIL {label}{(' — ' + str(detail)) if detail else ''}")
    return ok


def eq(label, got, want, tol=0.5):
    return check(label, abs(got - want) <= tol, f"got {got:,.2f} want {want:,.2f}")


def main():
    with open(CONTRACT, encoding="utf-8") as fh:
        c = json.load(fh)

    print(f"economy contract v{c['economy_version']} — server side")

    check(
        f"ECONOMY_VERSION is {c['economy_version']}",
        economy.ECONOMY_VERSION == c["economy_version"],
        economy.ECONOMY_VERSION,
    )

    # --- constants ---------------------------------------------------------
    for name, want in c["constants"].items():
        got = getattr(settings, name, None)
        check(f"settings.{name} == {want}", got == want, got)

    # --- the curve, from a standing start ----------------------------------
    for row in c["claim_area_m2"]:
        eq(f"claim_area_m2({row['distance_m']} m)", claim_area_m2(row["distance_m"]), row["expected"])

    # --- the DAILY entitlement: splitting a run must not multiply land ------
    for row in c["daily_entitlement"]:
        total, before = 0.0, 0.0
        for leg in row["splits"]:
            total += economy.entitled_area_m2(before, leg)
            before += leg
        eq(f"entitlement — {row['label']}", total, row["expected_total"], tol=1.0)

    # --- qualification ------------------------------------------------------
    for row in c["run_tier"]:
        got = economy.run_tier(row["distance_m"], row["duration_s"], row["unique_m"])
        check(
            f"run_tier({row['distance_m']} m, {row['duration_s']} s, {row['unique_m']} m unique)"
            f" == {row['expected']}",
            got == row["expected"],
            got,
        )

    # --- payouts ------------------------------------------------------------
    for row in c["run_coins"]:
        eq(f"run_coins({row['distance_m']} m)", economy.run_coins(row["distance_m"]), row["expected"])
    for row in c["run_energy"]:
        eq(f"run_energy({row['distance_m']} m)", economy.run_energy(row["distance_m"]), row["expected"])

    # --- claim pricing ------------------------------------------------------
    for row in c["claim_cost"]:
        got = economy.claim_cost(row["action"], row["first_of_day"])
        check(
            f"claim_cost({row['action']}, first={row['first_of_day']}) == {row['expected']}",
            got == row["expected"],
            got,
        )
    for row in c["claim_action"]:
        got = economy.claim_action(
            row["area_m2"], row["enemy_m2"], row["defended_m2"], row["mine_m2"]
        )
        check(f"claim_action — {row['label']} == {row['expected']}", got == row["expected"], got)

    print(f"\n{len(PASSES)} passed, {len(FAILURES)} failed")
    if FAILURES:
        sys.exit(1)
    print("ECONOMY CONTRACT UPHELD (server)")


if __name__ == "__main__":
    main()
