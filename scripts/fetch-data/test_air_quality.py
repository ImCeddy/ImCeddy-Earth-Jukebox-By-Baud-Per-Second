from __future__ import annotations

import unittest
from datetime import date

import numpy as np

from fetch_air_quality import LOCATIONS, build_payload
from fetch_valenzuela_air_quality import (
    last_completed_month_end,
    month_keys,
    qa_valid_mask,
    select_evenly_spaced,
    tile_pixel,
)
from maiac_sampling import build_monthly_series, calendar_month_coverage
from maiac_qa import aod_quality_masks


class ValenzuelaAirQualityTests(unittest.TestCase):
    def test_selects_first_middle_and_last_unique_days(self) -> None:
        entries = [
            {"time_start": f"2020-03-{day:02d}T00:00:00Z", "day": day}
            for day in range(1, 11)
        ]

        self.assertEqual(
            [entry["day"] for entry in select_evenly_spaced(entries)],
            [1, 6, 10],
        )

    def test_deduplicates_days_before_sampling(self) -> None:
        entries = [
            {"time_start": "2020-03-01T00:00:00Z", "version": 1},
            {"time_start": "2020-03-01T00:00:00Z", "version": 2},
            {"time_start": "2020-03-02T00:00:00Z", "version": 1},
        ]

        self.assertEqual(
            [entry["version"] for entry in select_evenly_spaced(entries)],
            [1, 1],
        )

    def test_quality_mask_accepts_good_and_documented_marginal_pixels(self) -> None:
        aod = np.array([[100, 200, 300, 400, 500, 600, 700, 5000, -1001]], dtype=np.int16)
        clear_land_best = 1
        adjacency_single_cloud = 1 | (3 << 5)
        qa = np.array([[
            clear_land_best,
            adjacency_single_cloud,
            1 | (1 << 5),
            1 | (2 << 5),
            2,
            1 | (1 << 3),
            1 | (1 << 8),
            clear_land_best,
            clear_land_best,
        ]], dtype=np.uint16)
        np.testing.assert_array_equal(
            qa_valid_mask(aod, qa),
            np.array([[True, True, False, False, False, False, False, False, False]]),
        )
        good, marginal = aod_quality_masks(aod, qa)
        self.assertEqual(int(good.sum()), 1)
        self.assertEqual(int(marginal.sum()), 1)

    def test_calendar_bounds_and_grid_tile(self) -> None:
        self.assertEqual(last_completed_month_end(date(2024, 3, 12)), date(2024, 2, 29))
        self.assertEqual(
            month_keys(date(2020, 11, 1), date(2021, 2, 28)),
            ["2020-11", "2020-12", "2021-01", "2021-02"],
        )
        self.assertEqual(tile_pixel(14.7011, 120.9830)[2], "h29v07")

    def test_monthly_series_requires_five_good_pixels_and_records_support(self) -> None:
        samples = {
            "2024-01": [
                ("2024-01-03", (0.2, 4, 2)),
                ("2024-01-15", (0.4, 5, 1)),
                ("2024-01-25", (0.6, 10, 0)),
            ],
            "2024-02": [("2024-02-14", (0.3, 4, 5))],
        }

        series, missing, valid_days, candidates, dates, sensitivity = build_monthly_series(
            samples,
            ["2024-01", "2024-02"],
        )

        self.assertEqual(len(series), 1)
        self.assertAlmostEqual(series[0]["value"], 0.5)
        self.assertEqual(series[0]["validDailySamples"], 2)
        self.assertEqual(series[0]["candidateDailySamples"], 3)
        self.assertEqual(series[0]["validPixelSamples"], 15)
        self.assertEqual(series[0]["qualityCounts"], {"goodSamples": 15, "marginalSamples": 1})
        self.assertEqual(missing, ["2024-02"])
        self.assertEqual(valid_days, {"2024-01": 2})
        self.assertEqual(candidates, {"2024-01": 3, "2024-02": 1})
        self.assertEqual(dates, {"2024-01": ["2024-01-15", "2024-01-25"]})
        self.assertEqual(sensitivity, {"5": 1, "10": 1})

    def test_calendar_month_coverage_exposes_seasonal_sampling_imbalance(self) -> None:
        coverage = calendar_month_coverage(
            [{"month": 4}, {"month": 4}, {"month": 8}],
            ["2024-04", "2024-08", "2025-04", "2025-08"],
        )

        self.assertEqual(coverage["04"], {"observedMonths": 2, "expectedMonths": 2})
        self.assertEqual(coverage["08"], {"observedMonths": 1, "expectedMonths": 2})
        self.assertEqual(coverage["09"], {"observedMonths": 0, "expectedMonths": 0})

    def test_paired_fetch_emits_same_method_metadata_for_both_sites(self) -> None:
        result = build_monthly_series(
            {"2024-01": [("2024-01-15", (0.25, 6, 2))]},
            ["2024-01"],
        )

        payloads = [build_payload(location, result) for location in LOCATIONS]
        self.assertEqual(
            {payload["sampling"]["minimumGoodPixelsPerDailyNeighborhood"] for payload in payloads},
            {5},
        )
        self.assertEqual(
            {payload["metric"] for payload in payloads},
            {"sampled_monthly_aod_047"},
        )
        self.assertEqual(
            [payload["sampling"]["coordinate"] for payload in payloads],
            [{"latitude": 14.72, "longitude": 121.1}, {"latitude": 14.7011, "longitude": 120.983}],
        )
        self.assertIn("not a verified landfill location", payloads[0]["sampling"]["coordinateNote"])
        self.assertNotIn("coordinateNote", payloads[1]["sampling"])


if __name__ == "__main__":
    unittest.main()
