from __future__ import annotations

import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from threading import local
from urllib.parse import quote

from common import earthdata_token, get_json, session, write_story_data

LOCATION_ID = "cagayan-de-oro"
LATITUDE = 8.4542
LONGITUDE = 124.6319
GRID_RESOLUTION = 0.1
GRID_LATITUDE_INDEX = round((LATITUDE + 89.95) / GRID_RESOLUTION)
GRID_LONGITUDE_INDEX = round((LONGITUDE + 179.95) / GRID_RESOLUTION)
GRID_CENTER_LATITUDE = -89.95 + GRID_LATITUDE_INDEX * GRID_RESOLUTION
GRID_CENTER_LONGITUDE = -179.95 + GRID_LONGITUDE_INDEX * GRID_RESOLUTION
START_YEAR = 1998
COLLECTION_ID = "C2723754851-GES_DISC"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
PRODUCT_URL = "https://gpm.nasa.gov/data/imerg"
GES_DISC_URL = "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary"
OPENDAP_ARRAY = "/Grid/precipitation"
FILL_VALUE = -9999.9
MAX_WORKERS = 8
_thread_state = local()


def month_keys(start: date, end: date) -> list[str]:
    keys: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        keys.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return keys


def parse_monthly_precipitation_rate(text: str) -> float | None:
    pattern = re.compile(
        r"^/Grid/precipitation\.precipitation\[.*\],\s*"
        r"(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$",
        re.MULTILINE,
    )
    matches = pattern.findall(text)
    if len(matches) != 1:
        raise ValueError(
            "NASA GPM OPeNDAP response did not contain exactly one Cagayan de Oro precipitation value."
        )
    value = float(matches[0])
    if not math.isfinite(value) or math.isclose(value, FILL_VALUE, abs_tol=0.01):
        return None
    if value < 0:
        raise ValueError(f"NASA GPM returned an unexpected negative precipitation rate: {value}.")
    return value


def monthly_total_mm(rate_mm_per_hour: float, year: int, month: int) -> float:
    if not 1 <= month <= 12:
        raise ValueError("Month values must be between 1 and 12.")
    days_in_month = (date(year + (month == 12), month % 12 + 1, 1) - date(year, month, 1)).days
    return rate_mm_per_hour * days_in_month * 24


def opendap_url(entry: dict) -> str:
    for link in entry.get("links", []):
        href = link.get("href", "")
        if "opendap.earthdata.nasa.gov" in href:
            return href
    raise RuntimeError(f"No NASA GES DISC OPeNDAP link found for {entry.get('producer_granule_id')}.")


def query_granules(client, today: date | None = None) -> dict[str, dict]:
    today = today or date.today()
    entries: list[dict] = []
    page_number = 1
    page_size = 2000
    while True:
        page = get_json(
            client,
            CMR_URL,
            params={
                "collection_concept_id": COLLECTION_ID,
                "temporal": f"{START_YEAR}-01-01T00:00:00Z,{today.isoformat()}T23:59:59Z",
                "point": f"{LONGITUDE},{LATITUDE}",
                "page_size": page_size,
                "page_num": page_number,
                "sort_key": "start_date",
            },
        )["feed"]["entry"]
        entries.extend(page)
        if len(page) < page_size:
            break
        page_number += 1

    granules_by_month: dict[str, dict] = {}
    for entry in entries:
        month_key = entry["time_start"][:7]
        previous = granules_by_month.get(month_key)
        if previous is None or entry.get("updated", "") > previous.get("updated", ""):
            granules_by_month[month_key] = entry
    if not granules_by_month:
        raise RuntimeError("NASA CMR returned no GPM IMERG monthly granules for Cagayan de Oro.")
    return granules_by_month


def _thread_session(token: str):
    client = getattr(_thread_state, "client", None)
    if client is None:
        client = session(token)
        _thread_state.client = client
    return client


