# NASA story-data pipeline

This is a one-time/offline data pull. The browser application does not call these APIs. Each script writes a static JSON file under `src/data/story-data/`.
Location selection, full-record coverage, missing-data continuity, and event interpretation follow the project [story research principles](../../STORY_RESEARCH_PRINCIPLES.md).

## Authentication decisions

| Location/source | Current access contract | Credential used |
|---|---|---|
| Manila Bay / NASA-SSH PO.DAAC | CMR collection metadata is public; protected PO.DAAC NetCDF granules and OPeNDAP data require Earthdata authorization | `EARTHDATA_TOKEN` |
| Tacloban / NASA POWER | The documented point API returns JSON directly and was verified with a real request without credentials | No authentication |
| Cagayan de Oro / NASA GPM IMERG | CMR and GES DISC OPeNDAP monthly subsets require Earthdata authorization | `EARTHDATA_TOKEN` |
| Angat and Pantabangan reservoirs, Macabebe delta / Landsat Collection 2 Level-2 | Landsat metadata and cloud-optimized imagery are public through the Microsoft Planetary Computer STAC API; temporary asset signatures are requested per raster. Area boundaries come from OpenStreetMap | No authentication |
| Philippine MOD13Q1 NDVI locations / NASA ORNL MODIS Web Service | Public point-subset API for the Terra MODIS time series | No authentication |
| Payatas / LP DAAC MCD19A2 | CMR metadata is public; protected LP DAAC HDF granules require Earthdata authorization | `EARTHDATA_TOKEN` |
| Valenzuela / LP DAAC MCD19A2 | CMR metadata is public; protected LP DAAC HDF granules require Earthdata authorization | `EARTHDATA_TOKEN` |
| Koronadal / NASA GES DISC MERRA-2 | CMR metadata is public; OPeNDAP subsets require Earthdata authorization | `EARTHDATA_TOKEN` |
| Metro Manila / NASA GES DISC OMI OMNO2d | CMR metadata is public; daily OPeNDAP subsets require Earthdata authorization | `EARTHDATA_TOKEN` |
| Taal region / NASA OMPS and OMI | Dated image archives and PHIVOLCS event reporting are public; no numeric time series is extracted | No authentication |
| Tacloban / Surigao City / NASA Black Marble VNP46A3 | CMR metadata and product documentation are public; LAADS granules require Earthdata authorization | `EARTHDATA_TOKEN` |
| Metro Cebu / NASA Black Marble VNP46A3 | CMR metadata and product documentation are public; LAADS granules require Earthdata authorization | `EARTHDATA_TOKEN` |
| Iloilo City / NASA Black Marble VNP46A3 | CMR metadata and product documentation are public; LAADS granules require Earthdata authorization | `EARTHDATA_TOKEN` |
| Bogo City / NASA Black Marble VNP46A3 and GPM IMERG Daily Late Run | CMR metadata is public; LAADS and GES DISC granules require Earthdata authorization | `EARTHDATA_TOKEN` |

FIRMS is not used for this requested air-quality series. FIRMS active-fire services have a separate `MAP_KEY`; an Earthdata bearer token must not be substituted for that credential.
AppEEARS currently does not expose `MCD19A2.061` or another aerosol optical-depth product in its product catalog, so the Payatas script remains on the direct LP DAAC Earthdata path.

## Setup

Use Python 3.11 or 3.12. `pyhdf` may not have a compatible Windows wheel for newer Python versions.

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Put the NASA Earthdata bearer token in `.env`:

```text
EARTHDATA_TOKEN=your-token-here
APPEEARS_TOKEN=token-returned-by-appeears-login
APPEEARS_TOKEN_EXPIRATION=expiration-returned-by-appeears-login
```

The repository already ignores `.env*`; do not commit `.env` or a real token.

## Run

Run the public source independently:

```powershell
python scripts/fetch-data/fetch_precipitation.py
```

Fetch a NASA-SSH monthly series for a location:

