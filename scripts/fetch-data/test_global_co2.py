from __future__ import annotations

import unittest

from fetch_global_co2 import parse_global_co2_csv


class ParseGlobalCo2CsvTests(unittest.TestCase):
    def test_preserves_uncertainty_and_reports_missing_months(self) -> None:
        csv_text = """# NOAA header
year,month,decimal,average,average_unc,trend,trend_unc
2020,1,2020.042,412.44,0.08,411.35,0.06
2020,2,2020.125,-9.99,-9.99,411.70,0.06
2020,3,2020.208,413.44,0.09,412.04,0.06
"""

        series, missing_months = parse_global_co2_csv(csv_text)

        self.assertEqual(series, [
            {"year": 2020, "month": 1, "value": 412.44, "uncertainty": 0.08},
            {"year": 2020, "month": 3, "value": 413.44, "uncertainty": 0.09},
        ])
        self.assertEqual(missing_months, ["2020-02"])

    def test_rejects_duplicate_months(self) -> None:
        csv_text = """year,month,average,average_unc
2020,1,412.44,0.08
2020,1,412.45,0.08
"""

        with self.assertRaisesRegex(ValueError, "duplicate month 2020-01"):
            parse_global_co2_csv(csv_text)


if __name__ == "__main__":
    unittest.main()
