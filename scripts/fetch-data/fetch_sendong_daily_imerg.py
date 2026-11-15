from __future__ import annotations

import json
import math
import re
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote
from typing import Any

from requests import Session

from common import OUTPUT_DIR, earthdata_token, session, write_story_data

LOCATION_ID = "cagayan-de-oro"
LATITUDE = 8.4542
LONGITUDE = 124.6319
GRID_RESOLUTION = 0.1
GRID_LATITUDE_INDEX = round((LATITUDE + 89.95) / GRID_RESOLUTION)
GRID_LONGITUDE_INDEX = round((LONGITUDE + 179.95) / GRID_RESOLUTION)
GRID_CENTER_LATITUDE = -89.95 + GRID_LATITUDE_INDEX * GRID_RESOLUTION
GRID_CENTER_LONGITUDE = -179.95 + GRID_LONGITUDE_INDEX * GRID_RESOLUTION
COLLECTION_ID = "C2723754864-GES_DISC"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
PRODUCT_URL = "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary"
LATE_COLLECTION_ID = "C2723754859-GES_DISC"
LATE_PRODUCT_URL = "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDL_07/summary"
DAILY_SCALE_NOTE = (
    "A separate daily IMERG Final Run sample covers 13–20 December 2011 at the same "
    "0.1° cell; it is a grid estimate, not the upstream Capehan rain-gauge observation."
)
OPENDAP_ARRAY = "precipitation"
FILL_VALUE = -9999.9
START_DATE = date(2011, 12, 13)
END_DATE = date(2011, 12, 20)
BASYANG_START_DATE = date(2026, 2, 4)
BASYANG_END_DATE = date(2026, 2, 10)


def expected_dates(start_date: date = START_DATE, end_date: date = END_DATE) -> list[str]:
    days = (end_date - start_date).days + 1
    return [(start_date + timedelta(days=offset)).isoformat() for offset in range(days)]


def parse_daily_precipitation(text: str) -> float | None:
    pattern = re.compile(
        r"^precipitation\.precipitation\[.*\],\s*"
        r"(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$",
        re.MULTILINE,
    )
    matches = pattern.findall(text)
    if len(matches) != 1:
        raise ValueError(
            "NASA GPM OPeNDAP response did not contain exactly one Cagayan de Oro daily precipitation value."
        )
    value = float(matches[0])
    if not math.isfinite(value) or math.isclose(value, FILL_VALUE, abs_tol=0.01):
        return None
    if value < 0:
        raise ValueError(f"NASA GPM returned an unexpected negative daily precipitation value: {value}.")
    return value


def find_daily_granules(
    client: Session,
    start_date: date = START_DATE,
    end_date: date = END_DATE,
    collection_id: str = COLLECTION_ID,
) -> list[dict[str, Any]]:
    response = client.get(
        CMR_URL,
        params={
            "collection_concept_id": collection_id,
            "temporal": (
                f"{start_date.isoformat()}T00:00:00Z,"
                f"{(end_date + timedelta(days=1)).isoformat()}T00:00:00Z"
            ),
            "point": f"{LONGITUDE},{LATITUDE}",
            "page_size": 100,
            "sort_key": "start_date",
        },
        timeout=60,
    )
    response.raise_for_status()
    expected = set(expected_dates(start_date, end_date))
    entries = [
        entry
        for entry in response.json()["feed"]["entry"]
        if entry.get("time_start", "")[:10] in expected
    ]
    entries_by_date = {entry["time_start"][:10]: entry for entry in entries}
    if set(entries_by_date) != expected or len(entries_by_date) != len(entries):
        raise RuntimeError(
            "NASA CMR did not return exactly one daily IMERG granule for each "
            f"requested date: expected {sorted(expected)}, got {sorted(entries_by_date)}."
        )
    return [entries_by_date[day] for day in sorted(entries_by_date)]


def opendap_url(entry: dict[str, Any]) -> str:
    for link in entry.get("links", []):
        if "service#" in link.get("rel", "") and "opendap.earthdata.nasa.gov" in link.get("href", ""):
            return link["href"]
    raise RuntimeError(
        f"No NASA GES DISC OPeNDAP URL found for {entry.get('producer_granule_id', 'unknown granule')}."
    )


