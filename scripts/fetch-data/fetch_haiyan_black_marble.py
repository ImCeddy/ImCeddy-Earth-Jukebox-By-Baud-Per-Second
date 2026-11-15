from __future__ import annotations

import json
import re
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import local
from typing import Any
from urllib.parse import urlparse

import h5py
import numpy as np
import requests

from common import OUTPUT_DIR, earthdata_token, session

LOCATION_ID = "tacloban-leyte"
OUTPUT_FILENAME = "tacloban-haiyan.json"
LATITUDE = 11.2431609
LONGITUDE = 125.0082936
START_YEAR = 2012
END_YEAR = 2026
END_MONTH = 10
MINIMUM_VALID_PIXELS = 10
NEIGHBORHOOD_SIZE = 11
COLLECTION_ID = "C3860061042-LAADS"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
PRODUCT_URL = "https://doi.org/10.5067/VIIRS/VNP46A3.002"
DATASET = "HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields"
GRANULE_PATTERN = re.compile(r"\.A(?P<year>\d{4})(?P<day>\d{3})\.h\d{2}v\d{2}\.")
RANGE_BLOCK_SIZE = 4 * 1024 * 1024
RANGE_CACHE_BLOCKS = 8
MAX_WORKERS = 6
_thread_state = local()


class HttpRangeReader:
    def __init__(
        self,
        url: str,
        client: requests.Session,
        block_size: int = RANGE_BLOCK_SIZE,
        max_cache_blocks: int = RANGE_CACHE_BLOCKS,
    ) -> None:
        self.url = url
        self.client = client
        self.block_size = block_size
        self.max_cache_blocks = max_cache_blocks
        self.cache: OrderedDict[int, bytes] = OrderedDict()
        self.offset = 0
        response = client.get(
            url,
            headers={"Range": "bytes=0-0"},
            timeout=(30, 60),
        )
        try:
            response.raise_for_status()
            content_range = response.headers.get("Content-Range", "")
            match = re.fullmatch(r"bytes 0-0/(\d+)", content_range)
            if response.status_code != 206 or match is None:
                raise OSError("NASA LAADS did not provide the requested byte-range metadata.")
            self.size = int(match.group(1))
        finally:
            response.close()

    def seek(self, offset: int, whence: int = 0) -> int:
        if whence == 0:
            next_offset = offset
        elif whence == 1:
            next_offset = self.offset + offset
        elif whence == 2:
            next_offset = self.size + offset
        else:
            raise ValueError(f"Invalid whence value: {whence}")
        if next_offset < 0:
            raise ValueError("Cannot seek to a negative offset.")
        self.offset = next_offset
        return self.offset

    def tell(self) -> int:
        return self.offset

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = max(0, self.size - self.offset)
        end = min(self.offset + size, self.size)
        chunks = []
        while self.offset < end:
            block_index = self.offset // self.block_size
            block = self.cache.get(block_index)
            if block is None:
                block_start = block_index * self.block_size
                block_end = min(self.size, block_start + self.block_size) - 1
                response = self.client.get(
                    self.url,
                    headers={"Range": f"bytes={block_start}-{block_end}"},
                    timeout=(30, 120),
                )
                try:
                    response.raise_for_status()
                    content_range = response.headers.get("Content-Range", "")
                    expected_range = f"bytes {block_start}-{block_end}/{self.size}"
                    if response.status_code != 206 or content_range != expected_range:
                        raise OSError("NASA LAADS did not honor an HDF5 byte-range request.")
                    block = response.content
                finally:
                    response.close()
                self.cache[block_index] = block
                if len(self.cache) > self.max_cache_blocks:
                    self.cache.popitem(last=False)
            else:
                self.cache.move_to_end(block_index)

            within_block = self.offset - block_index * self.block_size
            chunk_size = min(end - self.offset, len(block) - within_block)
            if chunk_size <= 0:
                break
            chunks.append(block[within_block : within_block + chunk_size])
            self.offset += chunk_size
        return b"".join(chunks)

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def close(self) -> None:
        self.cache.clear()


def _thread_session() -> requests.Session:
    client = getattr(_thread_state, "client", None)
    if client is None:
        client = create_session()
        _thread_state.client = client
    return client


def create_session() -> requests.Session:
    return session(earthdata_token())


def month_keys(start_year: int, start_month: int, end_year: int, end_month: int) -> list[str]:
    if not 1 <= start_month <= 12 or not 1 <= end_month <= 12:
        raise ValueError("Month values must be between 1 and 12.")
    if (start_year, start_month) > (end_year, end_month):
        raise ValueError("Start month must not be after end month.")
    months = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        months.append(f"{year:04d}-{month:02d}")
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return months


