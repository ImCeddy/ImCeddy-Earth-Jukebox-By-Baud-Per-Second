from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
import re
import threading
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlsplit, urlunsplit

import numpy as np
import requests
import tifffile
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from common import summarize, write_story_data

STAC_SEARCH_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
STAC_SIGN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
STAC_COLLECTION = "landsat-c2-l2"
OSM_URL = "https://api.openstreetmap.org/api/0.6/relation/{relation_id}/full"
LANDSAT_COLLECTION_URL = "https://landsatlook.usgs.gov/stac-server/collections/landsat-c2l2-sr"
LANDSAT_DOI_URL = "https://doi.org/10.5066/P9IAXOVV"
NASA_LANDSAT_URL = "https://science.nasa.gov/mission/landsat/data-overview/"
PIXEL_AREA_KM2 = 30 * 30 / 1_000_000
MINIMUM_VALID_COVERAGE = 0.8
EARLIEST_AVAILABLE_MONTH = (1987, 12)
MAX_MONTH_WORKERS = 6
SAS_REFRESH_BUFFER = timedelta(minutes=5)
_SAS_CACHE: dict[tuple[str, str, str], tuple[str, datetime]] = {}
_SAS_CACHE_LOCK = threading.Lock()


@dataclass(frozen=True)
class Reservoir:
    location_id: str
    title: str
    latitude: float
    longitude: float
    relation_id: int
    bbox: tuple[float, float, float, float]
    boundary_label: str = "reservoir outline"
    interpretation_note: str = (
        "The value is mapped surface area, not dam elevation, stored volume, or water supply."
    )


RESERVOIRS = {
    "angat-dam": Reservoir(
        "angat-dam", "Angat Dam Reservoir", 14.9740434, 121.1960013,
        2_970_167, (121.17, 14.90, 121.23, 14.99),
    ),
    "pantabangan-dam": Reservoir(
        "pantabangan-dam", "Pantabangan Reservoir", 15.8536949, 121.1388438,
        2_460_576, (121.086, 15.796, 121.237, 15.911),
    ),
    "macabebe-delta": Reservoir(
        "macabebe-delta", "Macabebe Municipality", 14.9081836, 120.7149803,
        16_253_334, (120.5933726, 14.6700123, 120.7320642, 14.9463714),
        boundary_label="municipal boundary",
        interpretation_note=(
            "The municipal polygon includes extensive existing surface water, so this total is not "
            "an estimate of land converted to fishponds. Monthly snapshots are not corrected for tide "
            "or seasonal inundation. It cannot distinguish fishponds from "
            "estuarine water, canals, or flooded fields, identify parcel conversion, or establish its cause."
        ),
    ),
}
RESERVOIR_LOCATION_IDS = ("angat-dam", "pantabangan-dam")


def _session() -> requests.Session:
    client = requests.Session()
    client.headers.update({"User-Agent": "earth-jukebox-data-pipeline/1.0"})
    client.mount("https://", HTTPAdapter(max_retries=Retry(
        total=5,
        connect=5,
        read=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "HEAD"}),
    )))
    return client


def _month_sequence(start: tuple[int, int], end: tuple[int, int]):
    year, month = start
    while (year, month) <= end:
        yield year, month
        month += 1
        if month == 13:
            year += 1
            month = 1


def _latest_complete_month(today: date) -> tuple[int, int]:
    if today.month == 1:
        return today.year - 1, 12
    return today.year, today.month - 1


def _month_interval(year: int, month: int) -> str:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T00:00:00Z"


def _month_midpoint(year: int, month: int) -> datetime:
    return datetime(year, month, 15, 12, tzinfo=timezone.utc)


def _candidate_rank(item: dict[str, Any], midpoint: datetime) -> tuple[float, float, str]:
    acquired = datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00"))
    cloud_cover = item["properties"].get("eo:cloud_cover")
    cloud_rank = float(cloud_cover) if cloud_cover is not None else 100.0
    return abs((acquired - midpoint).total_seconds()), cloud_rank, item["id"]


