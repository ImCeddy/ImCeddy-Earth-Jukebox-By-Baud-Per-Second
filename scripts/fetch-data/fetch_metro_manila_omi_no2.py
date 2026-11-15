from __future__ import annotations

import math
import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from threading import local
from urllib.parse import quote

from common import earthdata_token, get_json, session, write_story_data

LOCATION_ID = "metro-manila-lockdown"
LATITUDE = 14.5995
LONGITUDE = 120.9842
START_DATE = date(2004, 10, 1)
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
COLLECTION_ID = "C3333493715-GES_DISC"
PRODUCT_URL = "https://www.earthdata.nasa.gov/data/catalog/ges-disc-omno2-004"
COVID_VIEWER_URL = "https://www.earthdata.nasa.gov/topics/atmosphere/air-quality"
ARRAY_PATH = "/HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields/ColumnAmountNO2TropCloudScreened"
GRID_RESOLUTION = 0.25
GRID_ROWS = 3
GRID_COLUMNS = 3
MINIMUM_VALID_CELLS_PER_DAY = 3
VALUE_SCALE = 1e15
FILL_VALUE = -1.2676506e30
MAX_WORKERS = 8
_thread_state = local()

# OMNO2d's YDim runs north from -89.875 degrees; XDim starts at -179.875.
GRID_Y_INDEX = round((LATITUDE + 89.875) / GRID_RESOLUTION)
GRID_X_INDEX = round((LONGITUDE + 179.875) / GRID_RESOLUTION)
GRID_CENTER_LATITUDE = -89.875 + GRID_Y_INDEX * GRID_RESOLUTION
GRID_CENTER_LONGITUDE = -179.875 + GRID_X_INDEX * GRID_RESOLUTION


def last_completed_month_end(today: date | None = None) -> date:
    today = today or date.today()
    return date(today.year, today.month, 1) - timedelta(days=1)


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


def parse_daily_region(text: str) -> tuple[float, int] | None:
    row_pattern = re.compile(
        rf"^{re.escape(ARRAY_PATH)}\[(\d+)\],\s*(.+)$",
        re.MULTILINE,
    )
    rows: dict[int, list[float]] = {}
    for match in row_pattern.finditer(text):
        row_index = int(match.group(1))
        try:
            rows[row_index] = [float(value.strip()) for value in match.group(2).split(",")]
        except ValueError as error:
            raise ValueError("NASA OMI OPeNDAP response contains a non-numeric grid value.") from error

    expected_rows = set(range(GRID_ROWS))
    if set(rows) != expected_rows or any(len(row) != GRID_COLUMNS for row in rows.values()):
        raise ValueError(
            "NASA OMI OPeNDAP response did not contain the expected 3x3 Metro Manila grid "
            f"(rows={sorted(rows)}, columns={[len(rows[row]) for row in sorted(rows)]})."
        )

    values = [
        value
        for row in rows.values()
        for value in row
        if math.isfinite(value) and not math.isclose(value, FILL_VALUE, rel_tol=1e-6)
    ]
    if len(values) < MINIMUM_VALID_CELLS_PER_DAY:
        return None
    return sum(values) / len(values) / VALUE_SCALE, len(values)


def opendap_url(entry: dict) -> str:
    for link in entry.get("links", []):
        href = link.get("href", "")
        if "opendap.earthdata.nasa.gov" in href:
            return href
    raise RuntimeError(f"No NASA GES DISC OPeNDAP link found for {entry.get('producer_granule_id')}.")


