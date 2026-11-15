from __future__ import annotations

import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from threading import local
from urllib.parse import quote

from common import earthdata_token, get_json, session, write_story_data

LOCATION_ID = "koronadal-city"
LATITUDE = 6.5004041
LONGITUDE = 124.8435437
START_DATE = date(2010, 1, 1)
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
COLLECTION_ID = "C1276812866-GES_DISC"
PRODUCT_URL = "https://disc.gsfc.nasa.gov/datasets/M2TMNXAER_5.12.4/summary"
OPENDAP_VARIABLE = "TOTEXTTAU"
LATITUDE_RESOLUTION = 0.5
LONGITUDE_RESOLUTION = 0.625
FILL_VALUE_THRESHOLD = 1e10
MAX_WORKERS = 4
_thread_state = local()

LATITUDE_INDEX = round((LATITUDE + 90) / LATITUDE_RESOLUTION)
LONGITUDE_INDEX = round((LONGITUDE + 180) / LONGITUDE_RESOLUTION)
GRID_LATITUDE = -90 + LATITUDE_INDEX * LATITUDE_RESOLUTION
GRID_LONGITUDE = -180 + LONGITUDE_INDEX * LONGITUDE_RESOLUTION


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


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0088
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * earth_radius_km * math.asin(math.sqrt(haversine))


GRID_DISTANCE_KM = haversine_km(LATITUDE, LONGITUDE, GRID_LATITUDE, GRID_LONGITUDE)


def _scalar(text: str, pattern: str, label: str) -> float:
    match = re.search(pattern, text, re.MULTILINE)
    if match is None:
        raise ValueError(f"NASA GES DISC OPeNDAP response did not contain {label}.")
    return float(match.group(1))


def parse_opendap_response(text: str) -> float | None:
    latitude = _scalar(text, r"^lat,\s*([-+\d.eE]+)\s*$", "latitude coordinate")
    longitude = _scalar(text, r"^lon,\s*([-+\d.eE]+)\s*$", "longitude coordinate")
    if not math.isclose(latitude, GRID_LATITUDE, abs_tol=1e-6):
        raise ValueError(f"Unexpected MERRA-2 latitude center: {latitude}.")
    if not math.isclose(longitude, GRID_LONGITUDE, abs_tol=1e-6):
        raise ValueError(f"Unexpected MERRA-2 longitude center: {longitude}.")

    value = _scalar(
        text,
        rf"^{OPENDAP_VARIABLE}\.{OPENDAP_VARIABLE}\[[^\r\n]*\],\s*([-+\d.eE]+)\s*$",
        f"{OPENDAP_VARIABLE} value",
    )
    if not math.isfinite(value) or value < 0 or value >= FILL_VALUE_THRESHOLD:
        return None
    return value


def opendap_url(entry: dict) -> str:
    for link in entry.get("links", []):
        href = link.get("href", "")
        if "opendap.earthdata.nasa.gov" in href:
            return href
    raise RuntimeError(f"No NASA GES DISC OPeNDAP link found for {entry.get('producer_granule_id')}.")


def query_granules(client, end_date: date) -> dict[str, dict]:
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

    by_month: dict[str, dict] = {}
    for entry in entries:
        month = entry["time_start"][:7]
        if month in by_month:
            raise RuntimeError(f"CMR returned multiple MERRA-2 monthly granules for {month}.")
        by_month[month] = entry
    if not by_month:
        raise RuntimeError("NASA CMR returned no MERRA-2 monthly granules for Koronadal.")
    return by_month


def _thread_session(token: str):
    client = getattr(_thread_state, "client", None)
    if client is None:
        client = session(token)
        _thread_state.client = client
    return client


def fetch_month(entry: dict, token: str) -> float | None:
    constraint = (
        f"lat[{LATITUDE_INDEX}],lon[{LONGITUDE_INDEX}],"
        f"{OPENDAP_VARIABLE}[0][{LATITUDE_INDEX}][{LONGITUDE_INDEX}]"
    )
    url = f"{opendap_url(entry)}.ascii?{quote(constraint, safe='[],=')}"
    response = _thread_session(token).get(url, timeout=120)
    response.raise_for_status()
    return parse_opendap_response(response.text)


