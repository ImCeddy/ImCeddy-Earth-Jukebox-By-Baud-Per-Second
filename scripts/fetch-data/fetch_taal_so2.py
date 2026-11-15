from __future__ import annotations

import re
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from typing import Any
from urllib.parse import quote

import numpy as np

from common import earthdata_token, get_json, session, write_story_data
from maiac_sampling import last_completed_month_end, month_keys

LOCATION_ID = "taal-volcano"
LATITUDE = 14.002
LONGITUDE = 120.993
GRID_RESOLUTION = 0.25
GRID_RADIUS = 1
MIN_VALID_DAYS_PER_MONTH = 1
MAX_WORKERS = 6
CMR_URL = "https://cmr.earthdata.nasa.gov/search"
COLLECTION_ID = "C2567923363-GES_DISC"
PRODUCT = "OMPS_NPP_NMSO2_PCA_L3_DAILY"
VERSION = "1"
OPENDAP_BASE = (
    "https://opendap.earthdata.nasa.gov/collections/"
    f"{COLLECTION_ID}/granules/"
)
START_DATE = date(2012, 1, 26)
THREAD_LOCAL = threading.local()
ROW_PATTERN = re.compile(
    r"^(QualityFlags_SO2|ColumnAmountSO2|CloudRadianceFraction)\.\1\[.*?\],\s*(.*)$"
)


def grid_indices(latitude: float, longitude: float) -> tuple[range, range]:
    latitude_index = round((latitude + 90 - GRID_RESOLUTION / 2) / GRID_RESOLUTION)
    longitude_index = round((longitude + 180 - GRID_RESOLUTION / 2) / GRID_RESOLUTION)
    rows = range(latitude_index - GRID_RADIUS, latitude_index + GRID_RADIUS + 1)
    columns = range(longitude_index - GRID_RADIUS, longitude_index + GRID_RADIUS + 1)
    return rows, columns


def grid_cell_centers() -> tuple[list[float], list[float]]:
    rows, columns = grid_indices(LATITUDE, LONGITUDE)
    latitudes = [-90 + (row + 0.5) * GRID_RESOLUTION for row in rows]
    longitudes = [-180 + (column + 0.5) * GRID_RESOLUTION for column in columns]
    return latitudes, longitudes


