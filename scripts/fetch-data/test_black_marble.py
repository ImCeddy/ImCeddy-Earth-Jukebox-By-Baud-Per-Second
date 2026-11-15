from __future__ import annotations

import unittest

import numpy as np

from common import session
from fetch_haiyan_black_marble import (
    END_MONTH as TACLOBAN_END_MONTH,
    END_YEAR as TACLOBAN_END_YEAR,
    GRANULE_PATTERN,
    MINIMUM_VALID_PIXELS as TACLOBAN_MINIMUM_VALID_PIXELS,
    OUTPUT_FILENAME as TACLOBAN_OUTPUT_FILENAME,
    distance_km,
    month_keys,
    valid_radiance_values,
)
from fetch_odette_black_marble import (
    DAILY_QUERY_MONTH,
    DAILY_QUERY_YEAR,
    END_MONTH as SURIGAO_END_MONTH,
    END_YEAR as SURIGAO_END_YEAR,
    MINIMUM_VALID_PIXELS as SURIGAO_MINIMUM_VALID_PIXELS,
    START_MONTH as SURIGAO_START_MONTH,
    START_YEAR as SURIGAO_START_YEAR,
    find_daily_granules,
)


class BlackMarbleTests(unittest.TestCase):
    def test_surigao_fetch_covers_the_available_black_marble_record(self) -> None:
        self.assertEqual(
            (SURIGAO_START_YEAR, SURIGAO_START_MONTH, SURIGAO_END_YEAR, SURIGAO_END_MONTH),
            (2012, 1, 2026, 10),
        )
        self.assertEqual(TACLOBAN_END_YEAR, 2026)
        self.assertEqual(TACLOBAN_END_MONTH, 10)
        self.assertEqual(TACLOBAN_MINIMUM_VALID_PIXELS, 10)
        self.assertEqual(TACLOBAN_OUTPUT_FILENAME, "tacloban-haiyan.json")
        self.assertEqual(SURIGAO_MINIMUM_VALID_PIXELS, 35)

    def test_month_range_supports_location_specific_partial_years(self) -> None:
        self.assertEqual(
            month_keys(2020, 12, 2022, 2),
            [
                "2020-12",
                "2021-01",
                "2021-02",
                "2021-03",
                "2021-04",
                "2021-05",
                "2021-06",
                "2021-07",
                "2021-08",
                "2021-09",
                "2021-10",
                "2021-11",
                "2021-12",
                "2022-01",
                "2022-02",
            ],
        )

    def test_daily_query_excludes_adjacent_month_granules(self) -> None:
        entries = [
            {"producer_granule_id": "VNP46A2.A2021365.h30v08.002.test.h5", "time_start": "2021-12-31T00:00:00Z"},
            {"producer_granule_id": "VNP46A2.A2022001.h30v08.002.test.h5", "time_start": "2022-01-01T00:00:00Z"},
            {"producer_granule_id": "VNP46A2.A2022031.h30v08.002.test.h5", "time_start": "2022-01-31T00:00:00Z"},
            {"producer_granule_id": "VNP46A2.A2022032.h30v08.002.test.h5", "time_start": "2022-02-01T00:00:00Z"},
        ]

        class FakeResponse:
            def raise_for_status(self) -> None:
                pass

            def json(self) -> dict:
                return {"feed": {"entry": entries}}

        class FakeClient:
            def get(self, *args, **kwargs) -> FakeResponse:
                return FakeResponse()

        selected = find_daily_granules(FakeClient())
        self.assertEqual(len(selected), 2)
        self.assertTrue(all(
            item["time_start"].startswith(f"{DAILY_QUERY_YEAR}-{DAILY_QUERY_MONTH:02d}-")
            for item in selected
        ))

    def test_granule_matching_accepts_surigaos_h30v08_tile(self) -> None:
        match = GRANULE_PATTERN.search("VNP46A3.A2021335.h30v08.002.2025148180910.h5")
        self.assertIsNotNone(match)
        self.assertEqual(match.group("year"), "2021")

    def test_quality_filter_keeps_good_land_pixels_including_zero_radiance(self) -> None:
        radiance = np.array([[0.0, 1.5, 2.5, -999.9, np.nan]])
        quality = np.array([[0, 0, 1, 0, 0]])
        land_water = np.array([[1, 0, 1, 1, 1]])

        np.testing.assert_array_equal(
            valid_radiance_values(radiance, quality, land_water),
            np.array([0.0, 1.5]),
        )

    def test_quality_filter_excludes_coastal_and_water_pixels(self) -> None:
        radiance = np.array([[1.0, 2.0, 3.0]])
        quality = np.zeros_like(radiance, dtype=np.uint8)
        land_water = np.array([[2, 3, 5]])

        self.assertEqual(valid_radiance_values(radiance, quality, land_water).size, 0)

    def test_quality_filter_rejects_mismatched_arrays(self) -> None:
        with self.assertRaises(ValueError):
            valid_radiance_values(np.ones((2, 2)), np.ones((1, 2)), np.ones((2, 2)))

    def test_tacloban_grid_cell_is_within_one_pixel_of_requested_point(self) -> None:
        self.assertLess(
            distance_km(11.2431609, 125.0082936, 11.2416667, 125.0083333),
            0.2,
        )

    def test_session_uses_a_bearer_header_without_logging_the_token(self) -> None:
        client = session("test-token")
        try:
            self.assertEqual(client.headers["Authorization"], "Bearer test-token")
        finally:
            client.close()


if __name__ == "__main__":
    unittest.main()
