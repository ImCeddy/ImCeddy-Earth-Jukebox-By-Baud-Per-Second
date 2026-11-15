from __future__ import annotations

from common import summarize, write_story_data
from fetch_haiyan_black_marble import fetch_story_data

LOCATION_ID = "metro-cebu-energy"
LATITUDE = 10.3157
LONGITUDE = 123.8854
LOCATION_NAME = "central Cebu City"
START_YEAR = 2012
START_MONTH = 1
END_YEAR = 2023
END_MONTH = 12


def main() -> None:
    payload = fetch_story_data(
        location_id=LOCATION_ID,
        latitude=LATITUDE,
        longitude=LONGITUDE,
        location_name=LOCATION_NAME,
        start_year=START_YEAR,
        start_month=START_MONTH,
        end_year=END_YEAR,
        end_month=END_MONTH,
    )
    payload["scaleNote"] = (
        "Each monthly value is the median radiance of quality-flag-0 land pixels in an "
        "11×11 grid-cell neighborhood around central Cebu City. Nighttime radiance is "
        "an indirect indicator of human activity and lighting, not a direct measure of "
        "electricity production, consumption, access, affordability, or household "
        "experience. Monthly composites can hide short events; months without valid "
        "pixels are omitted, not zero."
    )
    payload["continuity"] = {
        "method": "Linear interpolation between adjacent valid monthly observations for interior gaps of at most two months; source observations remain unchanged.",
        "maximumInterpolatedGapMonths": 2,
    }
    payload["references"] = [
        {
            "mission": "NASA Earth Information Center",
            "product": "Change in Night Lights between 2012 and 2023",
            "url": "https://earth.gov/themes/energy",
        },
        {
            "mission": "NASA Scientific Visualization Studio",
            "product": "Black Marble Night Lights, 2012–2023",
            "url": "https://svs.gsfc.nasa.gov/5276/",
        },
    ]
    output_path = write_story_data(LOCATION_ID, payload)
    summarize(LOCATION_ID, payload["series"])
    print(f"  nearest NASA grid cell: {payload['gridCell']['nearestCellCenter']}")
    print(f"  wrote {output_path}")


if __name__ == "__main__":
    main()
