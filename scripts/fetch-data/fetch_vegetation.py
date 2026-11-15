from __future__ import annotations

import argparse
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from datetime import date, datetime, timedelta

from aggregation import aggregate_monthly
from common import session, summarize, write_story_data

PRODUCT = "MOD13Q1.061"
PRODUCT_SHORT_NAME = "MOD13Q1"
AQUA_PRODUCT_SHORT_NAME = "MYD13Q1"
LAYER = "_250m_16_days_NDVI"
LOCATIONS = {
    "nueva-ecija-rice-belt": {
        "title": "PhilRice Central Experiment Station, Nueva Ecija",
        "latitude": 15.67122,
        "longitude": 120.89077,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point extraction near PhilRice, averaged from good- or "
            "marginal-reliability 16-day "
            "observations by month. NDVI measures vegetation greenness, not rice yield, crop damage, "
            "soil moisture, or the condition of every farm. Seasonal crop cycles and other vegetation "
            "can affect the signal; event reports from the wider province are context, not proof of cause "
            "at this point."
        ),
    },
    "benguet-vegetable-belt": {
        "title": "Benguet Strawberry Farm, La Trinidad",
        "latitude": 16.4586141,
        "longitude": 120.5884970,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point sample at the mapped Strawberry Farm in La Trinidad, "
            "Benguet, averaged from good- or marginal-reliability 16-day observations by month. The playback "
            "panel shows each month's good/marginal composite counts; thinly sampled months warrant caution. "
            "NDVI measures vegetation greenness, not strawberry yield, crop loss, or the condition of every "
            "vegetable farm. A paired Aqua MODIS series is an independent sensor cross-check, not a calibrated "
            "correction or proof of orbital-drift bias. Regional event reports provide context, not proof that "
            "an event caused its reading."
        ),
    },
    "negros-sugarcane-belt": {
        "title": "Cadiz City croplands, Negros Occidental",
        "latitude": 10.94,
        "longitude": 123.28,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point sample in cropland near Cadiz City, Negros Occidental, "
            "averaged from good- or marginal-reliability 16-day observations by month. ESA WorldCover "
            "2021 classifies about 92% of the surrounding 250 m sample as cropland; that land-cover class "
            "does not identify the crop as sugarcane. The wider Cadiz-Negros area is part of the country's "
            "major sugar-producing region. NDVI measures vegetation greenness, not cane yield, sugar output, "
            "or damage, and reports about the wider industry are context, not proof of cause at this pixel."
        ),
    },
    "bohol-ube-landscape": {
        "title": "Bohol central landscape sample, Central Visayas",
        "latitude": 9.85,
        "longitude": 124.15,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point sample in central Bohol, averaged from good- or "
            "marginal-reliability 16-day observations by month. It is a regional landscape sample, not a "
            "verified ube field or crop-yield measurement. Bohol reporting documents yam cultivation and "
            "the Ubi Kinampay tradition at province scale; the sampled pixel's crop is not identified. NDVI "
            "measures vegetation greenness, not yam yield, harvested tubers, or damage. National production "
            "statistics are a separate measure and cannot be inferred from this point sample."
        ),
        "references": [
            {
                "mission": "Inquirer.net",
                "product": "Amid drought, Bohol farmers growing yam, not rice",
                "url": "https://news.google.com/rss/articles/CBMijAFBVV95cUxOSUg5MzI5YlB5OEFGT2N2azBkWFNMYno3Skt2ejRCTUNHRExlWnh2WmdCTXBnM1RndW9CMi1NT2VzbFIwZTRXMFo1VlplTmFTQWw2ZWFwcVQ0TE5kc01keTZ5NmF0LVlGbGhjZDgzMFAwdGJXZHNudnpHM0FyVVppR0F0ZklfY2VmS3FSddIBkgFBVV95cUxOMEZSNTAydjNiTWM2LXFwdXRjUjVLZzlmSmRlUFBUbWx5N01qcnRidkNuZm95dnBFNUJ1OGQyaDdXNnpiSldNRVFtRWwwMmtxdDA0Qnl6QnNGbGVxd2lFWHFqNjZWN3pyTWE0cWtOU1IxSTZraFNXOFVTTk83WGRxck1XVnRYd29wc1JZOXY5QTIzQQ?oc=5",
            },
            {
                "mission": "Inquirer.net",
                "product": "Bohol wants to preserve its link to 'ubi kinampay'",
                "url": "https://news.google.com/rss/articles/CBMijwFBVV95cUxQc0pjN19uLU5VMENzVXhHS3E5azJ4cXRNS2xuNldIWnZ3UFN5TmJQbW5WOHlFUEw0NGFNbmlmendISkJsSjh6Vlppc0tPTG9vb0xSNnVUVnNqYnVFczNJOWRmMF9FcUIzWU8wMWtKSUJSQ2VhU0xXZ2NyaG1ObTFRUGdZcjlhYlZFdmxoUlZCNNIBlAFBVV95cUxOS1pKTnpPdnhCQktaSXNzYjc2MEhkdHFMSnpSeHJISUtLZWJSY2Y2SDZPTmdzR1h6TjdSM1pFWUNueHVQT09yMzVUNVlObHZJMkE0WGhLMkdNMGE5cndSUVNtX0pJZ3VyVjlRMklaaWJjWHY5blh6LXNtd1QxVU1QR3QxYllWbTJBOW5UR0RNMTktU3Bn?oc=5",
            },
            {
                "mission": "BusinessWorld Online",
                "product": "Ube crop expansion kicks off with distribution of planting materials to Bohol, Leyte farmers",
                "url": "https://news.google.com/rss/articles/CBMi2wFBVV95cUxNVlFEbUdQOTN5WkY2bVhodUViNnhVQjVENGhhc1hweVA0QnJwNzF1NnNWOXB6OXJvNEVnSUVyX25iQmt2U3M1cmJzQV9MUncyRzZDZHIyOU9pQV95TDl0OUItOFVLTTRBQTJiUTlDV2VRdHpCRlg5OF90Q2FSNVh3TnhuMDdYOUh1Q2dTbDFsLUFxNEN6T1VKRGlnTTRQUDhHRThZaFZkVXJRMDFXd09IWi1LZ2FyNWRfbEZ1bW8tTm1MYktCUWVRNWRXWUZfamMxT3ZJS21VR2FLRnM?oc=5",
            },
            {
                "mission": "The Manila Times via Newswav",
                "product": "Agog over ube (2025 production and harvested-area statistics, citing PSA)",
                "url": "https://newswav.com/article/agog-over-ube-A2606_oURFI4",
            },
        ],
    },
    "banaue-rice-terraces": {
        "title": "Banaue area landscape sample, Ifugao",
        "latitude": 16.913,
        "longitude": 121.06,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point sample in the Banaue area of Ifugao, averaged from "
            "good- or marginal-reliability 16-day observations by month. It is a mixed mountain "
            "landscape sample, not a mapped rice paddy, terrace-condition survey, or harvest/yield "
            "measurement. UNESCO identifies five inscribed terrace clusters across four municipalities; "
            "the sample point is not a boundary or inventory of those clusters. NDVI measures vegetation "
            "greenness and cannot explain changes by itself. UNESCO conservation milestones provide "
            "cultural context, not proof of cause for a satellite reading. Months without accepted retrievals "
            "remain gaps; only interior gaps of up to two months are estimated for chart and audio."
        ),
        "references": [
            {
                "mission": "UNESCO World Heritage Centre",
                "product": "Rice Terraces of the Philippine Cordilleras — World Heritage listing and conservation status",
                "url": "https://whc.unesco.org/en/list/722/",
            },
        ],
    },
    "mount-hamiguitan": {
        "title": "Mount Hamiguitan Range Wildlife Sanctuary reference point",
        "latitude": 6.6084588,
        "longitude": 126.1665302,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point sample at the mapped reference "
            "center of the Mount Hamiguitan Range Wildlife Sanctuary. NDVI describes "
            "vegetation greenness, not forest cover, habitat quality, biodiversity, or "
            "species abundance. The sanctuary spans steep elevation zones and the "
            "sample is one pixel, not a protected-area-wide assessment; cloud and "
            "quality screening can leave gaps. UNESCO's species inventory and "
            "conservation status are independent ecological context, not outcomes "
            "measured by this satellite record."
        ),
        "references": [
            {
                "mission": "UNESCO World Heritage Centre",
                "product": "Mount Hamiguitan Range Wildlife Sanctuary — World Heritage listing and biodiversity context",
                "url": "https://whc.unesco.org/en/list/1403/",
            },
            {
                "mission": "OpenStreetMap contributors",
                "product": "Mount Hamiguitan Range Wildlife Sanctuary mapped boundary (way 1120154773)",
                "url": "https://www.openstreetmap.org/way/1120154773",
            },
        ],
    },
    "mount-apo-wildfire": {
        "title": "Mount Apo approximate summit-area reference point",
        "latitude": 6.988,
        "longitude": 125.270,
        "scale_note": (
            "This is a 250 m Terra MODIS NDVI point sample at an approximate Mount Apo summit-area "
            "reference coordinate, not a mapped burn perimeter or a confirmed burned pixel. NDVI "
            "measures vegetation greenness; it does not detect active fire, quantify burned area, or "
            "establish fire damage or ecological recovery. The reported March 2016 fire affected a "
            "broader area, and the sources do not establish whether this point was inside it. Steep "
            "terrain, cloud cover, mixed land cover, and thin monthly composite support can further "
            "limit interpretation. Only good- or marginal-reliability 16-day observations contribute "
            "to monthly means; marginal observations are less certain, and months without accepted "
            "observations remain gaps."
        ),
    },
}


