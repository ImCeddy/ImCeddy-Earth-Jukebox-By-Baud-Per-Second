from __future__ import annotations

import unittest

from aggregation import aggregate_annual, aggregate_monthly


class AggregateAnnualTests(unittest.TestCase):
    def test_mean_aggregates_monthly_values_by_year(self) -> None:
        result = aggregate_annual(
            [(2023, 0.2), (2024, 0.4), (2023, 0.6), (2024, 0.8)],
            "mean",
        )

        self.assertEqual(result, [{"year": 2023, "value": 0.4}, {"year": 2024, "value": 0.6}])

    def test_sum_and_max_keep_their_annual_semantics(self) -> None:
        monthly_values = [(2024, 2.5), (2024, 3.0), (2025, 1.25)]

        self.assertEqual(
            aggregate_annual(monthly_values, "sum"),
            [{"year": 2024, "value": 5.5}, {"year": 2025, "value": 1.25}],
        )
        self.assertEqual(
            aggregate_annual(monthly_values, "max"),
            [{"year": 2024, "value": 3.0}, {"year": 2025, "value": 1.25}],
        )

    def test_monthly_records_keep_calendar_months_and_average_duplicates(self) -> None:
        result = aggregate_monthly([
            ("2024-02", 0.2),
            ("2024-01", 0.4),
            ("2024-02", 0.6),
        ])

        self.assertEqual(result, [
            {"year": 2024, "month": 1, "value": 0.4},
            {"year": 2024, "month": 2, "value": 0.4},
        ])


if __name__ == "__main__":
    unittest.main()