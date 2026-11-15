from __future__ import annotations

import unittest

from fetch_koronadal_merra2_aod import (
    GRID_DISTANCE_KM,
    GRID_LATITUDE,
    GRID_LONGITUDE,
    LOCATION_ID,
    build_payload,
    parse_opendap_response,
)


class KoronadalMerra2AodTests(unittest.TestCase):
    def test_parses_a_valid_nearest_grid_cell_value(self) -> None:
        response = (
            "Dataset: MERRA2_400.tavgM_2d_aer_Nx.201509.nc4\n"
            "lon, 125\n"
            "lat, 6.5\n"
            "TOTEXTTAU.lon, 125\n"
            "TOTEXTTAU.TOTEXTTAU[TOTEXTTAU.time=0][TOTEXTTAU.lat=6.5], 0.231729\n"
        )

        self.assertEqual(parse_opendap_response(response), 0.231729)
        self.assertEqual((GRID_LATITUDE, GRID_LONGITUDE), (6.5, 125.0))
        self.assertGreater(GRID_DISTANCE_KM, 17)
        self.assertLess(GRID_DISTANCE_KM, 18)

    def test_rejects_unexpected_grid_coordinates_and_missing_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unexpected MERRA-2 latitude"):
            parse_opendap_response(
                "lon, 125\nlat, 7\nTOTEXTTAU.TOTEXTTAU[0], 0.2\n"
            )
        self.assertIsNone(
            parse_opendap_response(
                "lon, 125\nlat, 6.5\n"
                "TOTEXTTAU.TOTEXTTAU[0], 9.99999987e+14\n"
            )
        )

    def test_builds_series_and_records_monthly_gaps(self) -> None:
        payload = build_payload(
            {"2010-01": 0.08, "2010-02": None, "2010-03": 0.12},
            "2010-03",
        )

        self.assertEqual(payload["locationId"], LOCATION_ID)
        self.assertEqual(payload["metric"], "monthly_mean_aerosol_optical_thickness_055")
        self.assertEqual(payload["series"], [
            {"year": 2010, "month": 1, "value": 0.08},
            {"year": 2010, "month": 3, "value": 0.12},
        ])
        self.assertEqual(payload["sampling"]["missingMonths"], ["2010-02"])
        self.assertIn("MERRA-2", payload["scaleNote"])
        self.assertIn("do not validate", payload["scaleNote"])
        self.assertEqual(payload["sampling"]["gridCellCenter"], {"latitude": 6.5, "longitude": 125.0})


if __name__ == "__main__":
    unittest.main()
