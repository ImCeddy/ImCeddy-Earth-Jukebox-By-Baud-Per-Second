from __future__ import annotations

import unittest

from fetch_metro_manila_omi_no2 import (
    GRID_CENTER_LATITUDE,
    GRID_CENTER_LONGITUDE,
    LOCATION_ID,
    MINIMUM_VALID_CELLS_PER_DAY,
    VALUE_SCALE,
    build_payload,
    parse_daily_region,
)


def ascii_region(values: list[list[float]]) -> str:
    path = "/HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields/ColumnAmountNO2TropCloudScreened"
    return "\n".join(
        f"{path}[{row_index}], " + ", ".join(str(value) for value in row)
        for row_index, row in enumerate(values)
    )


class MetroManilaOmiNo2Tests(unittest.TestCase):
    def test_grid_center_is_nearest_cell_to_manila_reference(self) -> None:
        self.assertAlmostEqual(GRID_CENTER_LATITUDE, 14.625)
        self.assertAlmostEqual(GRID_CENTER_LONGITUDE, 120.875)

    def test_parses_valid_cells_and_excludes_only_fill_values(self) -> None:
        values = [
            [1e15, 2e15, -1.2676506e30],
            [3e15, 4e15, 5e15],
            [6e15, 7e15, 8e15],
        ]

        result = parse_daily_region(ascii_region(values))

        self.assertEqual(result, (4.5, 8))

    def test_rejects_daily_regions_below_minimum_valid_cell_support(self) -> None:
        result = parse_daily_region(ascii_region([
            [1e15, 2e15, -1.2676506e30],
            [-1.2676506e30, -1.2676506e30, -1.2676506e30],
            [-1.2676506e30, -1.2676506e30, -1.2676506e30],
        ]))

        self.assertIsNone(result)
        self.assertEqual(MINIMUM_VALID_CELLS_PER_DAY, 3)

    def test_payload_monthly_means_keep_support_and_report_gaps(self) -> None:
        payload = build_payload(
            {
                "2004-10": [("2004-10-02", (2.0, 4)), ("2004-10-03", (4.0, 5))],
                "2004-11": [("2004-11-02", None)],
                "2004-12": [("2004-12-02", (3.0, 6))],
            },
            {"2004-10": 3, "2004-11": 30, "2004-12": 2},
            "2004-12",
        )

        self.assertEqual(payload["locationId"], LOCATION_ID)
        self.assertEqual(payload["metric"], "monthly_mean_tropospheric_no2_column_omi")
        self.assertEqual(payload["series"], [
            {
                "year": 2004,
                "month": 10,
                "value": 3.0,
                "validDailySamples": 2,
                "candidateDailySamples": 3,
                "validPixelSamples": 9,
            },
            {
                "year": 2004,
                "month": 12,
                "value": 3.0,
                "validDailySamples": 1,
                "candidateDailySamples": 2,
                "validPixelSamples": 6,
            },
        ])
        self.assertEqual(payload["sampling"]["missingMonths"], ["2004-11"])
        self.assertIn("cannot attribute a NO₂ change to lockdown", payload["scaleNote"])
        self.assertEqual(payload["unit"], "10^15 molecules/cm²")
        self.assertEqual(VALUE_SCALE, 1e15)
        self.assertEqual(
            payload["sampling"]["minimumSupportForLowSupportCue"],
            {"validDailySamples": 10, "validPixelSamples": 30},
        )


if __name__ == "__main__":
    unittest.main()
