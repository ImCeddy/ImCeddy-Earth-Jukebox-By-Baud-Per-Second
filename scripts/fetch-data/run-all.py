from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SCRIPTS = [
    ("Manila Bay / sea level", "fetch_sea_level.py", ()),
    ("Leyte Gulf / Tacloban coast sea level", "fetch_sea_level.py", ("leyte-gulf-tacloban", "--latitude", "11.2431609", "--longitude", "125.0082936")),
    ("Davao / Mindanao Current sea level", "fetch_sea_level.py", ("davao-mindanao", "--latitude", "7.0731", "--longitude", "125.6128")),
    ("Tubigon / Bohol sea level", "fetch_sea_level.py", ("tubigon-bohol", "--latitude", "9.9515287", "--longitude", "123.9618897")),
    ("Aringay / Barangay Alaska sea level", "fetch_sea_level.py", ("aringay-alaska", "--latitude", "16.3684742", "--longitude", "120.3323896")),
    ("Tacloban / precipitation", "fetch_precipitation.py", ()),
    ("Nueva Ecija / agriculture", "fetch_vegetation.py", ()),
    ("La Trinidad / agriculture", "fetch_vegetation.py", ("--location", "benguet-vegetable-belt")),
    ("Cadiz / agriculture", "fetch_vegetation.py", ("--location", "negros-sugarcane-belt")),
    ("Bohol / agriculture", "fetch_vegetation.py", ("--location", "bohol-ube-landscape")),
    ("Banaue / agriculture", "fetch_vegetation.py", ("--location", "banaue-rice-terraces")),
    ("Mount Apo / wildfire context", "fetch_vegetation.py", ("--location", "mount-apo-wildfire")),
    ("Philippines / global CO2 context", "fetch_global_co2.py", ()),
    ("Payatas / air quality", "fetch_air_quality.py", ()),
    ("Valenzuela / air quality", "fetch_valenzuela_air_quality.py", ()),
]
ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent


def main() -> int:
    failures = []
    for label, script_name, arguments in SCRIPTS:
        print(f"\n=== {label} ===")
        result = subprocess.run([sys.executable, str(SCRIPT_DIR / script_name), *arguments], cwd=ROOT)
        if result.returncode == 0:
            print(f"SUCCESS: {label}")
        else:
            failures.append(label)
            print(f"FAILURE: {label} (exit code {result.returncode})")

    if failures:
        print("\nPipeline completed with failures:")
        for label in failures:
            print(f"- {label}")
        return 1
    print("\nPipeline completed successfully for all configured locations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
