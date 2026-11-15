from __future__ import annotations

import argparse
import json
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from functools import lru_cache
from pathlib import Path
from threading import local
from urllib.parse import urlparse

import netCDF4
import numpy as np

from aggregation import aggregate_monthly
from common import earthdata_token, get_json, session, summarize, write_story_data

LOCATION_ID = "manila-bay"
LATITUDE = 14.51667
LONGITUDE = 120.76667
TACLOBAN_ID = "leyte-gulf-tacloban"
DAVAO_ID = "davao-mindanao"
TUBIGON_ID = "tubigon-bohol"
ARINGAY_ID = "aringay-alaska"
TACLOBAN_SCALE_NOTE = "The selected NASA-SSH 0.5° open-water grid cell centered at 10.75°N, 125.25°E is about 60.85 km from Tacloban. Satellite altimetry measures regional sea-surface height, not street-level flood risk or storm surge."
MANILA_SCALE_NOTE = "The NASA-SSH 0.5° grid cell centered at 14.75°N, 120.75°E is about 26.01 km from the mapped Manila Bay center. NASA altimetry measures the open-water surface. Tide gauges at the shoreline record higher rates (about 13 mm/yr at Manila in one study). The gap is an open research question: land subsidence (large north of the bay), river loading, and limits of coastal altimetry."
DAVAO_SCALE_NOTE = "The historical +6.1 and +1.3 mm/year trends are Davao tide-gauge results, not NASA satellite measurements. The NASA-SSH 0.5° grid cell centered at 6.75°N, 125.75°E is about 38.99 km from Davao; the product uses Gaussian spatial averaging with a 100 km width. This regional open-water record is not a shoreline gauge and begins in October 1992."
TUBIGON_SCALE_NOTE = "The NASA-SSH 0.5° open-water grid cell centered at 9.75°N, 123.75°E is about 32.26 km from the mapped Tubigon town center, which is an approximate regional marker rather than one of the nearby islands. This regional sea-surface-height record cannot measure earthquake-related land subsidence or flooding at island communities."
ARINGAY_SCALE_NOTE = "The NASA-SSH 0.5° open-water grid cell centered at 16.25°N, 120.25°E is about 15.84 km from the mapped New Bern Elementary School reference point. This regional sea-surface-height record cannot measure shoreline retreat, land subsidence, or flooding in Barangay Alaska."
MAX_TACLOBAN_DISTANCE_KM = 60.85
MAX_DAVAO_DISTANCE_KM = 60
ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / ".cache" / "nasa-ssh"
COLLECTION_ID = "C3309442935-POCLOUD"
CMR_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
NASA_SSH_URL = "https://podaac.jpl.nasa.gov/dataset/NASA_SSH_REF_SIMPLE_GRID_V1"
DOWNLOAD_WORKERS = 6
_worker_state = local()


def select_granules(entries: list[dict]) -> list[dict]:
    return sorted(entries, key=lambda item: item["time_start"])


def granule_url(entry: dict) -> str:
    for link in entry.get("links", []):
        if link.get("rel", "").endswith("data#") and link.get("href", "").endswith(".nc"):
            return link["href"]
    raise RuntimeError(f"No protected NetCDF download link found for {entry.get('producer_granule_id')}")


def spatial_valid_grid(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    with netCDF4.Dataset(path) as dataset:
        latitudes = np.asarray(dataset.variables["latitude"][:])
        longitudes = np.asarray(dataset.variables["longitude"][:])
        variable = dataset.variables["ssha"]
        values = np.ma.asarray(variable[:])
        dimensions = list(variable.dimensions)
        valid = ~np.ma.getmaskarray(values)
        filled = np.ma.filled(values, np.nan)
        valid &= np.isfinite(filled) & (np.abs(filled) < 1e10)
        while valid.ndim > 2:
            axis = dimensions.index("time") if "time" in dimensions else 0
            valid = np.any(valid, axis=axis)
            dimensions.pop(axis)
        if "latitude" not in dimensions or "longitude" not in dimensions:
            raise RuntimeError(f"NASA-SSH grid dimensions are not recognized: {dimensions}")
        valid = np.transpose(valid, (dimensions.index("latitude"), dimensions.index("longitude")))
        if valid.shape != (latitudes.size, longitudes.size):
            raise RuntimeError("NASA-SSH validity mask does not match the coordinate grid")
        return latitudes, longitudes, valid


def point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    for index, start in enumerate(ring):
        end = ring[(index + 1) % len(ring)]
        if (start[1] > latitude) != (end[1] > latitude):
            crossing = (end[0] - start[0]) * (latitude - start[1]) / (end[1] - start[1]) + start[0]
            if longitude < crossing:
                inside = not inside
    return inside


@lru_cache(maxsize=1)
def philippines_land_polygons() -> list:
    geometry = json.loads(
        (ROOT / "src" / "data" / "philippines.geojson").read_text(encoding="utf-8")
    )["geometry"]
    return geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]


