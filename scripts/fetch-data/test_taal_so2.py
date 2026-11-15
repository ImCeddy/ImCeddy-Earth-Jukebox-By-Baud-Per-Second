from __future__ import annotations

import unittest

import numpy as np

from fetch_taal_so2 import (
    aggregate_monthly,
    daily_region_mean,
    grid_cell_centers,
    grid_indices,
    parse_subset_ascii,
)


class TaalSo2Tests(unittest.TestCase):
    def test_selects_nearest_omps_grid_cell_and_three_by_three_region(self) -> None:
        rows, columns = grid_indices(14.002, 120.993)
        latitudes, longitudes = grid_cell_centers()

        self.assertEqual(list(rows), [415, 416, 417])
        self.assertEqual(list(columns), [1202, 1203, 1204])
        self.assertEqual(latitudes, [13.875, 14.125, 14.375])
        self.assertEqual(longitudes, [120.625, 120.875, 121.125])

    def test_parses_all_cells_and_rejects_truncated_responses(self) -> None:
        response = """Dataset: sample.nc
QualityFlags_SO2.QualityFlags_SO2[QualityFlags_SO2.Time=1][QualityFlags_SO2.Latitude=13.875], 0, 1, 0
QualityFlags_SO2.QualityFlags_SO2[QualityFlags_SO2.Time=1][QualityFlags_SO2.Latitude=14.125], 0, 0, 1
ColumnAmountSO2.ColumnAmountSO2[ColumnAmountSO2.Time=1][ColumnAmountSO2.Latitude=13.875], 1, -999, 3
ColumnAmountSO2.ColumnAmountSO2[ColumnAmountSO2.Time=1][ColumnAmountSO2.Latitude=14.125], 2, 4, 5
CloudRadianceFraction.CloudRadianceFraction[CloudRadianceFraction.Time=1][CloudRadianceFraction.Latitude=13.875], 0.1, 0.1, 0.2
CloudRadianceFraction.CloudRadianceFraction[CloudRadianceFraction.Time=1][CloudRadianceFraction.Latitude=14.125], 0, 0.3, 0.1
"""
        flags, amounts, cloud_fraction = parse_subset_ascii(response, 6)

        np.testing.assert_array_equal(flags, [0, 1, 0, 0, 0, 1])
        np.testing.assert_array_equal(amounts, [1, -999, 3, 2, 4, 5])
        np.testing.assert_array_equal(cloud_fraction, [0.1, 0.1, 0.2, 0, 0.3, 0.1])
        with self.assertRaisesRegex(RuntimeError, "expected regional grids"):
            parse_subset_ascii(response, 9)

    def test_daily_average_applies_product_qa_and_cloud_filters(self) -> None:
        mean, valid_cells = daily_region_mean(
            np.array([0, 0, 0, 1, 0, 0, 0]),
            np.array([1.0, 2.0, -21.0, 4.0, 5.0, 2001.0, 7.0]),
            np.array([0.2, 0.21, 0.1, 0.1, 0.1, 0.1, np.nan]),
        )

        self.assertEqual(mean, 3.0)
        self.assertEqual(valid_cells, 2)

    def test_aggregates_daily_means_and_preserves_month_support(self) -> None:
        samples = [
            ("2012-01-27", 0.2, 4),
            ("2012-01-28", None, 0),
            ("2012-02-01", 0.4, 3),
            ("2012-02-02", 0.6, 2),
        ]
        result = aggregate_monthly(samples, ["2012-01", "2012-02", "2012-03"])
        series, missing, candidates, valid_days, valid_cells, valid_dates = result

        self.assertEqual([point["value"] for point in series], [0.2, 0.5])
        self.assertEqual([point["validDailySamples"] for point in series], [1, 2])
        self.assertEqual([point["validPixelSamples"] for point in series], [4, 5])
        self.assertEqual(missing, ["2012-03"])
        self.assertEqual(candidates, {"2012-01": 2, "2012-02": 2, "2012-03": 0})
        self.assertEqual(valid_days, {"2012-01": 1, "2012-02": 2, "2012-03": 0})
        self.assertEqual(valid_cells, {"2012-01": 4, "2012-02": 5, "2012-03": 0})
        self.assertEqual(valid_dates, {
            "2012-01": ["2012-01-27"],
            "2012-02": ["2012-02-01", "2012-02-02"],
            "2012-03": [],
        })


if __name__ == "__main__":
    unittest.main()