def fetch_daily_sample(entry: dict[str, Any], client: Session) -> dict[str, Any]:
    constraint = (
        f"{OPENDAP_ARRAY}[0][{GRID_LONGITUDE_INDEX}][{GRID_LATITUDE_INDEX}]"
    )
    url = f"{opendap_url(entry)}.ascii?{quote(constraint, safe='[]/:,')}"
    response = client.get(url, timeout=120)
    response.raise_for_status()
    value = parse_daily_precipitation(response.text)
    if value is None:
        raise RuntimeError(f"NASA IMERG returned no valid precipitation for {entry['time_start'][:10]}.")
    return {
        "date": entry["time_start"][:10],
        "value": round(value, 3),
        "unit": "mm/day",
        "validGridCell": [round(GRID_CENTER_LATITUDE, 5), round(GRID_CENTER_LONGITUDE, 5)],
    }


def fetch_daily_rainfall(
    client: Session,
    start_date: date = START_DATE,
    end_date: date = END_DATE,
    collection_id: str = COLLECTION_ID,
    product: str = "GPM_3IMERGDF.07 Final Run daily precipitation",
    product_url: str = PRODUCT_URL,
) -> dict[str, Any]:
    entries = find_daily_granules(client, start_date, end_date, collection_id)
    samples = [fetch_daily_sample(entry, client) for entry in entries]
    return {
        "product": product,
        "url": product_url,
        "variable": OPENDAP_ARRAY,
        "unit": "mm/day",
        "temporalBasis": "Daily accumulation on UTC calendar dates; Philippines local dates are UTC+8.",
        "eventWindowUtc": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
        },
        "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
        "gridCellCenter": {
            "latitude": round(GRID_CENTER_LATITUDE, 5),
            "longitude": round(GRID_CENTER_LONGITUDE, 5),
        },
        "gridResolutionDegrees": GRID_RESOLUTION,
        "method": (
            "Nearest 0.1-degree grid cell to the Cagayan de Oro reference coordinate; "
            "daily granule values are sampled independently and are not accumulated from the monthly series."
        ),
        "dailySamples": samples,
    }


def main() -> None:
    path = OUTPUT_DIR / f"{LOCATION_ID}.json"
    if not path.exists():
        raise FileNotFoundError(f"Expected the existing Cagayan de Oro monthly dataset at {path}.")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("locationId") != LOCATION_ID:
        raise ValueError(f"Unexpected location in {path}: {payload.get('locationId')!r}.")
    client = session(earthdata_token())
    daily_rainfall = fetch_daily_rainfall(client)
    basyang_rainfall = fetch_daily_rainfall(
        client,
        BASYANG_START_DATE,
        BASYANG_END_DATE,
        LATE_COLLECTION_ID,
        "GPM_3IMERGDL.07 Late Run daily precipitation",
        LATE_PRODUCT_URL,
    )
    payload.setdefault("sampling", {})["sendongDailyRainfall"] = daily_rainfall
    payload["sampling"]["basyangDailyRainfall"] = basyang_rainfall
    payload["references"] = [
        reference
        for reference in payload.get("references", [])
        if reference.get("url") not in {PRODUCT_URL, LATE_PRODUCT_URL}
    ] + [{
        "mission": "NASA GES DISC",
        "product": "GPM IMERG Final V07 daily precipitation",
        "url": PRODUCT_URL,
    }, {
        "mission": "NASA GES DISC",
        "product": "GPM IMERG Late V07 daily precipitation",
        "url": LATE_PRODUCT_URL,
    }]
    if DAILY_SCALE_NOTE not in payload["scaleNote"]:
        payload["scaleNote"] += f" {DAILY_SCALE_NOTE}"
    output_path = write_story_data(LOCATION_ID, payload)
    print(f"Daily IMERG Sendong samples: {daily_rainfall['dailySamples']}")
    print(f"Daily IMERG Basyang samples: {basyang_rainfall['dailySamples']}")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
