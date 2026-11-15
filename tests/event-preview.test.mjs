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

test("event previews use a bounded, readable summary for every event description", async () => {
  const { notableEvents, summarizeNotableEvent } = await loadTypescriptModule("../src/data/notable-events.ts");
  let truncatedCount = 0;

  for (const event of notableEvents) {
    const summary = summarizeNotableEvent(event.description);
    assert.ok(summary.length <= 180, `${event.id} summary fits the preview`);
    assert.ok(summary.length > 0, `${event.id} summary is not empty`);
    if (event.description.length > 180) {
      truncatedCount += 1;
      assert.notEqual(summary, event.description, `${event.id} does not show the full story`);
    }
  }

  assert.ok(truncatedCount > 0, "the event set includes long descriptions that need truncation");
  assert.equal(summarizeNotableEvent("  A short story.  "), "A short story.");
});