```powershell
python scripts/fetch-data/fetch_sea_level.py manila-bay
python scripts/fetch-data/fetch_sea_level.py leyte-gulf-tacloban --latitude 11.2431609 --longitude 125.0082936
python scripts/fetch-data/fetch_sea_level.py davao-mindanao --latitude 7.0731 --longitude 125.6128
python scripts/fetch-data/fetch_sea_level.py tubigon-bohol --latitude 9.9515287 --longitude 123.9618897
python scripts/fetch-data/fetch_sea_level.py aringay-alaska --latitude 16.3684742 --longitude 120.3323896
```

NASA-SSH NetCDF granules are reused from the ignored `.cache/nasa-ssh/` directory. Missing files are downloaded with at most six concurrent requests. The fetcher processes every available granule (typically four or five per calendar month), extracts the selected cell's valid SSHA value, and computes an arithmetic monthly mean. `sampling.validGranulesByMonth` records how many valid granules contributed to each month. Raw granules remain in the local cache and are not bundled in the website or mobile app.

The Tacloban and Davao runs select the nearest valid ocean grid cell, report its center and distance from the requested coordinates, and stop without writing the series if it exceeds the configured distance limit. Current cells are 10.75°N, 125.25°E (about 60.85 km from Tacloban) and 6.75°N, 125.75°E (about 38.99 km from Davao). Manila Bay uses the nearest 0.5° grid center, 14.75°N, 120.75°E (about 26.01 km from the mapped bay center). Tubigon uses 9.75°N, 123.75°E (about 32.26 km from the mapped town center), and Aringay uses 16.25°N, 120.25°E (about 15.84 km from the mapped New Bern Elementary School reference point); both are regional open-water context, not measurements at the reported community locations.

Refresh the Payatas-area and Valenzuela MAIAC sample series using the shared sampling and quality rules:

```powershell
python scripts/fetch-data/fetch_air_quality.py
python scripts/fetch-data/fetch_valenzuela_air_quality.py
```

For each completed month, the scripts select up to three evenly spaced unique daily granules. Each daily sample is a median of best-quality (`AOD_QA`) pixels in a 5x5 neighborhood and must contain at least five good pixels; single-cloud-adjacency pixels are counted as marginal but excluded. The monthly AOD is the mean of accepted daily medians, not a full daily monthly mean. Records retain candidate and valid day counts, good/marginal pixel support, valid dates, missing months, seasonal calendar-month coverage, and the number of months that would remain observed at five- versus ten-pixel minimums. Only months with at least one passing day are emitted; other months remain gaps. Payatas uses an approximate area coordinate, not a verified landfill point. No AERONET overlay or facility-closure event is included until the series can be collocated with a verified public ground-photometer record and the event dates are confirmed by primary reporting.

Fetch or refresh Koronadal's NASA MERRA-2 monthly aerosol optical thickness series:

```powershell
python scripts/fetch-data/fetch_koronadal_merra2_aod.py
```

The fetcher requests `TOTEXTTAU` from M2TMNXAER.5.12.4 through NASA GES DISC OPeNDAP, from January 2010 through the latest month available in CMR. It samples only the nearest grid-cell center (6.5°N, 125.0°E, about 17 km from the OpenStreetMap city-reference coordinate), without spatial averaging or interpolation. `TOTEXTTAU` is total aerosol extinction AOT at 550 nm from the MERRA-2 reanalysis; this is not the MODIS MAIAC 470 nm series analyzed in the cited Koronadal study. The paper's seasonal findings and MODIS-AERONET validation are research context only and do not validate or directly compare with this MERRA-2 series. The coarse monthly column measure is not ground-level particulate matter or personal exposure.

Fetch or refresh the Metro Manila NASA Aura OMI tropospheric NO₂ series:

```powershell
python scripts/fetch-data/fetch_metro_manila_omi_no2.py
```

The fetcher retrieves `ColumnAmountNO2TropCloudScreened` from the daily OMNO2d.004 Level-3 product through NASA GES DISC OPeNDAP. It averages valid cells in a fixed 3×3 region of 0.25° grid cells around central Manila for each day, requires at least three valid cells, then averages accepted daily regional means by month. Values are stored in units of 10^15 molecules/cm²; monthly records retain candidate days, valid days, and valid OMI grid-cell samples. The series starts in October 2004 and ends at the latest completed month. NASA's Air Quality and Climate Anomaly Viewer compares March 2020 with March 2010–2019; this is context, not evidence that lockdown caused a change in Metro Manila. The column measurement is not ground-level concentration or exposure, and OMI's row anomaly and cloud screening cause uneven sampling.