def find_monthly_granules(
    client: requests.Session,
    latitude: float = LATITUDE,
    longitude: float = LONGITUDE,
    start_year: int = START_YEAR,
    start_month: int = 1,
    end_year: int = END_YEAR,
    end_month: int = 12,
) -> dict[str, dict[str, Any]]:
    months = month_keys(start_year, start_month, end_year, end_month)
    last_year, last_month = end_year, end_month + 1
    if last_month == 13:
        last_year, last_month = last_year + 1, 1
    params = {
        "collection_concept_id": COLLECTION_ID,
        "temporal": (
            f"{start_year}-{start_month:02d}-01T00:00:00Z,"
            f"{last_year}-{last_month:02d}-01T00:00:00Z"
        ),
        "point": f"{longitude},{latitude}",
        "page_size": 200,
    }
    response = client.get(CMR_URL, params=params, timeout=60)
    response.raise_for_status()
    entries = response.json()["feed"]["entry"]
    granules: dict[str, dict[str, Any]] = {}
    for entry in entries:
        granule_id = entry.get("producer_granule_id", "")
        match = GRANULE_PATTERN.search(granule_id)
        if not match:
            continue
        year = int(match.group("year"))
        month = datetime.fromisoformat(entry["time_start"].replace("Z", "+00:00")).month
        month_key = f"{year:04d}-{month:02d}"
        if month_key not in months:
            continue
        previous = granules.get(month_key)
        if previous is None or entry.get("updated", "") > previous.get("updated", ""):
            granules[month_key] = entry
    return granules


def data_url(entry: dict[str, Any]) -> str:
    for link in entry.get("links", []):
        parsed = urlparse(link.get("href", ""))
        if parsed.netloc == "data.laadsdaac.earthdatacloud.nasa.gov" and "/prod-lads/VNP46A3/" in parsed.path:
            return link["href"]
    raise RuntimeError(f"No public LAADS data URL found for {entry.get('producer_granule_id', 'unknown granule')}")


def valid_radiance_values(
    radiance: np.ndarray,
    quality: np.ndarray,
    land_water: np.ndarray,
) -> np.ndarray:
    if radiance.shape != quality.shape or radiance.shape != land_water.shape:
        raise ValueError("Radiance, quality, and land/water arrays must have matching shapes.")
    valid = (
        (quality == 0)
        & np.isin(land_water, (0, 1))
        & np.isfinite(radiance)
        & (radiance >= 0)
        & (radiance != -999.9)
    )
    return radiance[valid]


def extract_monthly_sample(
    path: Path,
    latitude: float = LATITUDE,
    longitude: float = LONGITUDE,
) -> tuple[float | None, int, float, float]:
    with h5py.File(path, "r") as granule:
        return extract_monthly_sample_from_file(granule, latitude, longitude)


def extract_monthly_sample_from_file(
    granule: h5py.File,
    latitude: float = LATITUDE,
    longitude: float = LONGITUDE,
) -> tuple[float | None, int, float, float]:
    fields = granule[DATASET]
    latitudes = fields["lat"][:]
    longitudes = fields["lon"][:]
    row = int(np.argmin(np.abs(latitudes - latitude)))
    column = int(np.argmin(np.abs(longitudes - longitude)))
    radius = NEIGHBORHOOD_SIZE // 2
    row_slice = slice(max(0, row - radius), min(len(latitudes), row + radius + 1))
    column_slice = slice(max(0, column - radius), min(len(longitudes), column + radius + 1))
    radiance = fields["AllAngle_Composite_Snow_Free"][row_slice, column_slice]
    quality = fields["AllAngle_Composite_Snow_Free_Quality"][row_slice, column_slice]
    land_water = fields["Land_Water_Mask"][row_slice, column_slice]
    values = valid_radiance_values(radiance, quality, land_water)
    value = float(np.median(values)) if values.size else None
    return value, int(values.size), float(latitudes[row]), float(longitudes[column])


def extract_remote_monthly_sample(
    url: str,
    client: requests.Session,
    latitude: float = LATITUDE,
    longitude: float = LONGITUDE,
) -> tuple[float | None, int, float, float]:
    remote_file = HttpRangeReader(url, client)
    try:
        with h5py.File(remote_file, "r") as granule:
            return extract_monthly_sample_from_file(granule, latitude, longitude)
    finally:
        remote_file.close()