def build_payload(month_values: dict[str, float | None], latest_month: str) -> dict:
    latest_date = date.fromisoformat(f"{latest_month}-01")
    expected_months = month_keys(START_DATE, latest_date)
    series = []
    for month_key in expected_months:
        value = month_values.get(month_key)
        if value is not None:
            year, month = (int(part) for part in month_key.split("-"))
            series.append({"year": year, "month": month, "value": value})
    if not series:
        raise RuntimeError("MERRA-2 returned no valid monthly aerosol optical thickness values for Koronadal.")

    missing_months = [month for month in expected_months if month_values.get(month) is None]
    return {
        "locationId": LOCATION_ID,
        "metric": "monthly_mean_aerosol_optical_thickness_055",
        "unit": "Aerosol optical thickness at 0.55 micrometers, unitless",
        "source": {
            "mission": "NASA GMAO MERRA-2",
            "product": "M2TMNXAER.5.12.4 TOTEXTTAU, monthly mean total aerosol extinction AOT at 550 nm",
            "url": PRODUCT_URL,
        },
        "references": [
            {
                "mission": "NASA GES DISC",
                "product": "MERRA-2 tavgM_2d_aer_Nx monthly aerosol diagnostics",
                "url": PRODUCT_URL,
            },
            {
                "mission": "Caido et al. (2022), Atmosphere 13(6), 939",
                "product": "Spatiotemporal Analysis of MODIS Aerosol Optical Depth Data in the Philippines from 2010 to 2020",
                "url": "https://doi.org/10.3390/atmos13060939",
            },
        ],
        "scaleNote": (
            "This is NASA GMAO MERRA-2, a global atmospheric reanalysis that assimilates observations, not a "
            "direct satellite retrieval. Each monthly value is the 550 nm total aerosol optical thickness from "
            "one nearest grid cell centered at 6.5°N, 125.0°E, about "
            f"{GRID_DISTANCE_KM:.1f} km from the OpenStreetMap city-reference point. The grid is 0.5° by "
            "0.625° (roughly 50–70 km); it is regional atmospheric-column context, not ground-level PM2.5/PM10, "
            "personal exposure, or a measurement at a specific community. The published Koronadal study used "
            "MODIS AOD at 470 nm: its values and MODIS-AERONET validation do not validate or directly compare "
            "with this coarser MERRA-2 550 nm series. Monthly means also cannot resolve individual haze days. "
            "Months without a valid value are omitted, not zero."
        ),
        "sampling": {
            "method": (
                "For each available calendar month, retrieve the MERRA-2 M2TMNXAER.5.12.4 TOTEXTTAU monthly "
                "mean from the nearest grid-cell center to the Koronadal administrative-city reference point. "
                "No spatial averaging or temporal interpolation is applied."
            ),
            "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
            "coordinateNote": "OpenStreetMap Koronadal administrative-city reference point; not the AERONET station coordinate.",
            "gridCellCenter": {"latitude": GRID_LATITUDE, "longitude": GRID_LONGITUDE},
            "gridCellDistanceKm": round(GRID_DISTANCE_KM, 2),
            "gridResolutionDegrees": {
                "latitude": LATITUDE_RESOLUTION,
                "longitude": LONGITUDE_RESOLUTION,
            },
            "validGranulesByMonth": {
                month: int(value is not None) for month, value in month_values.items()
            },
            "missingMonths": missing_months,
            "publishedStudyNote": (
                "The cited Koronadal paper analyzes MODIS AOD at 470 nm. Its reported seasonal findings and "
                "MODIS-AERONET validation are research context only and do not validate this MERRA-2 series."
            ),
        },
        "series": series,
    }


def fetch_series() -> dict:
    token = earthdata_token()
    client = session(token)
    granules = query_granules(client, last_completed_month_end())
    latest_month = max(granules)
    latest_date = date.fromisoformat(f"{latest_month}-01")
    expected_months = month_keys(START_DATE, latest_date)
    month_values: dict[str, float | None] = {month: None for month in expected_months}
    available = {month: granules[month] for month in expected_months if month in granules}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_month, entry, token): month
            for month, entry in available.items()
        }
        for future in as_completed(futures):
            month = futures[future]
            month_values[month] = future.result()
            status = "valid" if month_values[month] is not None else "fill value"
            print(f"{month}: {status}")
    return build_payload(month_values, latest_month)


def main() -> None:
    payload = fetch_series()
    output = write_story_data(LOCATION_ID, payload)
    series = payload["series"]
    print(
        f"{LOCATION_ID}: {len(series)} observed months, "
        f"{series[0]['year']}-{series[0]['month']:02d} to "
        f"{series[-1]['year']}-{series[-1]['month']:02d}, "
        f"{len(payload['sampling']['missingMonths'])} months without valid monthly values"
    )
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