Fetch the agriculture NDVI series:

```powershell
python scripts/fetch-data/fetch_vegetation.py
python scripts/fetch-data/fetch_vegetation.py --location benguet-vegetable-belt
python scripts/fetch-data/fetch_vegetation.py --location negros-sugarcane-belt
python scripts/fetch-data/fetch_vegetation.py --location bohol-ube-landscape
python scripts/fetch-data/fetch_vegetation.py --location banaue-rice-terraces
python scripts/fetch-data/fetch_vegetation.py --location mount-hamiguitan
python scripts/fetch-data/fetch_vegetation.py --location mount-apo-wildfire
```

All seven checked-in vegetation bundles now use the same NASA ORNL point-subset method and Terra MODIS MOD13Q1.061 product, including the configured PhilRice coordinates. Reliability `0` (good) and `1` (marginal) observations contribute equally to monthly means; rejected reliability classes and invalid/fill NDVI are excluded. Each monthly record preserves accepted good and marginal 16-day composite counts in `qualityCounts`, which the playback panel displays for the selected month. Months without accepted observations remain missing. This policy applies to the shared MODIS NDVI product, not to unrelated products or quality flags in other themes; it does not imply that marginal retrievals are as certain as good ones.
La Trinidad also includes a same-coordinate Aqua MYD13Q1.061 cross-check, using the same reliability filter and reporting paired monthly means before and after 2020. Terra/Aqua differences are a comparison between separate sensors, not a calibrated correction or proof of Terra orbital-drift bias. The 2020-onward paired means are visible in the story's source note.
The La Trinidad point is at the mapped Strawberry Farm; it is not a measurement of strawberry yield or all Benguet farms.
The Cadiz sample uses the same service and quality filter at 10.94°N, 123.28°E near Hacienda Bayabas, Daga. ESA WorldCover 2021's 10 m cropland class (40) covers about 92% of the surrounding 250 m sample; it does not identify the crop as sugarcane. Negros sugar-industry news is regional context and is not treated as a measurement or proven cause at this pixel. The current snapshot contains 285 source-observed monthly values (2000-03 through 2026-09); months with no good/marginal retrieval are omitted. Only interior gaps up to two months are interpolated in the app, and longer gaps remain empty.
The Bohol sample is a 250 m MODIS point at 9.85°N, 124.15°E in the central island landscape. It is not a verified ube field, and NDVI is not a measure of yam area, yield, harvested tubers, or production. A cited 2025 national report gives ube-area and output declines; those statistics are separate from this local greenness sample and do not identify what grows at the point. Bohol's yam-growing tradition and drought/production reporting are regional context only.
The Banaue location is titled “Banaue area landscape sample” to distinguish the point from UNESCO's inscribed Rice Terraces of the Philippine Cordilleras. It is a mixed 250 m Terra MODIS greenness sample, not a mapped rice paddy, terrace-condition survey, or harvest/yield measurement. UNESCO's five inscribed clusters and conservation milestones provide cultural context, not proof of cause for a satellite reading. Only interior gaps up to two months are interpolated in the app.
The Mount Hamiguitan sample uses the mapped sanctuary reference center at 6.6084588°N, 126.1665302°E. It is a single 250 m greenness sample, not a forest-cover or biodiversity assessment; UNESCO's documented species and endemicity counts are independent ecological context. Only good- or marginal-reliability MODIS observations contribute to monthly means, and months without accepted observations remain gaps (short gaps may be estimated in the chart/audio under the shared vegetation continuity rule).
The Mount Apo wildfire story uses a 250 m Terra MODIS NDVI sample at an approximate summit-area reference coordinate. The point is not a mapped burn location, and the reported 2016 fire sources do not establish whether it burned. NDVI is not active-fire or burned-area data and cannot quantify fire damage or establish recovery; the event's reported extent and suspected campfire cause are attributed to reporting and remain unverified by this series.