def _aggregate_monthly_scenes(
    measurements: list[tuple[dict[str, Any], float, float, int]],
    year: int,
    month: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not measurements:
        raise ValueError("At least one accepted Landsat scene is required.")

    areas = [measurement[2] for measurement in measurements]
    coverages = [measurement[1] for measurement in measurements]
    record = {
        "year": year,
        "month": month,
        "value": round(float(np.median(areas)), 4),
        "validPixelSamples": sum(measurement[3] for measurement in measurements),
        "validSceneCount": len(measurements),
        "medianValidCoverage": round(float(np.median(coverages)), 4),
    }
    if record["value"] == 0:
        record["reviewNote"] = (
            "No water pixels were classified despite qualifying clear-pixel coverage. "
            "Verify the imagery before interpreting zero as an empty mapped-water footprint."
        )
    scenes = []
    for item, coverage, _, _ in measurements:
        properties = item["properties"]
        scenes.append({
            "scene": item["id"],
            "acquired": properties["datetime"],
            "platform": properties.get("platform"),
            "validCoverage": round(coverage, 4),
            "cloudCover": properties.get("eo:cloud_cover"),
            "metadataUpdated": properties.get("updated") or properties.get("created"),
        })
    summary = {
        "month": f"{year:04d}-{month:02d}",
        "aggregation": "median water area across accepted monthly scenes",
        "validSceneCount": len(measurements),
        "medianValidCoverage": record["medianValidCoverage"],
        "scenes": scenes,
    }
    return record, summary


def _classify_landsat(
    green_dn: np.ndarray,
    swir_dn: np.ndarray,
    qa_pixel: np.ndarray,
    qa_radsat: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    invalid_qa_bits = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)
    valid = (
        (green_dn > 0)
        & (swir_dn > 0)
        & ((qa_pixel & invalid_qa_bits) == 0)
        & (qa_radsat == 0)
    )
    green = green_dn.astype(np.float32) * 0.0000275 - 0.2
    swir = swir_dn.astype(np.float32) * 0.0000275 - 0.2
    denominator = green + swir
    valid &= denominator > 0
    mndwi = np.zeros(denominator.shape, dtype=np.float32)
    np.divide(green - swir, denominator, out=mndwi, where=valid)
    return valid, valid & (mndwi > 0)


def _utm(lon: float, lat: float, zone: int) -> tuple[float, float]:
    a = 6_378_137.0
    flattening = 1 / 298.257223563
    eccentricity_squared = flattening * (2 - flattening)
    second_eccentricity_squared = eccentricity_squared / (1 - eccentricity_squared)
    scale = 0.9996
    latitude = math.radians(lat)
    longitude = math.radians(lon)
    central_meridian = math.radians(zone * 6 - 183)
    sin_latitude = math.sin(latitude)
    cos_latitude = math.cos(latitude)
    tan_latitude = math.tan(latitude)
    prime_vertical_radius = a / math.sqrt(1 - eccentricity_squared * sin_latitude**2)
    tan_squared = tan_latitude**2
    cos_squared = second_eccentricity_squared * cos_latitude**2
    delta_longitude = cos_latitude * (longitude - central_meridian)
    meridional_arc = a * (
        (1 - eccentricity_squared / 4 - 3 * eccentricity_squared**2 / 64 - 5 * eccentricity_squared**3 / 256) * latitude
        - (3 * eccentricity_squared / 8 + 3 * eccentricity_squared**2 / 32 + 45 * eccentricity_squared**3 / 1024) * math.sin(2 * latitude)
        + (15 * eccentricity_squared**2 / 256 + 45 * eccentricity_squared**3 / 1024) * math.sin(4 * latitude)
        - (35 * eccentricity_squared**3 / 3072) * math.sin(6 * latitude)
    )
    easting = 500_000 + scale * prime_vertical_radius * (
        delta_longitude
        + (1 - tan_squared + cos_squared) * delta_longitude**3 / 6
        + (5 - 18 * tan_squared + tan_squared**2 + 72 * cos_squared - 58 * second_eccentricity_squared)
        * delta_longitude**5 / 120
    )
    northing = scale * (
        meridional_arc
        + prime_vertical_radius
        * tan_latitude
        * (
            delta_longitude**2 / 2
            + (5 - tan_squared + 9 * cos_squared + 4 * cos_squared**2) * delta_longitude**4 / 24
            + (
                61 - 58 * tan_squared + tan_squared**2 + 600 * cos_squared - 330 * second_eccentricity_squared
            ) * delta_longitude**6 / 720
        )
    )
    return easting, northing


def _utm51(lon: float, lat: float) -> tuple[float, float]:
    return _utm(lon, lat, 51)


def _relation_rings(client: requests.Session, relation_id: int) -> dict[str, list[list[tuple[float, float]]]]:
    response = client.get(OSM_URL.format(relation_id=relation_id), timeout=120)
    response.raise_for_status()
    root = ET.fromstring(response.content)
    nodes = {
        element.attrib["id"]: (float(element.attrib["lon"]), float(element.attrib["lat"]))
        for element in root.findall("node")
    }
    ways = {
        element.attrib["id"]: [node.attrib["ref"] for node in element.findall("nd")]
        for element in root.findall("way")
    }
    relation = next(
        (element for element in root.findall("relation") if element.attrib.get("id") == str(relation_id)),
        None,
    )
    if relation is None:
        raise RuntimeError(f"OpenStreetMap relation {relation_id} was not returned.")

    segments: dict[str, list[list[str]]] = {"outer": [], "inner": []}
    for member in relation.findall("member"):
        role = member.attrib.get("role")
        if member.attrib.get("type") == "way" and role in segments:
            way_id = member.attrib["ref"]
            if way_id not in ways:
                raise RuntimeError(f"OpenStreetMap relation member way {way_id} is missing.")
            segments[role].append(ways[way_id])

    result: dict[str, list[list[tuple[float, float]]]] = {"outer": [], "inner": []}
    for role, parts in segments.items():
        while parts:
            ring = parts.pop()
            while ring[-1] != ring[0]:
                for index, part in enumerate(parts):
                    if part[0] == ring[-1]:
                        ring.extend(part[1:])
                        parts.pop(index)
                        break
                    if part[-1] == ring[-1]:
                        ring.extend(reversed(part[:-1]))
                        parts.pop(index)
                        break
                else:
                    raise RuntimeError(f"OpenStreetMap relation {relation_id} has an unclosed {role} ring.")
            try:
                result[role].append([nodes[node_id] for node_id in ring])
            except KeyError as error:
                raise RuntimeError(f"OpenStreetMap relation node {error.args[0]} is missing.") from error
    if not result["outer"]:
        raise RuntimeError(f"OpenStreetMap relation {relation_id} has no outer boundary.")
    return result


def _raster_mask(
    page: tifffile.TiffPage,
    rings: dict[str, list[list[tuple[float, float]]]],
) -> tuple[np.ndarray, tuple[int, int, int, int], tuple[Any, ...]]:
    scale = page.tags.get(33550)
    tiepoint = page.tags.get(33922)
    geokeys = page.tags.get(34735)
    if scale is None or tiepoint is None or geokeys is None:
        raise RuntimeError("The Landsat raster is missing GeoTIFF georeferencing tags.")
    keys = geokeys.value
    epsg = next((
        keys[index + 3]
        for index in range(4, len(keys), 4)
        if keys[index] == 3072 and keys[index + 1] == 0
    ), None)
    if not isinstance(epsg, int) or not 32601 <= epsg <= 32660:
        raise RuntimeError(f"Expected a northern-hemisphere WGS84 UTM projection; found EPSG:{epsg}.")
    utm_zone = epsg - 32600
    pixel_scale = scale.value
    tie = tiepoint.value
    if tuple(pixel_scale[:2]) != (30.0, 30.0):
        raise RuntimeError(f"Expected 30 m Landsat pixels; found {pixel_scale[:2]}.")
    origin_x, origin_y = tie[3], tie[4]
    projected: dict[str, list[list[tuple[float, float]]]] = {"outer": [], "inner": []}
    for role, role_rings in rings.items():
        for ring in role_rings:
            projected[role].append([
                ((x - origin_x) / pixel_scale[0], (origin_y - y) / pixel_scale[1])
                for x, y in (_utm(lon, lat, utm_zone) for lon, lat in ring)
            ])
    all_points = [point for role_rings in projected.values() for ring in role_rings for point in ring]
    col_min = math.floor(min(point[0] for point in all_points))
    col_max = math.ceil(max(point[0] for point in all_points))
    row_min = math.floor(min(point[1] for point in all_points))
    row_max = math.ceil(max(point[1] for point in all_points))
    if col_min < 0 or row_min < 0 or col_max > page.imagewidth or row_max > page.imagelength:
        raise RuntimeError("OpenStreetMap boundary does not fit the Landsat scene.")

    columns = np.arange(col_min, col_max, dtype=np.float64) + 0.5
    mask = np.zeros((row_max - row_min, col_max - col_min), dtype=bool)
    for row in range(row_min, row_max):
        y = row + 0.5
        inside_outer = np.zeros(columns.shape, dtype=bool)
        inside_inner = np.zeros(columns.shape, dtype=bool)
        for role, role_rings in (("outer", projected["outer"]), ("inner", projected["inner"])):
            destination = inside_outer if role == "outer" else inside_inner
            for ring in role_rings:
                inside = np.zeros(columns.shape, dtype=bool)
                for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                    if (y1 > y) != (y2 > y):
                        intersection = x1 + (x2 - x1) * (y - y1) / (y2 - y1)
                        inside ^= columns < intersection
                destination |= inside
        mask[row - row_min] = inside_outer & ~inside_inner
    if not mask.any():
        raise RuntimeError("The OpenStreetMap boundary contains no Landsat pixel centers.")
    grid = (page.imagewidth, page.imagelength, tuple(pixel_scale), tuple(tie), epsg)
    return mask, (row_min, row_max, col_min, col_max), grid


class _RangeReader:
    def __init__(self, client: requests.Session, url: str) -> None:
        self.client = client
        self.url = url
        self.position = 0
        self.length = 0
        self.blocks: dict[int, bytes] = {}
        self._get_block(0)

    def _get_block(self, block: int) -> bytes:
        if block not in self.blocks:
            start = block * 1024 * 1024
            end = start + 1024 * 1024 - 1
            response = self.client.get(
                self.url,
                headers={"Range": f"bytes={start}-{end}"},
                timeout=120,
            )
            response.raise_for_status()
            if response.status_code != 206:
                raise RuntimeError("Landsat cloud-optimized GeoTIFF did not honor byte-range requests.")
            content_range = response.headers.get("Content-Range", "")
            match = re.fullmatch(r"bytes \d+-\d+/(\d+)", content_range)
            if not match:
                raise RuntimeError("Landsat byte-range response omitted its total object size.")
            self.length = int(match.group(1))
            self.blocks[block] = response.content
        return self.blocks[block]

    def seek(self, offset: int, whence: int = 0) -> int:
        self.position = offset if whence == 0 else (
            self.position + offset if whence == 1 else self.length + offset
        )
        return self.position

    def tell(self) -> int:
        return self.position

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            size = max(0, self.length - self.position)
        if size == 0:
            return b""
        start = self.position
        end = min(start + size, self.length)
        self.position = end
        result = bytearray()
        cursor = start
        while cursor < end:
            block_number = cursor // (1024 * 1024)
            block_start = block_number * (1024 * 1024)
            block = self._get_block(block_number)
            offset = cursor - block_start
            count = min(end - cursor, len(block) - offset)
            if count <= 0:
                break
            result.extend(block[offset:offset + count])
            cursor += count
        return bytes(result)

    def close(self) -> None:
        self.blocks.clear()


def _signed_asset(client: requests.Session, href: str) -> str:
    response = client.get(STAC_SIGN_URL, params={"href": href}, timeout=60)
    response.raise_for_status()
    signed_href = response.json().get("href")
    if not signed_href:
        raise RuntimeError("Planetary Computer did not return a signed Landsat asset URL.")
    return signed_href


def _network_error_summary(error: requests.RequestException) -> str:
    def redact_url(match: re.Match[str]) -> str:
        parts = urlsplit(match.group())
        if not parts.query:
            return match.group()
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "[query redacted]", parts.fragment))

    message = re.sub(
        r"(?i)((?:[?&]|\b)(?:sig|se|sp|spr|sr|st|sv|skt|ske|sks|skv)=)[^&\s'\"<>]+",
        r"\1[redacted]",
        str(error),
    )
    message = re.sub(r"https?://[^\s'\"<>]+", redact_url, message, flags=re.IGNORECASE)
    return f"{type(error).__name__}: {message[:500]}"


