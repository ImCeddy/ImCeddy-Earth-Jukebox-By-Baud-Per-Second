from __future__ import annotations

import unittest

from fetch_vegetation import aggregate_quality_observations


class AggregateQualityObservationsTests(unittest.TestCase):
    def test_good_and_marginal_samples_are_kept_and_counted(self) -> None:
        monthly_means, quality_counts = aggregate_quality_observations([
            ("2024-01", 5000, 0),
            ("2024-01", 7000, 1),
            ("2024-01", 9000, 2),
            ("2024-02", 6000, 1),
            ("2024-02", 12000, 0),
            ("2024-02", float("nan"), 1),
        ])

        self.assertEqual([month for month, _ in monthly_means], ["2024-01", "2024-02"])
        for _, mean in monthly_means:
            self.assertAlmostEqual(mean, 0.6)
        self.assertEqual(quality_counts, {
            "2024-01": {"goodSamples": 1, "marginalSamples": 1},
            "2024-02": {"goodSamples": 0, "marginalSamples": 1},
        })


if __name__ == "__main__":
    unittest.main()