Fetch the globally averaged atmospheric CO2 series used for the Philippines greenhouse-gas context story:

```powershell
python scripts/fetch-data/fetch_global_co2.py
```

The fetcher uses NOAA Global Monitoring Laboratory's globally averaged marine-surface monthly mean CO2 CSV and retains each source-reported global-mean uncertainty in `uncertainty` (ppm). This is a global atmospheric concentration record, not Philippine emissions, a local point measurement, or a satellite retrieval. Seasonal variation remains in the monthly mean; the latest year's observations are preliminary and may be revised. NASA's DYAMOND page is cited as context for a separate GEOS model visualization of January–March 2020, not as the source of the NOAA series.

Fetch the Tubbataha monthly heat-stress record:

```powershell
python scripts/fetch-data/fetch_tubbataha_biodiversity.py
```

The script uses NOAA Coral Reef Watch's public NCEI OPeNDAP endpoint to sample the nearest valid-water 5-km grid cell to Tubbataha and applies the NetCDF 0.01 scale factor. The monthly product reports the maximum daily Degree Heating Week (DHW) value in each month, not a monthly mean. The current archived series runs from January 2010 through September 2024; missing months are retained as gaps and are not interpolated. DHW is a satellite-derived heat-stress indicator, not an observation of coral bleaching, coral cover, biodiversity, or species abundance; risk thresholds must not be described as observed ecological impacts. The sample is one nearby pixel, not a park-wide average. NOAA documents the product and thresholds at https://coralreefwatch.noaa.gov/product/5km/index_5km_dhw.php.

Fetch NASA GPM IMERG monthly precipitation for Cagayan de Oro:

```powershell
python scripts/fetch-data/fetch_gpm_cagayan_de_oro.py
```

The script samples the nearest 0.1° cell from the GPM IMERG V07 Final Run monthly product, converts its mean precipitation rate to a calendar-month total, and retains valid zero rainfall while omitting fill values. The current GES DISC archive runs from January 1998 through September 2025. IMERG is a merged microwave/infrared satellite estimate with monthly gauge adjustment, not a local rain-gauge observation; it cannot resolve short-duration bursts or flood impacts.

Fetch both long-term reservoir water-area series:

```powershell
python scripts/fetch-data/fetch_reservoir_water_resources.py
```

Fetch one reservoir or a shorter date range:

```powershell
python scripts/fetch-data/fetch_reservoir_water_resources.py --location pantabangan-dam
python scripts/fetch-data/fetch_reservoir_water_resources.py --location angat-dam --start 2000-01 --end 2026-10
python scripts/fetch-data/fetch_reservoir_water_resources.py --location macabebe-delta --start 2000-01 --end 2026-10
```

The established Angat command remains an alias:

```powershell
python scripts/fetch-data/fetch_angat_water_resources.py
```

The default command fetches the Angat and Pantabangan reservoirs; `--location all` includes every configured boundary, including Macabebe. The common NASA/USGS Landsat Collection 2 Level-2 surface-reflectance archive is sampled for all three sites. Landsat metadata at Angat and Pantabangan begins in December 1987 (the first local scenes were acquired December 14, 1987), so the application replaces Angat's short 2024–2026 Sentinel-1-only series with the longer Landsat record. The Landsat Collection's global temporal extent begins in 1982, but no earlier qualifying image of those footprints was found. All sites use the same green/SWIR1 modified normalized difference water index (MNDWI > 0) method and 30 m area conversion; the series does not splice in OPERA/Sentinel-1 measurements.

The STAC catalog is queried once per year, and returned scenes are bucketed into calendar months. For each complete month, scenes intersecting the current OSM boundary are ordered by distance from the 15th, with scene-wide cloud cover as a tie-breaker. The script quality-masks fill, dilated cloud, cirrus, cloud, cloud shadow, snow, and radiometric saturation; it evaluates every candidate and retains those with at least 80% valid boundary-pixel coverage. Monthly mapped area is the median across those accepted scenes, reducing dependence on a single acquisition. Each classified pixel contributes 900 m². For Angat and Pantabangan this is mapped reservoir surface area—not dam elevation, stored volume, water supply, or proof of cause. The Macabebe record is municipal surface-water extent; it can include fishponds, canals, flooded fields, and other water, and cannot identify parcel conversion or establish its cause. The current OSM boundary is applied retrospectively. Missing months remain gaps; only interior gaps of at most two months are interpolated for chart and audio continuity. Accepted Landsat scene IDs, sensor, acquisition times, cloud cover, and valid coverage are recorded for each month; monthly records retain the accepted-scene count and median valid coverage. Summed `validPixelSamples` counts pixel-scene samples, not unique ground pixels. Public cloud-optimized images are read by byte ranges and raw rasters are not saved.

