from __future__ import annotations

import unittest

import numpy as np

from maiac_qa import aod_quality_masks


class MaiacQualityTests(unittest.TestCase):
    def test_keeps_best_normal_and_single_cloud_neighbor_retrievals(self) -> None:
        aod = np.array([[100, 200, 300, 400, 500, 600, 700, 5000, -1001]], dtype=np.int16)
        clear_land_best = 1
        adjacency_single_cloud = 1 | (3 << 5)
        qa = np.array([[
            clear_land_best,
            adjacency_single_cloud,
            1 | (1 << 5),
            1 | (2 << 5),
            2,
            1 | (1 << 3),
            1 | (1 << 8),
            clear_land_best,
            clear_land_best,
        ]], dtype=np.uint16)

        good, marginal = aod_quality_masks(aod, qa)

        np.testing.assert_array_equal(
            good,
            np.array([[True, False, False, False, False, False, False, False, False]]),
        )
        np.testing.assert_array_equal(
            marginal,
            np.array([[False, True, False, False, False, False, False, False, False]]),
        )

    def test_rejects_mismatched_aod_and_qa_arrays(self) -> None:
        with self.assertRaises(ValueError):
            aod_quality_masks(np.ones((1, 2)), np.ones((2, 1)))


if __name__ == "__main__":
    unittest.main()
