from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from threading import local
from typing import Any

import h5py
import numpy as np
from requests import Session

from common import summarize, write_story_data
from fetch_haiyan_black_marble import (
    CMR_URL,
    DATASET,
    HttpRangeReader,
    create_session,
    data_url,
    fetch_story_data,
    find_monthly_granules,
    valid_radiance_values,
)

LOCATION_ID = "surigao-city"
LATITUDE = 9.7843
LONGITUDE = 125.4888
LOCATION_NAME = "central Surigao City"
START_YEAR = 2012
START_MONTH = 1
END_YEAR = 2026
END_MONTH = 10
MINIMUM_VALID_PIXELS = 35
DAILY_COLLECTION_ID = "C3365931269-LAADS"
DAILY_MINIMUM_VALID_PIXELS = 10
DAILY_PRODUCT_URL = "https://doi.org/10.5067/VIIRS/VNP46A2.002"
DAILY_RADIANCE_FIELD = "DNB_BRDF-Corrected_NTL"
DAILY_QUALITY_FIELD = "Mandatory_Quality_Flag"
DAILY_QUERY_YEAR = 2022
DAILY_QUERY_MONTH = 1
DAILY_MAX_WORKERS = 4
_daily_thread_state = local()


def _daily_session() -> Session:
    client = getattr(_daily_thread_state, "client", None)
    if client is None:
        client = create_session()
        _daily_thread_state.client = client
    return client


def find_daily_granules(client: Session) -> list[dict[str, Any]]:
    start = date(DAILY_QUERY_YEAR, DAILY_QUERY_MONTH, 1)
    if DAILY_QUERY_MONTH == 12:
        end = date(DAILY_QUERY_YEAR + 1, 1, 1)
    else:
        end = date(DAILY_QUERY_YEAR, DAILY_QUERY_MONTH + 1, 1)
    response = client.get(
        CMR_URL,
        params={
            "collection_concept_id": DAILY_COLLECTION_ID,
            "temporal": f"{start.isoformat()}T00:00:00Z,{end.isoformat()}T00:00:00Z",
            "point": f"{LONGITUDE},{LATITUDE}",
            "page_size": 100,
            "sort_key": "start_date",
        },
        timeout=60,
    )
    response.raise_for_status()
    entries = response.json()["feed"]["entry"]
    daily_entries = [
        entry for entry in entries
        if (match := re.search(r"\.A(?P<year>\d{4})(?P<day>\d{3})\.", entry.get("producer_granule_id", "")))
        and match.group("year") == str(DAILY_QUERY_YEAR)
        and entry.get("time_start", "").startswith(f"{DAILY_QUERY_YEAR}-{DAILY_QUERY_MONTH:02d}-")
    ]
    return sorted(daily_entries, key=lambda entry: entry["time_start"])


def daily_data_url(entry: dict[str, Any]) -> str:
    for link in entry.get("links", []):
        href = link.get("href", "")
        if "data.laadsdaac.earthdatacloud.nasa.gov" in href and "/VNP46A2/" in href:
            return href
    raise RuntimeError(
        f"No NASA LAADS VNP46A2 data URL found for {entry.get('producer_granule_id', 'unknown granule')}."
    )


def extract_monthly_land_mask() -> np.ndarray:
    client = create_session()
    granules = find_monthly_granules(
        client,
        latitude=LATITUDE,
        longitude=LONGITUDE,
        start_year=DAILY_QUERY_YEAR,
        start_month=DAILY_QUERY_MONTH,
        end_year=DAILY_QUERY_YEAR,
        end_month=DAILY_QUERY_MONTH,
    )
    entry = granules.get(f"{DAILY_QUERY_YEAR}-{DAILY_QUERY_MONTH:02d}")
    if entry is None:
        raise RuntimeError("NASA CMR returned no matching VNP46A3 monthly sample for Surigao.")
    remote_file = HttpRangeReader(data_url(entry), client)
    try:
        with h5py.File(remote_file, "r") as granule:
            fields = granule[DATASET]
            latitudes = fields["lat"][:]
            longitudes = fields["lon"][:]
            row = int(np.argmin(np.abs(latitudes - LATITUDE)))
            column = int(np.argmin(np.abs(longitudes - LONGITUDE)))
            radius = 5
            row_slice = slice(max(0, row - radius), min(len(latitudes), row + radius + 1))
            column_slice = slice(max(0, column - radius), min(len(longitudes), column + radius + 1))
            return fields["Land_Water_Mask"][row_slice, column_slice]
    finally:
        remote_file.close()


