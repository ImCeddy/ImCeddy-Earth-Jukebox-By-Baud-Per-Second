import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadEicResources() {
  const source = await readFile(new URL("../src/data/eic-resources.ts", import.meta.url), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022 },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(errors, [], "Could not transpile EIC resource data");
  return import(`data:text/javascript;base64,${Buffer.from(result.outputText).toString("base64")}`);
}

test("NASA video themes use complete, compact frame sequences", async () => {
  const { eicResources } = await loadEicResources();
  const expectedThemes = ["agriculture", "air", "biodiversity", "disaster", "gases", "water"];
  const frameThemes = Object.entries(eicResources)
    .filter(([, resource]) => resource.mediaType === "frames")
    .map(([theme]) => theme)
    .sort();
  assert.deepEqual(frameThemes, expectedThemes);

  const uniqueResources = new Map(
    expectedThemes.map((theme) => [eicResources[theme].asset, eicResources[theme]]),
  );
  let totalBytes = 0;
  for (const [asset, resource] of uniqueResources) {
    assert.equal(resource.frameCount, 24);
    const directory = new URL(`../public${asset}/`, import.meta.url);
    const frames = (await readdir(directory)).filter((file) => /^frame-\d{3}\.webp$/.test(file));
    assert.equal(frames.length, resource.frameCount, `${asset} has all extracted frames`);
    const sizes = await Promise.all(frames.map(async (file) => (await stat(new URL(file, directory))).size));
    totalBytes += sizes.reduce((sum, size) => sum + size, 0);
    assert.ok(sizes.every((size) => size > 0 && size < 100_000), `${asset} frames are compressed`);
  }
  assert.ok(totalBytes < 4 * 1024 * 1024, `Frame sequences total ${totalBytes} bytes`);
});