def point_on_philippines_land(longitude: float, latitude: float) -> bool:
    polygons = philippines_land_polygons()
    for polygon in polygons:
        if point_in_ring(longitude, latitude, polygon[0]) and not any(
            point_in_ring(longitude, latitude, hole) for hole in polygon[1:]
        ):
            return True
    return False


def nearest_valid_ocean_cell(
    path: Path,
    latitude: float,
    longitude: float,
    exclude_philippines_land: bool = False,
) -> tuple[int, int, float, float, float]:
    latitudes, longitudes, valid = spatial_valid_grid(path)
    if np.nanmax(longitudes) > 180:
        normalized_longitudes = longitude % 360
    else:
        normalized_longitudes = longitude
    lat_indices, lon_indices = np.nonzero(valid)
    if exclude_philippines_land:
        longitude_deltas = (longitudes[lon_indices] - longitude + 180) % 360 - 180
        nearby = (
            (np.abs(latitudes[lat_indices] - latitude) <= 2.5)
            & (np.abs(longitude_deltas) <= 3.5)
        )
        lat_indices = lat_indices[nearby]
        lon_indices = lon_indices[nearby]
        ocean_cells = [
            not point_on_philippines_land(float(longitudes[lon_index]), float(latitudes[lat_index]))
            for lat_index, lon_index in zip(lat_indices, lon_indices)
        ]
        ocean_cells = np.asarray(ocean_cells, dtype=bool)
        lat_indices = lat_indices[ocean_cells]
        lon_indices = lon_indices[ocean_cells]
    if not len(lat_indices):
        raise RuntimeError("NASA-SSH granule contains no valid cells outside the Philippine land polygon")
    cell_lats = latitudes[lat_indices]
    cell_lons = longitudes[lon_indices]
    lat1 = np.radians(latitude)
    lat2 = np.radians(cell_lats)
    delta_lat = lat2 - lat1
    delta_lon = np.radians((cell_lons - normalized_longitudes + 180) % 360 - 180)
    haversine = np.sin(delta_lat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(delta_lon / 2) ** 2
    distances = 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(haversine, 0, 1)))
    nearest = int(np.argmin(distances))
    return (
        int(lat_indices[nearest]),
        int(lon_indices[nearest]),
        float(cell_lats[nearest]),
        float(cell_lons[nearest]),
        float(distances[nearest]),
    )


def extract_point(path: Path, lat_index: int | None = None, lon_index: int | None = None) -> float | None:
    with netCDF4.Dataset(path) as dataset:
        latitudes = np.asarray(dataset.variables["latitude"][:])
        longitudes = np.asarray(dataset.variables["longitude"][:])
        if lat_index is None:
            lat_index = int(np.nanargmin(np.abs(latitudes - LATITUDE)))
        if lon_index is None:
            target_longitude = LONGITUDE % 360 if np.nanmax(longitudes) > 180 else LONGITUDE
            lon_index = int(np.nanargmin(np.abs(longitudes - target_longitude)))
        variable = dataset.variables["ssha"]
        values = np.ma.asarray(variable[:])
        dimensions = list(variable.dimensions)
        while values.ndim > 2:
            if "time" in dimensions:
                axis = dimensions.index("time")
            else:
                axis = 0
            values = np.take(values, 0, axis=axis)
            dimensions.pop(axis)
        lat_axis = dimensions.index("latitude") if "latitude" in dimensions else 0
        lon_axis = dimensions.index("longitude") if "longitude" in dimensions else 1
        point = np.take(values, lat_index, axis=lat_axis)
        if lon_axis > lat_axis:
            lon_axis -= 1
        point = np.take(point, lon_index, axis=lon_axis)
        if np.ma.is_masked(point):
            return None
        numeric = float(point)
        return numeric if np.isfinite(numeric) and abs(numeric) < 1e10 else None


def cached_granule_path(entry: dict) -> Path:
    href = granule_url(entry)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / Path(urlparse(href).path).name


def get_granule(client, entry: dict) -> Path:
    filename = cached_granule_path(entry)
    if filename.exists():
        return filename
    response = client.get(granule_url(entry), timeout=300)
    response.raise_for_status()
    temporary = filename.with_suffix(filename.suffix + ".part")
    temporary.write_bytes(response.content)
    temporary.replace(filename)
    return filename


