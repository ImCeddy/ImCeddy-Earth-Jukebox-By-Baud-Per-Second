from __future__ import annotations

import unittest
from datetime import date

from fetch_gpm_cagayan_de_oro import (
    GRID_CENTER_LATITUDE,
    GRID_CENTER_LONGITUDE,
    build_payload,
    month_keys,
    monthly_total_mm,
    parse_monthly_precipitation_rate,
)


class GpmCagayanDeOroTests(unittest.TestCase):
    def test_collection_point_maps_to_nearest_grid_cell(self) -> None:
        self.assertAlmostEqual(GRID_CENTER_LATITUDE, 8.45)
        self.assertAlmostEqual(GRID_CENTER_LONGITUDE, 124.65)

    def test_monthly_rate_is_converted_using_calendar_hours(self) -> None:
        self.assertAlmostEqual(monthly_total_mm(0.1, 2024, 2), 69.6)
        self.assertAlmostEqual(monthly_total_mm(0.1, 2023, 2), 67.2)

    def test_opendap_parser_returns_monthly_mean_rate(self) -> None:
        response = (
            "Dataset: example\n"
            "/Grid/precipitation.lat, 8.45\n"
            "/Grid/precipitation.precipitation[/Grid/precipitation.time=567648000]"
            "[/Grid/precipitation.lon=124.65], 0.088\n"
        )
        self.assertEqual(parse_monthly_precipitation_rate(response), 0.088)

    def test_fill_values_are_missing_but_zero_is_valid(self) -> None:
        prefix = (
            "Dataset: example\n"
            "/Grid/precipitation.precipitation[/Grid/precipitation.time=0]"
            "[/Grid/precipitation.lon=124.65], "
        )
        self.assertIsNone(parse_monthly_precipitation_rate(prefix + "-9999.9\n"))
        self.assertEqual(parse_monthly_precipitation_rate(prefix + "0\n"), 0)

    def test_parser_rejects_ambiguous_or_negative_values(self) -> None:
        with self.assertRaises(ValueError):
            parse_monthly_precipitation_rate("Dataset: empty\n")
        with self.assertRaises(ValueError):
            parse_monthly_precipitation_rate(
                "/Grid/precipitation.precipitation[t][x], -1\n"
            )

    def test_payload_preserves_coverage_and_real_zero_rainfall(self) -> None:
        payload = build_payload(
            {"1998-01": 0.0, "1998-02": 0.1},
            ["1998-01", "1998-02", "1998-03"],
        )
        self.assertEqual(payload["datasetId"], "cagayan-de-oro-gpm-imerg")
        self.assertEqual(payload["series"][0]["value"], 0)
        self.assertAlmostEqual(payload["series"][1]["value"], 67.2)
        self.assertEqual(payload["sampling"]["missingMonths"], ["1998-03"])
        self.assertEqual(
            [point["month"] for point in payload["series"]],
            [1, 2],
        )

    def test_month_keys_cross_year_boundaries(self) -> None:
        self.assertEqual(
            month_keys(date(1998, 12, 1), date(1999, 2, 1)),
            ["1998-12", "1999-01", "1999-02"],
        )


if __name__ == "__main__":
    unittest.main()
