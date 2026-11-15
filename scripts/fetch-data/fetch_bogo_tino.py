from __future__ import annotations

import io
from datetime import date, timedelta
from typing import Any

import h5py
import numpy as np
from requests import Session

from common import earthdata_token, session, summarize, write_story_data
from fetch_haiyan_black_marble import fetch_story_data

LOCATION_ID = "bogo-cebu-tino"
LATITUDE = 11.0512735
LONGITUDE = 124.0035064
LOCATION_NAME = "Bogo City center, Cebu"
START_YEAR = 2012
START_MONTH = 1
END_YEAR = 2026
END_MONTH = 10
MINIMUM_VALID_PIXELS = 35
DAILY_COLLECTION_ID = "C2723754859-GES_DISC"
DAILY_PRODUCT_URL = "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDL_07/summary"
DAILY_QUERY_START = date(2025, 11, 3)
DAILY_QUERY_END = date(2025, 11, 5)
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
FILL_VALUE = -9999.9


def expected_daily_dates() -> list[str]:
    days = (DAILY_QUERY_END - DAILY_QUERY_START).days + 1
    return [(DAILY_QUERY_START + timedelta(days=offset)).isoformat() for offset in range(days)]


def find_daily_granules(client: Session) -> list[dict[str, Any]]:
    response = client.get(
        CMR_URL,
        params={
            "collection_concept_id": DAILY_COLLECTION_ID,
            "temporal": (
                f"{DAILY_QUERY_START.isoformat()}T00:00:00Z,"
                f"{(DAILY_QUERY_END + timedelta(days=1)).isoformat()}T00:00:00Z"
            ),
            "point": f"{LONGITUDE},{LATITUDE}",
            "page_size": 100,
            "sort_key": "start_date",
        },
        timeout=60,
    )
    response.raise_for_status()
    expected_dates = set(expected_daily_dates())
    entries = [
        entry
        for entry in response.json()["feed"]["entry"]
        if entry.get("time_start", "")[:10] in expected_dates
    ]
    entries_by_date = {entry["time_start"][:10]: entry for entry in entries}
    if set(entries_by_date) != expected_dates or len(entries_by_date) != len(entries):
        raise RuntimeError(
            "NASA CMR did not return exactly one daily IMERG Late granule for each "
            f"requested date: expected {sorted(expected_dates)}, got {sorted(entries_by_date)}."
        )
    return [entries_by_date[day] for day in sorted(entries_by_date)]


def grid_sample(
    precipitation: np.ndarray,
    latitudes: np.ndarray,
    longitudes: np.ndarray,
) -> tuple[float, float, float]:
    if precipitation.shape != (len(longitudes), len(latitudes)):
        raise ValueError(
            "Expected the daily IMERG precipitation grid to have longitude-by-latitude "
            f"shape {(len(longitudes), len(latitudes))}, got {precipitation.shape}."
        )
    latitude_index = int(np.argmin(np.abs(latitudes - LATITUDE)))
    longitude_index = int(np.argmin(np.abs(longitudes - LONGITUDE)))
    value = float(precipitation[longitude_index, latitude_index])
    if not np.isfinite(value) or np.isclose(value, FILL_VALUE, atol=0.01):
        raise ValueError("NASA IMERG returned no valid Bogo grid-cell rainfall for a requested day.")
    if value < 0:
        raise ValueError(f"NASA IMERG returned an unexpected negative daily value: {value}.")
    return value, float(latitudes[latitude_index]), float(longitudes[longitude_index])


def daily_data_url(entry: dict[str, Any]) -> str:
    for link in entry.get("links", []):
        if "data#" in link.get("rel", "") and "data.gesdisc.earthdata.nasa.gov" in link.get("href", ""):
            return link["href"]
    raise RuntimeError(
        f"No NASA GES DISC download URL found for {entry.get('producer_granule_id', 'unknown granule')}."
    )