def _signed_asset_urls(
    client: requests.Session,
    assets: dict[str, Any],
    required_assets: tuple[str, ...],
) -> dict[str, str]:
    green_href = assets["green"]["href"]
    signed_green, shared_query = _container_sas(client, green_href)
    signed_parts = urlsplit(signed_green)
    signed_assets = {"green": signed_green}
    for key in required_assets:
        if key == "green":
            continue
        href = assets[key]["href"]
        target = urlsplit(href)
        same_container = (
            target.scheme == signed_parts.scheme
            and target.netloc == signed_parts.netloc
            and target.path.strip("/").split("/", 1)[0]
            == signed_parts.path.strip("/").split("/", 1)[0]
        )
        if shared_query and same_container:
            signed_assets[key] = urlunsplit((
                target.scheme,
                target.netloc,
                target.path,
                shared_query,
                target.fragment,
            ))
        else:
            signed_assets[key] = _signed_asset(client, href)
    return signed_assets


def _container_sas(client: requests.Session, href: str) -> tuple[str, str | None]:
    parts = urlsplit(href)
    container_key = (
        parts.scheme,
        parts.netloc,
        parts.path.strip("/").split("/", 1)[0],
    )
    with _SAS_CACHE_LOCK:
        cached = _SAS_CACHE.get(container_key)
        now = datetime.now(timezone.utc)
        if cached and cached[1] > now + SAS_REFRESH_BUFFER:
            return urlunsplit((parts.scheme, parts.netloc, parts.path, cached[0], parts.fragment)), cached[0]

        signed = _signed_asset(client, href)
        signed_parts = urlsplit(signed)
        query = parse_qs(signed_parts.query)
        expires_at = query.get("se", [None])[0]
        if (
            query.get("sr") == ["c"]
            and expires_at is not None
            and (signed_parts.scheme, signed_parts.netloc) == (parts.scheme, parts.netloc)
            and signed_parts.path.strip("/").split("/", 1)[0] == container_key[2]
        ):
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except ValueError:
                return signed, None
            if expiry > now + SAS_REFRESH_BUFFER:
                _SAS_CACHE[container_key] = signed_parts.query, expiry
                return signed, signed_parts.query
        return signed, None


