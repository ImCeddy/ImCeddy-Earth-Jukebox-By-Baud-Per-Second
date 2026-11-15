from __future__ import annotations

from fetch_reservoir_water_resources import RESERVOIRS, fetch_reservoir


def main() -> None:
    fetch_reservoir(RESERVOIRS["angat-dam"])


if __name__ == "__main__":
    main()