def fetch_daily_sample(entry: dict[str, Any], client: Session) -> dict[str, Any]:
    response = client.get(daily_data_url(entry), timeout=180)
    response.raise_for_status()
    with h5py.File(io.BytesIO(response.content), "r") as granule:
        required_datasets = ("precipitation", "lat", "lon")
        if any(name not in granule for name in required_datasets):
            raise RuntimeError(
                f"Daily IMERG granule {entry.get('producer_granule_id')} is missing a required variable."
            )
        field = granule["precipitation"]
        if field.ndim != 3 or field.shape[0] != 1:
            raise ValueError(
                f"Expected one daily precipitation field in {entry.get('producer_granule_id')}; "
                f"got shape {field.shape}."
            )
        value, grid_latitude, grid_longitude = grid_sample(
            field[0, :, :],
            granule["lat"][:],
            granule["lon"][:],
        )
        units = field.attrs.get("units")
        unit = units[0] if isinstance(units, np.ndarray) else units
        if isinstance(unit, bytes):
            unit = unit.decode("ascii")
        if unit != "mm/day":
            raise ValueError(f"Unexpected daily IMERG precipitation units: {units!r}.")
    return {
        "date": entry["time_start"][:10],
        "value": round(value, 3),
        "unit": "mm/day",
        "validGridCell": [round(grid_latitude, 5), round(grid_longitude, 5)],
    }


def fetch_daily_rainfall() -> dict[str, Any]:
    client = session(earthdata_token())
    entries = find_daily_granules(client)
    samples = [fetch_daily_sample(entry, client) for entry in entries]
    grid_cells = {tuple(sample["validGridCell"]) for sample in samples}
    if len(grid_cells) != 1:
        raise RuntimeError(f"Daily IMERG returned inconsistent grid cells for Bogo: {sorted(grid_cells)}.")
    return {
        "product": "GPM_3IMERGDL.07 daily Late Run",
        "url": DAILY_PRODUCT_URL,
        "variable": "precipitation",
        "unit": "mm/day",
        "temporalBasis": "Daily accumulation on UTC calendar dates; Philippines local dates are UTC+8.",
        "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
        "gridCellCenter": list(next(iter(grid_cells))),
        "method": "Nearest 0.1-degree grid cell to the Bogo City OpenStreetMap reference point.",
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
    payload["optionLabel"] = "NIGHTTIME RADIANCE"
    payload["sampling"]["dailyRainfallCrossCheck"] = fetch_daily_rainfall()
    payload["scaleNote"] += (
        " A separate NASA GPM IMERG daily Late Run sample covers 3–5 November 2025 at the nearest "
        "0.1-degree grid cell; it is a regional estimate, not a local gauge or flood measurement."
    )
    payload["continuity"] = {
        "method": "Linear interpolation between adjacent valid monthly observations for interior gaps of at most two months; source observations remain unchanged.",
        "maximumInterpolatedGapMonths": 2,
    }
    payload["references"] = [
        {
            "mission": "NASA GPM IMERG",
            "product": "GPM_3IMERGDL.07 daily Late Run precipitation",
            "url": DAILY_PRODUCT_URL,
        },
        {
            "mission": "NASA Earth Information Center",
            "product": "Change in Night Lights between 2012 and 2023",
            "url": "https://earth.gov/themes/energy",
        },
        {
            "mission": "NASA Scientific Visualization Studio",
            "product": "Black Marble Night Lights, 2012–2023",
            "url": "https://svs.gsfc.nasa.gov/5276/",
        },
    ]
    output_path = write_story_data(LOCATION_ID, payload)
    summarize(LOCATION_ID, payload["series"])
    print(f"  nearest VIIRS grid cell: {payload['gridCell']['nearestCellCenter']}")
    print(f"  daily IMERG rainfall: {payload['sampling']['dailyRainfallCrossCheck']['dailySamples']}")
    print(f"  wrote {output_path}")


if __name__ == "__main__":
    main()
