from __future__ import annotations

import argparse
import csv
import math
from datetime import date
from io import StringIO
from typing import TypedDict

from common import session, summarize, write_story_data


class MonthlyCO2Observation(TypedDict):
    year: int
    month: int
    value: float
    uncertainty: float


LOCATION_ID = "philippines-global-co2"
DATA_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.csv"
REFERENCE_URL = "https://gml.noaa.gov/ccgg/trends/global.html"
SCALE_NOTE = (
    "The Philippines marker is a country-level story reference, not the location of a CO2 sensor. "
    "The plotted monthly values are NOAA's globally averaged dry-air CO2 mole fractions from marine "
    "surface sites in a global air-sampling network; they are not Philippine or city-level concentrations, "
    "emissions, or satellite retrievals. This story covers CO2 only, not every greenhouse gas. Values use "
    "the source's monthly average and retain its reported global-mean uncertainty; that uncertainty is not "
    "a local spatial range. Monthly seasonal variation is real and is not removed. NOAA notes that the "
    "latest year's values are preliminary and may be revised. NASA's DYAMOND visualization is a GEOS "
    "model of January-March 2020 atmospheric CO2, not a local measurement or the source of this time series."
)


def parse_global_co2_csv(text: str) -> tuple[list[MonthlyCO2Observation], list[str]]:
    data_lines = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
    reader = csv.DictReader(StringIO("\n".join(data_lines)))
    required_columns = {"year", "month", "average", "average_unc"}
    if reader.fieldnames is None or not required_columns.issubset(reader.fieldnames):
        raise ValueError(f"NOAA CO2 CSV is missing required columns: {sorted(required_columns)}")

    observations: dict[tuple[int, int], MonthlyCO2Observation] = {}
    for row in reader:
        year_text = (row.get("year") or "").strip()
        month_text = (row.get("month") or "").strip()
        if not year_text and not month_text:
            continue
        year = int(year_text)
        month = int(month_text)
        if not 1 <= month <= 12:
            raise ValueError(f"NOAA CO2 CSV has an invalid month: {month}")

        average_text = (row.get("average") or "").strip()
        if not average_text:
            continue
        value = float(average_text)
        if not math.isfinite(value) or value <= 0:
            continue

        uncertainty_text = (row.get("average_unc") or "").strip()
        if not uncertainty_text:
            raise ValueError(f"NOAA CO2 CSV has no uncertainty for {year:04d}-{month:02d}")
        uncertainty = float(uncertainty_text)
        if not math.isfinite(uncertainty) or uncertainty < 0:
            raise ValueError(f"NOAA CO2 CSV has invalid uncertainty for {year:04d}-{month:02d}")

        key = (year, month)
        if key in observations:
            raise ValueError(f"NOAA CO2 CSV contains duplicate month {year:04d}-{month:02d}")
        observations[key] = {
            "year": year,
            "month": month,
            "value": round(value, 2),
            "uncertainty": round(uncertainty, 2),
        }

    if not observations:
        raise RuntimeError("NOAA returned no valid global monthly CO2 observations.")

    series = [observations[key] for key in sorted(observations)]
    missing_months = []
    current = date(series[0]["year"], series[0]["month"], 1)
    last = date(series[-1]["year"], series[-1]["month"], 1)
    while current <= last:
        key = (current.year, current.month)
        if key not in observations:
            missing_months.append(current.strftime("%Y-%m"))
        current = (
            date(current.year + 1, 1, 1)
            if current.month == 12
            else date(current.year, current.month + 1, 1)
        )
    return series, missing_months


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch NOAA's globally averaged monthly CO2 record.")
    parser.parse_args()

    response = session().get(DATA_URL, timeout=120)
    response.raise_for_status()
    series, missing_months = parse_global_co2_csv(response.text)
    payload = {
        "locationId": LOCATION_ID,
        "metric": "monthly_mean_global_co2_mole_fraction",
        "unit": "ppm CO2",
        "narrationLabel": "globally averaged atmospheric CO2 concentration",
        "source": {
            "mission": "NOAA Global Monitoring Laboratory",
            "product": (
                "Globally averaged marine-surface monthly mean CO2 mole fraction from a global "
                "air-sampling network; source average and uncertainty"
            ),
            "url": REFERENCE_URL,
        },
        "references": [
            {
                "mission": "NOAA Global Monitoring Laboratory",
                "product": "Global monthly mean CO2 record, data, and calculation method",
                "url": REFERENCE_URL,
            },
            {
                "mission": "NASA Goddard Space Flight Center",
                "product": "DYAMOND Global Carbon Dioxide: GEOS model visualization for January-March 2020",
                "url": "https://svs.gsfc.nasa.gov/5196/",
            },
        ],
        "scaleNote": SCALE_NOTE,
        "sampling": {
            "method": (
                "Monthly globally averaged marine-surface CO2 mole fraction from NOAA GML's "
                "globally distributed air-sampling network; values use the CSV average column."
            ),
            "missingMonths": missing_months,
            "uncertainty": (
                "Each observation retains NOAA's average_unc value in ppm. The latest year's "
                "record is preliminary and may be revised."
            ),
        },
        "series": series,
    }

    output = write_story_data(LOCATION_ID, payload)
    summarize(LOCATION_ID, series)
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
