import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const fixtures = [
  { file: "manila-bay.json", locationId: "manila-bay", themeId: "sea" },
  { file: "tubigon-bohol.json", locationId: "tubigon-bohol", themeId: "sea" },
  { file: "aringay-alaska.json", locationId: "aringay-alaska", themeId: "sea" },
  { file: "leyte-gulf-tacloban.json", locationId: "leyte-gulf-tacloban", themeId: "sea" },
  { file: "davao-mindanao.json", locationId: "davao-mindanao", themeId: "sea" },
  { file: "tacloban-leyte.json", locationId: "tacloban-leyte", themeId: "disaster" },
  { file: "tacloban-haiyan.json", locationId: "tacloban-leyte", themeId: "disaster", initialMetric: "tertiary", pixelSampled: true, beforeRecord: true, metricLabel: "NIGHTTIME RADIANCE" },
  { file: "surigao-city.json", locationId: "surigao-city", themeId: "disaster", pixelSampled: true, metricLabel: "NIGHTTIME RADIANCE" },
  { file: "cagayan-de-oro.json", locationId: "cagayan-de-oro", themeId: "disaster" },
  { file: "angat-dam.json", locationId: "angat-dam", themeId: "water", pixelSampled: true, waterArea: true, metricLabel: "MONTHLY MAPPED WATER AREA" },
  { file: "pantabangan-dam.json", locationId: "pantabangan-dam", themeId: "water", pixelSampled: true, waterArea: true, metricLabel: "MONTHLY MAPPED WATER AREA" },
  { file: "macabebe-delta.json", locationId: "macabebe-delta", themeId: "water", pixelSampled: true, waterArea: true, metricLabel: "MONTHLY MAPPED WATER AREA" },
  { file: "nueva-ecija-rice-belt.json", locationId: "nueva-ecija-rice-belt", themeId: "agriculture", qualityAware: true },
  { file: "benguet-vegetable-belt.json", locationId: "benguet-vegetable-belt", themeId: "agriculture", qualityAware: true },
  { file: "negros-sugarcane-belt.json", locationId: "negros-sugarcane-belt", themeId: "agriculture", qualityAware: true },
  { file: "bohol-ube-landscape.json", locationId: "bohol-ube-landscape", themeId: "agriculture", qualityAware: true },
  { file: "banaue-rice-terraces.json", locationId: "banaue-rice-terraces", themeId: "agriculture", qualityAware: true },
  { file: "tubbataha-reefs.json", locationId: "tubbataha-reefs", themeId: "biodiversity" },
  { file: "mount-hamiguitan.json", locationId: "mount-hamiguitan", themeId: "biodiversity", qualityAware: true },
  { file: "mount-apo-wildfire.json", locationId: "mount-apo-wildfire", themeId: "wildfire", qualityAware: true },
  { file: "philippines-global-co2.json", locationId: "philippines-global-co2", themeId: "gases", ghgSeries: true },
  { file: "metro-cebu-energy.json", locationId: "metro-cebu-energy", themeId: "energy", pixelSampled: true, metricLabel: "NIGHTTIME RADIANCE" },
  { file: "iloilo-city-energy.json", locationId: "iloilo-city-energy", themeId: "energy", pixelSampled: true, metricLabel: "NIGHTTIME RADIANCE" },
  { file: "bogo-cebu-tino.json", locationId: "bogo-cebu-tino", themeId: "disaster", pixelSampled: true, metricLabel: "NIGHTTIME RADIANCE", bogoTino: true },
  { file: "payatas-metro-manila.json", locationId: "payatas-metro-manila", themeId: "air", sampled: true },
  { file: "valenzuela-metro-manila.json", locationId: "valenzuela-metro-manila", themeId: "air", sampled: true },
  { file: "taal-volcano.json", locationId: "taal-volcano", themeId: "air", taalSeries: true },
  { file: "metro-manila-lockdown.json", locationId: "metro-manila-lockdown", themeId: "air", omiNo2: true },
  { file: "koronadal-city.json", locationId: "koronadal-city", themeId: "air", merra2Aod: true },
];

const escapeHtml = (value) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#x27;");

test("Hagonoy and Bulakan story distinguishes community reporting from regional altimetry", async () => {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const { StoryDetail, ReferencesPage, themes } = await vite.ssrLoadModule("/src/App.tsx");
    const { locations } = await vite.ssrLoadModule("/src/data/locations.ts");
    const location = locations.find((item) => item.id === "hagonoy-bulakan");

    assert.ok(location);
    assert.equal(location.themeId, "sea-level");
    assert.ok(location.story.includes("Isla Pugad"));
    assert.ok(location.story.includes("Sitio Pariahan"));
    assert.equal(location.storySources.length, 2);

    const storyHtml = renderToStaticMarkup(
      createElement(StoryDetail, { initialTheme: themes.find((theme) => theme.id === "sea"), selectedLocation: location, onNavigate() {} }),
    );
    assert.ok(storyHtml.includes("A sinking island’s survival strategy"));
    assert.ok(storyHtml.includes("Sinking PH areas slow-onset disaster"));
    assert.ok(storyHtml.includes("about 9.5 km from that marker"));
    assert.ok(storyHtml.includes("cannot measure land subsidence"));

    const referencesHtml = renderToStaticMarkup(createElement(ReferencesPage, { onNavigate() {} }));
    assert.ok(referencesHtml.includes("Resources &amp; references"));
    assert.ok(referencesHtml.includes('role="tablist" aria-label="Resource categories"'));
    for (const tab of ["Data products", "Product references", "Story sources", "NASA challenge"]) {
      assert.ok(referencesHtml.includes(tab));
    }
    assert.ok(referencesHtml.includes("Landsat Collection 2 Level-2 Surface Reflectance, 30 m"));
    assert.ok(referencesHtml.includes("Macabebe · North Manila Bay Delta"));
  } finally {
    await vite.close();
  }
});

test("Tubigon story uses its own regional altimetry series and discloses its scale", async () => {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const { StoryDetail, ReferencesPage, themes } = await vite.ssrLoadModule("/src/App.tsx");
    const { locations } = await vite.ssrLoadModule("/src/data/locations.ts");
    const location = locations.find((item) => item.id === "tubigon-bohol");
    const dataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/tubigon-bohol.json", import.meta.url), "utf8"),
    );

    assert.ok(location);
    assert.equal(location.themeId, "sea-level");
    assert.deepEqual(location.lngLat, [123.9618897, 9.9515287]);
    assert.equal(dataset.locationId, location.id);
    assert.equal(dataset.series.length, 404);
    assert.ok(dataset.scaleNote.includes("32.26 km"));
    assert.ok(location.story.includes("2013 earthquake"));
    assert.ok(location.story.includes("cannot detect earthquake-related land movement"));

    const storyHtml = renderToStaticMarkup(
      createElement(StoryDetail, { initialTheme: themes.find((theme) => theme.id === "sea"), selectedLocation: location, onNavigate() {} }),
    );
    assert.ok(storyHtml.includes("Islands shaped by earthquake and tide"));
    assert.ok(storyHtml.includes("32.26 km from the mapped Tubigon town center"));
    assert.ok(storyHtml.includes("monthly sea-surface-height anomaly"));
    assert.ok(storyHtml.includes("ProQuest research record on Tubigon island flooding"));

    const referencesHtml = renderToStaticMarkup(createElement(ReferencesPage, { onNavigate() {} }));
    assert.ok(referencesHtml.includes("https://www.proquest.com/docview/1925187921"));
  } finally {
    await vite.close();
  }
});

test("Aringay story dates its reporting and distinguishes shoreline impacts from altimetry", async () => {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const { StoryDetail, ReferencesPage, themes } = await vite.ssrLoadModule("/src/App.tsx");
    const { locations } = await vite.ssrLoadModule("/src/data/locations.ts");
    const location = locations.find((item) => item.id === "aringay-alaska");
    const dataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/aringay-alaska.json", import.meta.url), "utf8"),
    );

    assert.ok(location);
    assert.equal(location.themeId, "sea-level");
    assert.deepEqual(location.lngLat, [120.3323896, 16.3684742]);
    assert.equal(dataset.locationId, location.id);
    assert.equal(dataset.series.length, 404);
    assert.ok(dataset.scaleNote.includes("15.84 km"));
    assert.ok(location.story.includes("17 January 2018"));
    assert.ok(location.story.includes("does not establish their present-day status"));
    assert.ok(location.story.includes("not a measurement of the village's shoreline retreat"));

    const storyHtml = renderToStaticMarkup(
      createElement(StoryDetail, { initialTheme: themes.find((theme) => theme.id === "sea"), selectedLocation: location, onNavigate() {} }),
    );
    assert.ok(storyHtml.includes("A village shoreline reshaped by earthquake and sea"));
    assert.ok(storyHtml.includes("As Philippine coastal village sinks"));
    assert.ok(storyHtml.includes("not a surveyed shoreline or village boundary"));

    const referencesHtml = renderToStaticMarkup(createElement(ReferencesPage, { onNavigate() {} }));
    assert.ok(referencesHtml.includes("https://www.eco-business.com/news/as-philippine-coastal-village-sinks-whos-paying-for-the-damage/"));
    assert.ok(referencesHtml.includes("17 Jan 2018"));
  } finally {
    await vite.close();
  }
});