def _raster_grid(page: tifffile.TiffPage) -> tuple[Any, ...]:
    return (
        page.imagewidth,
        page.imagelength,
        tuple(page.tags[33550].value),
        tuple(page.tags[33922].value),
        next((
            page.tags[34735].value[index + 3]
            for index in range(4, len(page.tags[34735].value), 4)
            if page.tags[34735].value[index] == 3072
            and page.tags[34735].value[index + 1] == 0
        ), None),
    )


def _read_crop(
    page: tifffile.TiffPage,
    reader: _RangeReader,
    window: tuple[int, int, int, int],
) -> np.ndarray:
    row_min, row_max, col_min, col_max = window
    crop = np.zeros((row_max - row_min, col_max - col_min), dtype=np.uint16)
    tile_columns = math.ceil(page.imagewidth / page.tilewidth)
    first_tile_row = row_min // page.tilelength
    last_tile_row = (row_max - 1) // page.tilelength
    first_tile_col = col_min // page.tilewidth
    last_tile_col = (col_max - 1) // page.tilewidth
    for tile_row in range(first_tile_row, last_tile_row + 1):
        for tile_col in range(first_tile_col, last_tile_col + 1):
            index = tile_row * tile_columns + tile_col
            reader.seek(page.dataoffsets[index])
            encoded = reader.read(page.databytecounts[index])
            decoded, _, shape = page.decode(encoded, index)
            if decoded is None:
                continue
            tile = decoded.reshape(shape)[0, :, :, 0]
            tile_row_start = tile_row * page.tilelength
            tile_col_start = tile_col * page.tilewidth
            overlap_row_start = max(row_min, tile_row_start)
            overlap_row_end = min(row_max, tile_row_start + tile.shape[0])
            overlap_col_start = max(col_min, tile_col_start)
            overlap_col_end = min(col_max, tile_col_start + tile.shape[1])
            crop[
                overlap_row_start - row_min:overlap_row_end - row_min,
                overlap_col_start - col_min:overlap_col_end - col_min,
            ] = tile[
                overlap_row_start - tile_row_start:overlap_row_end - tile_row_start,
                overlap_col_start - tile_col_start:overlap_col_end - tile_col_start,
            ]
    return crop