The checked-in Angat and Pantabangan JSON files have not yet been regenerated with this multi-scene method; they still contain the former single-scene monthly estimates. Refresh both complete records before interpreting the new monthly values or scene counts. A zero-area month is retained but flagged for imagery review, not automatically presented as a verified empty reservoir. The current Angat 2004-04 zero is flagged because it came from a scene with 99.05% valid-pixel coverage; its imagery still needs manual verification. Do not fill long missing periods with interpolation. The chart bridges missing intervals with a dotted connector, and only gaps of at most two months may have a separate, visibly estimated value.

Reservoir months are processed with at most six concurrent workers. Planetary Computer's container-scoped SAS token is cached in memory until five minutes before expiry and reused only for assets in that Azure container; credentials are not written to disk or output data. A transient STAC or image-access failure is recorded in `sampling.networkErrors` and the affected month is listed in `sampling.missingMonths`, distinct from a month where no candidate scene meets the coverage threshold. `--start` and `--end` write only the requested interval to the output file, so rerun the full reservoir command to regenerate a complete dataset after transient failures.

Fetch the Tacloban Black Marble monthly series for the Haiyan story:

```powershell
python scripts/fetch-data/fetch_haiyan_black_marble.py
```

The script retrieves VNP46A3.002 monthly granules from January 2012 through October 2026 using byte-range reads. It takes the median of quality-flag-0 land pixels in a fixed 11x11 grid-cell neighborhood around central Tacloban and omits months with fewer than 10 valid pixels. Zero radiance remains a valid observation; low-support months are recorded separately from missing granules.

Fetch the Surigao City Black Marble series around Typhoon Odette:

```powershell
python scripts/fetch-data/fetch_odette_black_marble.py
```

