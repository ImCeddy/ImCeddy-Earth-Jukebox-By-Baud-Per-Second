from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "src" / "data" / "story-data"
load_dotenv(ROOT / ".env")


def earthdata_token() -> str:
    token = os.getenv("EARTHDATA_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "EARTHDATA_TOKEN is missing. Put the NASA Earthdata bearer token in the repository .env file."
        )
    return token


def appeears_token() -> str:
    token = os.getenv("APPEEARS_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "APPEEARS_TOKEN is missing. Put the AppEEARS /login token in the repository .env file."
        )
    return token


def session(token: str | None = None) -> requests.Session:
    client = requests.Session()
    client.headers.update({"User-Agent": "earth-jukebox-data-pipeline/1.0"})
    retry = Retry(
        total=5,
        connect=5,
        read=5,
        backoff_factor=1,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
    )
    adapter = HTTPAdapter(max_retries=retry)
    client.mount("https://", adapter)
    if token:
        client.headers["Authorization"] = "Bearer " + token
    return client


def get_json(client: requests.Session, url: str, **kwargs: Any) -> Any:
    response = client.get(url, timeout=120, **kwargs)
    response.raise_for_status()
    return response.json()


def write_story_data(location_id: str, payload: dict[str, Any]) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"{location_id}.json"
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return output_path


def summarize(location_id: str, series: list[dict[str, Any]], value_key: str = "value") -> None:
    dates = [f"{point['year']}-{point['month']:02d}" if "month" in point else str(point["year"]) for point in series]
    values = [point[value_key] for point in series if point.get(value_key) is not None]
    gaps = len(series) - len(values)
    print(
        f"{location_id}: {len(series)} points, "
        f"{dates[0] if dates else 'none'} to {dates[-1] if dates else 'none'}, "
        f"{gaps} missing values"
    )
    if values:
        print(f"  value range: {min(values):.6g} to {max(values):.6g}")


def submit_appeears_point_task(
    product: str,
    layer: str,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    task_name: str,
) -> str:
    client = session(appeears_token())
    payload = {
        "task_type": "point",
        "task_name": task_name,
        "params": {
            "dates": [{"startDate": start_date, "endDate": end_date}],
            "layers": [{"product": product, "layer": layer}],
            "coordinates": [{"latitude": latitude, "longitude": longitude, "id": task_name, "category": "seed-location"}],
        },
    }
    response = client.post("https://appeears.earthdatacloud.nasa.gov/api/task", json=payload, timeout=120)
    response.raise_for_status()
    return response.json()["task_id"]


def download_appeears_csv(task_id: str) -> str:
    client = session(appeears_token())
    deadline = time.monotonic() + 60 * 30
    while time.monotonic() < deadline:
        response = client.get(f"https://appeears.earthdatacloud.nasa.gov/api/status/{task_id}", timeout=120)
        response.raise_for_status()
        status_payload = response.json()
        status = status_payload[0].get("status") if isinstance(status_payload, list) else status_payload.get("status")
        if status == "done":
            break
        if status == "error":
            raise RuntimeError(f"AppEEARS task {task_id} failed: {status_payload}")
        time.sleep(10)
    else:
        raise TimeoutError(f"AppEEARS task {task_id} did not finish within 30 minutes")

    bundle = client.get(f"https://appeears.earthdatacloud.nasa.gov/api/bundle/{task_id}", timeout=120)
    bundle.raise_for_status()
    result_file = next((item for item in bundle.json()["files"] if item.get("file_type") == "csv"), None)
    if result_file is None:
        raise RuntimeError(f"AppEEARS task {task_id} produced no CSV result file")
    download = client.get(
        f"https://appeears.earthdatacloud.nasa.gov/api/bundle/{task_id}/{result_file['file_id']}",
        timeout=300,
    )
    download.raise_for_status()
    return download.text