def extract_daily_sample(
    entry: dict[str, Any],
    land_water: np.ndarray,
) -> dict[str, str | int | None]:
    remote_file = HttpRangeReader(daily_data_url(entry), _daily_session())
    try:
        with h5py.File(remote_file, "r") as granule:
            fields = granule[DATASET]
            latitudes = fields["lat"][:]
            longitudes = fields["lon"][:]
            row = int(np.argmin(np.abs(latitudes - LATITUDE)))
            column = int(np.argmin(np.abs(longitudes - LONGITUDE)))
            if land_water.shape != (11, 11):
                raise ValueError(f"Expected an 11x11 monthly land/water mask, got {land_water.shape}.")
            radius = 5
            row_slice = slice(max(0, row - radius), min(len(latitudes), row + radius + 1))
            column_slice = slice(max(0, column - radius), min(len(longitudes), column + radius + 1))
            radiance = fields[DAILY_RADIANCE_FIELD][row_slice, column_slice]
            quality = fields[DAILY_QUALITY_FIELD][row_slice, column_slice]
            values = valid_radiance_values(radiance, quality, land_water)
            day = entry["time_start"][:10]
            return {
                "date": day,
                "medianRadiance": round(float(np.median(values)), 6) if values.size else None,
                "validPixelSamples": int(values.size),
            }
    finally:
        remote_file.close()


def fetch_daily_crosscheck() -> dict[str, Any]:
    client = create_session()
    entries = find_daily_granules(client)
    expected_days = date(DAILY_QUERY_YEAR, DAILY_QUERY_MONTH + 1, 1) - date(
        DAILY_QUERY_YEAR, DAILY_QUERY_MONTH, 1
    )
    expected_dates = {
        date(DAILY_QUERY_YEAR, DAILY_QUERY_MONTH, day).isoformat()
        for day in range(1, expected_days.days + 1)
    }
    returned_dates = [entry["time_start"][:10] for entry in entries]
    if len(entries) != expected_days.days or set(returned_dates) != expected_dates:
        raise RuntimeError(
            f"Expected one daily VNP46A2 granule for each of {expected_days.days} January 2022 dates; "
            f"found {len(entries)} granules for {len(set(returned_dates))} unique dates."
        )
    land_water = extract_monthly_land_mask()
    samples_by_date: dict[str, dict[str, str | int | None]] = {}
    with ThreadPoolExecutor(max_workers=DAILY_MAX_WORKERS) as executor:
        futures = {
            executor.submit(extract_daily_sample, entry, land_water): entry["time_start"][:10]
            for entry in entries
        }
        for future in as_completed(futures):
            samples_by_date[futures[future]] = future.result()
    samples = [samples_by_date[key] for key in sorted(samples_by_date)]
    return {
        "product": "VNP46A2.002 daily Black Marble",
        "url": DAILY_PRODUCT_URL,
        "radianceLayer": DAILY_RADIANCE_FIELD,
        "qualityRule": "Mandatory_Quality_Flag == 0 and monthly land/water mask 0 or 1",
        "neighborhood": "Same 11x11 cell neighborhood as the monthly series",
        "minimumValidPixelsPerDay": DAILY_MINIMUM_VALID_PIXELS,
        "daysWithGranules": len(samples),
        "daysMeetingMinimumSupport": sum(
            sample["validPixelSamples"] >= DAILY_MINIMUM_VALID_PIXELS
            for sample in samples
        ),
        "dailySamples": samples,
    }


def main() -> None:
    payload = fetch_story_data(
        location_id=LOCATION_ID,
        latitude=LATITUDE,
        longitude=LONGITUDE,
        location_name=LOCATION_NAME,
        start_year=START_YEAR,
        start_month=START_MONTH,
        end_year=END_YEAR,
        end_month=END_MONTH,
        minimum_valid_pixels=MINIMUM_VALID_PIXELS,
    )
    payload["sampling"]["dailyCrossCheck"] = fetch_daily_crosscheck()
    payload["references"] = [{
        "mission": "NASA Suomi NPP / VIIRS Black Marble",
        "product": "VNP46A2.002 daily Black Marble",
        "url": DAILY_PRODUCT_URL,
    }]
    payload["continuity"] = {
        "method": "Linear interpolation between adjacent valid monthly observations for interior gaps of at most two months; source observations remain unchanged.",
        "maximumInterpolatedGapMonths": 2,
    }
    payload["scaleNote"] += (
        " Only interior gaps of at most two months are linearly estimated for chart and audio continuity; "
        "those estimates are not observations."
    )
    output_path = write_story_data(LOCATION_ID, payload)
    summarize(LOCATION_ID, payload["series"])
    print(f"  nearest NASA grid cell: {payload['gridCell']['nearestCellCenter']}")
    print(f"  wrote {output_path}")


if __name__ == "__main__":
    main()
