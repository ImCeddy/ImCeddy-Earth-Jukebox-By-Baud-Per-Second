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

test("resource catalog merges repeated citations by canonical URL and retains every story use", async () => {
  const { collectUniqueSources, normalizeResourceUrl } = await loadTypescriptModule("../src/data/resource-catalog.ts");
  const sources = collectUniqueSources([
    { source: { title: "Same report", publisher: "Publisher", url: "https://example.org/report/#section-a" }, usedBy: "Story A" },
    { source: { title: "Same report", publisher: "Publisher", url: "https://example.org/report/" }, usedBy: "Story B" },
    { source: { title: "Different release", publisher: "Publisher", url: "https://example.org/report/?version=2" }, usedBy: "Story C" },
  ]);

  assert.equal(normalizeResourceUrl("https://example.org/report/#details"), "https://example.org/report");
  assert.equal(sources.length, 2);
  assert.deepEqual(sources.find((source) => source.title === "Same report").usedBy, ["Story A", "Story B"]);
});
