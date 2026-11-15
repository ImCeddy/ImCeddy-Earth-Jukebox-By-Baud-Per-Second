from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import requests

from common import session, summarize, write_story_data

LOCATION_ID = "tubbataha-reefs"
LATITUDE = 8.82
LONGITUDE = 119.87
GRID_LAT_INDEX = 1623
GRID_LON_INDEX = 5997
GRID_LATITUDE = 8.825
GRID_LONGITUDE = 119.875
MONTHLY_ARCHIVE_URL = "https://www.ncei.noaa.gov/data/oceans/crw/5km/v3.1/nc/v1.0/monthly/"
OPENDAP_BASE_URL = "https://www.ncei.noaa.gov/thredds-ocean/dodsC/crw/5km/v3.1/nc/v1.0/monthly/"
NCEI_DATASET_URL = (
    "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso"
    "?id=gov.noaa.nodc:CRW-5km-HeatStressProducts"
)
THREAD_LOCAL = threading.local()


def get_thread_session() -> requests.Session:
    if not hasattr(THREAD_LOCAL, "client"):
        THREAD_LOCAL.client = session()
    return THREAD_LOCAL.client


def available_months() -> list[tuple[int, int]]:
    client = session()
    response = client.get(MONTHLY_ARCHIVE_URL, timeout=120)
    response.raise_for_status()
    years = sorted({
        int(year)
        for year in re.findall(r'href="(20\d{2})/"', response.text)
        if int(year) >= 2010
    })
    months: set[tuple[int, int]] = set()
    for year in years:
        response = client.get(f"{MONTHLY_ARCHIVE_URL}{year}/", timeout=120)
        response.raise_for_status()
        months.update(
            (int(file_year), int(month))
            for file_year, month in re.findall(
                rf'ct5km_dhw-max_v3\.1_(\d{{4}})(\d{{2}})\.nc',
                response.text,
            )
        )
    return sorted(months)


def scalar(text: str, name: str) -> int:
    match = re.search(
        rf"{name}\.{name}\[\d+\]\[\d+\]\[\d+\]\s*\[0\]\[0\],\s*(-?\d+)",
        text,
    )
    if match is None:
        raise ValueError(f"NOAA OPeNDAP response did not contain {name}.")
    return int(match.group(1))


def coordinate(text: str, name: str) -> float:
    match = re.search(rf"(?m)^{name}\[1\]\s*\r?\n\s*(-?\d+(?:\.\d+)?)", text)
    if match is None:
        raise ValueError(f"NOAA OPeNDAP response did not contain the {name} coordinate.")
    return float(match.group(1))


def fetch_month(item: tuple[int, int]) -> tuple[tuple[int, int], dict[str, int] | None]:
    year, month = item
    filename = f"ct5km_dhw-max_v3.1_{year}{month:02d}.nc"
    query = (
        f"?lat[{GRID_LAT_INDEX}],lon[{GRID_LON_INDEX}],"
        f"mask[0][{GRID_LAT_INDEX}][{GRID_LON_INDEX}],"
        f"date[0][{GRID_LAT_INDEX}][{GRID_LON_INDEX}],"
        f"degree_heating_week[0][{GRID_LAT_INDEX}][{GRID_LON_INDEX}]"
    )
    url = f"{OPENDAP_BASE_URL}{year}/{filename}.ascii{query}"
    response = get_thread_session().get(url, timeout=120)
    response.raise_for_status()
    text = response.text

    latitude = coordinate(text, "lat")
    longitude = coordinate(text, "lon")
    if abs(latitude - GRID_LATITUDE) > 0.001 or abs(longitude - GRID_LONGITUDE) > 0.001:
        raise ValueError(
            f"Unexpected NOAA grid cell for {year}-{month:02d}: "
            f"{latitude}, {longitude}."
        )

    if scalar(text, "mask") != 0:
        return item, None

    raw_value = scalar(text, "degree_heating_week")
    if raw_value < 0:
        return item, None

    peak_date = scalar(text, "date")
    if peak_date // 100 != year * 100 + month:
        raise ValueError(f"Unexpected peak date {peak_date} in {year}-{month:02d} composite.")

    return item, {"rawValue": raw_value, "peakDate": peak_date}