def _read_masked_scene(
    client: requests.Session,
    item: dict[str, Any],
    rings: dict[str, list[list[tuple[float, float]]]],
) -> tuple[float, float, int]:
    assets = item.get("assets", {})
    required_assets = ("green", "swir16", "qa_pixel", "qa_radsat")
    missing = [key for key in required_assets if key not in assets]
    if missing:
        raise RuntimeError(f"Landsat scene {item['id']} is missing assets: {', '.join(missing)}.")

    signed_assets = _signed_asset_urls(client, assets, required_assets)

    def open_asset(
        key: str,
    ) -> tuple[str, requests.Session, _RangeReader, tifffile.TiffFile, tifffile.TiffPage]:
        asset_client = _session()
        reader: _RangeReader | None = None
        raster: tifffile.TiffFile | None = None
        try:
            reader = _RangeReader(asset_client, signed_assets[key])
            raster = tifffile.TiffFile(reader)
            page = raster.pages[0]
            if page.dtype != np.dtype("uint16"):
                raise RuntimeError(f"Unexpected Landsat {key} pixel type {page.dtype} in {item['id']}.")
            return key, asset_client, reader, raster, page
        except Exception:
            if raster is not None:
                raster.close()
            if reader is not None:
                reader.close()
            asset_client.close()
            raise

    opened_assets: dict[
        str, tuple[requests.Session, _RangeReader, tifffile.TiffFile, tifffile.TiffPage]
    ] = {}
    with ThreadPoolExecutor(max_workers=len(required_assets)) as executor:
        futures = [executor.submit(open_asset, key) for key in required_assets]
        errors: list[Exception] = []
        for future in as_completed(futures):
            try:
                key, asset_client, reader, raster, page = future.result()
            except Exception as error:
                errors.append(error)
                continue
            opened_assets[key] = asset_client, reader, raster, page

    try:
        if errors:
            raise errors[0]
        green_page = opened_assets["green"][3]
        reference_grid = _raster_grid(green_page)
        if any(
            _raster_grid(opened_assets[key][3]) != reference_grid
            for key in required_assets[1:]
        ):
            raise RuntimeError(f"Landsat scene {item['id']} assets use inconsistent image grids.")
        reservoir_mask, window, _ = _raster_mask(green_page, rings)

        def read_asset_crop(key: str) -> tuple[str, np.ndarray]:
            _, reader, _, page = opened_assets[key]
            return key, _read_crop(page, reader, window)

        arrays: dict[str, np.ndarray] = {}
        with ThreadPoolExecutor(max_workers=len(required_assets)) as executor:
            for key, crop in executor.map(read_asset_crop, required_assets):
                arrays[key] = crop
    finally:
        for asset_client, reader, raster, _ in opened_assets.values():
            raster.close()
            reader.close()
            asset_client.close()

    assert reservoir_mask is not None
    valid, water = _classify_landsat(
        arrays["green"],
        arrays["swir16"],
        arrays["qa_pixel"],
        arrays["qa_radsat"],
    )
    valid_pixels = int((valid & reservoir_mask).sum())
    total_pixels = int(reservoir_mask.sum())
    coverage = valid_pixels / total_pixels
    area_km2 = int((water & reservoir_mask).sum()) * PIXEL_AREA_KM2
    return coverage, area_km2, valid_pixels


