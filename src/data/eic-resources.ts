export type EicThemeId =
  | "sea"
  | "air"
  | "disaster"
  | "water"
  | "agriculture"
  | "wildfire"
  | "biodiversity"
  | "gases"
  | "energy";

export type EicResource = {
  title: string;
  sourceId: string;
  sourceUrl: string;
  asset: string;
  mediaType: "image" | "video" | "frames";
  frameCount?: number;
  period: string;
  scope: string;
  caveat: string;
};

export const eicResources: Record<EicThemeId, EicResource> = {
  sea: {
    title: "Global Sea Surface Currents and Temperature",
    sourceId: "NASA SVS 3912",
    sourceUrl: "https://svs.gsfc.nasa.gov/3912/",
    asset: "/assets/eic/ecco2-surface-currents.m4v",
    mediaType: "video",
    period: "25 Mar 2007–03 Mar 2008",
    scope: "Global ECCO2 modeled surface currents, colored by sea-surface temperature",
    caveat: "This global ocean model visualization is not a sea-level product or a local observation. It provides ocean context only; the Manila Bay time-series remains a separate NASA-SSH open-water estimate.",
  },
  air: {
    title: "Air Quality Model Runs",
    sourceId: "NASA SVS 5533",
    sourceUrl: "https://svs.gsfc.nasa.gov/5533/",
    asset: "/assets/eic/frames/air-quality",
    mediaType: "frames",
    frameCount: 24,
    period: "Jul–Aug 2024",
    scope: "GEOS-CF modeled air-pollutant transport during North America's active fire season",
    caveat: "This is a NASA GEOS-CF model visualization of pollutant transport, not a local air-quality station record or a measurement over the Philippines.",
  },
  disaster: {
    title: "Lightning Events Detected from the ISS",
    sourceId: "NASA SVS 5011",
    sourceUrl: "https://svs.gsfc.nasa.gov/5011/",
    asset: "/assets/eic/frames/iss-lightning",
    mediaType: "frames",
    frameCount: 24,
    period: "Jan 2017–Jul 2023",
    scope: "Quality-controlled global lightning detections from the ISS Lightning Imaging Sensor",
    caveat: "The image summarizes global lightning distribution using a 10-day roving window. It is not a record of one disaster, storm severity, or Philippine events alone.",
  },
  water: {
    title: "A 3D View of an Atmospheric River",
    sourceId: "NASA SVS 4960",
    sourceUrl: "https://svs.gsfc.nasa.gov/4960/",
    asset: "/assets/eic/frames/atmospheric-river",
    mediaType: "frames",
    frameCount: 24,
    period: "Illustrative MERRA-2 reanalysis visualization",
    scope: "Modeled global water-vapor transport and atmospheric circulation",
    caveat: "This is a model/reanalysis visualization of atmospheric moisture transport, not a Philippine watershed, reservoir, rainfall gauge, or freshwater-supply measurement.",
  },
  agriculture: {
    title: "Atmospheric River · Weather Context",
    sourceId: "NASA SVS 4960",
    sourceUrl: "https://svs.gsfc.nasa.gov/4960/",
    asset: "/assets/eic/frames/atmospheric-river",
    mediaType: "frames",
    frameCount: 24,
    period: "Illustrative MERRA-2 reanalysis visualization",
    scope: "Atmospheric moisture transport as broad weather context for agriculture",
    caveat: "NASA's supplied EIC list has no crop- or field-specific visualization. This atmospheric-river example is weather context only; it is not Philippine rainfall, crop condition, yield, or farm-impact data.",
  },
  wildfire: {
    title: "GEOS Aerosols",
    sourceId: "NASA SVS 5669",
    sourceUrl: "https://svs.gsfc.nasa.gov/5669/",
    asset: "/assets/eic/geos-aerosols.png",
    mediaType: "image",
    period: "19 Aug 2025 · 20:00 UTC",
    scope: "Global GEOS-modeled aerosol types, including wildfire smoke",
    caveat: "This is a global model still with smoke as one aerosol category alongside dust, sea salt, and sulfates. It does not show the Mount Apo fire or measure its burned area or smoke.",
  },
  biodiversity: {
    title: "GEDI Forest Height",
    sourceId: "NASA SVS 4950",
    sourceUrl: "https://svs.gsfc.nasa.gov/4950/",
    asset: "/assets/eic/frames/gedi-forest-height",
    mediaType: "frames",
    frameCount: 24,
    period: "Apr 2019–Apr 2020",
    scope: "Global forest canopy height observed by GEDI from the ISS",
    caveat: "Canopy height is habitat-structure context, not a biodiversity or species-count measurement. The global visualization's height is exaggerated and does not resolve a specific Philippine habitat.",
  },
  gases: {
    title: "DYAMOND Global Carbon Dioxide",
    sourceId: "NASA SVS 5196",
    sourceUrl: "https://svs.gsfc.nasa.gov/5196/",
    asset: "/assets/eic/frames/dyamond-co2",
    mediaType: "frames",
    frameCount: 24,
    period: "Jan–Mar 2020",
    scope: "Global modeled atmospheric CO₂ concentrations and transport",
    caveat: "This is a visualization of global modeled CO₂ distribution and transport, not a current reading or a Philippine emissions inventory. The app's NOAA CO₂ time series is a separate dataset.",
  },
  energy: {
    title: "Change in Night Lights between 2012 and 2023",
    sourceId: "NASA SVS 5313",
    sourceUrl: "https://svs.gsfc.nasa.gov/5313/",
    asset: "/assets/eic/night-lights.jpg",
    mediaType: "image",
    period: "Annual averages, 2012–2023",
    scope: "Global Black Marble night-light averages and change",
    caveat: "This NASA visualization highlights global change and selected regional close-ups; it does not provide an energy-use or electricity-access measurement for the Philippine city stories.",
  },
};
