from __future__ import annotations

import re
import tempfile
from collections import defaultdict
from datetime import date
from pathlib import Path

import numpy as np

from common import earthdata_token, get_json, session, write_story_data
from maiac_sampling import (
    MINIMUM_GOOD_PIXELS_PER_DAY,
    SAMPLES_PER_MONTH,
    build_monthly_series,
    calendar_month_coverage,
    extract_qa_filtered_neighborhood as shared_extract_qa_filtered_neighborhood,
    last_completed_month_end,
    month_keys,
    select_evenly_spaced,
    tile_pixel as shared_tile_pixel,
)
from maiac_qa import aod_quality_masks

LOCATION_ID = "valenzuela-metro-manila"
LATITUDE = 14.7011
LONGITUDE = 120.9830
CMR_URL = "https://cmr.earthdata.nasa.gov/search"
PRODUCT = "MCD19A2"
VERSION = "061"
COLLECTION_ID = "C2324689816-LPCLOUD"


def tile_pixel(latitude: float, longitude: float) -> tuple[int, int, str]:
    return shared_tile_pixel(latitude, longitude)


def qa_valid_mask(aod: np.ndarray, qa: np.ndarray) -> np.ndarray:
    good, marginal = aod_quality_masks(aod, qa)
    return good | marginal


def extract_qa_filtered_neighborhood(
    path: Path,
    producer_name: str,
    latitude: float = LATITUDE,
    longitude: float = LONGITUDE,
) -> tuple[float, int, int] | None:
    return shared_extract_qa_filtered_neighborhood(path, producer_name, latitude, longitude)


def granule_url(entry: dict) -> str:
    for link in entry.get("links", []):
        if link.get("rel", "").endswith("data#") and link.get("href", "").endswith(".hdf"):
            return link["href"]
    raise RuntimeError(f"No protected HDF download link found for {entry.get('producer_granule_id')}")


def query_granules(client, end_date: date) -> dict[str, list[dict]]:
    entries: list[dict] = []
    page_number = 1
    page_size = 2000
    while True:
        params = {
            "short_name": PRODUCT,
            "version": VERSION,
            "collection_concept_id": COLLECTION_ID,
            "temporal": f"2000-01-01T00:00:00Z,{end_date.isoformat()}T23:59:59Z",
            "point": f"{LONGITUDE},{LATITUDE}",
            "page_size": page_size,
            "page_num": page_number,
            "sort_key": "start_date",
        }
        page = get_json(client, f"{CMR_URL}/granules.json", params=params)["feed"]["entry"]
        entries.extend(page)
        if len(page) < page_size:
            break
        page_number += 1

    by_month: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        by_month[entry["time_start"][:7]].append(entry)
    return by_month


def fetch_series() -> tuple[list[dict], list[str], dict, dict, dict, dict[str, int]]:
    end_date = last_completed_month_end()
    expected_months = month_keys(date(2000, 2, 1), end_date)
    client = session(earthdata_token())
    granules_by_month = query_granules(client, end_date)
    samples_by_month: dict[str, list[tuple[str, tuple[float, int, int] | None]]] = {}

    with tempfile.TemporaryDirectory(prefix="earth-jukebox-valenzuela-aod-") as temporary_dir:
        granule_path = Path(temporary_dir) / "sample.hdf"
        for month_key in expected_months:
            candidates = select_evenly_spaced(granules_by_month.get(month_key, []))
            month_samples = []
            for entry in candidates:
                response = client.get(granule_url(entry), timeout=300)
                response.raise_for_status()
                granule_path.write_bytes(response.content)
                result = extract_qa_filtered_neighborhood(
                    granule_path,
                    entry["producer_granule_id"],
                )
                month_samples.append((entry["time_start"][:10], result))
                granule_path.unlink(missing_ok=True)
            samples_by_month[month_key] = month_samples
            passed = sum(result is not None and result[1] >= MINIMUM_GOOD_PIXELS_PER_DAY for _, result in month_samples)
            print(f"{month_key}: {passed}/{len(candidates)} sampled days meet the pixel rule")

    return build_monthly_series(samples_by_month, expected_months)