def _query_interval(
    client: requests.Session,
    reservoir: Reservoir,
    interval: str,
    label: str,
) -> list[dict[str, Any]]:
    response = client.get(
        STAC_SEARCH_URL,
        params={
            "collections": STAC_COLLECTION,
            "bbox": ",".join(str(value) for value in reservoir.bbox),
            "datetime": interval,
            "limit": 1000,
            "sortby": "properties.datetime",
        },
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    if any(link.get("rel") == "next" for link in payload.get("links", [])):
        raise RuntimeError(f"Landsat STAC results exceed the 1000-item page for {label}.")
    return payload.get("features", [])


def _query_month(
    client: requests.Session,
    reservoir: Reservoir,
    year: int,
    month: int,
) -> list[dict[str, Any]]:
    return _query_interval(client, reservoir, _month_interval(year, month), f"{year}-{month:02d}")


def _query_year(
    client: requests.Session,
    reservoir: Reservoir,
    year: int,
) -> list[dict[str, Any]]:
    start = date(year, 1, 1)
    end = date(year + 1, 1, 1)
    interval = f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T00:00:00Z"
    return _query_interval(client, reservoir, interval, str(year))


def _evaluate_month(
    reservoir: Reservoir,
    rings: dict[str, list[list[tuple[float, float]]]],
    year: int,
    month: int,
    scenes: list[dict[str, Any]],
) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None, str | None]:
    month_key = f"{year:04d}-{month:02d}"
    with _session() as client:
        midpoint = _month_midpoint(year, month)
        scenes.sort(key=lambda item: _candidate_rank(item, midpoint))
        measurements: list[tuple[dict[str, Any], float, float, int]] = []
        scene_errors: list[str] = []
        for item in scenes:
            try:
                coverage, area_km2, valid_pixels = _read_masked_scene(client, item, rings)
            except requests.RequestException as error:
                scene_errors.append(f"{item['id']}: {_network_error_summary(error)}")
                continue
            except RuntimeError as error:
                if "does not fit the Landsat scene" in str(error):
                    continue
                raise
            if coverage < MINIMUM_VALID_COVERAGE:
                continue
            measurements.append((item, coverage, area_km2, valid_pixels))

        if not measurements:
            failure = "; ".join(scene_errors) if scene_errors else None
            if failure:
                print(f"{reservoir.location_id} {month_key}: scene access failed", flush=True)
            else:
                print(
                    f"{reservoir.location_id} {month_key}: no scene reached "
                    f"{MINIMUM_VALID_COVERAGE:.0%} valid coverage",
                    flush=True,
                )
            return month_key, None, None, failure

        record, selected_scene = _aggregate_monthly_scenes(measurements, year, month)
        selected_scene["candidatesAvailable"] = len(scenes)
        selected_scene["candidatesEvaluated"] = len(scenes)
        failure = "; ".join(scene_errors) if scene_errors else None
        print(
            f"{reservoir.location_id} {month_key}: {record['value']:.4f} km2 "
            f"(median of {record['validSceneCount']} scenes; "
            f"{record['medianValidCoverage']:.1%} median valid coverage)",
            flush=True,
        )
        return month_key, record, selected_scene, failure


