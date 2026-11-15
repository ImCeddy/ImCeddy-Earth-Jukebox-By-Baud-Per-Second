from __future__ import annotations

import math
import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlsplit

import numpy as np
import requests

import fetch_reservoir_water_resources as reservoir_pipeline
from fetch_reservoir_water_resources import (
    EARLIEST_AVAILABLE_MONTH,
    RESERVOIRS,
    RESERVOIR_LOCATION_IDS,
    _candidate_rank,
    _classify_landsat,
    _aggregate_monthly_scenes,
    _latest_complete_month,
    _month_sequence,
    _network_error_summary,
    _raster_mask,
    _signed_asset_urls,
    _utm,
    _utm51,
)


class ReservoirWaterProcessingTests(unittest.TestCase):
    def test_sites_share_the_verified_landsat_record_start(self) -> None:
        self.assertEqual(EARLIEST_AVAILABLE_MONTH, (1987, 12))
        self.assertEqual(RESERVOIRS["angat-dam"].relation_id, 2_970_167)
        self.assertEqual(RESERVOIRS["pantabangan-dam"].relation_id, 2_460_576)
        macabebe = RESERVOIRS["macabebe-delta"]
        self.assertEqual(macabebe.relation_id, 16_253_334)
        self.assertEqual(macabebe.boundary_label, "municipal boundary")
        self.assertNotIn("macabebe-delta", RESERVOIR_LOCATION_IDS)

    def test_utm51_known_origin(self) -> None:
        easting, northing = _utm51(123.0, 0.0)
        self.assertAlmostEqual(easting, 500_000, places=3)
        self.assertAlmostEqual(northing, 0, places=3)

    def test_raster_mask_uses_the_landsat_scene_utm_zone(self) -> None:
        ring = [
            (116.99, 14.39),
            (117.01, 14.39),
            (117.01, 14.41),
            (116.99, 14.41),
            (116.99, 14.39),
        ]
        projected = [_utm(lon, lat, 50) for lon, lat in ring]
        origin_x = math.floor(min(x for x, _ in projected) / 30) * 30 - 30
        origin_y = math.ceil(max(y for _, y in projected) / 30) * 30 + 30
        width = math.ceil((max(x for x, _ in projected) - origin_x) / 30) + 2
        height = math.ceil((origin_y - min(y for _, y in projected)) / 30) + 2
        page = SimpleNamespace(
            tags={
                33550: SimpleNamespace(value=(30.0, 30.0, 0.0)),
                33922: SimpleNamespace(value=(0, 0, 0, origin_x, origin_y, 0)),
                34735: SimpleNamespace(value=(1, 1, 0, 1, 3072, 0, 1, 32650)),
            },
            imagewidth=width,
            imagelength=height,
        )

        mask, _, grid = _raster_mask(page, {"outer": [ring], "inner": []})

        self.assertTrue(mask.any())
        self.assertEqual(grid[-1], 32650)

    def test_month_sequence_and_latest_complete_month(self) -> None:
        self.assertEqual(
            list(_month_sequence((1987, 12), (1988, 2))),
            [(1987, 12), (1988, 1), (1988, 2)],
        )
        self.assertEqual(_latest_complete_month(date(2027, 1, 4)), (2026, 12))
        self.assertEqual(_latest_complete_month(date(2026, 11, 9)), (2026, 10))

    def test_landsat_mndwi_masks_qa_and_saturation(self) -> None:
        green = np.array([[30_000, 20_000, 30_000, 30_000]], dtype=np.uint16)
        swir = np.array([[20_000, 30_000, 20_000, 20_000]], dtype=np.uint16)
        qa_pixel = np.array([[0, 0, 1 << 3, 0]], dtype=np.uint16)
        qa_radsat = np.array([[0, 0, 0, 1]], dtype=np.uint16)

        valid, water = _classify_landsat(green, swir, qa_pixel, qa_radsat)

        self.assertTrue(valid[0, 0])
        self.assertTrue(water[0, 0])
        self.assertTrue(valid[0, 1])
        self.assertFalse(water[0, 1])
        self.assertFalse(valid[0, 2])
        self.assertFalse(valid[0, 3])

    def test_candidate_rank_prefers_nearest_midmonth_scene(self) -> None:
        midpoint = datetime(2026, 8, 15, 12, tzinfo=timezone.utc)
        closest = {
            "id": "closest",
            "properties": {"datetime": "2026-08-14T12:00:00Z", "eo:cloud_cover": 80},
        }
        farther = {
            "id": "farther",
            "properties": {"datetime": "2026-08-01T12:00:00Z", "eo:cloud_cover": 10},
        }
        self.assertLess(_candidate_rank(closest, midpoint), _candidate_rank(farther, midpoint))

    def test_month_uses_median_of_all_accepted_scene_areas(self) -> None:
        measurements = [
            (
                {
                    "id": f"scene-{index}",
                    "properties": {
                        "datetime": f"2026-08-{index:02d}T12:00:00Z",
                        "platform": "landsat-9",
                        "eo:cloud_cover": 20,
                    },
                },
                coverage,
                area,
                pixels,
            )
            for index, coverage, area, pixels in (
                (3, 0.9, 10.0, 900),
                (15, 0.8, 11.0, 800),
                (27, 1.0, 35.0, 1000),
            )
        ]

        record, summary = _aggregate_monthly_scenes(measurements, 2026, 8)

        self.assertEqual(record["value"], 11.0)
        self.assertEqual(record["validSceneCount"], 3)
        self.assertEqual(record["medianValidCoverage"], 0.9)
        self.assertEqual(record["validPixelSamples"], 2700)
        self.assertEqual(summary["aggregation"], "median water area across accepted monthly scenes")
        self.assertEqual(len(summary["scenes"]), 3)
        self.assertEqual(summary["validSceneCount"], 3)

    def test_monthly_scene_aggregation_rejects_empty_observations(self) -> None:
        with self.assertRaisesRegex(ValueError, "[Aa]t least one accepted"):
            _aggregate_monthly_scenes([], 2026, 8)

    def test_zero_area_month_is_flagged_for_imagery_review(self) -> None:
        item = {
            "id": "zero-water",
            "properties": {"datetime": "2026-08-15T12:00:00Z"},
        }

        record, _ = _aggregate_monthly_scenes([(item, 0.99, 0.0, 1000)], 2026, 8)

        self.assertEqual(record["value"], 0)
        self.assertIn("Verify the imagery", record["reviewNote"])

    def test_container_sas_token_is_reused_only_within_the_same_container(self) -> None:
        asset_names = ("green", "swir16", "qa_pixel", "qa_radsat")
        assets = {
            key: {"href": f"https://landsateuwest.blob.core.windows.net/landsat-c2/scene/{key}.TIF"}
            for key in asset_names
        }
        signed_green = (
            "https://landsateuwest.blob.core.windows.net/landsat-c2/scene/green.TIF"
            "?sv=2024-01-01&sr=c&se=2099-01-01T00%3A00%3A00Z&sig=opaque"
        )
        with reservoir_pipeline._SAS_CACHE_LOCK:
            reservoir_pipeline._SAS_CACHE.clear()
        with requests.Session() as client:
            with patch.object(reservoir_pipeline, "_signed_asset", return_value=signed_green) as sign:
                signed_assets = _signed_asset_urls(client, assets, asset_names)

        self.assertEqual(sign.call_count, 1)
        for key in asset_names:
            self.assertEqual(urlsplit(signed_assets[key]).query, urlsplit(signed_green).query)
            self.assertTrue(urlsplit(signed_assets[key]).path.endswith(f"/{key}.TIF"))

        another_scene = {
            key: {"href": f"https://landsateuwest.blob.core.windows.net/landsat-c2/another-scene/{key}.TIF"}
            for key in asset_names
        }
        with requests.Session() as client:
            with patch.object(reservoir_pipeline, "_signed_asset", return_value=signed_green) as sign:
                cached_assets = _signed_asset_urls(client, another_scene, asset_names)
        self.assertEqual(sign.call_count, 0)
        self.assertTrue(all("sig=opaque" in href for href in cached_assets.values()))

        with reservoir_pipeline._SAS_CACHE_LOCK:
            reservoir_pipeline._SAS_CACHE.clear()
        assets["qa_radsat"]["href"] = (
            "https://another-account.blob.core.windows.net/landsat-c2/scene/qa_radsat.TIF"
        )
        with requests.Session() as client:
            with patch.object(
                reservoir_pipeline,
                "_signed_asset",
                side_effect=(
                    signed_green,
                    "https://another-account.blob.core.windows.net/landsat-c2/scene/qa_radsat.TIF?sr=b&sig=other",
                ),
            ) as sign:
                signed_assets = _signed_asset_urls(client, assets, asset_names)

        self.assertEqual(sign.call_count, 2)
        self.assertIn("sig=other", signed_assets["qa_radsat"])

    def test_network_error_summary_redacts_signed_url_queries(self) -> None:
        errors = (
            requests.ConnectionError(
                "request failed for https://storage.example/container/image.tif?sv=secret&sig=secret"
            ),
            requests.exceptions.SSLError(
                "request failed for https://storage.example/sign?href="
                "https%3A%2F%2Fstorage.example%2Fcontainer%2Fimage.tif%3Fsv%3Dsecret%26sig%3Dsecret"
            ),
            requests.ConnectionError("request failed with sig=secret"),
        )

        for error in errors:
            with self.subTest(error=type(error).__name__):
                summary = _network_error_summary(error)
                self.assertNotIn("secret", summary)
                self.assertNotIn("sig=secret", summary)
                self.assertTrue("[redacted]" in summary or "[query redacted]" in summary)


if __name__ == "__main__":
    unittest.main()