test("mapped Story data renders real monthly records and only mapped themes are available", async () => {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const { StoryDetail, ReferencesPage, themes } = await vite.ssrLoadModule("/src/App.tsx");
    const { locations } = await vite.ssrLoadModule("/src/data/locations.ts");
    const { notableEvents } = await vite.ssrLoadModule("/src/data/notable-events.ts");
    const { interpolateShortMonthlyGaps, normalizeSelectedMonth, updateEngineForMonth } = await vite.ssrLoadModule("/src/audio/useSonification.ts");
    const { requestMapZoom, setMapZoomHandler } = await vite.ssrLoadModule("/src/state/globeStore.ts");

    assert.ok(locations.some((location) => location.id === "taal-volcano"));
    assert.ok(!locations.some((location) => location.id === "guiuan-hagupit"));
    const bogoLocation = locations.find((location) => location.id === "bogo-cebu-tino");
    const bogoEvent = notableEvents.find((event) => event.id === "bogo-cebu-2025-11-04-tino");
    assert.ok(bogoLocation);
    assert.equal(bogoLocation.themeId, "disasters");
    assert.equal(bogoLocation.storySources.length, 2);
    assert.ok(bogoLocation.dataScaleNote.includes("UTC calendar days"));
    assert.ok(bogoEvent);
    assert.equal(bogoEvent.kind, "context");
    assert.equal(bogoEvent.evidenceStatus, "context only (satellite cannot show it)");
    assert.deepEqual([bogoEvent.year, bogoEvent.month, bogoEvent.day], [2025, 11, 4]);
    assert.deepEqual(
      bogoEvent.sources.map((source) => source.url),
      [
        "https://cebudailynews.inquirer.net/667923/tino-unleashed-over-a-months-rainfall-in-cebu-within-24-hours",
        "https://disasterscharter.org/activations/flood-in-philippines-activation-1001-",
        "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDL_07/summary",
      ],
    );
    const taalEvents = notableEvents.filter((event) => event.locationId === "taal-volcano");
    assert.equal(taalEvents.length, 2);
    assert.deepEqual(
      taalEvents.map(({ year, month, day, endDay }) => [year, month, day, endDay]),
      [[2020, 1, 12, 13], [2021, 6, 28, 29]],
    );
    assert.ok(taalEvents.every((event) => event.kind === "context"));
    assert.ok(taalEvents[0].dataNote.includes("not the monthly regional mean"));
    assert.ok(taalEvents[1].dataNote.includes("not an SO₂ concentration over Manila"));
    const taalLocation = locations.find((location) => location.id === "taal-volcano");
    assert.equal(taalLocation.themeId, "air-quality");
    assert.deepEqual(taalLocation.lngLat, [120.993, 14.002]);
    assert.equal(taalLocation.storySources.length, 2);
    const koronadalLocation = locations.find((location) => location.id === "koronadal-city");
    const koronadalDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/koronadal-city.json", import.meta.url), "utf8"),
    );
    assert.equal(koronadalLocation.themeId, "air-quality");
    assert.deepEqual(koronadalLocation.lngLat, [124.8435437, 6.5004041]);
    assert.equal(koronadalLocation.storySources.length, 1);
    assert.equal(koronadalDataset.locationId, koronadalLocation.id);
    assert.equal(koronadalDataset.metric, "monthly_mean_aerosol_optical_thickness_055");
    assert.deepEqual(
      [koronadalDataset.series[0].year, koronadalDataset.series[0].month, koronadalDataset.series.at(-1).year, koronadalDataset.series.at(-1).month],
      [2010, 1, 2026, 9],
    );
    assert.equal(koronadalDataset.series.length, 201);
    assert.deepEqual(koronadalDataset.sampling.missingMonths, []);
    assert.ok(Object.values(koronadalDataset.sampling.validGranulesByMonth).every((count) => count === 1));
    assert.ok(koronadalDataset.references.some((reference) => reference.product.includes("MODIS Aerosol Optical Depth")));
    assert.ok(koronadalDataset.source.product.includes("TOTEXTTAU"));
    assert.ok(koronadalDataset.scaleNote.includes("do not validate"));
    const metroManilaLocation = locations.find((location) => location.id === "metro-manila-lockdown");
    const metroManilaDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/metro-manila-lockdown.json", import.meta.url), "utf8"),
    );
    assert.equal(metroManilaLocation.themeId, "air-quality");
    assert.deepEqual(metroManilaLocation.lngLat, [120.9842, 14.5995]);
    assert.equal(metroManilaLocation.storySources.length, 1);
    assert.equal(metroManilaDataset.metric, "monthly_mean_tropospheric_no2_column_omi");
    assert.deepEqual(
      [metroManilaDataset.series[0].year, metroManilaDataset.series[0].month, metroManilaDataset.series.at(-1).year, metroManilaDataset.series.at(-1).month],
      [2004, 10, 2026, 10],
    );
    assert.equal(metroManilaDataset.series.length, 265);
    assert.equal(metroManilaDataset.sampling.missingMonths.length, 0);
    assert.deepEqual(metroManilaDataset.sampling.minimumSupportForLowSupportCue, {
      validDailySamples: 10,
      validPixelSamples: 30,
    });
    assert.equal(
      metroManilaDataset.references[1].url,
      "https://www.earthdata.nasa.gov/topics/atmosphere/air-quality",
    );
    assert.ok(!("lowSupportThreshold" in metroManilaDataset.sampling));
    assert.equal(
      metroManilaDataset.series.find((point) => point.year === 2020 && point.month === 4).value,
      2.24520245100069,
    );
    assert.ok(metroManilaDataset.series.some((point) => point.year === 2020 && point.month === 3));
    assert.ok(metroManilaDataset.source.product.includes("OMNO2d"));
    assert.ok(metroManilaDataset.scaleNote.includes("cannot attribute a NO₂ change to lockdown"));

    for (const fixture of fixtures) {
      const dataset = JSON.parse(
        await readFile(new URL(`../src/data/story-data/${fixture.file}`, import.meta.url), "utf8"),
      );
      if (fixture.bogoTino) {
        assert.equal(dataset.sampling.dailyRainfallCrossCheck.product, "GPM_3IMERGDL.07 daily Late Run");
        assert.deepEqual(
          dataset.sampling.dailyRainfallCrossCheck.dailySamples.map(({ date, value, unit }) => [date, value, unit]),
          [
            ["2025-11-03", 71.355, "mm/day"],
            ["2025-11-04", 13.15, "mm/day"],
            ["2025-11-05", 0.91, "mm/day"],
          ],
        );
        assert.ok(dataset.series.some((point) => point.year === 2025 && point.month === 11));
        assert.equal(dataset.sampling.minimumValidPixelsPerMonth, 35);
      }
      assert.ok(dataset.series.every((item) => {
        const keys = Object.keys(item).sort().join(",");
        if (fixture.sampled && dataset.sampling?.refreshRequired) {
          return keys === "month,validDailySamples,validPixelSamples,value,year"
            || keys === "month,qualityCounts,validDailySamples,validPixelSamples,value,year"
            || keys === "month,value,year";
        }
        if (fixture.sampled) return keys === "candidateDailySamples,month,qualityCounts,validDailySamples,validPixelSamples,value,year";
        if (fixture.taalSeries) return keys === "candidateDailySamples,month,validDailySamples,validPixelSamples,value,year";
        if (fixture.omiNo2) return keys === "candidateDailySamples,month,validDailySamples,validPixelSamples,value,year";
        if (fixture.ghgSeries) return keys === "month,uncertainty,value,year";
        if (fixture.qualityAware) return keys === "month,qualityCounts,value,year";
        if (fixture.waterArea) return keys === "month,reviewNote,validPixelSamples,value,year"
          || keys === "month,validPixelSamples,value,year"
          || keys === "medianValidCoverage,month,validPixelSamples,validSceneCount,value,year"
          || keys === "medianValidCoverage,month,reviewNote,validPixelSamples,validSceneCount,value,year";
        if (fixture.pixelSampled) return keys === "month,validPixelSamples,value,year";
        return keys === "month,value,year";
      }));
      assert.ok(dataset.series.every((item, index) => index === 0 || dataset.series[index - 1].year * 12 + dataset.series[index - 1].month < item.year * 12 + item.month));
      if (fixture.qualityAware) {
        assert.equal(dataset.source.mission, "Terra MODIS");
        assert.ok(dataset.source.product.includes("MOD13Q1.061"));
        assert.equal(dataset.source.url, "https://modis.ornl.gov/rst/");
        assert.deepEqual(dataset.qualityPolicy.acceptedPixelReliability, [0, 1]);
        assert.equal(dataset.qualityPolicy.countLabel, "GOOD / MARGINAL 16-DAY COMPOSITES");
        assert.ok(Array.isArray(dataset.sampling.missingMonths));
        assert.ok(dataset.sampling.missingMonths.every((month) => /^\d{4}-\d{2}$/.test(month)));
        assert.ok(dataset.series.every((item) =>
          Number.isInteger(item.qualityCounts.goodSamples)
          && Number.isInteger(item.qualityCounts.marginalSamples)
          && item.qualityCounts.goodSamples + item.qualityCounts.marginalSamples > 0,
        ));
      }
      if (fixture.ghgSeries) {
        assert.equal(dataset.source.mission, "NOAA Global Monitoring Laboratory");
        assert.equal(dataset.unit, "ppm CO2");
        assert.equal(dataset.metric, "monthly_mean_global_co2_mole_fraction");
        assert.deepEqual(dataset.sampling.missingMonths, []);
        assert.ok(dataset.series.every((item) => Number.isFinite(item.uncertainty) && item.uncertainty >= 0));
        assert.ok(dataset.references.some((reference) => reference.url === "https://svs.gsfc.nasa.gov/5196/"));
      }
      if (fixture.sampled) {
        if (dataset.sampling.refreshRequired) {
          assert.ok(dataset.sampling.refreshReason);
          if (fixture.locationId === "payatas-metro-manila") {
            assert.equal(dataset.metric, "legacy_monthly_median_samples_aod_047");
          }
        } else {
          assert.ok(dataset.series.every((item) => Number.isInteger(item.validDailySamples) && item.validDailySamples > 0 && item.validDailySamples <= 3));
          assert.ok(dataset.series.every((item) => Number.isInteger(item.candidateDailySamples) && item.validDailySamples <= item.candidateDailySamples && item.candidateDailySamples <= 3));
          assert.ok(dataset.series.every((item) => Number.isInteger(item.validPixelSamples) && item.validPixelSamples > 0));
          assert.equal(dataset.metric, "sampled_monthly_aod_047");
          assert.equal(dataset.sampling.maximumSampledDaysPerMonth, 3);
          assert.ok(dataset.sampling.method.includes("up to three evenly spaced daily"));
          assert.ok(dataset.sampling.method.includes("arithmetic mean"));
          assert.equal(dataset.sampling.minimumGoodPixelsPerDailyNeighborhood, 5);
          assert.ok(dataset.scaleNote.includes("not a mean of all valid daily retrievals"));
          assert.ok(dataset.sampling.thresholdSensitivityObservedMonths["5"] >= dataset.sampling.thresholdSensitivityObservedMonths["10"]);
          assert.ok(dataset.scaleNote.includes("omitted, not zero"));
          assert.ok(dataset.sampling.missingMonths.every((month) =>
            !dataset.series.some((item) => `${item.year}-${String(item.month).padStart(2, "0")}` === month),
          ));
        }
      }
      if (fixture.pixelSampled) {
        assert.ok(dataset.series.every((item) => Number.isInteger(item.validPixelSamples) && item.validPixelSamples > 0));
      }
      if (fixture.waterArea && dataset.series[0].validSceneCount !== undefined) {
        assert.ok(dataset.series.every((item) =>
          Number.isInteger(item.validSceneCount) && item.validSceneCount > 0
          && item.medianValidCoverage >= 0.8 && item.medianValidCoverage <= 1,
        ));
      }
      const theme = themes.find((item) => item.id === fixture.themeId);
      const location = {
        id: fixture.locationId,
        name: fixture.locationId,
        story: `Story for ${fixture.locationId}`,
        dataScaleNote: "Location scale disclosure",
      };
      const html = renderToStaticMarkup(
        createElement(StoryDetail, { initialTheme: theme, selectedLocation: location, onNavigate() {}, initialMetric: fixture.initialMetric }),
      );
      const latest = dataset.series.at(-1);
      const formattedValue = new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(latest.value);
      assert.ok(html.includes(formattedValue), `${fixture.locationId} renders its real observed value`);
      assert.ok(html.includes(dataset.unit), `${fixture.locationId} renders its unit`);
      if (fixture.merra2Aod) {
        assert.ok(html.includes("NASA GMAO MERRA-2"));
        assert.ok(html.includes("not a direct satellite retrieval"));
        assert.ok(html.includes("MODIS-AERONET validation do not validate"));
      }
      if (fixture.omiNo2) {
        assert.ok(html.includes("NASA Aura OMI / NASA GES DISC"));
        assert.ok(html.includes("VALID / CANDIDATE DAYS"));
        assert.ok(html.includes("VALID OMI GRID CELL SAMPLES"));
        assert.ok(html.includes("notable-event-marker"));
      }
      if (fixture.taalSeries) {
        assert.equal(dataset.metric, "monthly_mean_regional_so2_column_du");
        assert.ok(dataset.series.length > 100);
        assert.ok(dataset.sampling.method.includes("3x3 grid-cell region"));
        assert.ok(dataset.sampling.qa.includes("CloudRadianceFraction"));
        assert.ok(Number.isInteger(latest.validDailySamples));
        assert.ok(Number.isInteger(latest.candidateDailySamples));
        assert.ok(Number.isInteger(latest.validPixelSamples));
        assert.ok(html.includes("VALID / CANDIDATE DAYS"));
        assert.ok(html.includes("VALID REGIONAL GRID CELLS"));
        assert.ok(html.includes("notable-event-marker"));
      }
      assert.ok(html.includes(dataset.source.mission), `${fixture.locationId} renders its source mission`);
      const scaleCaveat = dataset.scaleNote ?? location.dataScaleNote;
      assert.ok(html.includes(scaleCaveat.slice(0, 100)), `${fixture.locationId} renders its scale caveat`);
      if (fixture.pixelSampled) {
        assert.ok(html.includes(fixture.metricLabel ?? "NIGHTTIME RADIANCE"));
        if (fixture.beforeRecord) assert.ok(html.includes("Before the record"));
      }
      if (fixture.waterArea && latest.validSceneCount !== undefined) {
        assert.ok(html.includes("VALID SCENES · MEDIAN COVERAGE"));
        assert.ok(html.includes(String(latest.validSceneCount)));
      }
      const zoomLocationName = locations.find((location) => location.id === fixture.locationId)?.name ?? fixture.locationId;
      assert.ok(html.includes(`Zoom in on ${zoomLocationName}`), `${fixture.locationId} exposes map zoom controls`);
      assert.ok(html.includes(`Zoom out on ${zoomLocationName}`), `${fixture.locationId} exposes map zoom controls`);
      if (fixture.sampled) {
        if (dataset.sampling.refreshRequired) {
          assert.ok(html.includes("AOD data refresh required:"));
          if (latest.validDailySamples !== undefined) assert.ok(html.includes("VALID SAMPLED DAYS · LEGACY"));
        } else {
          assert.ok(html.includes("VALID / CANDIDATE DAYS"));
          assert.ok(html.includes(String(latest.validDailySamples)));
          assert.ok(html.includes(String(latest.candidateDailySamples)));
          assert.ok(html.includes("GOOD / MARGINAL PIXELS"));
        }
        assert.ok(html.includes("MISSING INTERVAL"));
        assert.ok(html.includes("chart-line-gap"));
        const linePath = html.match(/<path d="([^"]+)"[^>]*class="chart-line"/)?.[1];
        assert.ok(linePath && (linePath.match(/M/g) ?? []).length > 1, "the chart starts a new path across missing months");
      }
      assert.ok(!html.includes("illustrative interface dataset"), `${fixture.locationId} has no illustrative-data disclaimer`);
      assert.equal(
        html.includes("notable-event-marker"),
        notableEvents.some((event) => (event.locationIds ?? [event.locationId]).includes(fixture.locationId)),
        `${fixture.locationId} markers match its event list`,
      );
    }
    const apoLocation = locations.find((location) => location.id === "mount-apo-wildfire");
    const apoEvent = notableEvents.find((event) => event.id === "mount-apo-2016-03-wildfire-context");
    const apoDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/mount-apo-wildfire.json", import.meta.url), "utf8"),
    );
    const apoMarch2016 = apoDataset.series.find((point) => point.year === 2016 && point.month === 3);
    assert.ok(apoLocation);
    assert.equal(apoLocation.themeId, "wildfires");
    assert.ok(apoLocation.story.includes("not active-fire detection"));
    assert.ok(apoLocation.dataScaleNote.includes("not an analysis of the reported fire perimeter"));
    assert.ok(apoLocation.storySources.some((source) => source.url.includes("sunstar.com.ph")));
    assert.ok(apoEvent);
    assert.equal(apoEvent.evidenceStatus, "context only (satellite cannot show it)");
    assert.ok(apoMarch2016);
    assert.equal(apoMarch2016.value, 0.7476);
    assert.deepEqual(apoMarch2016.qualityCounts, { goodSamples: 1, marginalSamples: 1 });
    const globalCo2Location = locations.find((location) => location.id === "philippines-global-co2");
    const globalCo2Dataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/philippines-global-co2.json", import.meta.url), "utf8"),
    );
    assert.ok(globalCo2Location);
    assert.equal(globalCo2Location.themeId, "greenhouse-gases");
    assert.equal(globalCo2Location.coordinateLabel, "PHILIPPINES · REFERENCE MARKER");
    assert.ok(globalCo2Location.dataScaleNote.includes("not Philippine or city-level concentrations"));
    const july1979 = globalCo2Dataset.series.find((point) => point.year === 1979 && point.month === 7);
    const july2026 = globalCo2Dataset.series.find((point) => point.year === 2026 && point.month === 7);
    assert.equal(july1979.value, 335.56);
    assert.equal(july2026.value, 426.1);
    assert.ok(july2026.uncertainty >= 0);
    assert.deepEqual(themes.filter((theme) => theme.available).map((theme) => theme.id), [
      "sea", "air", "disaster", "water", "agriculture", "wildfire", "biodiversity", "gases", "energy",
    ]);
    const tubbatahaDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/tubbataha-reefs.json", import.meta.url), "utf8"),
    );
    assert.equal(tubbatahaDataset.series.length, 173);
    assert.deepEqual(tubbatahaDataset.sampling.missingMonths, ["2023-11", "2023-12", "2024-01", "2024-02"]);
    assert.equal(tubbatahaDataset.series.find((point) => point.year === 2020 && point.month === 6).value, 5.3);
    assert.equal(tubbatahaDataset.series.find((point) => point.year === 2024 && point.month === 6).value, 6.21);
    assert.equal(tubbatahaDataset.sampling.gridCellCenter.latitude, 8.825);
    assert.equal(tubbatahaDataset.sampling.gridCellCenter.longitude, 119.875);
    assert.ok(tubbatahaDataset.scaleNote.includes("not a direct observation of bleaching"));
    assert.ok(!tubbatahaDataset.continuity, "archive gaps are never interpolated");
    const tubbatahaEvents = notableEvents.filter((event) => event.locationId === "tubbataha-reefs");
    assert.equal(tubbatahaEvents.length, 2);
    assert.ok(tubbatahaEvents.every((event) => event.kind === "visible-in-data"));
    const hamiguitanLocation = locations.find((location) => location.id === "mount-hamiguitan");
    const hamiguitanDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/mount-hamiguitan.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(hamiguitanLocation.lngLat, [126.1665302, 6.6084588]);
    assert.equal(hamiguitanDataset.locationId, hamiguitanLocation.id);
    assert.equal(hamiguitanDataset.metric, "monthly_mean_ndvi");
    assert.equal(hamiguitanDataset.series.length, 222);
    assert.deepEqual(
      [
        hamiguitanDataset.series[0].year,
        hamiguitanDataset.series[0].month,
        hamiguitanDataset.series.at(-1).year,
        hamiguitanDataset.series.at(-1).month,
      ],
      [2000, 3, 2026, 10],
    );
    assert.equal(Math.min(...hamiguitanDataset.series.map((point) => point.value)), 0.4857);
    assert.ok(hamiguitanDataset.scaleNote.includes("not forest cover, habitat quality, biodiversity"));
    assert.ok(hamiguitanDataset.references.some((reference) => reference.url === "https://whc.unesco.org/en/list/1403/"));
    assert.ok(hamiguitanDataset.references.some((reference) => reference.url.includes("openstreetmap.org/way/1120154773")));
    const hamiguitanEvents = notableEvents.filter((event) => event.locationId === "mount-hamiguitan");
    assert.equal(hamiguitanEvents.length, 2);
    assert.ok(hamiguitanEvents.some((event) => event.kind === "visible-in-data" && event.dataNote.includes("0.4857")));
    assert.ok(hamiguitanEvents.some((event) =>
      event.kind === "context"
      && event.description.includes("not measured by NDVI")
      && event.sources.some((source) => source.url === "https://whc.unesco.org/en/list/1403/"),
    ));
    const cebuLocation = locations.find((location) => location.id === "metro-cebu-energy");
    const cebuDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/metro-cebu-energy.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(cebuLocation.lngLat, [123.8854, 10.3157]);
    assert.equal(cebuDataset.locationId, cebuLocation.id);
    assert.equal(cebuDataset.metric, "monthly_black_marble_nighttime_radiance");
    assert.deepEqual(
      [
        cebuDataset.series[0].year,
        cebuDataset.series[0].month,
        cebuDataset.series.at(-1).year,
        cebuDataset.series.at(-1).month,
      ],
      [2012, 1, 2023, 12],
    );
    assert.ok(cebuDataset.scaleNote.includes("not a direct measure of electricity production"));
    assert.ok(cebuDataset.references.some((reference) => reference.url === "https://earth.gov/themes/energy"));
    assert.equal(notableEvents.filter((event) => event.locationId === "metro-cebu-energy").length, 0);
    const iloiloLocation = locations.find((location) => location.id === "iloilo-city-energy");
    const iloiloDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/iloilo-city-energy.json", import.meta.url), "utf8"),
    );
    assert.deepEqual(iloiloLocation.lngLat, [122.5621, 10.7202]);
    assert.equal(iloiloDataset.locationId, iloiloLocation.id);
    assert.equal(iloiloDataset.metric, "monthly_black_marble_nighttime_radiance");
    assert.deepEqual(
      [
        iloiloDataset.series[0].year,
        iloiloDataset.series[0].month,
        iloiloDataset.series.at(-1).year,
        iloiloDataset.series.at(-1).month,
      ],
      [2012, 1, 2023, 12],
    );
    assert.ok(iloiloDataset.scaleNote.includes("not a direct measure of electricity production"));
    assert.ok(iloiloDataset.references.some((reference) => reference.url === "https://earth.gov/themes/energy"));
    assert.equal(notableEvents.filter((event) => event.locationId === "iloilo-city-energy").length, 0);
    const taclobanEvents = notableEvents.filter((event) => event.locationId === "tacloban-leyte");
    assert.equal(taclobanEvents.length, 5);
    assert.equal(notableEvents.filter((event) => (event.locationIds ?? [event.locationId]).includes("valenzuela-metro-manila")).length, 0,
      "no unverified Valenzuela context event is shown");
    assert.ok(taclobanEvents.every((event) => event.kind === "context"));
    assert.ok(taclobanEvents.filter((event) => event.locationIds).every((event) => event.locationIds.includes("leyte-gulf-tacloban")));
    assert.ok(taclobanEvents.some((event) =>
      event.title === "Typhoon Haiyan (Yolanda)" && event.dataNote.includes("November composite can mix observations"),
    ));
    assert.ok(taclobanEvents.some((event) => event.title === "Typhoon Hagupit (Ruby): the evacuation" && !event.description.match(/final death toll/i)));
    const davaoEvents = notableEvents.filter((event) => (event.locationIds ?? [event.locationId]).includes("davao-mindanao"));
    assert.equal(davaoEvents.length, 1, "only the verified Davao preparedness event is mapped");
    assert.deepEqual(davaoEvents.map(({ year, month, kind, title }) => ({ year, month, kind, title })), [
      { year: 2023, month: 3, kind: "context", title: "Davao prepares for El Niño" },
    ]);
    assert.ok(davaoEvents[0].description.includes("does not show that El Niño caused the NASA-SSH anomaly"));
    const originalManilaEventIds = notableEvents.filter((event) => event.locationId === "manila-bay").map((event) => event.id);
    assert.deepEqual(originalManilaEventIds, [
      "manila-bay-1998-01-el-nino-pulls-the-bay-down",
      "manila-bay-1998-12-la-nina-pushes-it-back-up",
      "manila-bay-2008-12-highest-month",
      "manila-bay-2011-01-la-nina-eastern-visayas-floods",
      "manila-bay-2016-04-el-nino-again",
      "manila-bay-2023-12-sea-dips-before-drought",
      "manila-bay-2006-land-sinking",
      "manila-bay-2011-09-pedring",
      "manila-bay-2017-03-mangroves-tibaguin",
      "manila-bay-2025-09-pugad-island",
    ], "Manila Bay event records remain unchanged");
    assert.deepEqual(taclobanEvents.map((event) => event.id), [
      "tacloban-leyte-2011-01-la-nina-floods",
      "tacloban-leyte-2013-11-haiyan",
      "tacloban-leyte-2014-02-no-build-zone",
      "tacloban-leyte-2014-12-hagupit",
      "tacloban-leyte-2023-11-ten-years-on",
    ], "Tacloban events include the January 2011 flood context");
    const taclobanFloodEvent = taclobanEvents.find((event) => event.id === "tacloban-leyte-2011-01-la-nina-floods");
    assert.ok(taclobanFloodEvent.dataNote.includes("1,000.37 mm"));
    assert.ok(taclobanFloodEvent.dataNote.includes("2.3 times the 429.4 mm mean"));
    assert.ok(taclobanFloodEvent.sources.some((source) => source.url.includes("210120")));
    const haiyanEvent = taclobanEvents.find((event) => event.id === "tacloban-leyte-2013-11-haiyan");
    assert.ok(haiyanEvent.dataNote.includes("6.58663"));
    assert.ok(haiyanEvent.dataNote.includes("0.778636"));
    assert.ok(haiyanEvent.dataNote.includes("6.942529"));
    assert.ok(haiyanEvent.sources.some((source) => source.url.includes("Typhoon_Haiyan_Report_20160701.pdf")));

    const referencesHtml = renderToStaticMarkup(
      createElement(ReferencesPage, { onNavigate() {} }),
    );
    const uniqueSources = new Map();
    for (const fixture of fixtures) {
      const dataset = JSON.parse(
        await readFile(new URL(`../src/data/story-data/${fixture.file}`, import.meta.url), "utf8"),
      );
      for (const source of [dataset.source, ...(dataset.references ?? [])]) {
        uniqueSources.set(`${source.url}|${source.product}`, source);
      }
    }
    assert.ok(uniqueSources.size >= 45);
    for (const source of uniqueSources.values()) {
      assert.ok(referencesHtml.includes(escapeHtml(source.mission)));
      assert.ok(referencesHtml.includes(escapeHtml(source.product)));
      assert.ok(referencesHtml.includes(escapeHtml(source.url)));
    }
    assert.ok(referencesHtml.includes("Typhoon Haiyan report"));
    assert.ok(referencesHtml.includes("us20008ixa"));
    assert.ok(referencesHtml.includes("Philippine Engineering Journal 44(1), 2023"));
    assert.ok(referencesHtml.includes("Period-Lengthening of the Mindanao Current Variability From the Long-Term Tide Gauge Sea Level Measurements"));
    assert.ok(referencesHtml.includes("https://doi.org/10.1029/2020JC016932"));
    assert.ok(referencesHtml.includes("https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20PUBLICATIONS/Philippine%20Climate%20Change%20Assessment_.pdf"));
    assert.ok(referencesHtml.includes("https://doi.org/10.1016/j.apr.2022.101379"));
    assert.ok(referencesHtml.includes("https://doi.org/10.4209/aaqr.230122"));
    for (const event of notableEvents) {
      for (const source of event.sources) assert.ok(referencesHtml.includes(source.url));
    }

    assert.deepEqual(locations.find((location) => location.id === "manila-bay").lngLat, [120.76667, 14.51667]);
    assert.deepEqual(locations.find((location) => location.id === "payatas-metro-manila").lngLat, [121.1, 14.72]);
    const valenzuela = locations.find((location) => location.id === "valenzuela-metro-manila");
    assert.equal(valenzuela.themeId, "air-quality");
    assert.equal(valenzuela.name, "Valenzuela, Metro Manila");
    assert.deepEqual(valenzuela.lngLat, [120.983, 14.7011]);
    assert.equal(valenzuela.zoom, 10);
    assert.equal(valenzuela.pitch, 35);
    assert.ok(valenzuela.story.includes("Sparse satellite retrievals"));
    const metroManila = locations.find((location) => location.id === "metro-manila-lockdown");
    assert.equal(metroManila.themeId, "air-quality");
    assert.ok(metroManila.story.includes("not evidence that lockdown caused them"));
    const valenzuelaDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/valenzuela-metro-manila.json", import.meta.url), "utf8"),
    );
    if (valenzuelaDataset.sampling.refreshRequired) {
      assert.ok(valenzuela.dataScaleNote.includes("best-quality"));
    } else {
      assert.equal(valenzuela.dataScaleNote, valenzuelaDataset.scaleNote);
    }
    assert.equal(valenzuelaDataset.source.url, "https://doi.org/10.5067/MODIS/MCD19A2.061");
    const march2020Valenzuela = valenzuelaDataset.series.find((point) => point.year === 2020 && point.month === 3);
    assert.ok(march2020Valenzuela && march2020Valenzuela.validDailySamples >= 1);
    if (!valenzuelaDataset.sampling.refreshRequired) {
      assert.ok(march2020Valenzuela.candidateDailySamples >= march2020Valenzuela.validDailySamples);
    }
    assert.equal(notableEvents.some((event) => (event.locationIds ?? [event.locationId]).includes(valenzuela.id)), false);
    assert.deepEqual(locations.find((location) => location.id === "nueva-ecija-rice-belt").lngLat, [120.89077, 15.67122]);
    const agricultureEvents = notableEvents.filter((event) => event.locationId === "nueva-ecija-rice-belt");
    const agricultureData = JSON.parse(
      await readFile(new URL("../src/data/story-data/nueva-ecija-rice-belt.json", import.meta.url), "utf8"),
    );
    assert.equal(agricultureEvents.length, 6);
    assert.ok(agricultureEvents.every((event) =>
      event.kind === "context"
      && event.evidenceStatus === "context only (satellite cannot show it)"
      && event.sources.length > 0
      && event.sources.every((source) => /^https:\/\//.test(source.url)),
    ));
    for (const event of agricultureEvents) {
      assert.ok(
        agricultureData.series.some((point) => point.year === event.year && point.month === event.month)
          || agricultureData.sampling?.missingMonths?.includes(`${event.year}-${String(event.month).padStart(2, "0")}`),
        `${event.id} falls in the observed period, including months with no accepted retrieval`,
      );
    }
    assert.ok(agricultureEvents.some((event) =>
      event.id === "nueva-ecija-2009-09-ondoy-crop-damage"
      && event.dataNote.includes("0.7844")
      && event.dataNote.includes("not crop-loss measurements"),
    ));
    assert.ok(agricultureEvents.some((event) =>
      event.id === "nueva-ecija-2016-05-rice-harvest-recovery"
      && event.sources.some((source) => source.publisher === "Food and Agriculture Organization"),
    ));
    assert.ok(agricultureEvents.some((event) =>
      event.id === "nueva-ecija-2022-09-karding-crop-damage"
      && event.dataNote.includes("not a before/after storm comparison"),
    ));
    assert.ok(agricultureEvents.some((event) =>
      event.id === "nueva-ecija-2024-01-dry-spell"
      && event.sources.some((source) => source.publisher === "Inquirer.net"),
    ));
    assert.ok(agricultureEvents.some((event) =>
      event.id === "nueva-ecija-2015-10-typhoon-lando-rice-damage"
      && event.dataNote.includes("0.4072")
      && event.sources.some((source) => source.url.includes("/733540/")),
    ));
    assert.ok(agricultureEvents.some((event) =>
      event.id === "nueva-ecija-2013-10-typhoon-santi-rice-losses"
      && event.dataNote.includes("no accepted August 2013 retrieval")
      && event.sources.some((source) => source.url.includes("?p=555513")),
    ));
    const nuevaEcijaLocation = locations.find((location) => location.id === "nueva-ecija-rice-belt");
    assert.ok(nuevaEcijaLocation.story.includes("wet-season planting window"));
    assert.ok(nuevaEcijaLocation.storySources.some((source) =>
      source.url.includes("/articles/XLII-4-W19/241/2019"),
    ));
    const benguetLocation = locations.find((location) => location.id === "benguet-vegetable-belt");
    assert.deepEqual(benguetLocation.lngLat, [120.588497, 16.4586141]);
    assert.ok(benguetLocation.dataScaleNote.includes("not strawberry yield"));
    const benguetData = JSON.parse(
      await readFile(new URL("../src/data/story-data/benguet-vegetable-belt.json", import.meta.url), "utf8"),
    );
    assert.equal(benguetData.locationId, benguetLocation.id);
    assert.equal(benguetData.source.url, "https://modis.ornl.gov/rst/");
    assert.ok(benguetData.source.product.includes("marginal-reliability"));
    assert.equal(benguetData.continuity.maximumInterpolatedGapMonths, 2);
    assert.ok(benguetData.references.some((reference) => reference.url === "https://doi.org/10.5067/MODIS/MOD13Q1.061"));
    assert.ok(benguetData.references.some((reference) => reference.url === "https://doi.org/10.5067/MODIS/MYD13Q1.061"));
    const terraAquaCheck = benguetData.sampling.terraAquaCrossCheck;
    assert.ok(terraAquaCheck.aquaSeries.length >= 100);
    assert.ok(
      terraAquaCheck.aquaSeries[0].year > 2002
        || (terraAquaCheck.aquaSeries[0].year === 2002 && terraAquaCheck.aquaSeries[0].month >= 7),
    );
    assert.ok(terraAquaCheck.aquaSeries.every((point) =>
      Number.isInteger(point.qualityCounts.goodSamples)
      && Number.isInteger(point.qualityCounts.marginalSamples)
      && point.qualityCounts.goodSamples + point.qualityCounts.marginalSamples > 0,
    ));
    assert.ok(terraAquaCheck.pairedPeriodMeans.some((period) =>
      period.period === "2020-01 onward" && period.pairedMonths > 0,
    ));
    assert.ok(terraAquaCheck.pairedPeriodMeans.some((period) =>
      period.period === "2002-07 to 2019-12" && period.pairedMonths > 0,
    ));
    assert.ok(terraAquaCheck.caveat.includes("not a calibrated correction"));
    assert.ok(benguetData.series.length >= 250, "Benguet has a long MODIS record");
    assert.deepEqual(
      [benguetData.series[0].year, benguetData.series[0].month],
      [2000, 2],
      "Benguet starts at the earliest available MODIS period",
    );
    assert.equal(benguetData.scaleNote, benguetLocation.dataScaleNote);
    const benguetEvents = notableEvents.filter((event) => event.locationId === benguetLocation.id);
    assert.equal(benguetEvents.length, 4);
    const benguetContextEvents = benguetEvents.filter((event) => event.kind === "context");
    assert.equal(benguetContextEvents.length, 3);
    assert.ok(benguetContextEvents.every((event) =>
      event.kind === "context"
      && event.evidenceStatus === "context only (satellite cannot show it)"
      && event.sources.length > 0
      && event.sources.every((source) => /^https:\/\//.test(source.url))
      && benguetData.series.some((point) => point.year === event.year && point.month === event.month),
    ));
    const benguetLowAnomaly = benguetEvents.find((event) => event.id === "benguet-2007-09-record-low-ndvi");
    assert.equal(benguetLowAnomaly.kind, "visible-in-data");
    assert.ok(benguetLowAnomaly.dataNote.includes("0.1242"));
    assert.ok(benguetData.series.some((point) => point.year === 2007 && point.month === 9 && point.value === 0.1242));
    assert.ok(benguetEvents.some((event) =>
      event.id === "benguet-2023-02-strawberry-farm-land-conversion"
      && event.dataNote.includes("-0.0016")
      && event.sources.some((source) => source.publisher === "HortiDaily, citing PNA"),
    ));
    const benguetStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "agriculture"),
        selectedLocation: benguetLocation,
        onNavigate() {},
      }),
    );
    assert.ok(benguetStory.includes("Ompong"), "Benguet story exposes its researched event marker");
    assert.ok(benguetStory.includes("GOOD / MARGINAL 16-DAY COMPOSITES"));
    assert.ok(benguetStory.includes("Terra/Aqua paired means"));
    assert.ok(benguetLocation.story.includes("one marginal-reliability composite"));
    const negrosLocation = locations.find((location) => location.id === "negros-sugarcane-belt");
    assert.deepEqual(negrosLocation.lngLat, [123.28, 10.94]);
    assert.ok(negrosLocation.dataScaleNote.includes("does not identify the crop as sugarcane"));
    const negrosData = JSON.parse(
      await readFile(new URL("../src/data/story-data/negros-sugarcane-belt.json", import.meta.url), "utf8"),
    );
    assert.equal(negrosData.locationId, negrosLocation.id);
    assert.equal(negrosData.source.url, "https://modis.ornl.gov/rst/");
    assert.ok(negrosData.source.product.includes("marginal-reliability"));
    assert.equal(negrosData.continuity.maximumInterpolatedGapMonths, 2);
    assert.ok(negrosData.references.some((reference) => reference.url === "https://doi.org/10.5067/MODIS/MOD13Q1.061"));
    assert.ok(negrosData.references.some((reference) => reference.url === "https://esa-worldcover.org/en/data-access"));
    assert.equal(negrosData.scaleNote, negrosLocation.dataScaleNote);
    assert.ok(negrosData.series.length >= 250, "Negros has a long MODIS record");
    assert.deepEqual(
      [negrosData.series[0].year, negrosData.series[0].month],
      [2000, 3],
      "Negros starts with its earliest month containing a valid retrieval",
    );
    const negrosEvents = notableEvents.filter((event) => event.locationId === negrosLocation.id);
    assert.equal(negrosEvents.length, 4);
    const negrosContextEvents = negrosEvents.filter((event) => event.kind === "context");
    assert.equal(negrosContextEvents.length, 3);
    assert.ok(negrosContextEvents.every((event) =>
      event.kind === "context"
      && event.evidenceStatus === "context only (satellite cannot show it)"
      && event.sources.length > 0
      && event.sources.every((source) => /^https:\/\//.test(source.url))
      && (event.month
        ? negrosData.series.some((point) => point.year === event.year && point.month === event.month)
        : negrosData.series.some((point) => point.year === event.year)),
    ));
    const negrosLowAnomaly = negrosEvents.find((event) => event.id === "negros-2014-05-record-low-ndvi");
    assert.equal(negrosLowAnomaly.kind, "visible-in-data");
    assert.ok(negrosLowAnomaly.dataNote.includes("0.2046"));
    assert.ok(negrosData.series.some((point) => point.year === 2014 && point.month === 5 && point.value === 0.2046));
    assert.ok(negrosEvents.some((event) =>
      event.id === "negros-2024-03-el-nino-drought-sugarcane"
      && event.dataNote.includes("0.48505")
      && event.dataNote.includes("no accepted June retrieval")
      && event.sources.some((source) => source.publisher === "Philstar.com")
      && event.sources.some((source) => source.publisher === "Inquirer.net"),
    ));
    assert.ok(negrosEvents.some((event) =>
      event.id === "negros-2015-16-el-nino-drought-sugarcane"
      && event.dataNote.includes("0.2380")
      && event.sources.some((source) => source.publisher === "The Freeman / Philstar.com"),
    ));
    assert.ok(negrosEvents.some((event) =>
      event.id === "negros-2025-11-typhoon-tino-sugar-losses"
      && event.dataNote.includes("0.7082")
      && event.dataNote.includes("0.4733, 0.4788, and 0.4653")
      && event.sources.some((source) => source.publisher === "Daily Guardian")
      && event.sources.some((source) => source.publisher === "Negros Now Daily"),
    ));
    const negrosStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "agriculture"),
        selectedLocation: negrosLocation,
        onNavigate() {},
      }),
    );
    assert.ok(negrosStory.includes("Tino"), "Negros story exposes its researched event marker");
    const boholLocation = locations.find((location) => location.id === "bohol-ube-landscape");
    assert.deepEqual(boholLocation.lngLat, [124.15, 9.85]);
    assert.ok(boholLocation.dataScaleNote.includes("not a verified ube field"));
    assert.ok(boholLocation.storySources.some((source) =>
      source.publisher === "The Manila Times via Newswav"
      && source.date === "12 Jun 2026"
      && source.url === "https://newswav.com/article/agog-over-ube-A2606_oURFI4",
    ));
    const boholData = JSON.parse(
      await readFile(new URL("../src/data/story-data/bohol-ube-landscape.json", import.meta.url), "utf8"),
    );
    assert.equal(boholData.locationId, boholLocation.id);
    assert.equal(boholData.source.url, "https://modis.ornl.gov/rst/");
    assert.ok(boholData.source.product.includes("marginal-reliability"));
    assert.equal(boholData.continuity.maximumInterpolatedGapMonths, 2);
    assert.equal(boholData.scaleNote, boholLocation.dataScaleNote);
    assert.ok(boholData.series.length >= 240, "Bohol has a long MODIS record");
    assert.deepEqual(
      [boholData.series[0].year, boholData.series[0].month],
      [2000, 3],
      "Bohol starts at the earliest available MODIS period",
    );
    assert.deepEqual(
      [boholData.series.at(-1).year, boholData.series.at(-1).month],
      [2026, 10],
      "Bohol extends through the latest complete month",
    );
    assert.equal(boholLocation.dataWindow, "Mar 2000—Oct 2026");
    assert.ok(boholData.references.some((reference) => reference.product.includes("ubi kinampay")));
    assert.ok(boholData.references.some((reference) => reference.product.includes("distribution of planting materials")));
    assert.ok(boholData.references.some((reference) => reference.url === "https://newswav.com/article/agog-over-ube-A2606_oURFI4"));
    assert.ok(boholLocation.story.includes("area fell 17.1% and output fell 6.7%"));
    assert.ok(boholLocation.story.includes("Neither that trend nor the MODIS series identifies what is planted"));
    const boholEvents = notableEvents.filter((event) => event.locationId === boholLocation.id);
    assert.equal(boholEvents.length, 5);
    const boholContexts = boholEvents.filter((event) => event.kind === "context");
    assert.equal(boholContexts.length, 4);
    assert.ok(boholContexts.every((event) =>
      event.evidenceStatus === "context only (satellite cannot show it)"
      && event.sources.length > 0
      && event.sources.every((source) => /^https:\/\//.test(source.url))
      && (boholData.series.some((point) => point.year === event.year && point.month === event.month)
        || boholData.sampling?.missingMonths?.includes(`${event.year}-${String(event.month).padStart(2, "0")}`)),
    ));
    assert.ok(boholEvents.some((event) =>
      event.id === "bohol-ube-2016-02-yam-during-drought"
      && event.description.includes("does not identify the yam as Ubi Kinampay"),
    ));
    assert.ok(boholEvents.some((event) =>
      event.id === "bohol-ube-2026-06-production-expansion"
      && event.sources.some((source) => source.publisher === "BusinessWorld Online"),
    ));
    assert.ok(boholEvents.some((event) =>
      event.id === "bohol-ube-2026-10-drought-crop-losses"
      && event.sources.some((source) => source.publisher === "Inquirer.net"),
    ));
    assert.ok(boholEvents.some((event) =>
      event.id === "bohol-ube-2024-05-el-nino-crop-losses"
      && event.dataNote.includes("0.4792")
      && event.dataNote.includes("0.6712")
      && event.sources.some((source) => source.url.includes("?p=2020432")),
    ));
    const boholLowest = boholData.series.reduce((lowest, point) =>
      point.value < lowest.value ? point : lowest,
    );
    const boholAnomaly = boholEvents.find((event) => event.id === "bohol-ube-record-low-ndvi");
    assert.deepEqual([boholAnomaly.year, boholAnomaly.month], [boholLowest.year, boholLowest.month]);
    assert.ok(boholAnomaly.dataNote.includes(String(boholLowest.value)));
    const boholStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "agriculture"),
        selectedLocation: boholLocation,
        onNavigate() {},
      }),
    );
    assert.ok(boholStory.includes("yam"), "Bohol story includes its researched crop context");
    assert.ok(boholStory.includes("drought"), "Bohol story includes its drought marker");
    assert.ok(boholStory.includes("The Manila Times via Newswav"), "Bohol national ube statistics are sourced in the story");
    const banaueLocation = locations.find((location) => location.id === "banaue-rice-terraces");
    assert.deepEqual(banaueLocation.lngLat, [121.06, 16.913]);
    assert.ok(banaueLocation.dataScaleNote.includes("not a mapped rice paddy"));
    const banaueData = JSON.parse(
      await readFile(new URL("../src/data/story-data/banaue-rice-terraces.json", import.meta.url), "utf8"),
    );
    assert.equal(banaueData.locationId, banaueLocation.id);
    assert.equal(banaueData.source.url, "https://modis.ornl.gov/rst/");
    assert.ok(banaueData.source.product.includes("marginal-reliability"));
    assert.equal(banaueData.continuity.maximumInterpolatedGapMonths, 2);
    assert.equal(banaueData.scaleNote, banaueLocation.dataScaleNote);
    assert.ok(banaueData.series.length >= 280, "Banaue has a long MODIS record");
    assert.deepEqual(
      [banaueData.series[0].year, banaueData.series[0].month],
      [2000, 3],
      "Banaue starts with the earliest valid Terra MODIS month",
    );
    assert.deepEqual(
      [banaueData.series.at(-1).year, banaueData.series.at(-1).month],
      [2026, 10],
      "Banaue extends through the latest complete month",
    );
    assert.equal(banaueLocation.dataWindow, "Mar 2000—Oct 2026");
    assert.ok(banaueData.references.some((reference) => reference.url === "https://whc.unesco.org/en/list/722/"));
    const banaueEvents = notableEvents.filter((event) => event.locationId === banaueLocation.id);
    assert.equal(banaueEvents.length, 4);
    assert.ok(banaueEvents.every((event) =>
      event.sources.length > 0
      && event.sources.every((source) => /^https:\/\//.test(source.url))
      && (event.month
        ? banaueData.series.some((point) => point.year === event.year && point.month === event.month)
        : banaueData.series.some((point) => point.year === event.year)),
    ));
    assert.ok(banaueEvents.some((event) =>
      event.id === "banaue-2001-unesco-danger-list"
      && event.description.includes("from 2001 to 2012")
      && event.sources.some((source) => source.publisher === "UNESCO World Heritage Centre"),
    ));
    assert.ok(banaueEvents.some((event) =>
      event.id === "banaue-2011-batad-landslide"
      && event.dataNote.includes("0.6204")
      && event.sources.some((source) => source.publisher === "AFP via Phys.org"),
    ));
    const banaueMinimum = banaueData.series.reduce((lowest, point) =>
      point.value < lowest.value ? point : lowest,
    );
    const banaueMaximum = banaueData.series.reduce((highest, point) =>
      point.value > highest.value ? point : highest,
    );
    const banaueLowEvent = banaueEvents.find((event) => event.id === "banaue-2004-12-record-low-ndvi");
    const banaueHighEvent = banaueEvents.find((event) => event.id === "banaue-2016-06-record-high-ndvi");
    assert.deepEqual([banaueLowEvent.year, banaueLowEvent.month], [banaueMinimum.year, banaueMinimum.month]);
    assert.deepEqual([banaueHighEvent.year, banaueHighEvent.month], [banaueMaximum.year, banaueMaximum.month]);
    const banaueStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "agriculture"),
        selectedLocation: banaueLocation,
        onNavigate() {},
      }),
    );
    assert.ok(banaueStory.includes("Danger List"), "Banaue story exposes its UNESCO context marker");
    assert.ok(banaueStory.includes("Landslide damages Batad"), "year-only landslide context is mapped");
    assert.ok(banaueStory.includes("Banaue area landscape sample"), "Banaue story separates this sample from the UNESCO site");
    const agricultureStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "agriculture"),
        selectedLocation: locations.find((item) => item.id === "nueva-ecija-rice-belt"),
        onNavigate() {},
      }),
    );
    assert.ok(agricultureStory.includes("Ondoy"), "agriculture story exposes its researched event marker");
    const taclobanLocation = locations.find((location) => location.id === "tacloban-leyte");
    assert.deepEqual(taclobanLocation.lngLat, [125.0082936, 11.2431609]);
    assert.equal(taclobanLocation.name, "Tacloban City, Leyte");
    assert.equal(taclobanLocation.dataWindow, "Jan 2000—Oct 2026");
    assert.ok(taclobanLocation.story.includes("precipitation reanalysis (2000 through September 2026)"));
    assert.ok(taclobanLocation.story.includes("nighttime radiance (January 2012 through October 2026)"));
    const taclobanRainfallDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/tacloban-leyte.json", import.meta.url), "utf8"),
    );
    assert.equal(taclobanRainfallDataset.datasetId, "tacloban-precipitation");
    assert.equal(taclobanRainfallDataset.source.mission, "NASA POWER / NASA GMAO MERRA-2");
    assert.ok(taclobanRainfallDataset.scaleNote.includes("not a direct satellite-only retrieval"));
    assert.equal(locations.some((location) => location.id === "tacloban-haiyan"), false);
    assert.equal(locations.filter((location) =>
      location.themeId === "disasters" && location.lngLat[0] === 125.0082936 && location.lngLat[1] === 11.2431609,
    ).length, 1, "Tacloban City, Leyte appears once in the disaster locations");
    const haiyanDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/tacloban-haiyan.json", import.meta.url), "utf8"),
    );
    assert.equal(haiyanDataset.locationId, "tacloban-leyte");
    assert.equal(haiyanDataset.datasetId, "tacloban-leyte-nighttime-radiance");
    assert.equal(haiyanDataset.sampling.minimumValidPixelsPerMonth, 10);
    assert.ok(haiyanDataset.series.every((point) => point.validPixelSamples >= 10));
    assert.equal(haiyanDataset.series.length, 162);
    assert.deepEqual(
      [
        haiyanDataset.series[0].year,
        haiyanDataset.series[0].month,
        haiyanDataset.series.at(-1).year,
        haiyanDataset.series.at(-1).month,
      ],
      [2012, 1, 2026, 10],
    );
    assert.ok(haiyanDataset.series.some((point) => point.year === 2013 && point.month === 11 && point.validPixelSamples > 0));
    assert.equal(haiyanDataset.series.some((point) => point.year === 2013 && point.month === 6), false);
    const taclobanRainfallStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "disaster"),
        selectedLocation: taclobanLocation,
        onNavigate() {},
      }),
    );
    assert.ok(taclobanRainfallStory.includes(">NIGHTTIME RADIANCE</button>"));
    assert.ok(!taclobanRainfallStory.includes(">WIND</button>"));
    assert.ok(taclobanLocation.story.includes("cannot isolate an event-night response"));
    const surigaoLocation = locations.find((location) => location.id === "surigao-city");
    assert.ok(surigaoLocation);
    assert.equal(surigaoLocation.themeId, "disasters");
    assert.equal(surigaoLocation.name, "Surigao City · Night Lights Through Change");
    assert.deepEqual(surigaoLocation.lngLat, [125.4888, 9.7843]);
    assert.equal(surigaoLocation.dataWindow, "Jan 2012—Oct 2026");
    assert.ok(surigaoLocation.story.includes("from 2012 through October 2026"));
    assert.ok(surigaoLocation.story.includes("remains unexplained"));
    assert.ok(surigaoLocation.story.includes("not established causes"));
    assert.ok(surigaoLocation.story.includes("does not corroborate the monthly zero"));
    assert.ok(!surigaoLocation.story.includes("before and after Odette"));
    assert.ok(surigaoLocation.dataScaleNote.includes("linearly estimated for chart and audio continuity"));
    const odetteDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/surigao-city.json", import.meta.url), "utf8"),
    );
    assert.equal(odetteDataset.locationId, "surigao-city");
    assert.equal(odetteDataset.datasetId, "surigao-city-nighttime-radiance");
    assert.equal(odetteDataset.sampling.minimumValidPixelsPerMonth, 35);
    assert.ok(odetteDataset.series.every((point) => point.validPixelSamples >= 35));
    assert.equal(odetteDataset.series.length, 134);
    assert.ok(!odetteDataset.series.some((point) =>
      (point.year === 2020 && point.month === 10)
      || (point.year === 2021 && point.month === 1)
      || (point.year === 2022 && point.month === 11),
    ), "low-support Surigao spikes are excluded");
    assert.ok(odetteDataset.sampling.rejectedLowSupportMonths.some((point) =>
      point.month === "2022-02" && point.validPixelSamples === 3,
    ));
    assert.ok(odetteDataset.sampling.rejectedLowSupportMonths.some((point) =>
      point.month === "2017-02" && point.validPixelSamples === 25,
    ));
    assert.ok(odetteDataset.sampling.rejectedLowSupportMonths.some((point) =>
      point.month === "2021-12" && point.validPixelSamples === 30,
    ));
    assert.equal(odetteDataset.series.some((point) => point.year === 2021 && point.month === 12), false);
    assert.ok(odetteDataset.series.some((point) => point.year === 2020));
    assert.ok(odetteDataset.series.some((point) => point.year === 2022));
    assert.deepEqual(odetteDataset.continuity, {
      method: "Linear interpolation between adjacent valid monthly observations for interior gaps of at most two months; source observations remain unchanged.",
      maximumInterpolatedGapMonths: 2,
    });
    assert.equal(odetteDataset.series[0].year, 2012);
    assert.equal(odetteDataset.series[0].month, 1);
    assert.equal(odetteDataset.series.at(-1).year, 2026);
    assert.equal(odetteDataset.series.at(-1).month, 10);
    assert.ok(!odetteDataset.series.some((point) => point.isInterpolated), "the downloaded series contains source observations only");
    const dailyCrossCheck = odetteDataset.sampling.dailyCrossCheck;
    assert.equal(dailyCrossCheck.product, "VNP46A2.002 daily Black Marble");
    assert.equal(dailyCrossCheck.daysWithGranules, 31);
    assert.equal(dailyCrossCheck.daysMeetingMinimumSupport, 11);
    const supportedDailySamples = dailyCrossCheck.dailySamples.filter((point) =>
      point.validPixelSamples >= dailyCrossCheck.minimumValidPixelsPerDay,
    );
    assert.ok(supportedDailySamples.every((point) => point.medianRadiance > 0));
    assert.ok(odetteDataset.references.some((reference) =>
      reference.url === "https://doi.org/10.5067/VIIRS/VNP46A2.002",
    ));
    assert.deepEqual(
      [
        Math.min(...supportedDailySamples.map((point) => point.medianRadiance)),
        Math.max(...supportedDailySamples.map((point) => point.medianRadiance)),
      ],
      [0.235336, 0.957849],
    );
    const cagayanLocation = locations.find((location) => location.id === "cagayan-de-oro");
    assert.ok(cagayanLocation);
    assert.equal(cagayanLocation.themeId, "disasters");
    assert.deepEqual(cagayanLocation.lngLat, [124.6319, 8.4542]);
    assert.equal(cagayanLocation.dataWindow, "Jan 1998—Sep 2025");
    assert.ok(cagayanLocation.story.includes("from January 1998 through September 2025"));
    const cagayanDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/cagayan-de-oro.json", import.meta.url), "utf8"),
    );
    assert.equal(cagayanDataset.series.length, 333);
    assert.deepEqual(
      [cagayanDataset.series[0].year, cagayanDataset.series[0].month, cagayanDataset.series.at(-1).year, cagayanDataset.series.at(-1).month],
      [1998, 1, 2025, 9],
    );
    assert.equal(cagayanDataset.datasetId, "cagayan-de-oro-gpm-imerg");
    assert.equal(cagayanDataset.source.mission, "NASA GPM IMERG");
    assert.ok(cagayanDataset.scaleNote.includes("monthly gauge adjustment"));
    const cagayanEvents = notableEvents.filter((event) => event.locationId === "cagayan-de-oro");
    assert.equal(cagayanEvents.length, 3);
    assert.ok(cagayanEvents.every((event) => event.kind === "context"));
    assert.ok(cagayanEvents.some((event) => event.id === "cagayan-de-oro-2009-01-flood" && event.sources.some((source) => source.url.includes("10.1007/s11069-021-04934-z"))));
    assert.ok(cagayanEvents.some((event) => event.id === "cagayan-de-oro-2011-12-sendong" && event.sources.some((source) => source.url.includes("10.1016/j.geoforum.2022.07.003"))));
    assert.ok(cagayanEvents.every((event) => event.dataNote.includes("NASA GPM IMERG")));
    assert.ok(cagayanEvents.filter((event) => event.id !== "cagayan-de-oro-2026-02-basyang").every((event) => event.dataNote.includes("cannot")));
    assert.ok(cagayanEvents.find((event) => event.id === "cagayan-de-oro-2026-02-basyang").dataNote.includes("do not verify"));
    const sendongEvent = cagayanEvents.find((event) => event.id === "cagayan-de-oro-2011-12-sendong");
    assert.ok(sendongEvent.dataNote.includes("368.280 mm"));
    assert.ok(sendongEvent.dataNote.includes("475 mm"));
    assert.ok(sendongEvent.sources.some((source) => source.url.includes("gpm.nasa.gov/mission-updates")));
    const sendongDaily = cagayanDataset.sampling.sendongDailyRainfall;
    assert.equal(sendongDaily.product, "GPM_3IMERGDF.07 Final Run daily precipitation");
    assert.deepEqual(
      sendongDaily.dailySamples.map(({ date, value, unit }) => [date, value, unit]),
      [
        ["2011-12-13", 7.375, "mm/day"],
        ["2011-12-14", 0.325, "mm/day"],
        ["2011-12-15", 0.735, "mm/day"],
        ["2011-12-16", 113.735, "mm/day"],
        ["2011-12-17", 14.29, "mm/day"],
        ["2011-12-18", 3.185, "mm/day"],
        ["2011-12-19", 0.11, "mm/day"],
        ["2011-12-20", 0.29, "mm/day"],
      ],
    );
    assert.deepEqual(sendongDaily.gridCellCenter, { latitude: 8.45, longitude: 124.65 });
    assert.ok(sendongEvent.dataNote.includes("08:00 16 Dec to 08:00 17 Dec"));
    const angatLocation = locations.find((location) => location.id === "angat-dam");
    assert.ok(angatLocation);
    assert.equal(angatLocation.themeId, "water-resources");
    assert.deepEqual(angatLocation.lngLat, [121.1960013, 14.9740434]);
    assert.ok(angatLocation.story.includes("not dam elevation, stored volume, or water supply"));
    const angatDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/angat-dam.json", import.meta.url), "utf8"),
    );
    const pantabanganLocation = locations.find((location) => location.id === "pantabangan-dam");
    assert.ok(pantabanganLocation);
    assert.equal(pantabanganLocation.themeId, "water-resources");
    assert.deepEqual(pantabanganLocation.lngLat, [121.1388438, 15.8536949]);
    assert.ok(pantabanganLocation.story.includes("not dam elevation, stored volume"));
    const pantabanganDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/pantabangan-dam.json", import.meta.url), "utf8"),
    );
    const macabebeLocation = locations.find((location) => location.id === "macabebe-delta");
    assert.ok(macabebeLocation);
    assert.equal(macabebeLocation.themeId, "water-resources");
    assert.deepEqual(macabebeLocation.lngLat, [120.7149803, 14.9081836]);
    assert.ok(macabebeLocation.story.includes("not the delta-wide rice-to-fishpond transition"));
    assert.ok(macabebeLocation.story.includes("aggregate is not an estimate of converted farmland"));
    assert.ok(macabebeLocation.story.includes("cannot distinguish fishponds from canals"));
    assert.equal(macabebeLocation.storySources.length, 2);
    assert.ok(macabebeLocation.storySources.some((source) => source.url.includes("resilience.up.edu.ph")));
    assert.ok(macabebeLocation.dataScaleNote.includes("not corrected for tide or seasonal inundation"));
    const macabebeDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/macabebe-delta.json", import.meta.url), "utf8"),
    );
    assert.equal(macabebeDataset.locationId, "macabebe-delta");
    assert.equal(macabebeDataset.metric, "monthly_mapped_water_area");
    assert.equal(macabebeDataset.unit, "km2");
    assert.ok(macabebeDataset.scaleNote.includes("current municipal boundary"));
    assert.ok(macabebeDataset.scaleNote.includes("cannot distinguish fishponds"));
    assert.ok(macabebeDataset.scaleNote.includes("not an estimate of land converted to fishponds"));
    assert.ok(macabebeDataset.scaleNote.includes("not corrected for tide or seasonal inundation"));
    assert.ok(macabebeDataset.references.some((source) => source.url.includes("openstreetmap.org/relation/16253334")));
    assert.ok(macabebeDataset.series.length > 0);
    const macabebeEvents = notableEvents.filter((event) => event.locationId === "macabebe-delta");
    assert.equal(macabebeEvents.length, 2);
    assert.ok(macabebeEvents.every((event) => event.kind === "context"));
    assert.ok(macabebeEvents.every((event) => event.dataNote.includes("cannot")));
    for (const [locationId, dataset, relationId] of [
      ["angat-dam", angatDataset, 2970167],
      ["pantabangan-dam", pantabanganDataset, 2460576],
    ]) {
      assert.equal(dataset.locationId, locationId);
      assert.equal(dataset.metric, "monthly_mapped_water_area");
      if (locationId === "angat-dam") {
        const zeroAreaPoint = dataset.series.find((point) => point.year === 2004 && point.month === 4);
        assert.equal(zeroAreaPoint.value, 0);
        assert.ok(zeroAreaPoint.reviewNote?.includes("Verify the imagery"));
      }
      assert.equal(dataset.unit, "km2");
      assert.equal(dataset.source.mission, "NASA/USGS Landsat");
      assert.ok(dataset.source.product.includes("Landsat Collection 2 Level-2"));
      assert.ok(dataset.scaleNote.includes("not dam elevation"));
      assert.ok(dataset.references.some((source) => source.url.includes(`openstreetmap.org/relation/${relationId}`)));
      assert.ok(dataset.references.some((source) => source.url.includes("doi.org/10.5066/P9IAXOVV")));
      assert.ok(dataset.references.some((source) => source.url.includes("planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2")));
      assert.ok(
        dataset.series.length >= (locationId === "angat-dam" ? 100 : 280),
        `${locationId} retains the currently verified multi-decade Landsat record`,
      );
      assert.deepEqual([dataset.series[0].year, dataset.series[0].month], [1987, 12]);
      assert.ok(dataset.series.at(-1).year >= 2026);
      assert.ok(dataset.series.every((point) =>
        Number.isFinite(point.value) && point.value >= 0
        && Number.isInteger(point.validPixelSamples) && point.validPixelSamples > 0,
      ));
      if (dataset.series[0].validSceneCount !== undefined) {
        assert.ok(dataset.sampling.selectedScenes.every((month) =>
          month.validSceneCount > 0
          && month.validSceneCount === month.scenes.length
          && month.medianValidCoverage >= 0.8
          && month.scenes.every((scene) =>
            scene.validCoverage >= 0.8
            && typeof scene.acquired === "string"
            && typeof scene.scene === "string",
          ),
        ));
      } else {
        assert.ok(dataset.sampling.selectedScenes.every((scene) => scene.validCoverage >= 0.8));
        assert.ok(dataset.sampling.selectedScenes.every((scene) =>
          scene.candidatesEvaluated >= 1 && scene.candidatesAvailable >= scene.candidatesEvaluated
          && typeof scene.acquired === "string" && typeof scene.scene === "string",
        ));
      }
      assert.equal(dataset.sampling.selectedScenes.length, dataset.series.length);
      assert.ok(dataset.sampling.missingMonths.every((month) =>
        !dataset.series.some((point) => `${point.year}-${String(point.month).padStart(2, "0")}` === month),
      ));
      assert.ok(dataset.sampling.networkErrors.every((failure) =>
        !/(?:sig=|[?&](?:se|sp|spr|sr|st|sv|skt|ske|sks|skv)=)/i.test(failure.error),
      ));
      assert.equal(dataset.continuity.maximumInterpolatedGapMonths, 2);
    }
    const angatEvents = notableEvents.filter((event) => event.locationId === "angat-dam");
    assert.equal(angatEvents.length, 3);
    assert.ok(angatEvents.every((event) =>
      `${event.year}-${String(event.month).padStart(2, "0")}` >= "2024-09"
      && `${event.year}-${String(event.month).padStart(2, "0")}` <= "2026-10",
    ));
    assert.ok(angatEvents.every((event) => event.kind === "context"));
    assert.ok(angatEvents.every((event) => event.evidenceStatus === "context only (satellite cannot show it)"));
    assert.ok(angatEvents.some((event) => event.sources.some((source) => source.publisher === "SunStar")));
    assert.ok(angatEvents.some((event) => event.sources.some((source) => source.publisher === "GMA Network")));
    assert.ok(angatEvents.some((event) => event.sources.some((source) => source.publisher === "BusinessWorld Online")));
    assert.ok(angatEvents.every((event) => event.dataNote.includes("not measured") || event.dataNote.includes("cannot be inferred")));
    const pantabanganEvents = notableEvents.filter((event) => event.locationId === "pantabangan-dam");
    assert.equal(pantabanganEvents.length, 3);
    assert.ok(pantabanganEvents.every((event) => event.kind === "context"));
    assert.ok(pantabanganEvents.every((event) =>
      event.evidenceStatus === "context only (satellite cannot show it)"
      && event.dataNote.includes("not") && event.sources.length > 0,
    ));
    assert.ok(pantabanganEvents.some((event) => event.id === "pantabangan-dam-2024-04-old-town-emerges"));
    assert.ok(pantabanganEvents.some((event) => event.id === "pantabangan-dam-2026-07-water-loss"));
    const surigaoHtml = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((item) => item.id === "disaster"),
        selectedLocation: surigaoLocation,
        onNavigate() {},
      }),
    );
    assert.ok(surigaoHtml.includes("ESTIMATED"));
    assert.ok(surigaoHtml.includes("those estimates are not observations"));
    const bridgedGap = interpolateShortMonthlyGaps([
      { year: 2020, month: 1, value: 10 },
      { year: 2020, month: 4, value: 40 },
    ], 2);
    assert.deepEqual(
      bridgedGap.slice(1, 3).map(({ year, month, value, interpolatedValue, isInterpolated }) =>
        ({ year, month, value, interpolatedValue, isInterpolated })),
      [
        { year: 2020, month: 2, value: null, interpolatedValue: 20, isInterpolated: true },
        { year: 2020, month: 3, value: null, interpolatedValue: 30, isInterpolated: true },
      ],
    );
    const unbridgedGap = interpolateShortMonthlyGaps([
      { year: 2020, month: 1, value: 10 },
      { year: 2020, month: 5, value: 50 },
    ], 2);
    assert.deepEqual(unbridgedGap.slice(1, 4).map(({ value, interpolatedValue }) => ({ value, interpolatedValue })), [
      { value: null, interpolatedValue: undefined },
      { value: null, interpolatedValue: undefined },
      { value: null, interpolatedValue: undefined },
    ], "gaps longer than the configured maximum remain unfilled");
    assert.equal(normalizeSelectedMonth(bridgedGap, 2020, 2, new Date("2021-01-01T00:00:00Z")), 1 / 3,
      "the estimated month can be sonified using a range based only on observed readings");
    assert.equal(normalizeSelectedMonth(unbridgedGap, 2020, 2, new Date("2021-01-01T00:00:00Z")), null,
      "a long missing month remains unavailable to sonification");
    const novemberOdette = odetteDataset.series.find((point) => point.year === 2021 && point.month === 11);
    const decemberOdette = odetteDataset.series.find((point) => point.year === 2021 && point.month === 12);
    const januaryOdette = odetteDataset.series.find((point) => point.year === 2022 && point.month === 1);
    const februaryOdette = odetteDataset.series.find((point) => point.year === 2022 && point.month === 2);
    assert.deepEqual(
      [novemberOdette.value, novemberOdette.validPixelSamples],
      [2.24068, 49],
    );
    assert.equal(decemberOdette, undefined, "the 30-pixel December estimate fails the monthly support rule");
    assert.deepEqual(
      [januaryOdette.value, januaryOdette.validPixelSamples],
      [0, 46],
    );
    assert.equal(februaryOdette, undefined, "the three-pixel February estimate fails the monthly support rule");
    const surigaoEvents = notableEvents.filter((event) => (event.locationIds ?? [event.locationId]).includes("surigao-city"));
    assert.equal(surigaoEvents.length, 2);
    const odetteEvent = surigaoEvents.find((event) => event.id === "surigao-city-2021-12-odette-landfall");
    const earthquakeEvent = surigaoEvents.find((event) => event.id === "surigao-city-2017-02-earthquake");
    assert.ok(odetteEvent);
    assert.ok(earthquakeEvent);
    assert.deepEqual(
      { year: earthquakeEvent.year, month: earthquakeEvent.month, day: earthquakeEvent.day },
      { year: 2017, month: 2, day: 10 },
    );
    assert.ok(earthquakeEvent.sources.some((source) => source.url.includes("us20008ixa")));
    assert.ok(earthquakeEvent.dataNote.includes("25 valid pixels"));
    assert.ok(earthquakeEvent.sources.some((source) => source.url.includes("FS2017-E-0001.pdf")));
    assert.deepEqual(
      { year: odetteEvent.year, month: odetteEvent.month, day: odetteEvent.day },
      { year: 2021, month: 12, day: 16 },
    );
    assert.ok(odetteEvent.description.includes("not specific to Surigao City"));
    assert.ok(odetteEvent.description.includes("not broken down by region"));
    assert.ok(odetteEvent.dataNote.includes("positive medians"));
    assert.ok(odetteEvent.dataNote.includes("does not corroborate the monthly zero"));
    assert.ok(odetteEvent.dataNote.toLowerCase().includes("neither product establishes an outage or recovery"));
    assert.ok(odetteEvent.sources.some((source) => source.url.includes("typhoon-rai-odette-philippines-flash-update-3")));
    assert.ok(odetteEvent.sources.some((source) => source.url.includes("philippines-super-typhoon-rai-100-days-after")));
    const leyteGulf = locations.find((location) => location.id === "leyte-gulf-tacloban");
    assert.equal(leyteGulf.themeId, "sea-level");
    assert.equal(leyteGulf.name, "Leyte Gulf · Tacloban coast");
    assert.deepEqual(leyteGulf.lngLat, [125.0082936, 11.2431609]);
    assert.equal(leyteGulf.zoom, 9);
    assert.equal(leyteGulf.pitch, 35);
    assert.equal(leyteGulf.blurb, "A Pacific-facing gulf where a changing sea meets one of the most storm-exposed coasts in the country.");
    assert.equal(leyteGulf.story, "Satellite altimetry measures the height of the open water of Leyte Gulf over time. It does not measure the shoreline of San Pedro Bay, and a one-day storm surge cannot show up in a monthly average.");
    assert.equal(leyteGulf.dataScaleNote, "The selected NASA-SSH 0.5° open-water grid cell centered at 10.75°N, 125.25°E is about 60.85 km from Tacloban. Satellite altimetry measures regional sea-surface height, not street-level flood risk or storm surge.");
    const manilaBay = locations.find((location) => location.id === "manila-bay");
    assert.ok(manilaBay.dataScaleNote.includes("NASA altimetry measures the open-water surface. Tide gauges at the shoreline record higher rates (about 13 mm/yr at Manila in one study)."));
    const davao = locations.find((location) => location.id === "davao-mindanao");
    assert.equal(davao.themeId, "sea-level");
    assert.equal(davao.name, "Davao, Mindanao");
    assert.deepEqual(davao.lngLat, [125.6128, 7.0731]);
    assert.equal(davao.zoom, 9);
    assert.equal(davao.pitch, 35);
    assert.ok(davao.story.includes("+6.1 mm/year in 1969–1988 and +1.3 mm/year in 1989–2014"));
    assert.ok(davao.story.includes("biennial in the 1970s to interannual in the 1980s"));
    assert.ok(davao.story.includes("NASA-SSH begins in October 1992"));
    assert.ok(locations.some((location) => location.id === davao.id && location.themeId === "sea-level"));
    const davaoDataset = JSON.parse(
      await readFile(new URL("../src/data/story-data/davao-mindanao.json", import.meta.url), "utf8"),
    );
    assert.equal(davaoDataset.source.url, "https://podaac.jpl.nasa.gov/dataset/NASA_SSH_REF_SIMPLE_GRID_V1");
    assert.equal(davaoDataset.scaleNote, davao.dataScaleNote);
    const march2023Davao = davaoDataset.series.find((point) => point.year === 2023 && point.month === 3);
    assert.ok(march2023Davao && Number.isFinite(march2023Davao.value), "Davao March 2023 has an observed numeric value");
    assert.ok(davaoEvents.every((event) => davaoDataset.series.some((point) =>
      point.year === event.year && point.month === event.month && Number.isFinite(point.value),
    )), "every Davao event aligns with an observed dataset month");
    assert.equal(davaoEvents[0].sources.length, 2);
    assert.ok(davaoEvents[0].sources.every((source) => /^https:\/\//.test(source.url)));
    const davaoStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((theme) => theme.id === "sea"),
        selectedLocation: davao,
        onNavigate() {},
      }),
    );
    assert.ok(davaoStory.includes("The Ocean Has Its Own Rhythm: Davao and the Changing Mindanao Current"));
    assert.equal((davaoStory.match(/notable-event-marker/g) ?? []).length, 1, "the Davao chart renders its single verified marker");
    assert.ok(davaoStory.includes("Zoom in on Davao, Mindanao"));
    assert.ok(davaoStory.includes("Zoom out on Davao, Mindanao"));
    const zoomRequests = [];
    const removeZoomHandler = setMapZoomHandler((delta) => zoomRequests.push(delta));
    requestMapZoom(1);
    requestMapZoom(-1);
    removeZoomHandler();
    assert.deepEqual(zoomRequests, [1, -1]);
    const taclobanHaiyanStory = renderToStaticMarkup(
      createElement(StoryDetail, {
        initialTheme: themes.find((theme) => theme.id === "disaster"),
        selectedLocation: taclobanLocation,
        initialMetric: "tertiary",
        onNavigate() {},
      }),
    );
    assert.ok(taclobanHaiyanStory.includes("Before the record"));
    assert.ok(taclobanHaiyanStory.includes("In October 1897 an unnamed typhoon on a similar path caused a surge of up to 7 m and an estimated 1,228 deaths."));
    assert.ok(taclobanHaiyanStory.includes("https://doi.org/10.1175/BAMS-D-14-00245.1"));

    const monthlySeries = [
      { year: 2023, month: 1, value: 10 },
      { year: 2023, month: 2, value: 20 },
      { year: 2024, month: 1, value: 100 },
      { year: 2024, month: 2, value: null },
    ];
    const currentDate = new Date("2024-01-15T00:00:00Z");
    assert.equal(normalizeSelectedMonth(monthlySeries, 2023, 1, currentDate), 0);
    assert.equal(normalizeSelectedMonth(monthlySeries, 2023, 2, currentDate), 1);
    assert.equal(normalizeSelectedMonth(monthlySeries, 2024, 1, currentDate), 1, "partial current-year values clamp to the completed-month range");
    assert.equal(normalizeSelectedMonth(monthlySeries, 2024, 2, currentDate), null, "missing monthly observations are skipped");

    const updates = [];
    const fakeEngine = { update: (...values) => updates.push(values) };
    updateEngineForMonth(fakeEngine, monthlySeries, 2023, 1, undefined, currentDate);
    updateEngineForMonth(fakeEngine, monthlySeries, 2023, 2, undefined, currentDate);
    assert.deepEqual(updates, [[0, undefined], [1, undefined]], "selected months send their normalized values to the engine");

    const rainSeries = [{ year: 2023, month: 1, value: 100 }, { year: 2023, month: 2, value: 200 }];
    const windSeries = [{ year: 2023, month: 1, value: 12 }, { year: 2023, month: 2, value: 4 }];
    const stormUpdates = [];
    const stormEngine = { update: (...values) => stormUpdates.push(values) };
    updateEngineForMonth(stormEngine, rainSeries, 2023, 1, windSeries, currentDate);
    updateEngineForMonth(stormEngine, rainSeries, 2023, 2, windSeries, currentDate);
    assert.deepEqual(stormUpdates, [[0, 1], [1, 0]], "rain and wind are normalized independently");
  } finally {
    await vite.close();
  }
});