def parse_subset_ascii(
    response_text: str,
    expected_cells: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rows: dict[str, list[float]] = {
        "QualityFlags_SO2": [],
        "ColumnAmountSO2": [],
        "CloudRadianceFraction": [],
    }
    for line in response_text.splitlines():
        match = ROW_PATTERN.match(line.strip())
        if not match:
            continue
        variable, values = match.groups()
        try:
            rows[variable].extend(float(value.strip()) for value in values.split(","))
        except ValueError as error:
            raise RuntimeError(f"Could not parse OMPS {variable} values: {line}") from error

    if any(len(values) != expected_cells for values in rows.values()):
        raise RuntimeError(
            "The OMPS OPeNDAP response did not contain the expected regional grids "
            f"(flags={len(rows['QualityFlags_SO2'])}, SO2={len(rows['ColumnAmountSO2'])}, "
            f"cloud fraction={len(rows['CloudRadianceFraction'])}, "
            f"expected={expected_cells})."
        )
    return (
        np.asarray(rows["QualityFlags_SO2"], dtype=float),
        np.asarray(rows["ColumnAmountSO2"], dtype=float),
        np.asarray(rows["CloudRadianceFraction"], dtype=float),
    )


def daily_region_mean(
    flags: np.ndarray,
    amounts: np.ndarray,
    cloud_fraction: np.ndarray,
) -> tuple[float | None, int]:
    if flags.shape != amounts.shape or amounts.shape != cloud_fraction.shape:
        raise RuntimeError("OMPS quality flags, SO2 amounts, and cloud fractions must have matching shapes.")
    valid = (
        (flags == 0)
        & np.isfinite(amounts)
        & (amounts >= -20)
        & (amounts <= 2000)
        & np.isfinite(cloud_fraction)
        & (cloud_fraction >= 0)
        & (cloud_fraction <= 0.2)
    )
    valid_amounts = amounts[valid]
    return (
        float(np.mean(valid_amounts)) if valid_amounts.size else None,
        int(valid_amounts.size),
    )


def extract_daily_region(entry: dict[str, Any], token: str) -> tuple[str, float | None, int]:
    opendap_link = next(
        (
            link["href"]
            for link in entry.get("links", [])
            if "opendap" in link.get("title", "").lower() and link.get("href", "").endswith(".nc")
        ),
        None,
    )
    if not opendap_link:
        raise RuntimeError(f"No OPeNDAP link found for {entry.get('producer_granule_id')}")

    rows, columns = grid_indices(LATITUDE, LONGITUDE)
    constraint = (
        f"QualityFlags_SO2[0][{rows.start}:1:{rows.stop - 1}][{columns.start}:1:{columns.stop - 1}],"
        f"ColumnAmountSO2[0][{rows.start}:1:{rows.stop - 1}][{columns.start}:1:{columns.stop - 1}],"
        f"CloudRadianceFraction[0][{rows.start}:1:{rows.stop - 1}][{columns.start}:1:{columns.stop - 1}]"
    )
    url = opendap_link + ".ascii?" + quote(constraint, safe="[],=:")
    client = getattr(THREAD_LOCAL, "client", None)
    if client is None:
        client = session(token)
        THREAD_LOCAL.client = client
    response = client.get(url, timeout=120)
    response.raise_for_status()
    flags, amounts, cloud_fraction = parse_subset_ascii(response.text, len(rows) * len(columns))
    regional_mean, valid_cells = daily_region_mean(flags, amounts, cloud_fraction)
    return (
        entry["time_start"][:10],
        regional_mean,
        valid_cells,
    )


def query_granules(client, end_date: date) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    page_number = 1
    page_size = 2000
    while True:
        params = {
            "short_name": PRODUCT,
            "version": VERSION,
            "collection_concept_id": COLLECTION_ID,
            "temporal": f"{START_DATE.isoformat()}T00:00:00Z,{end_date.isoformat()}T23:59:59Z",
            "page_size": page_size,
            "page_num": page_number,
            "sort_key": "start_date",
        }
        page = get_json(client, f"{CMR_URL}/granules.json", params=params)["feed"]["entry"]
        entries.extend(page)
        if len(page) < page_size:
            break
        page_number += 1

    unique_by_day: dict[str, dict[str, Any]] = {}
    for entry in entries:
        unique_by_day.setdefault(entry["time_start"][:10], entry)
    return [unique_by_day[key] for key in sorted(unique_by_day)]


def aggregate_monthly(
    daily_samples: list[tuple[str, float | None, int]],
    expected_months: list[str],
) -> tuple[list[dict[str, Any]], list[str], dict[str, int], dict[str, int], dict[str, int], dict[str, list[str]]]:
    by_month: dict[str, list[tuple[str, float | None, int]]] = defaultdict(list)
    for sample in daily_samples:
        by_month[sample[0][:7]].append(sample)

    series: list[dict[str, Any]] = []
    missing_months: list[str] = []
    candidate_days: dict[str, int] = {}
    valid_days: dict[str, int] = {}
    valid_cells: dict[str, int] = {}
    valid_dates: dict[str, list[str]] = {}
    for month_key in expected_months:
        candidates = by_month.get(month_key, [])
        accepted = [(day, value, cells) for day, value, cells in candidates if value is not None]
        candidate_days[month_key] = len(candidates)
        valid_days[month_key] = len(accepted)
        valid_cells[month_key] = sum(cells for _, _, cells in accepted)
        valid_dates[month_key] = [day for day, _, _ in accepted]
        if len(accepted) < MIN_VALID_DAYS_PER_MONTH:
            missing_months.append(month_key)
            continue
        year, month = map(int, month_key.split("-"))
        series.append({
            "year": year,
            "month": month,
            "value": float(np.mean([value for _, value, _ in accepted])),
            "validDailySamples": len(accepted),
            "candidateDailySamples": len(candidates),
            "validPixelSamples": valid_cells[month_key],
        })
    return series, missing_months, candidate_days, valid_days, valid_cells, valid_dates


def fetch_series() -> tuple[list[dict[str, Any]], list[str], dict[str, int], dict[str, int], dict[str, int], dict[str, list[str]]]:
    end_date = last_completed_month_end()
    expected_months = month_keys(START_DATE, end_date)
    token = earthdata_token()
    granules = query_granules(session(), end_date)
    if not granules:
        raise RuntimeError("NASA CMR returned no OMPS daily granules for the Taal time series.")
    print(f"Fetching {len(granules)} daily OMPS regional subsets with up to {MAX_WORKERS} workers.")

    daily_samples: list[tuple[str, float | None, int]] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(extract_daily_region, entry, token): entry for entry in granules}
        for completed, future in enumerate(as_completed(futures), start=1):
            entry = futures[future]
            try:
                daily_samples.append(future.result())
            except Exception as error:
                for pending in futures:
                    pending.cancel()
                raise RuntimeError(
                    f"Failed to retrieve OMPS subset for {entry['producer_granule_id']}"
                ) from error
            if completed % 250 == 0 or completed == len(futures):
                print(f"  retrieved {completed}/{len(futures)} daily subsets")

    daily_samples.sort(key=lambda item: item[0])
    return aggregate_monthly(daily_samples, expected_months)


