from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from typing import Literal

AggregationMethod = Literal["mean", "sum", "max"]


def aggregate_annual(
    values: Iterable[tuple[int, float]],
    method: AggregationMethod,
    precision: int = 6,
) -> list[dict[str, int | float]]:
    grouped: dict[int, list[float]] = defaultdict(list)
    for year, value in values:
        if math.isfinite(value):
            grouped[year].append(value)

    if method not in {"mean", "sum", "max"}:
        raise ValueError(f"Unsupported annual aggregation method: {method}")

    annual = []
    for year, observations in sorted(grouped.items()):
        if method == "mean":
            value = math.fsum(observations) / len(observations)
        elif method == "sum":
            value = math.fsum(observations)
        else:
            value = max(observations)
        annual.append({"year": year, "value": round(value, precision)})
    return annual


def aggregate_monthly(
    values: Iterable[tuple[str, float]],
    precision: int = 6,
) -> list[dict[str, int | float]]:
    grouped: dict[str, list[float]] = defaultdict(list)
    for month, value in values:
        if math.isfinite(value):
            grouped[month].append(value)

    monthly = []
    for month, observations in sorted(grouped.items()):
        monthly.append({
            "year": int(month[:4]),
            "month": int(month[5:7]),
            "value": round(math.fsum(observations) / len(observations), precision),
        })
    return monthly