import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTypescriptModule(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(errors, [], `Could not transpile ${relativePath}`);
  const encoded = Buffer.from(result.outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("Sendong and Basyang IMERG samples stay separate from monthly and gauge rainfall", async () => {
  const dataset = JSON.parse(
    await readFile(new URL("../src/data/story-data/cagayan-de-oro.json", import.meta.url), "utf8"),
  );
  assert.equal(dataset.series.length, 333);
  assert.equal(dataset.series.find((point) => point.year === 2011 && point.month === 12).value, 368.28);
  assert.equal(dataset.sampling.sendongDailyRainfall.product, "GPM_3IMERGDF.07 Final Run daily precipitation");
  assert.deepEqual(
    dataset.sampling.sendongDailyRainfall.dailySamples.map(({ date, value, unit }) => [date, value, unit]),
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
  assert.equal(dataset.sampling.basyangDailyRainfall.product, "GPM_3IMERGDL.07 Late Run daily precipitation");
  assert.deepEqual(
    dataset.sampling.basyangDailyRainfall.dailySamples.map(({ date, value, unit }) => [date, value, unit]),
    [
      ["2026-02-04", 15.1, "mm/day"],
      ["2026-02-05", 122.81, "mm/day"],
      ["2026-02-06", 9.33, "mm/day"],
      ["2026-02-07", 12.355, "mm/day"],
      ["2026-02-08", 3.815, "mm/day"],
      ["2026-02-09", 8.125, "mm/day"],
      ["2026-02-10", 5.62, "mm/day"],
    ],
  );
  assert.equal(dataset.sampling.basyangDailyRainfall.gridCellCenter.latitude, 8.45);
  assert.equal(dataset.sampling.basyangDailyRainfall.gridCellCenter.longitude, 124.65);

  const { locations } = await loadTypescriptModule("../src/data/locations.ts");
  const { notableEvents } = await loadTypescriptModule("../src/data/notable-events.ts");
  const location = locations.find((item) => item.id === "cagayan-de-oro");
  const sendongEvent = notableEvents.find((item) => item.id === "cagayan-de-oro-2011-12-sendong");
  const basyangEvent = notableEvents.find((item) => item.id === "cagayan-de-oro-2026-02-basyang");

  assert.ok(location);
  assert.ok(location.story.includes("Separate daily samples"));
  assert.ok(location.story.includes("Iligan"));
  assert.ok(location.dataScaleNote.includes("local Philippines dates begin at 08:00"));
  assert.ok(sendongEvent);
  assert.ok(sendongEvent.dataNote.includes("113.735 mm/day"));
  assert.ok(sendongEvent.dataNote.includes("475 mm/24-hour gauge total"));
  assert.ok(sendongEvent.dataNote.includes("cannot resolve flood depth"));
  assert.ok(sendongEvent.sources.some((source) => source.url === dataset.sampling.sendongDailyRainfall.url));
  assert.ok(basyangEvent);
  assert.ok(basyangEvent.description.includes("not the Cagayan de Oro satellite grid cell"));
  assert.ok(basyangEvent.description.includes("Iligan"));
  assert.ok(basyangEvent.dataNote.includes("122.810 mm/day"));
  assert.ok(basyangEvent.dataNote.includes("08:00 5 Feb to 08:00 6 Feb"));
  assert.ok(basyangEvent.dataNote.includes("ends in September 2025"));
  assert.ok(basyangEvent.sources.some((source) => source.url === dataset.sampling.basyangDailyRainfall.url));
});