def fetch_monthly_precipitation(entry: dict, token: str) -> float | None:
    constraint = (
        f"{OPENDAP_ARRAY}[0][{GRID_LONGITUDE_INDEX}][{GRID_LATITUDE_INDEX}]"
    )
    url = f"{opendap_url(entry)}.ascii?{quote(constraint, safe='[]/:,')}"
    response = _thread_session(token).get(url, timeout=120)
    response.raise_for_status()
    return parse_monthly_precipitation_rate(response.text)


def build_payload(
    rates_by_month: dict[str, float | None],
    candidate_months: list[str],
) -> dict:
    latest_month = max(candidate_months)
    expected_months = month_keys(date(START_YEAR, 1, 1), date.fromisoformat(f"{latest_month}-01"))
    series = []
    missing_months = []
    for month_key in expected_months:
        rate = rates_by_month.get(month_key)
        if rate is None:
            missing_months.append(month_key)
            continue
        year, month = (int(part) for part in month_key.split("-"))
        series.append({
            "year": year,
            "month": month,
            "value": round(monthly_total_mm(rate, year, month), 3),
        })
    if not series:
        raise RuntimeError("NASA GPM IMERG returned no valid monthly precipitation estimates for Cagayan de Oro.")

    return {
        "locationId": LOCATION_ID,
        "datasetId": "cagayan-de-oro-gpm-imerg",
        "metric": "monthly_precipitation_total",
        "unit": "mm/month",
        "source": {
            "mission": "NASA GPM IMERG",
            "product": "GPM_3IMERGM.07 Final Run, monthly merged microwave-infrared-gauge precipitation",
            "url": PRODUCT_URL,
        },
        "references": [{
            "mission": "NASA GES DISC",
            "product": "GPM IMERG Monthly V07 dataset",
            "url": GES_DISC_URL,
        }],
        "scaleNote": (
            "This is a satellite-based, multi-sensor precipitation estimate with a monthly gauge adjustment, "
            "not a local rain-gauge observation. The sampled 0.1° grid cell is centered at "
            f"{GRID_CENTER_LATITUDE:.2f}°N, {GRID_CENTER_LONGITUDE:.2f}°E. Monthly totals cannot resolve "
            "short cloudbursts, river rise, flood depth, or neighborhood impacts. IMERG's archived monthly "
            "record currently ends in September 2025; no later month is implied."
        ),
        "sampling": {
            "method": (
                "Sample the nearest 0.1° GPM IMERG grid cell to the Cagayan de Oro reference coordinate. "
                "The monthly product's precipitation field is a mean rate in mm/hour; multiply by the "
                "calendar month's hours to obtain mm/month. Valid zero values are retained and fill values "
                "are omitted."
            ),
            "qa": (
                "Uses the GPM IMERG V07 Final Run merged microwave-infrared-gauge precipitation field. "
                "The monthly product incorporates gauge adjustment; no additional pixel-quality threshold "
                "is applied."
            ),
            "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
            "gridCellCenter": {
                "latitude": GRID_CENTER_LATITUDE,
                "longitude": GRID_CENTER_LONGITUDE,
            },
            "gridResolutionDegrees": GRID_RESOLUTION,
            "missingMonths": missing_months,
            "candidateMonths": candidate_months,
        },
        "series": series,
    }


def fetch_series() -> dict:
    token = earthdata_token()
    client = session(token)
    granules_by_month = query_granules(client)
    rates_by_month: dict[str, float | None] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_monthly_precipitation, entry, token): month
            for month, entry in granules_by_month.items()
        }
        completed = 0
        for future in as_completed(futures):
            rates_by_month[futures[future]] = future.result()
            completed += 1
            if completed % 50 == 0 or completed == len(futures):
                print(f"Retrieved {completed}/{len(futures)} GPM IMERG monthly subsets", flush=True)
    return build_payload(rates_by_month, sorted(granules_by_month))


def main() -> None:
    payload = fetch_series()
    output = write_story_data(LOCATION_ID, payload)
    series = payload["series"]
    print(
        f"{LOCATION_ID}: {len(series)} observed months, "
        f"{series[0]['year']}-{series[0]['month']:02d} to "
        f"{series[-1]['year']}-{series[-1]['month']:02d}, "
        f"{len(payload['sampling']['missingMonths'])} months without valid estimates"
    )
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