def _build_payload(
    reservoir: Reservoir,
    rings: dict[str, list[list[tuple[float, float]]]],
    start: tuple[int, int],
    end: tuple[int, int],
) -> dict[str, Any]:
    series: list[dict[str, Any]] = []
    selected_scenes: list[dict[str, Any]] = []
    missing_months: list[str] = []
    network_errors: list[dict[str, Any]] = []
    months = list(_month_sequence(start, end))
    print(
        f"{reservoir.location_id}: indexing annual Landsat scene metadata",
        flush=True,
    )
    scenes_by_month: dict[tuple[int, int], list[dict[str, Any]]] = {}
    with _session() as search_client:
        for year in range(start[0], end[0] + 1):
            year_scenes = _query_year(search_client, reservoir, year)
            for item in year_scenes:
                acquired = _item_datetime(item)
                item_month = (acquired.year, acquired.month)
                if start <= item_month <= end:
                    scenes_by_month.setdefault(item_month, []).append(item)
            print(f"{reservoir.location_id}: indexed {year} ({len(year_scenes)} scenes)", flush=True)

    print(
        f"{reservoir.location_id}: processing {len(months)} months with "
        f"{MAX_MONTH_WORKERS} workers",
        flush=True,
    )
    with ThreadPoolExecutor(max_workers=MAX_MONTH_WORKERS) as executor:
        futures = {
            executor.submit(
                _evaluate_month,
                reservoir,
                rings,
                year,
                month,
                scenes_by_month.get((year, month), []),
            ): (year, month)
            for year, month in months
        }
        results = []
        for future in as_completed(futures):
            results.append(future.result())

    for month_key, record, selected_scene, failure in sorted(
        results,
        key=lambda result: result[0],
    ):
        if failure:
            network_errors.append({
                "month": month_key,
                "observationAvailable": record is not None,
                "error": failure,
            })
        if record is None or selected_scene is None:
            missing_months.append(month_key)
            continue
        series.append(record)
        selected_scenes.append(selected_scene)

    if not series:
        raise RuntimeError(f"No qualifying Landsat observations were found for {reservoir.location_id}.")

    boundary_url = f"https://www.openstreetmap.org/relation/{reservoir.relation_id}"
    scale_note = (
        "Landsat Collection 2 Level-2 surface-reflectance pixels at 30 m are classified with MNDWI "
        "(green minus SWIR1 divided by green plus SWIR1; water threshold > 0) inside the current "
        f"{reservoir.boundary_label} from OpenStreetMap, relation {reservoir.relation_id}. Pixels flagged as fill, "
        "dilated cloud, cirrus, cloud, cloud shadow, snow, or saturation are excluded; only scenes with at least "
        "80% valid boundary pixels are retained. "
        f"{reservoir.interpretation_note} The current boundary is applied retrospectively, and "
        "the spectral threshold is an estimate rather than a gauge observation. Monthly values are the "
        "median of accepted scenes, reducing dependence on a single acquisition; summed validPixelSamples "
        "counts pixel-scene samples, not unique ground pixels."
    )
    return {
        "locationId": reservoir.location_id,
        "metric": "monthly_mapped_water_area",
        "unit": "km2",
        "source": {
            "mission": "NASA/USGS Landsat",
            "product": "Landsat Collection 2 Level-2 Surface Reflectance, 30 m",
            "url": LANDSAT_COLLECTION_URL,
        },
        "references": [
            {"mission": "NASA", "product": "Landsat data archive overview", "url": NASA_LANDSAT_URL},
            {"mission": "USGS", "product": "Landsat Collection 2 Level-2, DOI 10.5066/P9IAXOVV", "url": LANDSAT_DOI_URL},
            {
                "mission": "Microsoft Planetary Computer",
                "product": "Public Landsat Collection 2 Level-2 STAC archive used for cloud-optimized raster access",
                "url": f"https://planetarycomputer.microsoft.com/api/stac/v1/collections/{STAC_COLLECTION}",
            },
            {
                "mission": "USGS",
                "product": "Collection 2 Quality Assessment Bands",
                "url": "https://www.usgs.gov/landsat-missions/landsat-collection-2-quality-assessment-bands",
            },
            {
                "mission": "OpenStreetMap contributors",
                "product": f"{reservoir.title} boundary, relation {reservoir.relation_id}",
                "url": boundary_url,
            },
        ],
        "scaleNote": scale_note,
        "sampling": {
            "method": (
                "For each complete calendar month, Landsat Collection 2 Level-2 scenes intersecting "
                f"the {reservoir.title} boundary are ranked by distance from the 15th, with scene-wide "
                "cloud cover as a tie-breaker. Every candidate is evaluated; scenes are masked using "
                "QA_PIXEL and classified with MNDWI > 0. Accepted scenes each have at least 80% valid "
                "boundary-pixel coverage, and the monthly value is their median mapped water area. "
                "Each water pixel contributes 900 m2. Months with no qualifying scene remain gaps."
            ),
            "index": "MNDWI = (green surface reflectance - SWIR1 surface reflectance) / (green + SWIR1); water threshold > 0",
            "qualityMask": "QA_PIXEL fill, dilated cloud, cirrus, cloud, cloud shadow, snow bits, and any QA_RADSAT flag are excluded.",
            "minimumValidCoverage": MINIMUM_VALID_COVERAGE,
            "boundarySource": {"url": boundary_url, "attribution": "© OpenStreetMap contributors"},
            "missingMonths": missing_months,
            "networkErrors": network_errors,
            "maximumConcurrentMonths": MAX_MONTH_WORKERS,
            "selectedScenes": selected_scenes,
        },
        "continuity": {
            "method": (
                "Linear interpolation between adjacent valid monthly observations for interior gaps of "
                "at most two months; source observations remain unchanged."
            ),
            "maximumInterpolatedGapMonths": 2,
        },
        "series": series,
    }


