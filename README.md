# Earth Jukebox

**Explore Earth through sound.** Earth Jukebox is an interactive educational
experience that combines a 3D globe, NASA Earth Information Center (EIC)
visualizations, Philippine place-based environmental stories, and sound.

> **Try the live app:** [Earth Jukebox on Vercel](https://earth-jukebox-by-baud-per-second.vercel.app/)

> **Download the Android app:** [Earth Jukebox for Android (APK)](https://github.com/ImCeddy/ImCeddy-Earth-Jukebox-By-Baud-Per-Second/blob/main/Earth%20Jukebox.apk)  
> Version 1.0.1 · Android 7.0 or later · Install instructions below

## For judges

Earth Jukebox was created for the NASA Space Apps Challenge 2026 Earth Jukebox
challenge. It offers two complementary ways to listen:

1. **Explore a place-based story.** Start at the globe, choose a theme and
   location, then explore a sourced environmental time series. The chart and
   timeline drive an original synthesized soundscape.
2. **Listen to an EIC visualization.** Each of the nine themes includes an
   image or animation listening experience. Image brightness and color
   variation are mapped to sound as the image is scanned or the animation
   advances.

The sound is an interpretive aid, not a scientific unit, forecast, or
substitute for the chart. The app identifies the source, time window, scale,
and important caveats alongside each story.

## What you can explore

The experience includes nine themes: Sea Level Change, Air Quality, Disasters,
Water Resources, Agriculture, Wildfires, Biodiversity, Greenhouse Gases, and
Energy. Browse the available location stories, compare the data with sourced
event context, and control playback on desktop or mobile.

Story data is bundled with the app, so exploring the time series does not
depend on a live NASA data request. Separate Python scripts are provided for
authorized offline data retrieval and processing.

## Science, sources, and limitations

Earth Jukebox is an independent educational project, not an official NASA
product. It uses NASA EIC and Scientific Visualization Studio (SVS) material
for visualization context, alongside mission and product data. Some stories
also draw on other authoritative sources, including NOAA. Each story and the
references section identify the relevant sources.

Satellite products measure specific signals, not every local condition. For
example:

- Sea-surface-height grids are regional open-water context, not tide-gauge
  readings or neighborhood flood levels.
- Aerosol optical depth is not a ground-level PM2.5 measurement.
- Vegetation indices measure greenness, not crop identity or yield.
- Nighttime radiance is not a direct measure of electricity access or outages.
- Model and reanalysis products are not direct observations at every location.
- Global EIC images and models are not presented as local Philippine
  measurements.

Missing observations remain missing rather than being treated as zero. Where
short gaps are estimated for playback continuity, the interface distinguishes
estimates from source observations. Event markers provide context and do not
claim that an event caused a change in the data.

The visualization-sonification experience maps rendered pixel brightness and
color variation to sound. It does not claim to sonify the underlying NASA
measurements pixel-for-pixel. Place-story sound is algorithmically synthesized
from the selected time series. Neither is AI-generated audio.

## Android app

Download the signed APK from the link at the top of this page. The APK is
provided directly in this repository so it is available without a separate
release-page account or app store.

To install on Android:

1. Download the APK to your device.
2. Open the downloaded file and approve installation from that source if
   Android asks.
3. Launch **Earth Jukebox**.

This is a sideloaded app, not a Google Play release. Only install APKs you
download from this project’s repository. Android app signing keys are private
and are not included in the repository.

## Run the web app locally

### Requirements

- Node.js 22 (see `.mise.toml`)
- pnpm 10 (the project lockfile is `pnpm-lock.yaml`)

### Install and run

```powershell
pnpm install
pnpm dev
```

Open the local address printed by Vite (by default
`http://localhost:8443`).

### Build and test

```powershell
pnpm run build
pnpm test
```

### Build the Android debug app

Install Android Studio, a compatible JDK, and the Android SDK first. Then run:

```powershell
pnpm android:debug
```

The command builds the web app, syncs it into the Capacitor Android project,
and assembles a debug APK. For a distributable release, configure your own
Android signing properties locally; never commit signing keys or passwords.

## Technology

- React 19 and TypeScript
- Vite 8 and Tailwind CSS 4
- MapLibre GL JS for the interactive globe
- Capacitor 8 for the Android application
- Web Audio API and Canvas for synthesized audio and image-feature analysis
- Python for offline data-fetch and processing scripts

## Repository guide

| Path | Contents |
| --- | --- |
| `src/` | App screens, globe, audio, state, locations, and story data |
| `public/assets/eic/` | EIC visualization images, animation, and sampled frames |
| `downloads/` | Android APK for direct download |
| `tests/` | JavaScript tests for story data, resources, events, and sonification |
| `scripts/fetch-data/` | Offline data-fetching, aggregation, and Python tests |
| `scripts/analysis/` | Focused data-analysis scripts and outputs |
| `STORY_RESEARCH_PRINCIPLES.md` | Story selection, evidence, and interpretation standards |
| `SATELLITE_DATA_CATALOG.md` | Dataset and satellite-product reference catalog |

Data-fetch scripts that require NASA Earthdata authentication read credentials
from a local `.env` file. See `scripts/fetch-data/README.md` for setup and
source-specific instructions. Do not commit `.env`, access tokens, or signing
files.

## Attribution and licensing

NASA imagery and datasets retain their source attribution. Third-party sources
are credited in the app and project documentation. The app is not endorsed by
NASA. No repository-wide software license is currently provided; contact the
project maintainers before reusing this code or its bundled materials.
