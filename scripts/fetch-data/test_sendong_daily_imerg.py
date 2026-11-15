from __future__ import annotations

import unittest
from datetime import date

from fetch_sendong_daily_imerg import (
    BASYANG_END_DATE,
    BASYANG_START_DATE,
    GRID_CENTER_LATITUDE,
    GRID_CENTER_LONGITUDE,
    expected_dates,
    parse_daily_precipitation,
)


class SendongDailyIMERGTests(unittest.TestCase):
    def test_event_window_covers_the_nasa_trmm_analysis_dates(self) -> None:
        self.assertEqual(
            expected_dates(),
            [
                "2011-12-13",
                "2011-12-14",
                "2011-12-15",
                "2011-12-16",
                "2011-12-17",
                "2011-12-18",
                "2011-12-19",
                "2011-12-20",
            ],
        )

    def test_basyang_window_covers_the_february_2026_northern_mindanao_event(self) -> None:
        self.assertEqual(BASYANG_START_DATE, date(2026, 2, 4))
        self.assertEqual(BASYANG_END_DATE, date(2026, 2, 10))
        self.assertEqual(
            expected_dates(BASYANG_START_DATE, BASYANG_END_DATE),
            [
                "2026-02-04",
                "2026-02-05",
                "2026-02-06",
                "2026-02-07",
                "2026-02-08",
                "2026-02-09",
                "2026-02-10",
            ],
        )

    def test_sampling_cell_matches_the_monthly_cdo_grid(self) -> None:
        self.assertAlmostEqual(GRID_CENTER_LATITUDE, 8.45)
        self.assertAlmostEqual(GRID_CENTER_LONGITUDE, 124.65)

    def test_ascii_parser_keeps_zero_and_rejects_fill_or_bad_values(self) -> None:
        prefix = (
            "Dataset: example\n"
            "precipitation.precipitation[precipitation.time=11664]"
            "[precipitation.lon=124.65], "
        )
        self.assertEqual(parse_daily_precipitation(prefix + "7.375\n"), 7.375)
        self.assertEqual(parse_daily_precipitation(prefix + "0\n"), 0)
        self.assertIsNone(parse_daily_precipitation(prefix + "-9999.9\n"))
        with self.assertRaises(ValueError):
            parse_daily_precipitation(prefix + "-1\n")
        with self.assertRaises(ValueError):
            parse_daily_precipitation("Dataset: empty\n")


if __name__ == "__main__":
    unittest.main()
