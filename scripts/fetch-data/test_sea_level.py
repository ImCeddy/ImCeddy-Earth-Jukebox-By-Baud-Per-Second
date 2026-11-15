from __future__ import annotations

import unittest

from fetch_sea_level import select_granules


class SelectGranulesTests(unittest.TestCase):
    def test_keeps_and_sorts_every_granule_in_each_month(self) -> None:
        entries = [
            {"time_start": "2024-02-15T00:00:00Z", "id": "feb-2"},
            {"time_start": "2024-01-08T00:00:00Z", "id": "jan-2"},
            {"time_start": "2024-01-01T00:00:00Z", "id": "jan-1"},
        ]

        self.assertEqual(
            [entry["id"] for entry in select_granules(entries)],
            ["jan-1", "jan-2", "feb-2"],
        )


if __name__ == "__main__":
    unittest.main()
