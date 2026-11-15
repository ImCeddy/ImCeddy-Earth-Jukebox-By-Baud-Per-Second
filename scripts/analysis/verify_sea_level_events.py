from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from urllib.request import urlopen

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "src" / "data" / "story-data" / "manila-bay.json"
OUTPUT_DIR = ROOT / "scripts" / "analysis" / "output"
ONI_URL = "https://psl.noaa.gov/data/correlation/oni.data"


def month_number(year: int, month: int) -> int:
    return year * 12 + month - 1


def season_month(year: int, season_index: int) -> tuple[int, int]:
    return year, season_index + 1


def load_sea_level(data_path: Path) -> dict[tuple[int, int], float]:
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    return {(int(item["year"]), int(item["month"])): float(item["value"]) for item in payload["series"]}


def fetch_oni_text() -> str:
    with urlopen(ONI_URL, timeout=60) as response:
        return response.read().decode("utf-8")


def parse_oni(text: str) -> dict[tuple[int, int], float]:
    values: dict[tuple[int, int], float] = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts or not parts[0].isdigit():
            continue
        year = int(parts[0])
        if len(parts) != 13:
            continue
        for index, raw in enumerate(parts[1:13]):
            value = float(raw)
            if abs(value) >= 99:
                continue
            season_year, season_month_number = season_month(year, index)
            values[(season_year, season_month_number)] = value
    return values