def _item_datetime(item: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(item["properties"]["datetime"].replace("Z", "+00:00"))


def fetch_reservoir(
    reservoir: Reservoir,
    start: tuple[int, int] = EARLIEST_AVAILABLE_MONTH,
    end: tuple[int, int] | None = None,
) -> Path:
    last_month = end or _latest_complete_month(date.today())
    if start < EARLIEST_AVAILABLE_MONTH:
        start = EARLIEST_AVAILABLE_MONTH
    if start > last_month:
        raise ValueError(f"Start month {start} is after the latest complete month {last_month}.")
    print(f"{reservoir.location_id}: retrieving OpenStreetMap boundary", flush=True)
    with _session() as client:
        rings = _relation_rings(client, reservoir.relation_id)
    print(f"{reservoir.location_id}: boundary loaded", flush=True)
    payload = _build_payload(reservoir, rings, start, last_month)
    output = write_story_data(reservoir.location_id, payload)
    summarize(reservoir.location_id, payload["series"])
    print(f"  wrote {output}")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Landsat mapped surface-water area series.")
    parser.add_argument(
        "--location",
        choices=(*RESERVOIRS, "reservoirs", "all"),
        default="reservoirs",
        help="'reservoirs' fetches Angat and Pantabangan; 'all' includes every configured boundary.",
    )
    parser.add_argument("--start", help="First month to fetch (YYYY-MM); defaults to December 1987.")
    parser.add_argument("--end", help="Last complete month to fetch (YYYY-MM); defaults to the previous month.")
    args = parser.parse_args()
    start = tuple(map(int, args.start.split("-"))) if args.start else EARLIEST_AVAILABLE_MONTH
    end = tuple(map(int, args.end.split("-"))) if args.end else None
    if args.location == "all":
        targets = RESERVOIRS.values()
    elif args.location == "reservoirs":
        targets = (RESERVOIRS[location_id] for location_id in RESERVOIR_LOCATION_IDS)
    else:
        targets = (RESERVOIRS[args.location],)
    for reservoir in targets:
        fetch_reservoir(reservoir, start, end)


if __name__ == "__main__":
    main()