def fetch_ornl_modis(
    latitude: float,
    longitude: float,
    product: str = PRODUCT_SHORT_NAME,
    start_date: date = date(2000, 2, 1),
    end_date: date | None = None,
) -> tuple[list[tuple[str, float]], dict[str, dict[str, int]]]:
    endpoint = f"https://modis.ornl.gov/rst/api/v1/{product}/subset"
    last_date = end_date or (date.today().replace(day=1) - timedelta(days=1))
    if start_date > last_date:
        raise ValueError(f"Vegetation fetch start {start_date} is after end {last_date}.")
    date_windows = []
    chunk_start = start_date
    while chunk_start <= last_date:
        chunk_end = min(chunk_start + timedelta(days=143), last_date)
        date_windows.append((chunk_start, chunk_end))
        chunk_start = chunk_end + timedelta(days=1)

    def fetch_window(window: tuple[date, date]) -> list[tuple[str, float, int]]:
        start, end = window
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "startDate": start.strftime("A%Y%j"),
            "endDate": end.strftime("A%Y%j"),
            "kmAboveBelow": 0,
            "kmLeftRight": 0,
        }
        response = session().get(endpoint, params=params, timeout=120)
        response.raise_for_status()
        observations: dict[str, dict[str, dict]] = defaultdict(dict)
        for item in response.json().get("subset", []):
            observations[item["modis_date"]][item["band"]] = item
        values = []
        for observation in observations.values():
            ndvi_item = observation.get("250m_16_days_NDVI")
            reliability_item = observation.get("250m_16_days_pixel_reliability")
            if ndvi_item is None or reliability_item is None:
                continue
            raw_ndvi = ndvi_item["data"][0]
            reliability = reliability_item["data"][0]
            if not isinstance(raw_ndvi, (int, float)) or not isinstance(reliability, (int, float)):
                continue
            observed_date = datetime.strptime(ndvi_item["calendar_date"], "%Y-%m-%d").date()
            values.append((observed_date.strftime("%Y-%m"), raw_ndvi, reliability))
        return values

    observations: list[tuple[str, float, int]] = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(fetch_window, window) for window in date_windows]
        for completed, future in enumerate(as_completed(futures), start=1):
            observations.extend(future.result())
            print(f"  Retrieved MODIS windows: {completed}/{len(futures)}", flush=True)

    return aggregate_quality_observations(observations)