def get_granule_for_worker(entry: dict, token: str) -> Path:
    if not hasattr(_worker_state, "client"):
        _worker_state.client = session(token)
    return get_granule(_worker_state.client, entry)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch monthly NASA-SSH data for a location.")
    parser.add_argument("location_id", nargs="?", default=LOCATION_ID)
    parser.add_argument("--latitude", type=float)
    parser.add_argument("--longitude", type=float)
    parser.add_argument("--check-cell-only", action="store_true")
    args = parser.parse_args()
    if args.location_id == LOCATION_ID:
        args.latitude = LATITUDE if args.latitude is None else args.latitude
        args.longitude = LONGITUDE if args.longitude is None else args.longitude
    elif args.latitude is None or args.longitude is None:
        parser.error("--latitude and --longitude are required for non-Manila locations")
    return args


def main() -> None:
    args = parse_args()
    location_id = args.location_id
    latitude = args.latitude
    longitude = args.longitude
    token = earthdata_token()
    client = session(token)
    end_date = date.today().isoformat()
    params = {
        "collection_concept_id": COLLECTION_ID,
        "temporal": f"1992-10-01T00:00:00Z,{end_date}T23:59:59Z",
        "page_size": 2000,
        "sort_key": "start_date",
    }
    feed = get_json(client, CMR_URL, params=params)["feed"]["entry"]
    entries = select_granules(feed)
    if not entries:
        raise RuntimeError("CMR returned no NASA-SSH granules for the requested period")

    cell_lat_index: int | None = None
    cell_lon_index: int | None = None
    if location_id != LOCATION_ID:
        probe_path = get_granule(client, entries[-1])
        (
            cell_lat_index,
            cell_lon_index,
            cell_latitude,
            cell_longitude,
            distance_km,
        ) = nearest_valid_ocean_cell(
            probe_path,
            latitude,
            longitude,
            exclude_philippines_land=location_id in {TACLOBAN_ID, DAVAO_ID},
        )
        print(
            f"nearest valid NASA-SSH ocean cell: center=({cell_latitude:.5f}, "
            f"{cell_longitude:.5f}), distance={distance_km:.2f} km"
        )
        if location_id == TACLOBAN_ID and round(distance_km, 2) > MAX_TACLOBAN_DISTANCE_KM:
            raise RuntimeError(
                f"Nearest valid ocean cell is {distance_km:.2f} km away, beyond "
                f"the {MAX_TACLOBAN_DISTANCE_KM:.2f} km limit; no data was written."
            )
        if location_id == DAVAO_ID and distance_km > MAX_DAVAO_DISTANCE_KM:
            raise RuntimeError(
                f"Nearest valid ocean cell is {distance_km:.2f} km away, beyond "
                f"the {MAX_DAVAO_DISTANCE_KM} km limit; no data was written."
            )
        if args.check_cell_only:
            print("  cell check passed; no story data was written")
            return

    granule_paths: list[Path | None] = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        downloads = {
            executor.submit(get_granule_for_worker, entry, token): index
            for index, entry in enumerate(entries)
        }
        for completed, future in enumerate(as_completed(downloads), start=1):
            granule_paths[downloads[future]] = future.result()
            if completed % 100 == 0:
                print(f"  downloaded or reused {completed}/{len(entries)} granules", flush=True)

    by_month: dict[str, list[float]] = defaultdict(list)
    for entry, filename in zip(entries, granule_paths):
        if filename is None:
            raise RuntimeError(f"No NASA-SSH granule was prepared for {entry.get('producer_granule_id')}")
        value = extract_point(filename, cell_lat_index, cell_lon_index)
        if value is not None:
            by_month[entry["time_start"][:7]].append(value)

    series = aggregate_monthly(
        ((month, value) for month, values in by_month.items() for value in values),
    )
    if not series:
        raise RuntimeError(f"NASA-SSH returned no valid SSHA values at {location_id}")

    payload = {
        "locationId": location_id,
        "metric": "monthly_mean_sea_surface_height_anomaly",
        "unit": "m",
        "source": {
            "mission": "NASA/JPL/PO.DAAC reference altimetry missions",
            "product": "NASA-SSH Simple Gridded Sea Surface Height from Standardized Reference Missions Only V1, monthly mean of valid SSHA granules",
            "url": NASA_SSH_URL,
        },
        "sampling": {
            "method": "Arithmetic mean of valid SSHA values from all available granules whose start date falls within each calendar month.",
            "validGranulesByMonth": {month: len(values) for month, values in sorted(by_month.items())},
        },
        "scaleNote": {
            LOCATION_ID: MANILA_SCALE_NOTE,
            TACLOBAN_ID: TACLOBAN_SCALE_NOTE,
            DAVAO_ID: DAVAO_SCALE_NOTE,
            TUBIGON_ID: TUBIGON_SCALE_NOTE,
            ARINGAY_ID: ARINGAY_SCALE_NOTE,
        }.get(location_id, "NASA-SSH is a regional open-water record, not a shoreline or flood-risk measurement."),
        "series": series,
    }
    output = write_story_data(location_id, payload)
    summarize(location_id, series)
    print(f"  sampled {len(entries)} NetCDF granules into {len(series)} monthly records")
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