def format_ym(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    absolute_month = year * 12 + month - 1 + offset
    return absolute_month // 12, absolute_month % 12 + 1


def oni_phase(value: float | None) -> str:
    if value is None:
        return "Missing"
    if value >= 0.5:
        return "El Nino"
    if value <= -0.5:
        return "La Nina"
    return "Neutral"


def correlation(x: np.ndarray, y: np.ndarray) -> float:
    mask = np.isfinite(x) & np.isfinite(y)
    if mask.sum() < 2:
        return float("nan")
    return float(np.corrcoef(x[mask], y[mask])[0, 1])


def window_bounds(window: tuple[int, int, int, int]) -> list[tuple[int, int]]:
    start_year, start_month, end_year, end_month = window
    result = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        result.append((year, month))
        month += 1
        if month == 13:
            year += 1
            month = 1
    return result


def calculate_metrics(
    sea: dict[tuple[int, int], float],
    oni: dict[tuple[int, int], float],
) -> tuple[list[tuple[int, int]], float, float, dict, dict, list[tuple[int, float]]]:
    keys = sorted(sea)
    x = np.array([month_number(*key) for key in keys], dtype=float)
    values_m = np.array([sea[key] for key in keys], dtype=float)
    x -= x.mean()
    slope_m_per_month, intercept = np.linalg.lstsq(np.column_stack((x, np.ones_like(x))), values_m, rcond=None)[0]
    detrended = values_m - (slope_m_per_month * x + intercept)

    seasonal: dict[int, list[float]] = defaultdict(list)
    for key, residual in zip(keys, detrended):
        seasonal[key[1]].append(float(residual))
    month_means = {month: float(np.mean(items)) for month, items in seasonal.items()}
    anomalies = np.array([detrended[index] - month_means[key[1]] for index, key in enumerate(keys)])
    std = float(np.std(anomalies, ddof=0))
    z_scores = anomalies / std if std else np.zeros_like(anomalies)
    trend_mm_per_year = slope_m_per_month * 1000 * 12
    anomaly_by_key = dict(zip(keys, anomalies))
    z_by_key = dict(zip(keys, z_scores))
    lag_rows = []
    for lag in range(7):
        anomaly_values = []
        oni_values = []
        for key in keys:
            oni_key = shift_month(key[0], key[1], -lag)
            if oni_key in oni:
                anomaly_values.append(anomaly_by_key[key])
                oni_values.append(oni[oni_key])
        lag_rows.append((lag, correlation(np.array(anomaly_values), np.array(oni_values))))
    return keys, trend_mm_per_year, std, anomaly_by_key, z_by_key, lag_rows


def markdown_report(data_path: Path) -> str:
    sea = load_sea_level(data_path)
    manila = load_sea_level(DATA_PATH)
    oni = parse_oni(fetch_oni_text())
    keys, trend_mm_per_year, std, anomaly_by_key, z_by_key, lag_rows = calculate_metrics(sea, oni)
    _, manila_trend, _, _, manila_z, manila_lags = calculate_metrics(manila, oni)

    lines = ["# Sea-level monthly verification", "", "## Trend and detrending", ""]
    lines.append(f"Fitted trend: {trend_mm_per_year:.6f} mm/yr")
    lines.append(f"Detrended-seasonal anomaly standard deviation: {std * 1000:.6f} mm")

    lines += ["", "## ONI correlation by lag", ""]
    for lag, value in lag_rows:
        lines.append(f"Lag {lag:02d}: r={value:.6f}")
    finite_lags = [(lag, value) for lag, value in lag_rows if math.isfinite(value)]
    target_best_lag = max(finite_lags, key=lambda row: abs(row[1]))
    manila_best_lag = max(
        ((lag, value) for lag, value in manila_lags if math.isfinite(value)),
        key=lambda row: abs(row[1]),
    )
    lines.append(f"Best lag: {target_best_lag[0]} months (r={target_best_lag[1]:.6f})")

    windows = [
        ("El Nino 1997-98", (1997, 5, 1998, 5)),
        ("La Nina 2007-08 / late 2008", (2007, 1, 2008, 12)),
        ("El Nino 2009-10", (2009, 7, 2010, 6)),
        ("La Nina 2010-11", (2010, 7, 2011, 6)),
        ("El Nino 2015-16", (2015, 7, 2016, 6)),
        ("La Nina 2020-09 to 2021-04", (2020, 9, 2021, 4)),
        ("La Nina 2021-09 to 2023-01", (2021, 9, 2023, 1)),
    ]
    lines += ["", "## ENSO windows", ""]
    for name, bounds in windows:
        window_keys = [key for key in window_bounds(bounds) if key in anomaly_by_key]
        if window_keys:
            mean_anomaly = float(np.mean([anomaly_by_key[key] for key in window_keys]))
            extreme = max(window_keys, key=lambda key: abs(anomaly_by_key[key]))
        else:
            mean_anomaly = float("nan")
            extreme = None
        if extreme is None:
            lines.append(f"{name}: n=0; mean anomaly=NaN; extreme=N/A")
        else:
            lines.append(
                f"{name} ({format_ym(*bounds[:2])} to {format_ym(*bounds[2:])}): "
                f"n={len(window_keys)}; mean anomaly={mean_anomaly * 1000:.6f} mm; "
                f"extreme={format_ym(*extreme)}, value={sea[extreme]:.9f} m, "
                f"anomaly={anomaly_by_key[extreme] * 1000:.6f} mm, z={z_by_key[extreme]:.6f}; "
                f"ONI phase={oni_phase(oni.get(extreme))}"
            )

    ranked = sorted(keys, key=lambda key: z_by_key[key], reverse=True)
    lines += ["", "## Extreme positive z-score months", ""]
    for key in ranked[:10]:
        lines.append(f"{format_ym(*key)}, z={z_by_key[key]:.6f}, ONI phase={oni_phase(oni.get(key))}")
    lines += ["", "## Extreme negative z-score months", ""]
    for key in sorted(keys, key=lambda key: z_by_key[key])[:10]:
        lines.append(f"{format_ym(*key)}, z={z_by_key[key]:.6f}, ONI phase={oni_phase(oni.get(key))}")

    first = month_number(*keys[0])
    last = month_number(*keys[-1])
    expected = []
    cursor = keys[0]
    while month_number(*cursor) <= last:
        expected.append(cursor)
        next_month = cursor[1] + 1
        next_year = cursor[0]
        if next_month == 13:
            next_month = 1
            next_year += 1
        cursor = (next_year, next_month)
    missing = [key for key in expected if key not in sea]
    lines += ["", "## Missing months", ""]
    lines.extend(format_ym(*key) for key in missing) if missing else lines.append("None")

    lines += ["", "## Requested observations", ""]
    for key in [(2013, 11), (2014, 12)]:
        label = format_ym(*key)
        if key in sea:
            lines.append(f"{label}: value={sea[key]:.9f} m, anomaly={anomaly_by_key[key] * 1000:.6f} mm, z={z_by_key[key]:.6f}, ONI phase={oni_phase(oni.get(key))}")
        else:
            lines.append(f"{label}: missing")

    comparison_dates = [(1998, 1), (2008, 12), (2011, 1), (2016, 4), (2023, 12)]
    lines += ["", "## Manila Bay vs Leyte Gulf", ""]
    headers = ["Location", "Trend (mm/yr)", "Best lag (months)", "Best-lag r"]
    headers.extend(f"{format_ym(*key)} z" for key in comparison_dates)
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join("---" for _ in headers) + " |")
    for name, trend, best_lag, scores in [
        ("Manila Bay", manila_trend, manila_best_lag, manila_z),
        ("Leyte Gulf" if data_path.stem == "leyte-gulf-tacloban" else data_path.stem, trend_mm_per_year, target_best_lag, z_by_key),
    ]:
        row = [name, f"{trend:.6f}", str(best_lag[0]), f"{best_lag[1]:.6f}"]
        row.extend(f"{scores[key]:.6f}" if key in scores else "missing" for key in comparison_dates)
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze a monthly sea-level JSON data file.")
    parser.add_argument("data_file", nargs="?", type=Path, default=DATA_PATH)
    args = parser.parse_args()
    data_path = args.data_file if args.data_file.is_absolute() else ROOT / args.data_file
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    report = markdown_report(data_path)
    report_name = "sea_level_events.md" if data_path.resolve() == DATA_PATH.resolve() else f"sea_level_events_{data_path.stem}.md"
    (OUTPUT_DIR / report_name).write_text(report, encoding="utf-8")
    print(report, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