def month_range(start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    months = []
    year, month = start
    while (year, month) <= end:
        months.append((year, month))
        month += 1
        if month == 13:
            year += 1
            month = 1
    return months


def main() -> None:
    months = available_months()
    if not months:
        raise RuntimeError("NOAA's monthly Coral Reef Watch DHW archive returned no composites.")

    observations: dict[tuple[int, int], dict[str, int]] = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        for item, observation in executor.map(fetch_month, months):
            if observation is not None:
                observations[item] = observation

    if not observations:
        raise RuntimeError("NOAA returned no valid-water DHW observations for the Tubbataha grid cell.")

    ordered_months = sorted(observations)
    missing_months = [
        f"{year:04d}-{month:02d}"
        for year, month in month_range(ordered_months[0], ordered_months[-1])
        if (year, month) not in observations
    ]
    series = [
        {"year": year, "month": month, "value": round(observation["rawValue"] * 0.01, 2)}
        for (year, month), observation in sorted(observations.items())
    ]
    first_year, first_month = ordered_months[0]
    last_year, last_month = ordered_months[-1]
    today = date.today()
    archive_end = f"{last_year:04d}-{last_month:02d}"
    partial_archive_note = (
        f"The currently archived monthly composites end in {archive_end}; "
        "months beyond that date are unavailable in this archive snapshot."
    )
    scale_note = (
        "The NOAA Coral Reef Watch 5-km (0.05-degree) Degree Heating Week product is "
        "a satellite-derived measure of accumulated coral-bleaching heat stress, "
        "not a direct observation of bleaching, coral cover, biodiversity, or species "
        "abundance. This monthly value is the maximum daily DHW in that calendar month "
        "at one valid-water grid cell centered at 8.825°N, 119.875°E, nearest the "
        "Tubbataha sample coordinates; it is not an average for the park. DHW "
        "accumulates heat stress over the preceding 12 weeks. NOAA's 4 °C-weeks "
        "threshold indicates bleaching risk and 8 °C-weeks indicates likely reef-wide "
        "bleaching with mortality among heat-sensitive corals; these are risk "
        "thresholds, not observed outcomes. Missing archive months remain gaps and "
        "are not interpolated. " + partial_archive_note
    )
    payload = {
        "locationId": LOCATION_ID,
        "metric": "monthly_max_degree_heating_weeks",
        "unit": "°C-weeks",
        "narrationLabel": "the NOAA reef heat-stress index",
        "source": {
            "mission": "NOAA Coral Reef Watch satellite products",
            "product": (
                "Daily Global 5-km Coral Bleaching Heat Stress Monitoring Product "
                "Suite, Version 3.1; monthly maximum Degree Heating Week composite"
            ),
            "url": NCEI_DATASET_URL,
        },
        "references": [
            {
                "mission": "NOAA Coral Reef Watch",
                "product": "Degree Heating Week product description and risk thresholds",
                "url": "https://coralreefwatch.noaa.gov/product/5km/index_5km_dhw.php",
            },
            {
                "mission": "UNESCO World Heritage Centre",
                "product": "Tubbataha Reefs Natural Park — biodiversity and conservation context",
                "url": "https://whc.unesco.org/en/list/653/",
            },
        ],
        "scaleNote": scale_note,
        "availabilityNote": partial_archive_note,
        "sampling": {
            "method": (
                "For each archived calendar-month composite, sampled the nearest "
                "0.05-degree grid cell to 8.82°N, 119.87°E. The selected cell center "
                "is 8.825°N, 119.875°E; NOAA's pixel mask was required to identify "
                "valid water. The product's 0.01 scale factor was applied. Monthly "
                "composites report each cell's maximum daily DHW in that month."
            ),
            "gridCellCenter": {
                "latitude": GRID_LATITUDE,
                "longitude": GRID_LONGITUDE,
            },
            "missingMonths": missing_months,
            "archiveEnd": archive_end,
            "archivePartial": (last_year, last_month) < (today.year, today.month),
        },
        "series": series,
    }
    output_path = write_story_data(LOCATION_ID, payload)
    summarize(LOCATION_ID, series)
    print(
        f"  archive window: {first_year}-{first_month:02d} to "
        f"{last_year}-{last_month:02d}; {len(missing_months)} missing months"
    )
    print(f"  wrote {output_path}")


if __name__ == "__main__":
    main()