def main() -> None:
    series, missing_months, valid_samples_by_month, candidate_samples_by_month, valid_dates_by_month, sensitivity = fetch_series()
    if not series:
        raise RuntimeError("MCD19A2 returned no QA-valid AOD samples for Valenzuela")

    payload = {
        "locationId": LOCATION_ID,
        "metric": "sampled_monthly_aod_047",
        "unit": "AOD at 0.47 micrometers, unitless",
        "source": {
            "mission": "Terra and Aqua MODIS MAIAC",
            "product": "MCD19A2.061 Optical_Depth_047; monthly mean of up to three evenly spaced daily 5x5-neighborhood medians",
            "url": "https://doi.org/10.5067/MODIS/MCD19A2.061",
        },
        "references": [{
            "mission": "NASA LP DAAC",
            "product": "MAIAC Data User's Guide, Collection 6.1, Version 3.1",
            "url": "https://lpdaac.usgs.gov/documents/1500/MCD19_User_Guide_V61.pdf",
        }],
        "scaleNote": (
            "MAIAC aerosol optical depth is a column-integrated optical measure, not ground-level PM2.5 or PM10. "
            "Each monthly value averages up to three evenly spaced daily medians of best-quality QA-filtered pixels "
            "in a 5x5 neighborhood and is not a mean of all valid daily retrievals. "
            "Each sampled day requires at least five such pixels; each month requires at least "
            "one valid sampled day. Months failing these rules are omitted, not zero. This regional sample cannot "
            "resolve landfill-, street-, or household-level exposure."
        ),
        "sampling": {
            "method": (
                "For each complete calendar month, up to three evenly spaced unique daily MCD19A2 granules are sampled. "
                "Each daily value is the median of best-quality QA-filtered Optical_Depth_047 pixels in a 5x5 neighborhood. "
                "A day requires at least five valid pixels; a month requires at least one passing sampled day. "
                "The monthly value is the arithmetic mean of passing daily medians."
            ),
            "qa": (
                "Value pixels have clear-sky code 1, land code 0, normal adjacency code 0, best AOT quality code 0, "
                "and Optical_Depth_047 in the product valid range -1000 to <5000 before the 0.001 scale factor. "
                "Single-cloud-adjacency pixels (code 3) are counted separately as marginal and excluded from the value."
            ),
            "qualityCounts": {
                "goodSamples": "Good pixel samples across passing daily neighborhoods in the month.",
                "marginalSamples": "Marginal single-cloud-adjacency pixel samples in passing daily neighborhoods.",
            },
            "sampledDailyObservationsByMonth": valid_samples_by_month,
            "candidateDailyObservationsByMonth": candidate_samples_by_month,
            "validSampleDatesByMonth": valid_dates_by_month,
            "missingMonths": missing_months,
            "maximumSampledDaysPerMonth": SAMPLES_PER_MONTH,
            "minimumGoodPixelsPerDailyNeighborhood": MINIMUM_GOOD_PIXELS_PER_DAY,
            "minimumValidDaysPerMonth": 1,
            "thresholdSensitivityObservedMonths": sensitivity,
            "calendarMonthCoverage": calendar_month_coverage(
                series,
                month_keys(date(2000, 2, 1), last_completed_month_end()),
            ),
            "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
        },
        "series": series,
    }
    output = write_story_data(LOCATION_ID, payload)
    values = [point["value"] for point in series]
    print(
        f"{LOCATION_ID}: {len(series)} observed months, "
        f"{series[0]['year']}-{series[0]['month']:02d} to "
        f"{series[-1]['year']}-{series[-1]['month']:02d}, "
        f"{len(missing_months)} months without valid sampled retrievals"
    )
    print(f"  value range: {min(values):.6g} to {max(values):.6g}")
    print(f"  observed months at 5-pixel threshold: {sensitivity['5']}; at 10-pixel threshold: {sensitivity['10']}")
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
