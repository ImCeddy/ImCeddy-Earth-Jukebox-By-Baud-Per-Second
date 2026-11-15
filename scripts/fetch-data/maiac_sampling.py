from __future__ import annotations

import re
from datetime import date, timedelta
from pathlib import Path

import numpy as np

from maiac_qa import aod_quality_masks

SAMPLES_PER_MONTH = 3
MINIMUM_GOOD_PIXELS_PER_DAY = 5
MINIMUM_VALID_DAYS_PER_MONTH = 1
SCALE_FACTOR = 0.001
AOD_LAYER = "Optical_Depth_047"
QA_LAYER = "AOD_QA"


def tile_pixel(latitude: float, longitude: float) -> tuple[int, int, str]:
    radius = 6371007.181
    tile_size = 1111950.5196666666
    x = radius * np.radians(longitude) * np.cos(np.radians(latitude))
    y = radius * np.radians(latitude)
    horizontal_tile = int((x + 20015109.354) // tile_size)
    vertical_tile = int((10007554.677 - y) // tile_size)
    pixel_size = tile_size / 1200
    column = int(((x + 20015109.354) - horizontal_tile * tile_size) / pixel_size)
    row = int(((10007554.677 - y) - vertical_tile * tile_size) / pixel_size)
    return row, column, f"h{horizontal_tile:02d}v{vertical_tile:02d}"


def select_evenly_spaced(entries: list[dict], count: int = SAMPLES_PER_MONTH) -> list[dict]:
    if count < 1:
        raise ValueError("The monthly sample count must be at least one")
    unique_by_day: dict[str, dict] = {}
    for entry in entries:
        unique_by_day.setdefault(entry["time_start"][:10], entry)
    ordered = [unique_by_day[day] for day in sorted(unique_by_day)]
    if len(ordered) <= count:
        return ordered
    if count == 1:
        return [ordered[len(ordered) // 2]]
    indexes = [int(index * (len(ordered) - 1) / (count - 1) + 0.5) for index in range(count)]
    return [ordered[index] for index in indexes]


def extract_qa_filtered_neighborhood(
    path: Path,
    producer_name: str,
    latitude: float,
    longitude: float,
) -> tuple[float, int, int] | None:
    from pyhdf.SD import SD, SDC

    tile_match = re.search(r"\.(h\d{2}v\d{2})\.", producer_name)
    expected_row, expected_column, expected_tile = tile_pixel(latitude, longitude)
    if not tile_match or tile_match.group(1) != expected_tile:
        raise RuntimeError(f"Granule tile does not match the requested coordinate: {producer_name}")

    dataset = SD(str(path), SDC.READ)
    try:
        aod_layer = dataset.select(AOD_LAYER)
        aod = np.asarray(aod_layer.get())
        aod_layer.endaccess()
        qa_layer = dataset.select(QA_LAYER)
        qa = np.asarray(qa_layer.get())
        qa_layer.endaccess()
    finally:
        dataset.end()

    if aod.shape != qa.shape:
        raise RuntimeError(f"{AOD_LAYER} and {QA_LAYER} shapes differ in {producer_name}")
    if aod.ndim == 2:
        aod = aod[np.newaxis, ...]
        qa = qa[np.newaxis, ...]

    row_start = max(0, expected_row - 2)
    row_end = min(aod.shape[-2], expected_row + 3)
    column_start = max(0, expected_column - 2)
    column_end = min(aod.shape[-1], expected_column + 3)
    aod = aod[:, row_start:row_end, column_start:column_end].astype(float)
    qa = qa[:, row_start:row_end, column_start:column_end].astype(np.uint16)

    good, marginal = aod_quality_masks(aod, qa)
    if not good.any():
        return None
    return float(np.median(aod[good]) * SCALE_FACTOR), int(good.sum()), int(marginal.sum())


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


def calendar_month_coverage(series: list[dict], expected_months: list[str]) -> dict[str, dict[str, int]]:
    observed_counts = {
        month: sum(point["month"] == month for point in series)
        for month in range(1, 13)
    }
    expected_counts = {
        month: sum(int(key[5:7]) == month for key in expected_months)
        for month in range(1, 13)
    }
    return {
        f"{month:02d}": {
            "observedMonths": observed_counts[month],
            "expectedMonths": expected_counts[month],
        }
        for month in range(1, 13)
    }


def build_monthly_series(
    samples_by_month: dict[str, list[tuple[str, tuple[float, int, int] | None]]],
    expected_months: list[str],
) -> tuple[list[dict], list[str], dict, dict, dict, dict[str, int]]:
    series: list[dict] = []
    missing_months: list[str] = []
    valid_days_by_month: dict[str, int] = {}
    candidate_days_by_month: dict[str, int] = {}
    valid_dates_by_month: dict[str, list[str]] = {}
    threshold_10_months: set[str] = set()

    for month_key in expected_months:
        candidates = samples_by_month.get(month_key, [])
        candidate_days_by_month[month_key] = len(candidates)
        accepted = [
            (sample_date, result)
            for sample_date, result in candidates
            if result is not None and result[1] >= MINIMUM_GOOD_PIXELS_PER_DAY
        ]
        threshold_10 = [
            result for _, result in candidates
            if result is not None and result[1] >= 10
        ]
        if len(threshold_10) >= MINIMUM_VALID_DAYS_PER_MONTH:
            threshold_10_months.add(month_key)
        if len(accepted) < MINIMUM_VALID_DAYS_PER_MONTH:
            missing_months.append(month_key)
            continue

        year, month = map(int, month_key.split("-"))
        results = [result for _, result in accepted]
        good_pixels = sum(result[1] for result in results)
        marginal_pixels = sum(result[2] for result in results)
        series.append({
            "year": year,
            "month": month,
            "value": float(np.mean([result[0] for result in results])),
            "validDailySamples": len(accepted),
            "candidateDailySamples": len(candidates),
            "validPixelSamples": good_pixels,
            "qualityCounts": {
                "goodSamples": good_pixels,
                "marginalSamples": marginal_pixels,
            },
        })
        valid_days_by_month[month_key] = len(accepted)
        valid_dates_by_month[month_key] = [sample_date for sample_date, _ in accepted]

    sensitivity = {
        "5": sum(
            any(result is not None and result[1] >= 5 for _, result in samples_by_month.get(month, []))
            for month in expected_months
        ),
        "10": len(threshold_10_months),
    }
    return series, missing_months, valid_days_by_month, candidate_days_by_month, valid_dates_by_month, sensitivity
