from __future__ import annotations

import unittest

import numpy as np

from fetch_bogo_tino import expected_daily_dates, grid_sample


class BogoTinoFetcherTests(unittest.TestCase):
    def test_daily_window_covers_the_three_requested_utc_dates(self) -> None:
        self.assertEqual(
            expected_daily_dates(),
            ["2025-11-03", "2025-11-04", "2025-11-05"],
        )

    def test_grid_sample_selects_the_nearest_longitude_latitude_cell(self) -> None:
        precipitation = np.arange(12, dtype=np.float32).reshape(4, 3)
        value, latitude, longitude = grid_sample(
            precipitation,
            np.array([11.15, 11.05, 10.95]),
            np.array([123.85, 123.95, 124.05, 124.15]),
        )
        self.assertEqual(value, 7.0)
        self.assertEqual(latitude, 11.05)
        self.assertEqual(longitude, 124.05)

    def test_grid_sample_rejects_missing_or_negative_rainfall(self) -> None:
        latitudes = np.array([11.05])
        longitudes = np.array([124.05])
        with self.assertRaisesRegex(ValueError, "no valid"):
            grid_sample(np.array([[-9999.9]]), latitudes, longitudes)
        with self.assertRaisesRegex(ValueError, "negative"):
            grid_sample(np.array([[-0.1]]), latitudes, longitudes)


if __name__ == "__main__":
    unittest.main()