def distance_km(latitude: float, longitude: float, other_latitude: float, other_longitude: float) -> float:
    earth_radius_km = 6371.0088
    lat1, lat2 = np.radians([latitude, other_latitude])
    delta_lat = lat2 - lat1
    delta_lon = np.radians(other_longitude - longitude)
    haversine = (
        np.sin(delta_lat / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin(delta_lon / 2) ** 2
    )
    return float(2 * earth_radius_km * np.arcsin(np.sqrt(haversine)))


def fetch_story_data(
    location_id: str = LOCATION_ID,
    latitude: float = LATITUDE,
    longitude: float = LONGITUDE,
    location_name: str = "central Tacloban",
    start_year: int = START_YEAR,
    start_month: int = 1,
    end_year: int = END_YEAR,
    end_month: int = END_MONTH,
    minimum_valid_pixels: int = MINIMUM_VALID_PIXELS,
) -> dict[str, Any]:
    if minimum_valid_pixels < 1:
        raise ValueError("The monthly valid-pixel minimum must be at least one.")
    client = create_session()
    expected_months = month_keys(start_year, start_month, end_year, end_month)
    granules = find_monthly_granules(
        client,
        latitude,
        longitude,
        start_year,
        start_month,
        end_year,
        end_month,
    )
    missing_granules = [month for month in expected_months if month not in granules]
    series = []
    missing_observations = []
    rejected_low_support = []
    nearest_cell_center: tuple[float, float] | None = None
    samples_by_month = {}

    def fetch_month(month_key: str, entry: dict[str, Any]):
        return month_key, extract_remote_monthly_sample(
            data_url(entry),
            _thread_session(),
            latitude,
            longitude,
        )

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_month, month_key, entry): month_key
            for month_key, entry in granules.items()
        }
        completed = 0
        for future in as_completed(futures):
            month_key, result = future.result()
            samples_by_month[month_key] = result
            completed += 1
            if completed % 25 == 0 or completed == len(futures):
                print(f"Retrieved {completed}/{len(futures)} {location_name} monthly samples", flush=True)

    for month_key in expected_months:
        result = samples_by_month.get(month_key)
        if result is None:
            missing_observations.append(month_key)
            continue
        value, valid_pixels, cell_latitude, cell_longitude = result
        nearest_cell_center = nearest_cell_center or (cell_latitude, cell_longitude)
        year, month = map(int, month_key.split("-"))
        if value is None:
            missing_observations.append(month_key)
            continue
        if valid_pixels < minimum_valid_pixels:
            missing_observations.append(month_key)
            rejected_low_support.append({
                "month": month_key,
                "validPixelSamples": valid_pixels,
            })
            continue
        series.append({
            "year": year,
            "month": month,
            "value": round(value, 6),
            "validPixelSamples": valid_pixels,
        })

    payload = {
        "locationId": location_id,
        "datasetId": f"{location_id}-nighttime-radiance",
        "metric": "monthly_black_marble_nighttime_radiance",
        "unit": "nW/(cm² sr)",
        "source": {
            "mission": "NASA Suomi NPP / VIIRS Black Marble",
            "product": "VNP46A3.002 monthly nighttime lights",
            "url": PRODUCT_URL,
        },
        "scaleNote": (
            "Each monthly value is the median radiance of quality-flag-0 land pixels "
            f"in a fixed 11×11 grid-cell neighborhood around {location_name}. "
            "The product measures nighttime radiance, not electricity access, "
            "casualties, damage, or household recovery. Monthly compositing can obscure "
            "short outages. Months with fewer than "
            f"{minimum_valid_pixels} quality-valid land pixels are rejected; months without "
            "a passing sample are omitted, not zero."
        ),
        "sampling": {
            "method": (
                "Median of AllAngle_Composite_Snow_Free pixels with quality flag 0 and land/water "
                f"mask 0 or 1 in an 11x11 neighborhood; at least {minimum_valid_pixels} valid "
                "pixels are required for an observed month."
            ),
            "neighborhood": f"11×11 grid cells centered on the nearest VNP46A3 cell to {location_name}.",
            "missingMonths": missing_observations,
            "missingGranules": missing_granules,
            "minimumValidPixelsPerMonth": minimum_valid_pixels,
            "rejectedLowSupportMonths": rejected_low_support,
        },
        "gridCell": {
            "requestedCoordinates": [latitude, longitude],
            "nearestCellCenter": [
                round(nearest_cell_center[0], 6),
                round(nearest_cell_center[1], 6),
            ] if nearest_cell_center else None,
            "distanceFromLocationKm": round(
                distance_km(latitude, longitude, *nearest_cell_center),
                3,
            ) if nearest_cell_center else None,
        },
        "series": series,
    }
    if not series:
        raise RuntimeError(f"No QA-valid Black Marble observations were retrieved for {location_name}.")
    return payload


def main() -> None:
    payload = fetch_story_data()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / OUTPUT_FILENAME
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    first, last = payload["series"][0], payload["series"][-1]
    print(
        f"{LOCATION_ID}: {len(payload['series'])} valid months, "
        f"{first['year']}-{first['month']:02d} to {last['year']}-{last['month']:02d}; "
        f"{len(payload['sampling']['missingMonths'])} months without valid pixels"
    )
    print(f"{location_name} nearest grid-cell center: {payload['gridCell']['nearestCellCenter']}")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