The script retrieves VNP46A3.002 monthly granules from January 2012 through October 2026, samples a fixed 11x11 grid-cell neighborhood around Surigao City, and omits months with fewer than 35 valid pixels. It also checks the January 2022 zero against the daily VNP46A2.002 [`DNB_BRDF-Corrected_NTL` layer](https://doi.org/10.5067/VIIRS/VNP46A2.002), using only quality-flag-0 land cells in the same neighborhood and recording daily support. This full-record pull is intentionally separate from `run-all.py` because it transfers several gigabytes.

Fetch the Metro Cebu Black Marble energy-context series:

```powershell
python scripts/fetch-data/fetch_cebu_energy_black_marble.py
```

The Metro Cebu story samples monthly NASA Suomi-NPP VIIRS Black Marble `VNP46A3.002` nighttime radiance from January 2012 through December 2023, matching the time span of the NASA Earth Information Center's [Change in Night Lights visualization](https://earth.gov/themes/energy). Values are medians of quality-flag-0 land pixels in an 11×11 neighborhood around central Cebu City. Radiance is an indirect indicator of nighttime lighting and human activity, not electricity generation, consumption, access, or individual outage measurements. Missing observations are omitted; only interior gaps of at most two months are estimated for chart and audio continuity. The story is not a causal account of local energy-system change.

Fetch the Iloilo City Black Marble energy-context series:

```powershell
python scripts/fetch-data/fetch_iloilo_energy_black_marble.py
```

The Iloilo City story uses the same NASA Suomi-NPP VIIRS Black Marble `VNP46A3.002` product and January 2012–December 2023 window as the Metro Cebu series and the EIC night-lights visualization. It samples quality-flag-0 land pixels in an 11×11 neighborhood around central Iloilo City. Nighttime radiance is not a direct measure of electricity generation, consumption, access, or individual outages. Missing observations are omitted; only interior gaps of at most two months are estimated for chart and audio continuity.

Fetch the Bogo City Black Marble and Typhoon Tino data:

```powershell
python scripts/fetch-data/fetch_bogo_tino.py
```

The script samples monthly VNP46A3.002 nighttime radiance from January 2012 through October 2026 using the median of quality-flag-0 land pixels in an 11×11 neighborhood; months with fewer than 35 valid pixels are omitted. It also samples the nearest 0.1° cell from NASA GPM IMERG V07 Daily Late Run for 3–5 November 2025, retaining the UTC dates and mm/day values in the JSON as event context. Neither product is a local gauge or damage assessment; the monthly lights cannot resolve the storm night or household impacts. The location is in northern Cebu and remains distinct from the Metro Cebu energy-context sample.

Fetch the Sendong-period daily GPM IMERG Final Run samples for Cagayan de Oro:

```powershell
python scripts/fetch-data/fetch_sendong_daily_imerg.py
```

This adds daily precipitation estimates for Sendong (13–20 December 2011 UTC, Final Run) and Basyang (4–10 February 2026 UTC, Late Run) at Cagayan de Oro's nearest 0.1° grid cell to the existing `cagayan-de-oro.json` dataset. The event series are stored separately from its long-term monthly series. They do not replace the upstream Capehan gauge report, Northern Mindanao gauge observations, or NASA's regional TRMM storm-period analysis; reported Basyang impacts in Iligan are regional context, not observations at the CDO cell. Philippines local time is UTC+8, and Final and Late Run estimates should not be treated as a like-for-like comparison.

The Valenzuela pull samples up to three evenly spaced daily granules per complete calendar month. It applies `AOD_QA` clear-sky, land, and best-retrieval-quality filters to `Optical_Depth_047`; normal adjacency (code 0) is counted good, while adjacency to one cloudy pixel (code 3) is retained and counted marginal, following the MAIAC User Guide's general-use guidance. It takes the median of accepted pixels in the 5x5 neighborhood for each sampled day, then averages valid sampled-day medians. It is not a mean of every valid daily retrieval. Each output month preserves good/marginal pixel counts and valid sampled-day counts; months with no sampled QA-valid retrieval are omitted and listed in `sampling.missingMonths`. The checked-in Valenzuela snapshot predates this expanded filter and needs regeneration. Raw granules are temporary and are not written into the repository. The Valenzuela sample involves roughly 1,000 granule downloads (about 4 GB based on CMR catalog sizes); run it separately if you do not want that transfer as part of `run-all.py`.

Run all configured locations and sources:

```powershell
python scripts/fetch-data/run-all.py
```

Run the focused annual aggregation tests:

```powershell
python -m unittest discover -s scripts/fetch-data -p test_aggregation.py -v
```

`run-all.py` reports success/failure for each location and exits nonzero if any source fails. It never substitutes mock data.

## Output contract

Every story-data file uses chronological monthly records and this shape:

```json
{
	"locationId": "location-id",
	"metric": "monthly-metric-name",
	"unit": "unit",
	"source": { "mission": "...", "product": "...", "url": "..." },
	"scaleNote": "Optional spatial or interpretation caveat.",
	"series": [{ "year": 2000, "month": 1, "value": 0.0 }]
}
```

Files, monthly aggregation, and units:

- `manila-bay.json`, `leyte-gulf-tacloban.json`, and `davao-mindanao.json`: monthly means of valid sea-surface-height anomaly values in meters from all available NASA-SSH granules whose start date falls within each calendar month. Each granule covers roughly 10 days, with new grids every 7 days; valid contributor counts are stored in `sampling.validGranulesByMonth`. Months with no valid value are omitted. NASA-SSH begins in October 1992. The sampled 0.5° grid centers are 14.75°N, 120.75°E for Manila Bay (about 26.01 km from the mapped bay center), 10.75°N, 125.25°E for Tacloban/Leyte Gulf (about 60.85 km from Tacloban), and 6.75°N, 125.75°E for Davao (about 38.99 km from Davao). The Davao product applies Gaussian spatial averaging with a 100 km width. See the [NASA-SSH reference collection release](https://podaac.jpl.nasa.gov/announcements/2025-03-11-Release-of-NASA-SSH-Reference-Collections).
- `tacloban-leyte.json`: monthly precipitation total in mm/month. NASA POWER reports `PRECTOTCORR` as a monthly mean daily rate in mm/day; each valid value is multiplied by its calendar month length, including leap days. The current/future months are excluded.
- `angat-dam.json` and `pantabangan-dam.json`: monthly mapped water area in km2 from NASA/USGS Landsat Collection 2 Level-2 green and SWIR1 reflectance, classified with MNDWI inside OSM relations 2970167 and 2460576, respectively. Both local archives begin with Landsat 5 scenes acquired on 14 December 1987. The updated fetcher takes the median of all monthly scenes with at least 80% valid reservoir-pixel coverage; each record includes its accepted-scene count, median coverage, and summed pixel-scene sample count. `sampling.selectedScenes` retains per-month scene details. Months without an eligible scene are listed in `sampling.missingMonths` and omitted from `series`. **The checked-in JSON files are still the older single-scene snapshots and must be refreshed before the updated estimates are shown.**
- `macabebe-delta.json`: municipal mapped water extent from the same Landsat/MNDWI pipeline, December 1987–October 2026. It contains 277 observed months and 190 months without a scene meeting the 80% valid-pixel threshold. Existing fishponds, canals, estuarine water, and seasonal inundation all contribute to the municipal total; this series cannot identify farmland conversion or its cause.
- `nueva-ecija-rice-belt.json`, `benguet-vegetable-belt.json`, `negros-sugarcane-belt.json`, `bohol-ube-landscape.json`, `banaue-rice-terraces.json`, `mount-hamiguitan.json`, and `mount-apo-wildfire.json`: the fetcher now produces monthly means of good- or marginal-reliability (`pixel_reliability = 0` or `1`) 16-day Terra MODIS MOD13Q1.061 `_250m_16_days_NDVI` point observations from NASA's ORNL MODIS Web Service. Refreshed monthly records include good/marginal sample counts; the currently checked-in snapshots predate that refresh and do not yet include them. Invalid/fill NDVI and lower-reliability observations are omitted; months with no accepted observations remain absent from the source series. For charts, missing intervals are linked with dotted segments rather than filled with values; short-gap estimates remain visually distinct.
- `negros-sugarcane-belt.json`: same monthly MODIS NDVI method at a cropland sample near Hacienda Bayabas in Cadiz, Negros Occidental. ESA WorldCover 2021's 10 m Cropland class supports the agricultural setting but does not identify the crop species.
- `payatas-metro-manila.json` and `valenzuela-metro-manila.json`: comparable monthly samples of `MCD19A2.061` `Optical_Depth_047`, unitless AOD. Both use up to three evenly spaced daily 5x5-neighborhood medians, best-quality normal-adjacency pixels only, a five-good-pixel minimum per sampled day, and the arithmetic mean of accepted daily values. Marginal single-cloud-adjacency pixels are counted separately and excluded. Monthly support metadata distinguishes candidate days, valid days, good and marginal pixel samples, valid dates, missing months, calendar-month coverage, and observed-month sensitivity at five- and ten-pixel thresholds. These sparse samples are not full monthly means. Payatas' coordinate is approximate and is not a verified landfill location.
- The currently checked-in Payatas and Valenzuela bundles are legacy snapshots and are marked in-app as requiring refresh; their historic values are not yet harmonized and should not be compared. Running `fetch_air_quality.py` regenerates both locations together from the same selected granules and rules.
- `taal-volcano.json`: monthly regional SO₂ column means from the NASA Suomi-NPP OMPS Nadir Mapper L3 PCA daily product (0.25° grid), from January 2012 through the latest completed month. Each daily sample averages cells with `QualityFlags_SO2 == 0`, `ColumnAmountSO2` in the product range, and `CloudRadianceFraction` between 0 and 0.2 in a fixed 3×3 grid near Taal; monthly values average valid daily regional means. The January 2020 and June 2021 event markers remain contextual and are not individual plotted daily observations. This coarse atmospheric column series is not ground-level SO₂ concentration, vog exposure, ashfall, or a health measurement. Regenerate with `python fetch_taal_so2.py` from this directory; NASA Earthdata access is required.
- `koronadal-city.json`: monthly MERRA-2 `TOTEXTTAU` total aerosol optical thickness at 550 nm, sampled from the nearest 0.5° × 0.625° grid cell from January 2010 through the latest available month. It is regional reanalysis context, not the MODIS MAIAC series in Caido et al. (2022); the paper's validation does not validate MERRA-2. Refresh with `python fetch_koronadal_merra2_aod.py`; NASA Earthdata access is required.
- `metro-manila-lockdown.json`: monthly means of daily NASA Aura OMI `ColumnAmountNO2TropCloudScreened` from OMNO2d.004, aggregated over a fixed 3×3 region of 0.25° grid cells around Manila. The series starts in October 2004, records daily/monthly spatial support, and omits months without accepted daily samples. Values are in 10^15 molecules/cm². NASA's March 2020 versus 2010–2019 visualization is contextual; this monthly regional column series cannot establish a lockdown-caused change or ground-level exposure. Refresh with `python fetch_metro_manila_omi_no2.py`; NASA Earthdata access is required.
- `tacloban-haiyan.json`: monthly median nighttime radiance in `nW/(cm² sr)` from `VNP46A3.002`, using quality-flag-0 pixels with land/water mask 0 or 1 in a fixed 11x11 neighborhood centered on Tacloban. The series spans January 2012–October 2026 and requires at least 10 valid pixels per month; rejected low-support months and missing granules are recorded separately. It is the alternate dataset option under the Tacloban story, alongside precipitation.
- `surigao-city.json`: monthly median nighttime radiance in `nW/(cm² sr)` from `VNP46A3.002`, sampled from quality-flag-0 pixels with land/water mask 0 or 1 in an 11x11 grid-cell neighborhood around Surigao City, January 2012–October 2026. The monthly minimum is 35 valid pixels. Its January 2022 zero is cross-checked against the daily VNP46A2.002 `DNB_BRDF-Corrected_NTL` layer; the stored daily values and valid-pixel counts document that check. Missing or rejected observations are not zeros.
- `metro-cebu-energy.json`: monthly median nighttime radiance in `nW/(cm² sr)` from `VNP46A3.002`, sampled from quality-flag-0 land pixels in an 11×11 grid-cell neighborhood around central Cebu City, January 2012–December 2023. Its record window matches NASA EIC's 2012–2023 night-lights visualization. Radiance is not a direct measure of electricity production, consumption, or access. Missing observations are omitted, not zero; only interior gaps up to two months may be estimated for chart and sonification.

All `series` entries include `{ "year": number, "month": number, "value": number }`, sorted chronologically with unique year/month pairs. Refreshed MODIS NDVI entries additionally include `qualityCounts.goodSamples` and `qualityCounts.marginalSamples`; these counts are not yet present in the checked-in vegetation snapshots. Payatas and Valenzuela additionally include sampled/candidate daily counts, valid good-pixel counts, and good/marginal pixel counts; Metro Manila OMI NO₂ records include candidate/valid daily counts and valid grid-cell samples; Angat includes its valid reservoir-pixel count. Source metadata contains only mission, product, and URL; access credentials are never written to outputs. Spatial caveats are stored in the top-level optional `scaleNote` and should be shown with the story. Payatas and Valenzuela describe district-scale aerosol information, not landfill-level or street-level air quality. Sea-level stories measure regional open-water sea-surface height, not shoreline conditions, street-level flood risk, or storm surge.

Line charts use a calendar-scaled horizontal axis. A dotted link bridges months without source observations without creating data for those months. Interpolated values, where supported, remain visibly distinct and are excluded from observed-value counts.

Refresh status, 2026-10-03: Manila Bay was refreshed from NASA-SSH into 400 source-observed monthly records (1992-10 through 2026-05). Payatas was refreshed from MAIAC granules into 198 monthly observations (2000-02 through 2026-06); months with no valid retrieval are omitted. These AOD samples describe district-scale conditions, not landfill-level or street-level air quality.
