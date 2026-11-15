import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { locations } from "./data/locations";
import type { ThemeId } from "./data/locations";
import { getGlobeState, setMapZoomHandler, subscribeToGlobe } from "./state/globeStore";
import globalImageUrl from "./data/earth-global.jpg";

const earthTiles = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg";

const themeAccents: Record<ThemeId, string> = {
  "sea-level": "#5aa9e6",
  "air-quality": "#7fd68a",
  disasters: "#e6a85a",
  "water-resources": "#4fc3b0",
  agriculture: "#a8c24a",
  wildfires: "#e05a3a",
  biodiversity: "#9b7fe0",
  "greenhouse-gases": "#8a94a3",
  energy: "#e0c94a",
};

function getLocationFeatures(themeId: ThemeId | null, locationId: string | null) {
  return {
    type: "FeatureCollection" as const,
    features: locations
      .filter((location) => location.themeId === themeId)
      .map((location) => ({
        type: "Feature" as const,
        id: location.id,
        geometry: { type: "Point" as const, coordinates: location.lngLat },
        properties: {
          id: location.id,
          name: location.name,
          accent: themeAccents[location.themeId],
          selected: location.id === locationId,
        },
      })),
  };
}

function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function createStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      earthUnderlay: {
        type: "image",
        url: globalImageUrl,
        coordinates: [[-180, 85], [180, 85], [180, -85], [-180, -85]],
      },
      blueMarble: {
        type: "raster",
        tiles: [earthTiles],
        tileSize: 256,
        maxzoom: 8,
      },
      worldImagery: {
        type: "raster",
        tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 18,
      },
      locations: {
        type: "geojson",
        data: getLocationFeatures(null, null),
      },
    },
    layers: [
      {
        id: "earth-underlay",
        type: "raster",
        source: "earthUnderlay",
        paint: {
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      },
      {
        id: "blue-marble",
        type: "raster",
        source: "blueMarble",
        paint: {
          "raster-fade-duration": 250,
          "raster-resampling": "linear",
        },
      },
      {
        id: "world-imagery",
        type: "raster",
        source: "worldImagery",
        minzoom: 3,
        paint: {
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 4.4, 1],
          "raster-fade-duration": 350,
          "raster-resampling": "linear",
        },
      },
      {
        id: "location-pin-glow",
        type: "circle",
        source: "locations",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 16, 12],
          "circle-color": ["get", "accent"],
          "circle-opacity": ["case", ["get", "selected"], 0.35, 0.2],
          "circle-blur": 0.65,
        },
      },
      {
        id: "location-pins",
        type: "circle",
        source: "locations",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 7, 5],
          "circle-color": ["get", "accent"],
          "circle-stroke-color": "#f4f5ee",
          "circle-stroke-width": ["case", ["get", "selected"], 2, 1],
          "circle-opacity": ["case", ["get", "selected"], 1, 0.48],
        },
      },
    ],
    sky: {
      "sky-color": "rgba(8, 11, 14, 0)",
      "horizon-color": "#090b0d",
      "fog-color": "#090b0d",
      "sky-horizon-blend": 0.12,
    },
  };
}

