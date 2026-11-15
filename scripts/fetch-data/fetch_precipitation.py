from __future__ import annotations

from calendar import monthrange
from datetime import date

from aggregation import aggregate_monthly
from common import get_json, session, summarize, write_story_data

LOCATION_ID = "tacloban-leyte"
LATITUDE = 11.2431609
LONGITUDE = 125.0082936
START_YEAR = 2000
POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"


def main() -> None:
    today = date.today()
    end_year = today.year
    params = {
        "parameters": "PRECTOTCORR",
        "community": "AG",
        "longitude": LONGITUDE,
        "latitude": LATITUDE,
        "start": START_YEAR,
        "end": end_year,
        "format": "JSON",
    }
    response = get_json(session(), POWER_URL, params=params)
    parameters = response["properties"]["parameter"]
    precipitation = parameters["PRECTOTCORR"]

    precipitation_months = []
    for month_key, raw_value in precipitation.items():
        key = str(month_key)
        year = int(key[:4])
        month = int(key[-2:])
        if not 1 <= month <= 12 or (year, month) >= (today.year, today.month):
            continue
        if raw_value is None or float(raw_value) < 0:
            continue
        monthly_total = float(raw_value) * monthrange(year, month)[1]
        precipitation_months.append((f"{year:04d}-{month:02d}", monthly_total))

    precipitation_series = aggregate_monthly(precipitation_months, precision=2)
    precipitation_payload = {
        "locationId": LOCATION_ID,
        "datasetId": "tacloban-precipitation",
        "metric": "monthly_precipitation_total",
        "unit": "mm/month",
        "source": {
            "mission": "NASA POWER / NASA GMAO MERRA-2",
            "product": "Monthly Point API PRECTOTCORR MERRA-2 precipitation rate converted to monthly total",
            "url": POWER_URL,
        },
        "scaleNote": (
            "This is a NASA GMAO MERRA-2 reanalysis estimate distributed by NASA POWER, "
            "not a direct satellite-only retrieval or a local rain-gauge observation. "
            "The 0.5° x 0.625° grid is regional context; monthly totals cannot resolve "
            "short-duration storm rainfall or neighborhood impacts."
        ),
        "series": precipitation_series,
    }
    precipitation_output = write_story_data(LOCATION_ID, precipitation_payload)
    summarize(LOCATION_ID, precipitation_series)
    print(f"  wrote {precipitation_output}")


if __name__ == "__main__":
    main()
