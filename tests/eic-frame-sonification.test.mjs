import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("NASA EIC sonification is available from every theme, not the Manila Bay location card", async () => {
  const vite = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true },
  });

  try {
    const { EicFrameSonification, LocationView, ThemeView, themes } = await vite.ssrLoadModule("/src/App.tsx");
    const { locations } = await vite.ssrLoadModule("/src/data/locations.ts");
    const { eicResources } = await vite.ssrLoadModule("/src/data/eic-resources.ts");
    const seaTheme = themes.find((theme) => theme.id === "sea");
    const manilaBay = locations.find((location) => location.id === "manila-bay");
    const hagonoy = locations.find((location) => location.id === "hagonoy-bulakan");

    const manilaMarkup = renderToStaticMarkup(
      createElement(LocationView, { theme: seaTheme, location: manilaBay, onNavigate() {} }),
    );
    assert.ok(manilaMarkup.includes("Listen to this place"));
    assert.ok(!manilaMarkup.includes("EIC frames sonification"));
    assert.ok(!manilaMarkup.includes("Time-series data sonification"));

    const hagonoyMarkup = renderToStaticMarkup(
      createElement(LocationView, { theme: seaTheme, location: hagonoy, onNavigate() {} }),
    );
    assert.ok(hagonoyMarkup.includes("Listen to this place"));
    assert.ok(!hagonoyMarkup.includes("EIC frames sonification"));

    assert.equal(themes.length, 9);
    for (const theme of themes) {
      const themeMarkup = renderToStaticMarkup(
        createElement(ThemeView, { theme, onNavigate() {}, onLocation() {} }),
      );
      assert.ok(themeMarkup.includes("Explore NASA EIC sound"), `${theme.id} theme has a NASA EIC entry point`);
      assert.ok(themeMarkup.includes(eicResources[theme.id].sourceId), `${theme.id} displays its matched NASA source`);

      const sonificationMarkup = renderToStaticMarkup(
        createElement(EicFrameSonification, { initialTheme: theme, onNavigate() {} }),
      );
      assert.ok(sonificationMarkup.includes('id="eic-frame-range"'), `${theme.id} has an interactive scan/timeline`);
      assert.ok(sonificationMarkup.includes(eicResources[theme.id].asset), `${theme.id} sonifies its NASA asset`);
      assert.ok(sonificationMarkup.includes('class="eic-frame-caveat"'), `${theme.id} explains its limitations`);
      assert.ok(sonificationMarkup.includes(eicResources[theme.id].period), `${theme.id} displays the NASA source period`);
      if (eicResources[theme.id].mediaType === "frames") {
        const resource = eicResources[theme.id];
        const files = await readdir(new URL(`../public${resource.asset}/`, import.meta.url));
        const frames = files.filter((file) => /^frame-\d{3}\.webp$/.test(file));
        assert.equal(frames.length, resource.frameCount, `${theme.id} has every optimized frame`);
        assert.ok(sonificationMarkup.includes("frame-001.webp"), `${theme.id} starts on its first extracted frame`);
        assert.ok(sonificationMarkup.includes("not an observed calendar date"), `${theme.id} explains frame timing`);
      }
    }

    const agricultureMarkup = renderToStaticMarkup(
      createElement(EicFrameSonification, {
        initialTheme: themes.find((theme) => theme.id === "agriculture"),
        onNavigate() {},
      }),
    );
    assert.ok(agricultureMarkup.includes("weather context only"));

    const { analyzeFramePixels } = await vite.ssrLoadModule("/src/audio/useSonification.ts");
    assert.deepEqual(analyzeFramePixels(new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
    ])), { brightness: 0.5, colorVariation: 0 });
    assert.deepEqual(analyzeFramePixels(new Uint8ClampedArray([255, 0, 0, 255])), {
      brightness: 0.2126,
      colorVariation: 1,
    });
    assert.throws(() => analyzeFramePixels(new Uint8ClampedArray([0, 0, 0])), RangeError);
  } finally {
    await vite.close();
  }
});