export default function GlobeStage({ screenKey }: { screenKey: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const starCanvasRef = useRef<HTMLCanvasElement>(null);
  const previousScreenRef = useRef<string | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const rotationFrameRef = useRef<number | null>(null);
  const rotationStartRef = useRef<(() => void) | null>(null);
  const transitionRef = useRef(0);
  const [hasViewport, setHasViewport] = useState(false);
  const [hasEverHadViewport, setHasEverHadViewport] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const globeState = useSyncExternalStore(subscribeToGlobe, getGlobeState, getGlobeState);
  const [starsVisible, setStarsVisible] = useState(false);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (previousScreenRef.current !== null && previousScreenRef.current !== screenKey && stage) {
      stage.dataset.relocateFrom = previousScreenRef.current;
    }
    previousScreenRef.current = screenKey;
  }, [screenKey]);

  useEffect(() => {
    const canvas = starCanvasRef.current;
    const field = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !field || !context) return;

    const drawStars = () => {
      const { width, height } = field.getBoundingClientRect();
      if (!width || !height) return;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      let seed = 85173;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const colors = ["#ffffff", "#e5efff", "#cbdfff", "#fff0db"];
      const starCount = Math.round((width * height) / 420);
      for (let index = 0; index < starCount; index += 1) {
        const x = random() * width;
        const y = random() * height;
        const brightStar = random() < 0.07;
        const size = brightStar ? 1.2 + random() * 1.1 : 0.45 + random() * 0.9;
        const color = colors[Math.floor(random() * colors.length)];
        context.globalAlpha = 0.28 + random() * (brightStar ? 0.65 : 0.48);
        context.fillStyle = color;
        context.shadowColor = color;
        context.shadowBlur = brightStar ? 4 : 0;
        context.beginPath();
        context.arc(x, y, size / 2, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    };

    const resizeObserver = new ResizeObserver(drawStars);
    resizeObserver.observe(field);
    drawStars();
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasEverHadViewport) return;
    if (!isWebGLAvailable()) {
      setWebglUnavailable(true);
      return;
    }

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        style: createStyle(),
        center: [122, 15],
        zoom: 1.4,
        minZoom: 1,
        maxZoom: 18,
        maxPitch: 55,
        pitch: 0,
        attributionControl: false,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        interactive: false,
        maxTileCacheZoomLevels: 4,
        refreshExpiredTiles: false,
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    mapRef.current = map;
    map.getCanvas().tabIndex = -1;
    map.scrollZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoomRotate.enable();
    map.once("style.load", () => {
      map.setSky({
        "sky-color": "rgba(8, 11, 14, 0)",
        "horizon-color": "#090b0d",
        "fog-color": "#090b0d",
        "sky-horizon-blend": 0.12,
      });
      setMapStyleReady(true);
    });
    map.once("idle", () => setImageryReady(true));
    window.setTimeout(() => setImageryReady(true), 3500);
    map.on("error", (event) => {
      if (event.error.message.toLowerCase().includes("webgl")) {
        setWebglUnavailable(true);
      }
    });

    return () => {
      mapRef.current = null;
      if (rotationFrameRef.current !== null) cancelAnimationFrame(rotationFrameRef.current);
      map.remove();
    };
  }, [hasEverHadViewport]);

  useEffect(() => {
    const stage = stageRef.current;
    const appContent = document.querySelector(".app-content");
    if (!stage || !appContent) return;
    let observedViewport: HTMLElement | null = null;
    let previousWidth = -1;
    let previousHeight = -1;
    const resizeObserver = new ResizeObserver(() => syncViewport());
    const mutationObserver = new MutationObserver(() => syncViewport());
    function syncViewport() {
      if (!stage || !appContent) return;
      const viewport = appContent.querySelector<HTMLElement>("[data-globe-viewport]");
      if (viewport !== observedViewport) {
        if (observedViewport) resizeObserver.unobserve(observedViewport);
        observedViewport = viewport;
        if (observedViewport) resizeObserver.observe(observedViewport);
      }
      if (!viewport) {
        delete stage.dataset.relocateFrom;
        stage.style.visibility = "hidden";
        setHasViewport(false);
        mapRef.current?.stop();
        if (rotationFrameRef.current !== null) cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
        return;
      }
      stage.dataset.context = viewport.classList.contains("landing-globe-viewport") ? "landing" : "app";
      const bounds = viewport.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        stage.style.visibility = "hidden";
        setHasViewport(false);
        mapRef.current?.stop();
        if (rotationFrameRef.current !== null) cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
        return;
      }
      const oldBounds = stage.dataset.relocateFrom ? stage.getBoundingClientRect() : null;
      stage.style.left = `${bounds.left}px`;
      stage.style.top = `${bounds.top}px`;
      stage.style.width = `${bounds.width}px`;
      stage.style.height = `${bounds.height}px`;
      stage.style.visibility = "visible";
      setHasViewport(true);
      setHasEverHadViewport(true);
      if (bounds.width !== previousWidth || bounds.height !== previousHeight) {
        previousWidth = bounds.width;
        previousHeight = bounds.height;
        mapRef.current?.resize();
      }
      if (oldBounds && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        stage.animate([
          { transform: `translate(${oldBounds.left - bounds.left}px, ${oldBounds.top - bounds.top}px)` },
          { transform: "translate(0, 0)" },
        ], { duration: 1400, easing: "cubic-bezier(.65, 0, .35, 1)" });
      }
      delete stage.dataset.relocateFrom;
    }
    mutationObserver.observe(appContent, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, childList: true, subtree: true });
    window.addEventListener("resize", syncViewport);
    window.addEventListener("scroll", syncViewport, true);
    syncViewport();
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("scroll", syncViewport, true);
    };
  }, []);

  const [mapStyleReady, setMapStyleReady] = useState(false);
  const [imageryReady, setImageryReady] = useState(false);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleReady || !hasViewport) return;
    const source = map.getSource("locations") as maplibregl.GeoJSONSource;
    source.setData(getLocationFeatures(globeState.themeId, globeState.locationId));
  }, [globeState.themeId, globeState.locationId, globeState.stage, mapStyleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapStyleReady) return;
    if (globeState.stage !== "hub") setStarsVisible(false);
    transitionRef.current += 1;
    const transition = transitionRef.current;
    map.stop();
    if (rotationFrameRef.current !== null) cancelAnimationFrame(rotationFrameRef.current);
    rotationFrameRef.current = null;
    rotationStartRef.current = null;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const target = globeState.stage === "location"
      ? (() => {
          const location = locations.find((entry) => entry.id === globeState.locationId);
          return location ? {
            center: location.lngLat,
            zoom: location.zoom,
            pitch: location.pitch ?? 35,
            bearing: location.bearing ?? 0,
          } : { center: [122, 12.5] as [number, number], zoom: 5.2, pitch: 18, bearing: 0 };
        })()
      : globeState.stage === "theme"
        ? { center: [122, 12.5] as [number, number], zoom: mobile ? 4.4 : 5.2, pitch: 18, bearing: 0 }
        : { center: [124, 12] as [number, number], zoom: 1.4, pitch: 0, bearing: 0 };

    const startRotation = () => {
      if (transition !== transitionRef.current || globeState.stage !== "hub" || document.hidden || rotationFrameRef.current !== null) return;
      setStarsVisible(true);
      let lastUpdateTime: number | null = null;
      let lastFrameTime = 0;
      const rotate = (time: number) => {
        if (transition !== transitionRef.current || document.hidden) {
          rotationFrameRef.current = null;
          return;
        }
        if (time - lastFrameTime >= 1000 / 30) {
          if (lastUpdateTime !== null) {
            const center = map.getCenter();
            map.setCenter([center.lng + (time - lastUpdateTime) * 0.00100, center.lat]);
          }
          lastUpdateTime = time;
          lastFrameTime = time;
        }
        rotationFrameRef.current = requestAnimationFrame(rotate);
      };
      rotationFrameRef.current = requestAnimationFrame(rotate);
    };
    rotationStartRef.current = startRotation;

    const duration = globeState.stage === "theme" ? 4800 : globeState.stage === "location" ? 3200 : 2400;
    const cameraOptions = { ...target, duration: reducedMotion ? 0 : duration };
    if (reducedMotion && globeState.stage !== "location") {
      map.jumpTo(cameraOptions);
      if (globeState.stage === "hub") setStarsVisible(true);
    } else if (globeState.stage === "location") {
      map.easeTo({
        ...cameraOptions,
        duration: reducedMotion ? 800 : duration,
        easing: (time) => time * time * (3 - 2 * time),
      });
    } else {
      map.flyTo({
        ...cameraOptions,
        curve: 1.35,
        speed: 0.65,
        easing: (time) => time * time * (3 - 2 * time),
      });
      if (globeState.stage === "hub") map.once("moveend", startRotation);
    }

    return () => {
      transitionRef.current += 1;
      map.stop();
      if (rotationFrameRef.current !== null) cancelAnimationFrame(rotationFrameRef.current);
    };
  }, [globeState.stage, globeState.themeId, globeState.locationId, mapStyleReady, hasViewport]);

  useEffect(() => {
    const map = mapRef.current;
    const location = locations.find((entry) => entry.id === globeState.locationId);
    if (!map || !mapStyleReady || globeState.stage !== "location" || !location) return;
    const pulse = document.createElement("div");
    pulse.className = "globe-pulse-marker";
    pulse.setAttribute("aria-hidden", "true");
    pulse.style.setProperty("--pulse-color", themeAccents[location.themeId]);
    const marker = new maplibregl.Marker({ element: pulse, anchor: "center" })
      .setLngLat(location.lngLat)
      .addTo(map);
    return () => { marker.remove(); };
  }, [globeState.stage, globeState.locationId, mapStyleReady]);

  useEffect(() => {
    if (!mapStyleReady) return;
    return setMapZoomHandler((delta) => {
      const map = mapRef.current;
      if (map && getGlobeState().stage === "location" && getGlobeState().locationId) {
        map.zoomTo(map.getZoom() + delta, { duration: 350 });
      }
    });
  }, [mapStyleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleVisibility = () => {
      if (document.hidden) {
        map.stop();
        if (rotationFrameRef.current !== null) cancelAnimationFrame(rotationFrameRef.current);
        rotationFrameRef.current = null;
      } else if (getGlobeState().stage === "hub") {
        rotationStartRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [mapStyleReady]);

  return (
    <>
      <div ref={stageRef} className="globe-stage-root" data-stage={globeState.stage} data-stars-visible={starsVisible} data-imagery-ready={imageryReady} aria-hidden="true">
        <div ref={containerRef} className="globe-map-canvas" />
        <div className="globe-starfield">
          <canvas ref={starCanvasRef} className="globe-star-canvas" aria-hidden="true" />
        </div>
        {webglUnavailable && <img className="globe-static-fallback" src={globalImageUrl} alt="Static NASA satellite view of Earth" />}
      </div>
      <div className="visually-hidden">Earth imagery provided by NASA EOSDIS GIBS.</div>
    </>
  );
}