def query_granules(client, end_date: date) -> dict[str, list[dict]]:
    entries: list[dict] = []
    page_number = 1
    page_size = 2000
    while True:
        page = get_json(
            client,
            CMR_URL,
            params={
                "collection_concept_id": COLLECTION_ID,
                "temporal": f"{START_DATE.isoformat()}T00:00:00Z,{end_date.isoformat()}T23:59:59Z",
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

    by_month: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        by_month[entry["time_start"][:7]].append(entry)
    if not entries:
        raise RuntimeError("NASA CMR returned no OMNO2d daily granules for Metro Manila.")
    return by_month


def _thread_session(token: str):
    client = getattr(_thread_state, "client", None)
    if client is None:
        client = session(token)
        _thread_state.client = client
    return client


def fetch_daily_region(entry: dict, token: str) -> tuple[float, int] | None:
    y_start, y_end = GRID_Y_INDEX - 1, GRID_Y_INDEX + 1
    x_start, x_end = GRID_X_INDEX - 1, GRID_X_INDEX + 1
    constraint = f"{ARRAY_PATH}[{y_start}:{y_end}][{x_start}:{x_end}]"
    url = f"{opendap_url(entry)}.ascii?{quote(constraint, safe='[],:/')}"
    response = _thread_session(token).get(url, timeout=120)
    response.raise_for_status()
    return parse_daily_region(response.text)


def build_payload(
    samples_by_month: dict[str, list[tuple[str, tuple[float, int] | None]]],
    candidate_days_by_month: dict[str, int],
    latest_month: str,
) -> dict:
    year, month = (int(part) for part in latest_month.split("-"))
    expected_months = month_keys(START_DATE, date(year, month, 1))
    series = []
    valid_days_by_month: dict[str, int] = {}
    valid_cells_by_month: dict[str, int] = {}
    normalized_candidate_days = {
        month_key: candidate_days_by_month.get(month_key, 0)
        for month_key in expected_months
    }

    for month_key in expected_months:
        samples = samples_by_month.get(month_key, [])
        valid = [(value, cells) for _, result in samples if result is not None for value, cells in [result]]
        valid_days_by_month[month_key] = len(valid)
        valid_cells_by_month[month_key] = sum(cells for _, cells in valid)
        if not valid:
            continue
        point_year, point_month = (int(part) for part in month_key.split("-"))
        series.append({
            "year": point_year,
            "month": point_month,
            "value": sum(value for value, _ in valid) / len(valid),
            "validDailySamples": len(valid),
            "candidateDailySamples": normalized_candidate_days[month_key],
            "validPixelSamples": valid_cells_by_month[month_key],
        })

    if not series:
        raise RuntimeError("NASA OMNO2d returned no valid tropospheric NO₂ columns for Metro Manila.")
    missing_months = [month for month in expected_months if valid_days_by_month[month] == 0]
    return {
        "locationId": LOCATION_ID,
        "metric": "monthly_mean_tropospheric_no2_column_omi",
        "unit": "10^15 molecules/cm²",
        "source": {
            "mission": "NASA Aura OMI / NASA GES DISC",
            "product": "OMNO2d.004 ColumnAmountNO2TropCloudScreened, daily 0.25° L3 gridded tropospheric NO₂ column",
            "url": PRODUCT_URL,
        },
        "references": [{
            "mission": "NASA GES DISC",
            "product": "OMI/Aura NO₂ Cloud-Screened Total and Tropospheric Column L3 Global Gridded 0.25 degree x 0.25 degree, Version 5.0 Collection 004",
            "url": PRODUCT_URL,
        }, {
            "mission": "NASA GES DISC",
            "product": "Air Quality and Climate Anomaly Viewer; OMI March 2020 tropospheric NO₂ compared with March 2010–2019",
            "url": COVID_VIEWER_URL,
        }],
        "scaleNote": (
            "This is the tropospheric NO₂ vertical column, not ground-level NO₂ concentration, personal exposure, "
            "or a direct measure of health effects. Each daily value is the unweighted mean of valid "
            "cloud-screened OMI grid cells in a fixed 3x3 region centered at "
            f"{GRID_CENTER_LATITUDE:.3f}°N, {GRID_CENTER_LONGITUDE:.3f}°E; a day needs at least "
            f"{MINIMUM_VALID_CELLS_PER_DAY} of 9 cells. Monthly values are the arithmetic mean of accepted "
            "daily regional means, with support shown in the record. The grid is about 25 km, the region spans "
            "roughly 75 km, and OMI's row-anomaly and cloud screening create uneven sampling. The March 2020 "
            "marker is context; this series alone cannot attribute a NO₂ change to lockdown measures. Values "
            "are divided by 10^15 for display; months without accepted days are omitted, not zero."
        ),
        "sampling": {
            "method": (
                "For every available OMNO2d.004 daily granule, request the fixed 3x3 grid-cell region around "
                "the Manila reference point. Each daily value is the arithmetic mean of valid "
                "ColumnAmountNO2TropCloudScreened cells; at least three of nine cells are required. The monthly "
                "value is the arithmetic mean of accepted daily regional means. Stored values are divided by "
                "10^15 from the source units of molecules/cm²."
            ),
            "qa": (
                "Uses the OMNO2d.004 ColumnAmountNO2TropCloudScreened field, whose product definition applies "
                "the NASA retrieval quality criteria and cloud fraction below 30%. Fill values are excluded; "
                "valid negative retrievals are retained."
            ),
            "missingMonths": missing_months,
            "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
            "coordinateNote": "Central Manila reference point for a Metro Manila regional sample, not a monitoring station.",
            "gridCellCenter": {
                "latitude": GRID_CENTER_LATITUDE,
                "longitude": GRID_CENTER_LONGITUDE,
            },
            "gridResolutionDegrees": GRID_RESOLUTION,
            "regionGridShape": [GRID_ROWS, GRID_COLUMNS],
            "minimumValidCellsPerDailyRegion": MINIMUM_VALID_CELLS_PER_DAY,
            "validDailyObservationsByMonth": valid_days_by_month,
            "candidateDailyObservationsByMonth": normalized_candidate_days,
            "validGridCellSamplesByMonth": valid_cells_by_month,
            "minimumSupportForLowSupportCue": {
                "validDailySamples": 10,
                "validPixelSamples": 30,
            },
            "pixelSupportLabel": "VALID OMI GRID CELL SAMPLES",
            "march2020Context": (
                "NASA GES DISC's Air Quality and Climate Anomaly Viewer compares OMI March 2020 tropospheric "
                "NO₂ with the March 2010–2019 average. That global comparison is context, not a local causal "
                "finding for Metro Manila."
            ),
        },
        "series": series,
    }


def fetch_series() -> dict:
    token = earthdata_token()
    client = session(token)
    granules_by_month = query_granules(client, last_completed_month_end())
    latest_month = max(granules_by_month)
    samples_by_month: dict[str, list[tuple[str, tuple[float, int] | None]]] = {}
    candidate_days_by_month = {
        month: len(entries) for month, entries in granules_by_month.items()
    }
    futures = {}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for month, entries in granules_by_month.items():
            samples_by_month[month] = []
            for entry in entries:
                future = executor.submit(fetch_daily_region, entry, token)
                futures[future] = (month, entry["time_start"][:10])

        completed = 0
        for future in as_completed(futures):
            month, sample_date = futures[future]
            samples_by_month[month].append((sample_date, future.result()))
            completed += 1
            if completed % 250 == 0 or completed == len(futures):
                print(f"Retrieved {completed}/{len(futures)} OMI daily regional subsets", flush=True)

    for month in samples_by_month:
        samples_by_month[month].sort(key=lambda sample: sample[0])
    return build_payload(samples_by_month, candidate_days_by_month, latest_month)


def main() -> None:
    payload = fetch_series()
    output = write_story_data(LOCATION_ID, payload)
    series = payload["series"]
    print(
        f"{LOCATION_ID}: {len(series)} observed months, "
        f"{series[0]['year']}-{series[0]['month']:02d} to "
        f"{series[-1]['year']}-{series[-1]['month']:02d}, "
        f"{len(payload['sampling']['missingMonths'])} months without valid regional samples"
    )
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