def main() -> None:
    series, missing, candidate_days, valid_days, valid_cells, valid_dates = fetch_series()
    if not series:
        raise RuntimeError("OMPS had no quality-valid regional SO2 samples for the Taal series.")
    end_date = last_completed_month_end()
    expected_months = month_keys(START_DATE, end_date)
    payload = {
        "locationId": LOCATION_ID,
        "metric": "monthly_mean_regional_so2_column_du",
        "unit": "Dobson Units (DU)",
        "source": {
            "mission": "NASA Suomi-NPP",
            "product": "OMPS Nadir Mapper L3 PCA SO2 total-column daily best-pixel grid, 0.25° (OMPS_NPP_NMSO2_PCA_L3_DAILY V1)",
            "url": "https://doi.org/10.5067/OMPS/OMPS_NPP_NMSO2_PCA_L3_DAILY.1",
        },
        "references": [{
            "mission": "NASA GES DISC",
            "product": "OMPS_NPP_NMSO2_PCA_L3_DAILY V1 Product README",
            "url": "https://omps.gesdisc.eosdis.nasa.gov/data/SNPP_OMPS_Level3/OMPS_NPP_NMSO2_PCA_L3_DAILY.1/doc/README.OMPS_NPP_NMSO2_PCA_L3_DAILY.1.pdf",
        }, {
            "mission": "DOST-PHIVOLCS",
            "product": "Press release on volcanic SO2 dispersal information for Taal Volcano, 30 June 2021",
            "url": "https://www.phivolcs.dost.gov.ph/press-release-on-volcanic-so2-dispersal-information-for-taal-volcano-30-june-2021-6-30-a-m/",
        }],
        "scaleNote": (
            "This is a coarse regional atmospheric SO2 column series, not a ground-level concentration, "
            "vog exposure, ashfall, or health measurement. For each day, the value is the mean of valid "
            "0.25-degree best-pixel cells in a fixed 3x3 grid centered near Taal Volcano (about 83 km across); "
            "the monthly value is the mean of those daily regional means. Cells are accepted only when the "
            "product SO2 quality flag is 0 and cloud radiance fraction is between 0 and 0.2. These monthly "
            "means are event and plume context, not a monitor at the volcano or surrounding communities."
        ),
        "sampling": {
            "method": (
                "For each day with a NASA OMPS Nadir Mapper L3 granule, average valid SO2 column values "
                "over the fixed 3x3 grid-cell region nearest Taal; each cell is 0.25 degrees. The monthly "
                "value is the arithmetic mean of valid daily regional means."
            ),
            "qa": (
                "Use only cells with QualityFlags_SO2 == 0 (good best-pixel result), finite ColumnAmountSO2 "
                "within the product range -20 to 2000 DU, and CloudRadianceFraction from 0 to 0.2. "
                "The source product uses daily best-pixel retrievals."
            ),
            "coordinate": {"latitude": LATITUDE, "longitude": LONGITUDE},
            "gridResolutionDegrees": GRID_RESOLUTION,
            "regionalGridShape": [GRID_RADIUS * 2 + 1, GRID_RADIUS * 2 + 1],
            "regionalGridCellCenters": dict(zip(
                ("latitudes", "longitudes"),
                grid_cell_centers(),
            )),
            "maximumGridCellsPerDay": (GRID_RADIUS * 2 + 1) ** 2,
            "candidateDailyObservationsByMonth": candidate_days,
            "validDailyObservationsByMonth": valid_days,
            "validGridCellSamplesByMonth": valid_cells,
            "validSampleDatesByMonth": valid_dates,
            "missingMonths": missing,
            "minimumValidDaysPerMonth": MIN_VALID_DAYS_PER_MONTH,
            "firstMonthIsPartial": True,
            "period": {
                "start": START_DATE.isoformat(),
                "end": end_date.isoformat(),
                "aggregation": "through the last completed calendar month",
            },
            "calendarMonthCoverage": {
                f"{month:02d}": {
                    "observedMonths": sum(point["month"] == month for point in series),
                    "expectedMonths": sum(int(key[5:7]) == month for key in expected_months),
                }
                for month in range(1, 13)
            },
            "minimumSupportForLowSupportCue": {"validDailySamples": 3, "validPixelSamples": 5},
            "pixelSupportLabel": "VALID REGIONAL GRID CELLS",
        },
        "series": series,
    }
    output = write_story_data(LOCATION_ID, payload)
    print(
        f"{LOCATION_ID}: {len(series)} observed months, "
        f"{series[0]['year']}-{series[0]['month']:02d} to "
        f"{series[-1]['year']}-{series[-1]['month']:02d}, "
        f"{len(missing)} months without valid regional retrievals."
    )
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