def aggregate_quality_observations(
    observations: list[tuple[str, float, int]],
) -> tuple[list[tuple[str, float]], dict[str, dict[str, int]]]:
    monthly_values: dict[str, list[float]] = defaultdict(list)
    monthly_quality: dict[str, dict[str, int]] = defaultdict(lambda: {"goodSamples": 0, "marginalSamples": 0})
    for month, raw_ndvi, reliability in observations:
        if not math.isfinite(raw_ndvi) or reliability not in (0, 1) or not -2000 <= raw_ndvi <= 10000:
            continue
        monthly_values[month].append(raw_ndvi * 0.0001)
        quality_key = "goodSamples" if reliability == 0 else "marginalSamples"
        monthly_quality[month][quality_key] += 1

    monthly_means = [
        (month, sum(values) / len(values))
        for month, values in sorted(monthly_values.items())
        if values
    ]
    return monthly_means, dict(monthly_quality)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch a long-term MODIS vegetation index series.")
    parser.add_argument("--location", choices=LOCATIONS, default="nueva-ecija-rice-belt")
    args = parser.parse_args()
    location_id = args.location
    location = LOCATIONS[location_id]
    monthly_means, monthly_quality = fetch_ornl_modis(location["latitude"], location["longitude"])
    series = aggregate_monthly(monthly_means)
    if not series:
        raise RuntimeError(f"The configured service returned no valid NDVI values at {location['title']}")
    for point in series:
        month = f"{point['year']:04d}-{point['month']:02d}"
        point["qualityCounts"] = monthly_quality[month]
    observed_months = {
        f"{point['year']:04d}-{point['month']:02d}"
        for point in series
    }
    missing_months = []
    current_month = date(series[0]["year"], series[0]["month"], 1)
    last_month = date(series[-1]["year"], series[-1]["month"], 1)
    while current_month <= last_month:
        month = current_month.strftime("%Y-%m")
        if month not in observed_months:
            missing_months.append(month)
        current_month = (
            date(current_month.year + 1, 1, 1)
            if current_month.month == 12
            else date(current_month.year, current_month.month + 1, 1)
        )

    payload = {
        "locationId": location_id,
        "metric": "monthly_mean_ndvi",
        "unit": "NDVI, unitless",
        "source": {
            "mission": "Terra MODIS",
            "product": f"{PRODUCT} {LAYER}, NASA ORNL MODIS Web Service point subset at {location['title']}, monthly mean of good- and marginal-reliability 16-day observations",
            "url": "https://modis.ornl.gov/rst/",
        },
        "references": (
            [{
                "mission": "NASA Terra MODIS",
                "product": "MOD13Q1 Version 6.1 product documentation",
                "url": "https://doi.org/10.5067/MODIS/MOD13Q1.061",
            }] + ([{
                "mission": "ESA WorldCover",
                "product": "WorldCover 2021 v200 10 m land-cover classification",
                "url": "https://esa-worldcover.org/en/data-access",
            }] if location_id == "negros-sugarcane-belt" else [])
            + location.get("references", [])
        ),
        "scaleNote": location["scale_note"],
        "qualityPolicy": {
            "acceptedPixelReliability": [0, 1],
            "marginalObservationsRetained": True,
            "countLabel": "GOOD / MARGINAL 16-DAY COMPOSITES",
            "monthlyCounts": "Each monthly record stores its accepted good and marginal sample counts.",
        },
        "continuity": {
            "maximumInterpolatedGapMonths": 2,
            "method": "Linear interpolation of interior gaps up to two months for sonification only; source observations remain unchanged. The chart uses dotted links across all missing intervals.",
        },
        "sampling": {
            "missingMonths": missing_months,
        },
        "series": series,
    }

    if location_id == "benguet-vegetable-belt":
        aqua_start = date(2002, 7, 4)
        aqua_monthly, aqua_quality = fetch_ornl_modis(
            location["latitude"],
            location["longitude"],
            product=AQUA_PRODUCT_SHORT_NAME,
            start_date=aqua_start,
        )
        aqua_series = aggregate_monthly(aqua_monthly)
        terra_by_month = {
            f"{point['year']:04d}-{point['month']:02d}": point
            for point in series
        }
        aqua_by_month = {
            f"{point['year']:04d}-{point['month']:02d}": point
            for point in aqua_series
        }
        paired = [
            {
                "year": point["year"],
                "month": point["month"],
                "terraValue": point["value"],
                "aquaValue": aqua_by_month[month]["value"],
            }
            for month, point in terra_by_month.items()
            if month in aqua_by_month
        ]
        periods = []
        for label, start_year, end_year in (
            ("2002-07 to 2019-12", 2002, 2019),
            ("2020-01 onward", 2020, 9999),
        ):
            period_pairs = [
                point for point in paired
                if (point["year"], point["month"]) >= (start_year, 7 if start_year == 2002 else 1)
                and point["year"] <= end_year
            ]
            if not period_pairs:
                continue
            terra_mean = sum(point["terraValue"] for point in period_pairs) / len(period_pairs)
            aqua_mean = sum(point["aquaValue"] for point in period_pairs) / len(period_pairs)
            periods.append({
                "period": label,
                "pairedMonths": len(period_pairs),
                "terraMean": round(terra_mean, 6),
                "aquaMean": round(aqua_mean, 6),
                "aquaMinusTerra": round(aqua_mean - terra_mean, 6),
            })
        payload["sampling"]["terraAquaCrossCheck"] = {
            "mission": "Terra MODIS MOD13Q1.061 and Aqua MODIS MYD13Q1.061",
            "method": (
                "Independent 250 m point subsets at the same coordinate, each using monthly means of "
                "good- and marginal-reliability 16-day observations (reliability 0 or 1)."
            ),
            "caveat": (
                "Terra and Aqua are separate sensors with different overpass times and compositing inputs; "
                "differences are not a calibrated correction or proof of orbital-drift bias."
            ),
            "aquaProduct": "MYD13Q1.061 _250m_16_days_NDVI",
            "aquaStartDate": aqua_start.isoformat(),
            "aquaSeries": [
                {
                    **point,
                    "qualityCounts": aqua_quality[f"{point['year']:04d}-{point['month']:02d}"],
                }
                for point in aqua_series
            ],
            "pairedPeriodMeans": periods,
            "pairedMonthsSince2020": [
                point for point in paired if point["year"] >= 2020
            ],
        }
        payload["references"].append({
            "mission": "NASA Aqua MODIS",
            "product": "MYD13Q1 Version 6.1 product documentation",
            "url": "https://doi.org/10.5067/MODIS/MYD13Q1.061",
        })

    output = write_story_data(location_id, payload)
    summarize(location_id, series)
    print(f"  wrote {output}")


if __name__ == "__main__":
    main()
