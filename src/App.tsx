import { Fragment, Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { locations, locationsForTheme, locationById, type Location, type ThemeId } from "./data/locations";
import { eicResources, type EicThemeId } from "./data/eic-resources";
import { collectUniqueSources, normalizeResourceUrl } from "./data/resource-catalog";
import manilaBayData from "./data/story-data/manila-bay.json";
import tubigonData from "./data/story-data/tubigon-bohol.json";
import aringayAlaskaData from "./data/story-data/aringay-alaska.json";
import leyteGulfData from "./data/story-data/leyte-gulf-tacloban.json";
import davaoData from "./data/story-data/davao-mindanao.json";
import taclobanData from "./data/story-data/tacloban-leyte.json";
import nuevaEcijaData from "./data/story-data/nueva-ecija-rice-belt.json";
import benguetData from "./data/story-data/benguet-vegetable-belt.json";
import negrosSugarcaneData from "./data/story-data/negros-sugarcane-belt.json";
import boholUbeData from "./data/story-data/bohol-ube-landscape.json";
import banaueTerracesData from "./data/story-data/banaue-rice-terraces.json";
import payatasData from "./data/story-data/payatas-metro-manila.json";
import valenzuelaData from "./data/story-data/valenzuela-metro-manila.json";
import taalData from "./data/story-data/taal-volcano.json";
import metroManilaNo2Data from "./data/story-data/metro-manila-lockdown.json";
import koronadalData from "./data/story-data/koronadal-city.json";
import haiyanData from "./data/story-data/tacloban-haiyan.json";
import odetteData from "./data/story-data/surigao-city.json";
import cagayanDeOroData from "./data/story-data/cagayan-de-oro.json";
import angatWaterData from "./data/story-data/angat-dam.json";
import pantabanganWaterData from "./data/story-data/pantabangan-dam.json";
import macabebeWaterData from "./data/story-data/macabebe-delta.json";
import tubbatahaData from "./data/story-data/tubbataha-reefs.json";
import mountHamiguitanData from "./data/story-data/mount-hamiguitan.json";
import mountApoWildfireData from "./data/story-data/mount-apo-wildfire.json";
import philippinesGlobalCo2Data from "./data/story-data/philippines-global-co2.json";
import metroCebuEnergyData from "./data/story-data/metro-cebu-energy.json";
import iloiloCityEnergyData from "./data/story-data/iloilo-city-energy.json";
import bogoTinoData from "./data/story-data/bogo-cebu-tino.json";
import { notableEvents, summarizeNotableEvent, type NotableEvent } from "./data/notable-events";
import { analyzeFramePixels, interpolateShortMonthlyGaps, useEicFrameSonification, useSonification, type AudioTheme, type MonthlyValue } from "./audio/useSonification";
import { getGlobeState, goBack, requestMapZoom, setHub, setLocation as setGlobeLocation, setTheme as setGlobeTheme, subscribeToGlobe } from "./state/globeStore";

const GlobeStage = lazy(() => import("./GlobeStage"));

type Screen =
  | "landing"
  | "hub"
  | "theme"
  | "location"
  | "story"
  | "eic-frames"
  | "privacy"
  | "terms"
  | "cookies"
  | "community"
  | "about"
  | "references"
  | "event-detail"
  | "contact";

type Theme = {
  id: EicThemeId;
  name: string;
  short: string;
  icon: IconName;
  color: string;
  available: boolean;
};

type IconName =
  | "wave"
  | "wind"
  | "alert"
  | "drop"
  | "leaf"
  | "fire"
  | "bird"
  | "cloud"
  | "bolt"
  | "pin"
  | "sound"
  | "globe"
  | "settings"
  | "play"
  | "pause"
  | "volume"
  | "muted"
  | "arrow"
  | "radio";

export const themes: Theme[] = [
  { id: "sea", name: "Sea Level Change", short: "SEALEVEL", icon: "wave", color: "var(--sea)", available: true },
  { id: "air", name: "Air Quality", short: "AIRQUALITY", icon: "wind", color: "var(--air)", available: true },
  { id: "disaster", name: "Disasters", short: "DISASTERS", icon: "alert", color: "var(--disaster)", available: true },
  { id: "water", name: "Water Resources", short: "WATER", icon: "drop", color: "var(--water)", available: true },
  { id: "agriculture", name: "Agriculture", short: "AGRICULTURE", icon: "leaf", color: "var(--agriculture)", available: true },
  { id: "wildfire", name: "Wildfires", short: "WILDFIRES", icon: "fire", color: "var(--wildfire)", available: true },
  { id: "biodiversity", name: "Biodiversity", short: "BIODIVERSITY", icon: "bird", color: "var(--biodiversity)", available: true },
  { id: "gases", name: "Greenhouse Gases", short: "GHG", icon: "cloud", color: "var(--gases)", available: true },
  { id: "energy", name: "Energy", short: "ENERGY", icon: "bolt", color: "var(--energy)", available: true },
];

const themeIdByScreenId: Record<string, ThemeId> = {
  sea: "sea-level", air: "air-quality", disaster: "disasters", water: "water-resources",
  agriculture: "agriculture", wildfire: "wildfires", biodiversity: "biodiversity",
  gases: "greenhouse-gases", energy: "energy",
};

const legalCopy: Record<string, { title: string; updated: string; sections: { heading: string; body: string }[] }> = {
  about: {
    title: "Earth Jukebox",
    updated: "A NASA Space Apps Challenge project",
    sections: [
      { heading: "The team", body: "Baud Per Second brings together people interested in Earth science, sound, and interactive storytelling." },
      { heading: "The project", body: "Earth Jukebox turns Earth-observation records into visual and auditory stories, with a focus on environmental change across the Philippines." },
      { heading: "Our approach", body: "Each story connects a place and environmental theme with Earth-observation data, including satellite products and data-assimilation estimates where appropriate. Sonification is an invitation to explore the data, not a substitute for the underlying measurements." },
      { heading: "Super Intelligence (SI) use", body: "Generative AI assisted with drafting project and submission descriptions and implementing this disclosure. The app's scientific datasets and NASA visuals are sourced and documented, not AI-generated. Its audio is synthesized algorithmically from image features and data, not generated by AI." },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "Last revised · 05 OCT 2025",
    sections: [
      { heading: "What we collect", body: "Earth Jukebox can be explored without creating an account. We collect only the technical information required to keep the experience reliable, such as anonymous device type, page performance, and broad region." },
      { heading: "How data is used", body: "Usage signals help us understand which stories are useful and where the interface needs improvement. We do not sell personal information or use it to build advertising profiles." },
      { heading: "Your controls", body: "You may decline optional analytics through the cookie controls. Contact the project team to request access to or deletion of information submitted through the support form." },
    ],
  },
  terms: {
    title: "Terms of Service",
    updated: "Last revised · 05 OCT 2025",
    sections: [
      { heading: "Educational use", body: "Earth Jukebox is an exploratory educational experience. Its sonifications and summaries help people engage with Earth-observation data, but they are not forecasts or professional scientific advice." },
      { heading: "Data and availability", body: "We aim to cite every dataset and mission accurately. Source services may change or become temporarily unavailable, and displayed values may be revised as agencies publish improved products." },
      { heading: "Responsible use", body: "Do not misuse the service, interfere with its operation, or present generated audio as a substitute for the cited scientific record." },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    updated: "Last revised · 05 OCT 2025",
    sections: [
      { heading: "Essential storage", body: "Small local records remember settings such as narration, volume, and your last selected theme. They keep controls consistent between visits." },
      { heading: "Optional analytics", body: "Anonymous analytics may measure visits and interaction patterns. These signals are aggregated and are never used for behavioral advertising." },
      { heading: "Manage preferences", body: "You can clear stored preferences in your browser at any time. Disabling storage will not block the core stories, charts, or sound controls." },
    ],
  },
  community: {
    title: "Community Guidelines",
    updated: "For explorers, educators & contributors",
    sections: [
      { heading: "Be curious, be accurate", body: "Ask questions and share interpretations, while keeping the original data source and its uncertainty visible. Correct mistakes openly and constructively." },
      { heading: "Respect people and places", body: "Environmental change affects real communities. Avoid sensational claims, stereotypes, or language that treats a place only as a data point." },
      { heading: "Design for many senses", body: "Describe visual material, caption spoken content, and preserve non-audio ways to understand every sonification. Accessibility is part of the instrument." },
    ],
  },
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    wave: <><path d="M3 8c2.3 0 2.3-2 4.6-2s2.3 2 4.7 2 2.3-2 4.6-2 2.3 2 4.6 2" /><path d="M3 13c2.3 0 2.3-2 4.6-2s2.3 2 4.7 2 2.3-2 4.6-2 2.3 2 4.6 2M3 18h18" /></>,
    wind: <><path d="M3 8h11c3 0 3-4 0-4-1.2 0-2 .7-2.3 1.4M3 12h16c3 0 3 4 0 4-1.2 0-2-.7-2.3-1.4M3 16h7" /></>,
    alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v5m0 3h.01" /></>,
    drop: <path d="M12 3S5.5 10 5.5 15a6.5 6.5 0 0 0 13 0C18.5 10 12 3 12 3Z" />,
    leaf: <><path d="M20 4C11 4 5 8 5 14c0 3 2 5 5 5 6 0 10-6 10-15Z" /><path d="M4 21c2-6 6-9 12-12" /></>,
    fire: <path d="M13 2c1 5-3 6-3 10 0 1.5 1 2.5 2 3-1-4 3-5 3-8 3 3 5 6 5 9a8 8 0 1 1-14-5c0 3 1 4 2 4-.5-5 2-9 5-13Z" />,
    bird: <><path d="M3 15c5-7 8-8 12-4l6-3-4 6c-1 4-5 6-10 5" /><path d="m8 13-4-2" /></>,
    cloud: <path d="M7 18h11a4 4 0 0 0 .4-8A6 6 0 0 0 7 9a4.5 4.5 0 0 0 0 9Z" />,
    bolt: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    sound: <><path d="M4 14h3l4 4V6L7 10H4v4Z" /><path d="M15 9c1.5 1.5 1.5 4.5 0 6m3-9c3 3 3 9 0 12" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7-.7-2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7 2-.7Z" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    volume: <><path d="M4 14h3l4 4V6L7 10H4v4Z" /><path d="M15 9c1.5 1.5 1.5 4.5 0 6" /></>,
    muted: <><path d="M4 14h3l4 4V6L7 10H4v4Z" /><path d="m16 10 5 5m0-5-5 5" /></>,
    arrow: <><path d="m15 18-6-6 6-6" /></>,
    radio: <><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function Header({ onNavigate, compact = false, activeScreen }: { onNavigate: (screen: Screen) => void; compact?: boolean; activeScreen?: Screen }) {
  return (
    <header className={`topbar ${compact ? "compact" : ""}`}>
      <button className="wordmark" onClick={() => onNavigate("landing")} aria-label="Earth Jukebox home">
        <span>EARTH JUKEBOX</span>
        <i>PH</i>
      </button>
      <button
        className={`resource-nav-link ${activeScreen === "references" ? "active" : ""}`}
        onClick={() => onNavigate("references")}
        aria-current={activeScreen === "references" ? "page" : undefined}
      >
        Resources
      </button>
    </header>
  );
}

function Footer({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <footer className="footer">
      <div><span className="footer-logo">EJ/PH</span><span>Earth data, translated into sound.</span><span className="footer-team">BAUD PER SECOND</span></div>
      <nav aria-label="Legal">
        <button onClick={() => onNavigate("privacy")}>Privacy Policy</button>
        <button onClick={() => onNavigate("about")}>About</button>
        <button onClick={() => onNavigate("terms")}>Terms of Service</button>
        <button onClick={() => onNavigate("cookies")}>Cookie Policy</button>
        <button onClick={() => onNavigate("community")}>Community Guidelines</button>
        <button onClick={() => onNavigate("references")}>Resources</button>
        <button onClick={() => onNavigate("contact")}>Contact / Support</button>
      </nav>
    </footer>
  );
}

function Landing({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <main className="landing">
      <Header onNavigate={onNavigate} />
      <section className="landing-hero">
        <GlobeViewport mode="global" className="landing-globe-viewport" />
        <div className="hero-copy">
          <div className="signal-label"><span /> LIVE EARTH SIGNAL · PHILIPPINES</div>
          <h1>Hear the Philippines<br />change, <em>one place at a time.</em></h1>
          <p>Pick a theme. Pick a place. Hear decades of NASA Earth-observation data become an evolving soundscape.</p>
          <button className="primary-action" onClick={() => onNavigate("hub")}>
            <span>Enter the Jukebox</span><Icon name="sound" />
          </button>
        </div>
        <div className="frequency-stack" aria-hidden="true">
          {Array.from({ length: 30 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 17) % 68)}%` }} />)}
        </div>
      </section>
      <section className="landing-sequence" aria-label="How it works">
        <div className="sequence-intro"><span>03 STEPS / 40 YEARS</span><p>Turn an environmental record into something you can see, hear, and feel.</p></div>
        <div className="preview-tiles">
          <article><span className="step-num">01</span><Icon name="wave" size={30} /><div><strong>Choose a signal</strong><small>9 Earth systems</small></div><span className="tile-line" /></article>
          <article><span className="step-num">02</span><Icon name="pin" size={30} /><div><strong>Locate the story</strong><small>Across the archipelago</small></div><span className="tile-line" /></article>
          <article><span className="step-num">03</span><Icon name="sound" size={30} /><div><strong>Listen to change</strong><small>Data becomes sound</small></div><span className="mini-wave">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 23) % 74)}%` }} />)}</span></article>
        </div>
      </section>
      <div className="nasa-note"><span>DATA SIGNAL</span><p>Powered by open NASA Earth-observation data. A NASA Space Apps Challenge project — not an official NASA product.</p></div>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

function GlobeViewport({ mode, className = "", locationId }: { mode: "global" | "philippines" | "pinpoint"; className?: string; locationId?: string }) {
  const label = mode === "global" ? "ORBITAL VIEW" : mode === "philippines" ? "REGIONAL LOCK" : "PINPOINT LOCK";
  const imageryCredit = mode === "global"
    ? "NASA EOSDIS GIBS"
    : "NASA GIBS · Esri · Vantor · Earthstar Geographics · GIS User Community";
  return (
    <div className={`globe-stage globe-map-frame ${mode} ${className}`} data-globe-viewport="">
      <div className="stage-meta" aria-hidden="true"><span>{label}</span><span className="imagery-credit" title="Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community">{imageryCredit}</span></div>
      {mode === "pinpoint" && locationId && <div className="map-zoom-controls" role="group" aria-label={`${locations.find((location) => location.id === locationId)?.name ?? "Location"} map zoom controls`}>
        <button type="button" aria-label={`Zoom in on ${locations.find((location) => location.id === locationId)?.name ?? "location"}`} onClick={() => requestMapZoom(1)}>+</button>
        <button type="button" aria-label={`Zoom out on ${locations.find((location) => location.id === locationId)?.name ?? "location"}`} onClick={() => requestMapZoom(-1)}>−</button>
      </div>}
    </div>
  );
}

function Hub({ onNavigate, onTheme }: { onNavigate: (screen: Screen) => void; onTheme: (theme: Theme) => void }) {
  return (
    <main className="app-screen map-screen">
      <Header onNavigate={onNavigate} compact />
      <section className="hub-layout">
        <div className="hub-heading">
          <div><span className="index">01 / SELECT SIGNAL</span><h1>Earth systems<br />as instruments.</h1></div>
          <p>Select an environmental theme to focus the orbital view and reveal local data stories.</p>
        </div>
        <div className="hub-stage">
          <GlobeViewport mode="global" />
          <div className="theme-grid">
            {themes.map((theme, i) => (
              <button key={theme.id} className={`theme-node ${theme.available ? "available" : "soon"}`} style={{ "--accent": theme.color } as React.CSSProperties} onClick={() => theme.available && onTheme(theme)} aria-disabled={!theme.available}>
                <span className="theme-index">{String(i + 1).padStart(2, "0")}</span>
                <span className="theme-icon"><Icon name={theme.icon} /></span>
                <strong>{theme.name}</strong>
                <small>{theme.available ? "AVAILABLE" : "IN QUEUE"}</small>
              </button>
            ))}
          </div>
        </div>
        <button className="back-control hub-landing-return" onClick={() => onNavigate("landing")}><Icon name="arrow" /> RETURN TO LANDING</button>
      </section>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

export function ThemeView({ theme, onNavigate, onLocation }: { theme: Theme; onNavigate: (screen: Screen) => void; onLocation: (location: Location) => void }) {
  const themeLocations = locationsForTheme(themeIdByScreenId[theme.id]);
  return (
    <main className="app-screen map-screen themed" style={{ "--accent": theme.color } as React.CSSProperties}>
      <Header onNavigate={onNavigate} compact />
      <section className="explore-layout">
        <div className="screen-side">
          <button className="back-control" onClick={() => onNavigate("hub")}><Icon name="arrow" /> HUB / ALL SIGNALS</button>
          <span className="index">02 / LOCATE STORY</span>
          <div className="selected-theme-heading">
            <div className="selected-theme-icon"><Icon name={theme.icon} size={34} /></div>
            <h1>{theme.name}</h1>
          </div>
          <p>Earth-observation records reveal where this signal has shifted across the Philippine archipelago.</p>
          <div className="readout"><span>REGION</span><strong>PHILIPPINES</strong><span>AVAILABLE SITES</span><strong>{themeLocations.length.toString().padStart(2, "0")}</strong></div>
          <button className="theme-eic-action listen-action" onClick={() => onNavigate("eic-frames")}>
            <span><Icon name="sound" /> Explore NASA EIC sound</span>
            <small>{eicResources[theme.id].sourceId} · {eicResources[theme.id].title}</small>
          </button>
          <p className="theme-eic-note">NASA visualization sonification · global or model context; details and limits on next screen.</p>
        </div>
        <GlobeViewport mode="philippines" />
        <div className="location-list">
          <span className="index">ACTIVE GROUND POINTS</span>
          {themeLocations.length ? themeLocations.map((location, i) => <button key={location.id} onClick={() => onLocation(location)}><i /><span><small>0{i + 1}</small>{location.name}</span><Icon name="arrow" /></button>) : <p className="location-empty">No ground points are mapped for this theme yet.</p>}
        </div>
      </section>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

export function LocationView({ theme, location, onNavigate }: { theme: Theme; location: Location; onNavigate: (screen: Screen) => void }) {
  const descriptions: Record<string, string> = {
    sea: "A dense coastal edge where land movement, tides, and a changing ocean meet millions of daily lives.",
    air: "A fast-growing urban atmosphere where satellites track particles carried between roads, industry, weather, and people.",
    disaster: "A landscape repeatedly reshaped by extreme weather, where rainfall and surface change reveal exposure and recovery.",
    water: "A vital freshwater system whose changing surface area records rainfall, demand, drought, and watershed pressure.",
    agriculture: "One of the country's most productive farming regions, where seasonal greenness records water, harvest, and heat.",
    wildfire: "A fire-sensitive upland landscape where heat and vegetation dryness can turn small ignitions into visible scars.",
    biodiversity: "Globally important habitats where satellite measurements add environmental context, not species counts.",
    gases: "A global greenhouse-gas signal, where measured CO₂ levels and modeled transport reveal a changing shared atmosphere.",
    energy: "Nighttime radiance traces patterns in human activity and infrastructure, not electricity supply or access.",
  };
  const dataWindows: Record<string, string> = {
    sea: "1993—2025", air: "2005—2025", disaster: "2000—2025", water: "2001—2025",
    agriculture: "2001—2025", wildfire: "2001—2025", biodiversity: "2000—2025",
    gases: "1979—2026", energy: "2012—2023",
  };
  const dataWindow = location.dataWindow ?? dataWindows[theme.id];
  return (
    <main className="app-screen map-screen themed" style={{ "--accent": theme.color } as React.CSSProperties}>
      <Header onNavigate={onNavigate} compact />
      <section className="pinpoint-layout">
        <button className="back-control floating-back" onClick={() => onNavigate("theme")}><Icon name="arrow" /> {theme.short}</button>
        <GlobeViewport mode="pinpoint" locationId={location.id} />
        <article className="location-card">
          <div className="location-coordinate"><span>{location.coordinateLabel ?? "GROUND POINT"}</span><span>{Math.abs(location.lngLat[1]).toFixed(4)}° {location.lngLat[1] >= 0 ? "N" : "S"}<br />{Math.abs(location.lngLat[0]).toFixed(4)}° {location.lngLat[0] >= 0 ? "E" : "W"}</span></div>
          <span className="theme-tag"><Icon name={theme.icon} /> {theme.name}</span>
          <h1>{location.name}</h1>
          <p>{location.blurb || descriptions[theme.id]}</p>
          <p className="data-scale-note">{location.dataScaleNote}</p>
          <div className="data-window"><span>{location.dataWindow ? "STORY RECORD" : "DATA WINDOW"}</span><strong>{dataWindow}</strong></div>
          <button className="listen-action" onClick={() => onNavigate("story")}><span><Icon name="play" /> Listen to this place</span><small>04:18</small></button>
        </article>
      </section>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

const EIC_FRAME_START = Date.parse("2007-03-25T12:00:00Z");
const EIC_FRAME_END = Date.parse("2008-03-03T12:00:00Z");
const EIC_FRAME_STEPS = 1000;

function formatEicFrameDate(position: number) {
  const timestamp = EIC_FRAME_START + (EIC_FRAME_END - EIC_FRAME_START) * position / EIC_FRAME_STEPS;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(timestamp);
}

export function EicFrameSonification({ initialTheme, onNavigate }: { initialTheme: Theme; onNavigate: (screen: Screen) => void }) {
  const resource = eicResources[initialTheme.id];
  const isVideo = resource.mediaType === "video";
  const isFrameSequence = resource.mediaType === "frames";
  const frameCount = resource.frameCount ?? 1;
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positionRef = useRef(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frameFeatures, setFrameFeatures] = useState({ brightness: 0.5, colorVariation: 0.25 });
  const [frameError, setFrameError] = useState<string | null>(null);
  const { start: startFrameAudio, pause: pauseFrameAudio, update: updateFrameAudio } = useEicFrameSonification();

  const publishFeatures = useCallback((pixels: Uint8ClampedArray) => {
    const features = analyzeFramePixels(pixels);
    setFrameFeatures(features);
    updateFrameAudio(features.brightness, features.colorVariation);
    setFrameError(null);
  }, [updateFrameAudio]);

  const sampleVideoFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !canvas || !context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      publishFeatures(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch (error) {
      setFrameError(error instanceof Error ? error.message : "The selected frame could not be analyzed.");
    }
  }, [publishFeatures]);

  const sampleImageScan = useCallback((scanPosition: number) => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!image || !canvas || !context || !image.complete || image.naturalWidth === 0) return;

    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const x = Math.min(canvas.width - 1, Math.floor(canvas.width * scanPosition / EIC_FRAME_STEPS));
      const stripWidth = Math.min(2, canvas.width - x);
      publishFeatures(context.getImageData(x, 0, stripWidth, canvas.height).data);
    } catch (error) {
      setFrameError(error instanceof Error ? error.message : "The selected NASA image could not be analyzed.");
    }
  }, [publishFeatures]);

  const sampleSequenceFrame = useCallback(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!image || !canvas || !context || !image.complete || image.naturalWidth === 0) return;

    try {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      publishFeatures(context.getImageData(0, 0, canvas.width, canvas.height).data);
    } catch (error) {
      setFrameError(error instanceof Error ? error.message : "The selected NASA frame could not be analyzed.");
    }
  }, [publishFeatures]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (isVideo) {
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        const nextPosition = Math.min(EIC_FRAME_STEPS, Math.round(video.currentTime / video.duration * EIC_FRAME_STEPS));
        positionRef.current = nextPosition;
        setPosition(nextPosition);
        sampleVideoFrame();
      } else {
        const nextPosition = positionRef.current >= EIC_FRAME_STEPS ? 0 : Math.min(EIC_FRAME_STEPS, positionRef.current + 8);
        positionRef.current = nextPosition;
        setPosition(nextPosition);
        if (!isFrameSequence) sampleImageScan(nextPosition);
      }
    }, 160);
    return () => window.clearInterval(timer);
  }, [isFrameSequence, isVideo, playing, sampleImageScan, sampleVideoFrame]);

  const seekToPosition = (nextPosition: number) => {
    positionRef.current = nextPosition;
    setPosition(nextPosition);
    if (isVideo) {
      const video = videoRef.current;
      if (video && duration > 0) video.currentTime = duration * nextPosition / EIC_FRAME_STEPS;
    } else if (!isFrameSequence) {
      sampleImageScan(nextPosition);
    }
  };

  const togglePlayback = async () => {
    if (playing) {
      videoRef.current?.pause();
      pauseFrameAudio();
      setPlaying(false);
      return;
    }
    const video = videoRef.current;
    if (isVideo && (!video || duration <= 0)) return;
    if (!isVideo && position >= EIC_FRAME_STEPS) seekToPosition(0);
    if (isVideo && video && video.currentTime >= duration) seekToPosition(0);
    try {
      await startFrameAudio();
      if (isVideo && video) await video.play();
      setFrameError(null);
      setPlaying(true);
    } catch (error) {
      video?.pause();
      pauseFrameAudio();
      setPlaying(false);
      setFrameError(error instanceof Error ? error.message : "NASA visual sonification could not start.");
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      setFrameError("NASA's animation did not provide a usable duration.");
      return;
    }
    setDuration(video.duration);
    setReady(true);
    setFrameError(null);
  };

  const selectedDate = formatEicFrameDate(position);
  const selectedFrameIndex = Math.min(frameCount - 1, Math.floor(position / EIC_FRAME_STEPS * frameCount));
  const progressLabel = isVideo
    ? selectedDate
    : isFrameSequence
      ? `FRAME ${String(selectedFrameIndex + 1).padStart(2, "0")} OF ${String(frameCount).padStart(2, "0")}`
      : `${Math.round(position / EIC_FRAME_STEPS * 100)}%`;

  return (
    <main className="app-screen story-screen eic-frame-screen themed" style={{ "--accent": initialTheme.color } as React.CSSProperties}>
      <Header onNavigate={onNavigate} compact />
      <section className="story-header">
        <button className="back-control" onClick={() => onNavigate("theme")}><Icon name="arrow" /> {initialTheme.short}</button>
        <div className="story-title">
          <span className="theme-tag"><Icon name={initialTheme.icon} /> NASA EIC · PIXEL SONIFICATION</span>
          <h1 className="eic-frame-heading">{resource.title}</h1>
          <p>{resource.scope}</p>
        </div>
        <div className="date-range"><span>{isVideo ? "APPROX. MODEL DATE" : isFrameSequence ? "VIDEO FRAME" : "SCAN POSITION"}</span><strong>{progressLabel}</strong><i>{resource.sourceId}</i></div>
      </section>
      <section className="eic-frame-layout">
        <figure className="eic-frame-visual">
          {isVideo ? (
            <video
              ref={videoRef}
              className="eic-frame-video"
              src={resource.asset}
              preload="metadata"
              playsInline
              muted
              aria-label={`${resource.title}, approximate model date ${selectedDate}`}
              onLoadedMetadata={handleLoadedMetadata}
              onLoadedData={sampleVideoFrame}
              onSeeked={sampleVideoFrame}
              onEnded={() => {
                pauseFrameAudio();
                setPlaying(false);
              }}
              onError={() => setFrameError("NASA's animation could not be loaded.")}
            />
          ) : (
            <>
              <img
                ref={imageRef}
                className="eic-frame-image"
                src={isFrameSequence ? `${resource.asset}/frame-${String(selectedFrameIndex + 1).padStart(3, "0")}.webp` : resource.asset}
                alt={`${resource.title}. ${resource.scope}.`}
                onLoad={() => {
                  setReady(true);
                  if (isFrameSequence) sampleSequenceFrame();
                  else sampleImageScan(position);
                }}
                onError={() => setFrameError(isFrameSequence ? "NASA's frame could not be loaded." : "NASA's image could not be loaded.")}
              />
              {!isFrameSequence && <span className="eic-frame-scan-line" style={{ left: `${position / EIC_FRAME_STEPS * 100}%` }} aria-hidden="true" />}
            </>
          )}
          <figcaption className="eic-frame-caption">
            <strong>{isVideo || isFrameSequence ? `NASA EIC FRAME · ${progressLabel}` : `NASA EIC IMAGE SCAN · ${progressLabel}`}</strong>
            <span>{resource.scope}</span>
            <span>{resource.period}</span>
          </figcaption>
          <canvas ref={canvasRef} width={96} height={48} className="eic-frame-analysis-canvas" aria-hidden="true" />
        </figure>
        <div className="eic-frame-controls">
          <div className="panel-head"><span>NASA EIC VISUAL SONIFICATION</span><span className={playing ? "playing" : ""}><i /> {frameError ? "CHECK VISUAL" : playing ? "PLAYING" : "PAUSED"}</span></div>
          <div className="eic-frame-transport">
            <button className="eic-frame-play" onClick={() => void togglePlayback()} disabled={!ready} aria-label={playing ? "Pause NASA visual sonification" : "Play NASA visual sonification"}>
              <Icon name={playing ? "pause" : "play"} /> {playing ? "PAUSE VISUAL + SOUND" : "PLAY VISUAL + SOUND"}
            </button>
            <div className="eic-frame-position"><span>{isVideo ? "APPROX. MODEL DATE" : isFrameSequence ? "VIDEO FRAME" : "SCAN POSITION"}</span><strong>{progressLabel}</strong></div>
            <label htmlFor="eic-frame-range">{isVideo ? "ANIMATION TIMELINE" : isFrameSequence ? "EXTRACTED VIDEO FRAMES" : "SPATIAL IMAGE SCAN"}</label>
            <input
              id="eic-frame-range"
              type="range"
              min="0"
              max={EIC_FRAME_STEPS}
              step="1"
              value={position}
              disabled={!ready}
              onChange={(event) => seekToPosition(Number(event.currentTarget.value))}
              aria-label={isVideo ? "NASA EIC animation frame position" : isFrameSequence ? "NASA EIC extracted frame position" : "NASA EIC image scan position"}
              aria-valuetext={isVideo ? `Approximate model date ${selectedDate}` : isFrameSequence ? `Frame ${selectedFrameIndex + 1} of ${frameCount}` : `Image scan position ${progressLabel}`}
            />
            <div className="eic-frame-range-labels"><span>{isVideo ? "25 MAR 2007" : isFrameSequence ? "FIRST FRAME" : "LEFT EDGE"}</span><span>{isVideo ? "03 MAR 2008" : isFrameSequence ? "LAST FRAME" : "RIGHT EDGE"}</span></div>
            <div className="eic-frame-readouts">
              <div><span>{isVideo || isFrameSequence ? "FRAME" : "SCAN STRIP"} BRIGHTNESS · PITCH</span><strong>{(frameFeatures.brightness * 100).toFixed(0)}%</strong></div>
              <div><span>COLOR VARIATION · OVERTONES</span><strong>{(frameFeatures.colorVariation * 100).toFixed(0)}%</strong></div>
            </div>
            {frameError && <p className="eic-frame-error" role="status">{frameError}</p>}
            <p className="eic-frame-method">{isVideo
              ? "Average frame brightness controls pitch and color variation controls added harmonics as the NASA animation plays."
              : isFrameSequence
                ? `This sequence uses ${frameCount} evenly sampled frames from the NASA animation. Brightness controls pitch and color variation controls added harmonics; frame number indicates relative position in the visualization, not an observed calendar date.`
                : "A scan moves from left to right across the static NASA image. Brightness in the sampled vertical strip controls pitch; its color variation controls added harmonics. The scan is an artistic mapping of image pixels, not a change-over-time measurement."}</p>
            <p className="eic-frame-caveat">{resource.caveat}</p>
            <a className="eic-frame-source" href={resource.sourceUrl} target="_blank" rel="noreferrer">{resource.sourceId} · source, notes & credits <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

type MonthlyStoryData = {
  locationId: string;
  metric: string;
  unit: string;
  source: { mission: string; product: string; url: string };
  scaleNote?: string;
  availabilityNote?: string;
  narrationLabel?: string;
  references?: { mission: string; product: string; url: string }[];
  qualityPolicy?: {
    acceptedPixelReliability: number[];
    marginalObservationsRetained: boolean;
    countLabel?: string;
    monthlyCounts: string;
  };
  sampling?: {
    missingMonths?: string[];
    method?: string;
    terraAquaCrossCheck?: {
      caveat: string;
      pairedPeriodMeans: {
        period: string;
        pairedMonths: number;
        terraMean: number;
        aquaMean: number;
        aquaMinusTerra: number;
      }[];
    };
    refreshRequired?: boolean;
    refreshReason?: string;
    minimumGoodPixelsPerDailyNeighborhood?: number;
    validGranulesByMonth?: Record<string, number>;
    boundarySource?: { url: string; attribution: string };
    minimumSupportForLowSupportCue?: { validDailySamples: number; validPixelSamples: number };
    pixelSupportLabel?: string;
  };
  continuity?: { maximumInterpolatedGapMonths: number; method: string };
  series: MonthlyValue[];
};

type StoryPresentation = { region: string; title: string; scaleNote?: string };

const storyDataByLocation: Record<string, MonthlyStoryData> = {
  "manila-bay": manilaBayData,
  "hagonoy-bulakan": manilaBayData,
  "tubigon-bohol": tubigonData,
  "aringay-alaska": aringayAlaskaData,
  "leyte-gulf-tacloban": leyteGulfData,
  "davao-mindanao": davaoData,
  "tacloban-leyte": taclobanData,
  "nueva-ecija-rice-belt": nuevaEcijaData,
  "benguet-vegetable-belt": benguetData,
  "negros-sugarcane-belt": negrosSugarcaneData,
  "bohol-ube-landscape": boholUbeData,
  "banaue-rice-terraces": banaueTerracesData,
  "payatas-metro-manila": payatasData,
  "valenzuela-metro-manila": valenzuelaData,
  "taal-volcano": taalData,
  "metro-manila-lockdown": metroManilaNo2Data,
  "koronadal-city": koronadalData,
  "surigao-city": odetteData,
  "cagayan-de-oro": cagayanDeOroData,
  "angat-dam": angatWaterData,
  "pantabangan-dam": pantabanganWaterData,
  "macabebe-delta": macabebeWaterData,
  "tubbataha-reefs": tubbatahaData,
  "mount-hamiguitan": mountHamiguitanData,
  "mount-apo-wildfire": mountApoWildfireData,
  "philippines-global-co2": philippinesGlobalCo2Data,
  "metro-cebu-energy": metroCebuEnergyData,
  "iloilo-city-energy": iloiloCityEnergyData,
  "bogo-cebu-tino": bogoTinoData,
};

const secondaryStoryDataByLocation: Record<string, MonthlyStoryData> = {};

const tertiaryStoryDataByLocation: Record<string, MonthlyStoryData> = {
  "tacloban-leyte": haiyanData,
};

const storyPresentationByLocation: Record<string, StoryPresentation> = {
  "manila-bay": { region: "National Capital Region", title: "A regional sea-level record" },
  "hagonoy-bulakan": {
    region: "Central Luzon",
    title: "Two Bulacan communities living with the tide",
    scaleNote: "The marker is an approximate midpoint between the Hagonoy and Bulakan municipal centers, not a surveyed point for Isla Pugad or Sitio Pariahan. The displayed monthly sea-surface-height series is the existing NASA-SSH 0.5° open-water grid cell centered at 14.75°N, 120.75°E, about 9.5 km from that marker. It is regional ocean context only: it cannot measure land subsidence, high-tide frequency, or flooding at either community. The cited report notes that Pugad-specific subsidence studies are lacking.",
  },
  "tubigon-bohol": { region: "Central Visayas", title: "Islands shaped by earthquake and tide" },
  "aringay-alaska": { region: "Ilocos Region", title: "A village shoreline reshaped by earthquake and sea" },
  "leyte-gulf-tacloban": { region: "Eastern Visayas", title: "A regional sea-level record" },
  "davao-mindanao": { region: "Davao Region", title: "The Ocean Has Its Own Rhythm: Davao and the Changing Mindanao Current" },
  "tacloban-leyte": { region: "Eastern Visayas", title: "Storms, rainfall, and nighttime radiance in Tacloban" },
  "nueva-ecija-rice-belt": { region: "Central Luzon", title: "A harvest written in green" },
  "benguet-vegetable-belt": { region: "Cordillera Administrative Region", title: "Highland farms, seen through the seasons" },
  "negros-sugarcane-belt": { region: "Negros Island Region", title: "Greenness across the sugar belt" },
  "bohol-ube-landscape": { region: "Central Visayas", title: "Central Bohol greenness, not a crop-yield record" },
  "banaue-rice-terraces": { region: "Cordillera Administrative Region", title: "Greenness around Banaue, not a terrace survey" },
  "payatas-metro-manila": { region: "National Capital Region", title: "Aerosol through the seasons" },
  "valenzuela-metro-manila": { region: "National Capital Region", title: "City air, seen from above" },
  "taal-volcano": { region: "CALABARZON · Batangas, Cavite, Laguna", title: "Taal's volcanic SO₂ plumes and vog" },
  "metro-manila-lockdown": { region: "National Capital Region", title: "Metro Manila's NO₂ column before and during lockdown" },
  "koronadal-city": { region: "SOCCSKSARGEN · South Cotabato", title: "Smoke haze in Koronadal's fall seasons" },
  "surigao-city": { region: "Caraga", title: "Night Lights Through Change in Surigao City" },
  "cagayan-de-oro": { region: "Northern Mindanao", title: "Rainfall Through Time in Cagayan de Oro" },
  "angat-dam": { region: "Central Luzon", title: "Nearly four decades of change at Angat Reservoir" },
  "pantabangan-dam": { region: "Central Luzon", title: "Pantabangan Reservoir, seen across generations" },
  "macabebe-delta": { region: "Central Luzon", title: "Macabebe's changing waters in the North Manila Bay delta" },
  "tubbataha-reefs": { region: "MIMAROPA", title: "Heat stress at the heart of a reef sanctuary" },
  "mount-hamiguitan": { region: "Davao Region", title: "Vegetation at a mountain biodiversity sanctuary" },
  "mount-apo-wildfire": { region: "Davao Region", title: "Mount Apo's 2016 fire: greenness is not a burn scar" },
  "philippines-global-co2": { region: "Philippines · global context", title: "A shared atmosphere: the global rise in CO₂" },
  "metro-cebu-energy": { region: "Central Visayas", title: "Cebu after dark: energy and changing city lights" },
  "iloilo-city-energy": { region: "Western Visayas", title: "Iloilo after dark: energy and changing city lights" },
  "bogo-cebu-tino": { region: "Central Visayas · Northern Cebu", title: "Typhoon Tino: rainfall and lights in Bogo City" },
};

type DatasetSource = MonthlyStoryData["source"];
type DatasetResource = DatasetSource & { usedBy: string[] };

const projectDatasets = Array.from(new Map(
  [
    ...Object.values(storyDataByLocation),
    ...Object.values(secondaryStoryDataByLocation),
    ...Object.values(tertiaryStoryDataByLocation),
  ].map((dataset) => [dataset.locationId, dataset] as const),
).values());

function collectDatasetResources(selectSources: (dataset: MonthlyStoryData) => DatasetSource[]): DatasetResource[] {
  const collected = new Map<string, DatasetSource & { usedBy: Set<string> }>();
  for (const dataset of projectDatasets) {
    const usedBy = locations
      .filter((location) => [
        storyDataByLocation[location.id],
        secondaryStoryDataByLocation[location.id],
        tertiaryStoryDataByLocation[location.id],
      ].some((candidate) => candidate?.locationId === dataset.locationId))
      .map((location) => location.name);
    for (const source of selectSources(dataset)) {
      const key = `${normalizeResourceUrl(source.url)}|${source.product}`;
      const resource = collected.get(key) ?? { ...source, usedBy: new Set<string>() };
      for (const locationName of usedBy) resource.usedBy.add(locationName);
      if (!usedBy.length) resource.usedBy.add(dataset.locationId);
      collected.set(key, resource);
    }
  }
  return Array.from(collected.values(), ({ usedBy, ...source }) => ({ ...source, usedBy: [...usedBy] }));
}

const dataProductResources = collectDatasetResources((dataset) => [dataset.source]);
const primaryProductKeys = new Set(dataProductResources.map((source) => `${normalizeResourceUrl(source.url)}|${source.product}`));
const productReferenceResources = collectDatasetResources((dataset) => dataset.references ?? [])
  .filter((source) => !primaryProductKeys.has(`${normalizeResourceUrl(source.url)}|${source.product}`));

const trendContextSources = [
  { title: "PAGASA scientist warns anew on rising sea levels in the Philippines", publisher: "ABS-CBN", url: "https://news.abs-cbn.com/spotlight/04/30/22/pagasa-scientist-warns-anew-on-rising-sea-levels-in-ph" },
  { title: "Coastal sea-level trends in Manila Bay", publisher: "UP Diliman / ACRS 2013", url: "https://a-a-r-s.org/proceeding/ACRS2013/Abstracts/SC03/Abstract_ACRS2013_ReyesSR_BlancoAC.pdf" },
  { title: "Rise or fall? How local factors influence coastal sea level in the Philippines", publisher: "Philippine Engineering Journal", url: "https://journals.upd.edu.ph/index.php/pej/article/view/9137" },
  { title: "Period-Lengthening of the Mindanao Current Variability From the Long-Term Tide Gauge Sea Level Measurements", publisher: "Journal of Geophysical Research: Oceans", url: "https://doi.org/10.1029/2020JC016932" },
  { title: "Philippine Climate Change Assessment (PHILCCA 2024)", publisher: "PAGASA", url: "https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20PUBLICATIONS/Philippine%20Climate%20Change%20Assessment_.pdf" },
  { title: "Characterization, source apportionment and associated health risk assessment of respirable air particulates in Metro Manila, Philippines", publisher: "Atmospheric Pollution Research", url: "https://doi.org/10.1016/j.apr.2022.101379" },
  { title: "Impact of Mixed Sources on the Atmospheric Aerosols of Urbanized Areas in the Philippines", publisher: "Aerosol and Air Quality Research", url: "https://doi.org/10.4209/aaqr.230122" },
];

const nasaChallengeResources = [
  { category: "EIC library", title: "Earth Information Center Content Database", description: "NASA SVS visualizations used across Earth Information Center dashboards.", url: "https://svs.gsfc.nasa.gov/gallery/earth-information-center/" },
  { category: "Sonification example", title: "Data Sonification: Caldwell 73", description: "NASA's example of translating image position and brightness into sound.", url: "https://svs.gsfc.nasa.gov/13786/" },
  { category: "Night lights", title: "Change in Night Lights between 2012 and 2023 - EIC Version", description: "The EIC Energy theme spatially scans a still from this global Black Marble visualization; it is not city-level energy data.", url: "https://svs.gsfc.nasa.gov/5313/" },
  { category: "Ocean", title: "Global Sea Surface Currents and Temperature", description: "NASA ECCO2 modeled animation drives frame sonification in the Sea Level Change theme; it is global ocean context, not sea-level data.", url: "https://svs.gsfc.nasa.gov/3912/#media_group_349716" },
  { category: "Atmosphere", title: "GEOS Aerosols", description: "Static NASA GEOS aerosol visualization is spatially scanned for the Wildfires theme; smoke is one global aerosol category, not local fire data.", url: "https://svs.gsfc.nasa.gov/5669/" },
  { category: "Atmosphere", title: "Air Quality Model Runs", description: "A sequence of 24 evenly sampled frames from NASA's GEOS-CF North American animation drives sonification in the Air Quality theme; this is modeled 2024 context, not a local measurement.", url: "https://svs.gsfc.nasa.gov/5533/" },
  { category: "Ocean", title: "Perpetual Ocean 2: Western Boundary Currents", description: "Visual maps of major ocean boundary currents.", url: "https://svs.gsfc.nasa.gov/5425/" },
  { category: "Climate", title: "DYAMOND Global Carbon Dioxide", description: "A sequence of 24 evenly sampled frames from NASA's global modeled CO₂ animation drives the Greenhouse Gases theme; global context, Jan–Mar 2020, not local emissions.", url: "https://svs.gsfc.nasa.gov/5196/" },
  { category: "Weather", title: "Lightning Events Detected from the ISS, 2017-2023", description: "A sequence of 24 evenly sampled frames from NASA's global lightning animation drives the Disasters theme; detections are not a specific Philippine disaster.", url: "https://svs.gsfc.nasa.gov/5011/" },
  { category: "Weather", title: "A 3D View of an Atmospheric River from an Earth System Model", description: "A sequence of 24 evenly sampled MERRA-2 animation frames provides weather context for Water Resources and Agriculture, not a local rainfall or crop record.", url: "https://svs.gsfc.nasa.gov/4960/" },
  { category: "Biosphere", title: "GEDI Forest Height", description: "A sequence of 24 evenly sampled frames from NASA's global GEDI canopy-height animation drives the Biodiversity theme; forest structure is not a species measure.", url: "https://svs.gsfc.nasa.gov/4950/" },
  { category: "Black Marble", title: "Black Marble: Night Lights of the World", description: "NASA SVS visualization cited as context for the app's city-light stories.", url: "https://svs.gsfc.nasa.gov/5276/" },
];

function resourceMatches(query: string, ...values: (string | undefined)[]) {
  const normalized = query.trim().toLowerCase();
  return !normalized || values.filter(Boolean).join(" ").toLowerCase().includes(normalized);
}

function formatObservedValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(value);
}

function chartValue(point: MonthlyValue | undefined) {
  return point?.value ?? point?.interpolatedValue ?? null;
}

const eventLocations: Record<string, { label: string; coordinates?: string }> = {
  "taal-volcano-2020-01-12-eruption": { label: "Taal Volcano and southern Luzon", coordinates: "Volcano reference: 14.002° N, 120.993° E; plume extent varies by day." },
  "taal-volcano-2021-06-28-so2-plumes": { label: "Taal Volcano; plume reported across southern and central Luzon", coordinates: "Volcano reference: 14.002° N, 120.993° E; PHIVOLCS reported satellite plume detections on 28–29 June." },
  "manila-bay-1998-01-el-nino-pulls-the-bay-down": { label: "Manila Bay regional record" },
  "manila-bay-1998-12-la-nina-pushes-it-back-up": { label: "Manila Bay regional record" },
  "manila-bay-2008-12-highest-month": { label: "Manila Bay regional record; Cagayan de Oro source context", coordinates: "Cagayan de Oro: 8.4542° N, 124.6319° E" },
  "manila-bay-2011-01-la-nina-eastern-visayas-floods": { label: "Manila Bay regional record; Eastern Visayas context" },
  "manila-bay-2016-04-el-nino-again": { label: "Manila Bay regional record" },
  "manila-bay-2023-12-sea-dips-before-drought": { label: "Manila Bay regional record; Philippine drought context" },
  "manila-bay-2006-land-sinking": { label: "Metro Manila and Manila Bay land subsidence context", coordinates: "Manila Bay: 14.5167° N, 120.7667° E" },
  "manila-bay-2011-09-pedring": { label: "Manila seawall and Manila Bay", coordinates: "Manila Bay: 14.5167° N, 120.7667° E" },
  "manila-bay-2017-03-mangroves-tibaguin": { label: "Tibaguin, Bulacan", coordinates: "Approx. 14.75° N, 120.83° E" },
  "manila-bay-2025-09-pugad-island": { label: "Pugad Island, Bulacan", coordinates: "Approx. 14.77° N, 120.91° E" },
  "surigao-city-2017-02-earthquake": { label: "Surigao City and Mabua, Surigao del Norte", coordinates: "USGS epicenter: 11 km north of Mabua" },
  "surigao-city-2021-12-odette-landfall": { label: "Surigao City data point · regional event context", coordinates: "Typhoon landfall was on Siargao Island, Surigao del Norte—not at the Surigao City sampling point." },
  "cagayan-de-oro-2009-01-flood": { label: "Cagayan de Oro City", coordinates: "NASA GPM IMERG grid: 8.45° N, 124.65° E" },
  "cagayan-de-oro-2011-12-sendong": { label: "Cagayan de Oro City", coordinates: "NASA GPM IMERG grid: 8.45° N, 124.65° E" },
  "cagayan-de-oro-2026-02-basyang": { label: "Northern Mindanao · Cagayan de Oro grid context", coordinates: "NASA GPM IMERG grid: 8.45° N, 124.65° E; reported upstream gauge extremes and Iligan impacts are regional context." },
  "bogo-cebu-2025-11-04-tino": { label: "Bogo City · regional storm context", coordinates: "Bogo reference: 11.05127° N, 124.00351° E; daily IMERG grid center: 11.05° N, 124.05° E." },
  "angat-dam-2025-05-below-normal": { label: "Angat Dam Reservoir", coordinates: "OpenStreetMap reservoir boundary: relation 2970167" },
  "angat-dam-2026-06-critical-level": { label: "Angat Dam Reservoir", coordinates: "OpenStreetMap reservoir boundary: relation 2970167" },
  "angat-dam-2026-09-rain-recovery": { label: "Angat Dam Reservoir", coordinates: "OpenStreetMap reservoir boundary: relation 2970167" },
  "pantabangan-dam-2024-04-old-town-emerges": { label: "Pantabangan Reservoir", coordinates: "OpenStreetMap reservoir boundary: relation 2460576" },
  "pantabangan-dam-2024-03-el-nino-drought": { label: "Pantabangan Reservoir, Nueva Ecija", coordinates: "OpenStreetMap reservoir boundary: relation 2460576" },
  "pantabangan-dam-2026-07-water-loss": { label: "Pantabangan Reservoir, Nueva Ecija", coordinates: "OpenStreetMap reservoir boundary: relation 2460576" },
  "macabebe-delta-1996-fishpond-conversion": { label: "North Manila Bay delta study area" },
  "macabebe-delta-2025-fieldwork": { label: "Macabebe, Pampanga", coordinates: "UPRI-NOAH fieldwork location; Landsat sample covers the current municipality boundary." },
  "bohol-ube-2016-02-yam-during-drought": { label: "Bohol, province-level reporting", coordinates: "Regional context for the central Bohol MODIS sample" },
  "bohol-ube-2026-06-production-expansion": { label: "Bohol and Leyte, production program reporting", coordinates: "Reported program coverage; not a mapped field" },
  "bohol-ube-2026-10-drought-crop-losses": { label: "Bohol, province-level reporting", coordinates: "Regional context for the central Bohol MODIS sample" },
  "bohol-ube-record-low-ndvi": { label: "Central Bohol MODIS sample", coordinates: "250 m Terra MODIS point sample: 9.85° N, 124.15° E" },
  "banaue-2001-unesco-danger-list": { label: "Rice Terraces of the Philippine Cordilleras", coordinates: "UNESCO World Heritage cultural landscape; five inscribed clusters across four municipalities" },
  "banaue-2004-12-record-low-ndvi": { label: "Banaue-area MODIS sample", coordinates: "250 m Terra MODIS point sample: 16.913° N, 121.06° E" },
  "banaue-2016-06-record-high-ndvi": { label: "Banaue-area MODIS sample", coordinates: "250 m Terra MODIS point sample: 16.913° N, 121.06° E" },
  "tubbataha-2020-06-heat-stress": { label: "Tubbataha Reefs Natural Park", coordinates: "Nearest valid-water NOAA 5-km grid cell: 8.825° N, 119.875° E" },
  "tubbataha-2024-06-heat-stress": { label: "Tubbataha Reefs Natural Park", coordinates: "Nearest valid-water NOAA 5-km grid cell: 8.825° N, 119.875° E" },
  "mount-hamiguitan-2014-06-unesco-inscription": { label: "Mount Hamiguitan Range Wildlife Sanctuary", coordinates: "UNESCO World Heritage property; MODIS sample at 6.6085° N, 126.1665° E" },
  "mount-hamiguitan-2023-03-record-low-ndvi": { label: "Mount Hamiguitan Range Wildlife Sanctuary", coordinates: "250 m Terra MODIS reference sample: 6.6085° N, 126.1665° E" },
};

function eventIncludesLocation(event: NotableEvent, locationId: string) {
  return (event.locationIds ?? [event.locationId]).includes(locationId);
}

function formatNotableEventDate(event: NotableEvent) {
  if (!event.month) return `${event.year}`;
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(event.year, event.month - 1, 1)));
  if (!event.day) return `${month} ${event.year}`;
  const day = event.endDay && event.endDay !== event.day
    ? `${event.day}–${event.endDay}`
    : `${event.day}`;
  return `${month} ${day}, ${event.year}`;
}

function TrendScatterplot({ series, selectedIndex, unit }: { series: MonthlyStoryData["series"]; selectedIndex: number; unit: string }) {
  const width = 800;
  const height = 300;
  const plotTop = 20;
  const plotHeight = 214;
  const plotBottom = plotTop + plotHeight;
  const leftPadding = 58;
  const rightPadding = 16;
  const observations = series.flatMap((point, index) =>
    point.value !== null && Number.isFinite(point.value) ? [{ ...point, index, value: point.value }] : [],
  );
  if (!observations.length) return null;

  const firstPoint = series[0];
  const lastPoint = series.at(-1);
  if (!firstPoint || !lastPoint) return null;
  const firstMonth = firstPoint.year * 12 + firstPoint.month;
  const lastMonth = lastPoint.year * 12 + lastPoint.month;
  const indexForMonth = (point: MonthlyValue) => point.year * 12 + point.month - firstMonth;
  const lastYearIndex = lastMonth - firstMonth;
  const meanIndex = observations.reduce((sum, point) => sum + indexForMonth(point), 0) / observations.length;
  const meanValue = observations.reduce((sum, point) => sum + point.value, 0) / observations.length;
  const variance = observations.reduce((sum, point) => sum + (indexForMonth(point) - meanIndex) ** 2, 0);
  const covariance = observations.reduce((sum, point) => sum + (indexForMonth(point) - meanIndex) * (point.value - meanValue), 0);
  const slope = variance ? covariance / variance : 0;
  const trendStart = meanValue - meanIndex * slope;
  const trendEnd = meanValue + (lastYearIndex - meanIndex) * slope;
  const values = observations.map((point) => point.value);
  const minimum = Math.min(...values, trendStart, trendEnd);
  const maximum = Math.max(...values, trendStart, trendEnd);
  const padding = (maximum - minimum || 1) * 0.1;
  const chartMinimum = minimum - padding;
  const chartMaximum = maximum + padding;
  const plotWidth = width - leftPadding - rightPadding;
  const xFor = (index: number) => leftPadding + (index / Math.max(1, lastYearIndex)) * plotWidth;
  const yFor = (value: number) => plotTop + plotHeight - ((value - chartMinimum) / (chartMaximum - chartMinimum)) * plotHeight;
  const selectedTimelinePoint = series[selectedIndex];
  const selectedPoint = selectedTimelinePoint
    ? observations.find((point) => point.year === selectedTimelinePoint.year && point.month === selectedTimelinePoint.month)
    : undefined;
  const selectedX = selectedTimelinePoint ? xFor(indexForMonth(selectedTimelinePoint)) : null;
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = chartMinimum + ((chartMaximum - chartMinimum) * index) / 4;
    return { value, y: yFor(value) };
  });
  const formatAxisValue = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(value);
  const yearTicks = series.reduce<{ year: number; index: number }[]>((ticks, point, index) => {
    if (ticks.at(-1)?.year !== point.year) ticks.push({ year: point.year, index });
    return ticks;
  }, []);
  const tickInterval = Math.max(1, Math.ceil((yearTicks.length - 1) / 6));
  const visibleYearTicks = yearTicks.filter((tick, index) => index % tickInterval === 0 || index === yearTicks.length - 1);
  return (
    <section className="trend-scatterplot" aria-labelledby="trend-scatterplot-title">
      <div className="trend-scatterplot-heading">
        <span id="trend-scatterplot-title">OBSERVATIONS / LINEAR TREND</span>
        <span className="trend-scatterplot-legend"><i className="observation-key" /> Observation <i className="trend-key" /> Trend</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Scatterplot of ${observations.length} monthly ${unit} observations with a linear trend from ${formatObservedValue(trendStart)} to ${formatObservedValue(trendEnd)}. Selected month: ${selectedPoint ? `${selectedPoint.month}/${selectedPoint.year}, ${formatObservedValue(selectedPoint.value)} ${unit}` : "no observation"}`}>
        {yTicks.map(({ value, y }) => <g key={value}>
          <line x1={leftPadding} x2={width - rightPadding} y1={y} y2={y} className="scatter-gridline" />
          <text x={leftPadding - 10} y={y + 3} textAnchor="end" className="scatter-axis-label">{formatAxisValue(value)}</text>
        </g>)}
        <line x1={leftPadding} x2={leftPadding} y1={plotTop} y2={plotBottom} className="scatter-axis-line" />
        <line x1={leftPadding} x2={width - rightPadding} y1={plotBottom} y2={plotBottom} className="scatter-axis-line" />
        {selectedX !== null && <line x1={selectedX} x2={selectedX} y1={plotTop} y2={plotBottom} className="scatter-selected-guide" />}
        <line x1={xFor(0)} y1={yFor(trendStart)} x2={xFor(lastYearIndex)} y2={yFor(trendEnd)} className="trend-line" />
        {observations.map((point) => <circle
          key={`${point.year}-${point.month}`}
          cx={xFor(indexForMonth(point))}
          cy={yFor(point.value)}
          r={point.index === selectedIndex ? 5 : 2.6}
          className={point.index === selectedIndex ? "scatter-point selected" : "scatter-point"}
        />)}
        {visibleYearTicks.map((tick) => <text key={tick.year} x={xFor(tick.index)} y="278" textAnchor={tick.index === 0 ? "start" : tick.index === lastYearIndex ? "end" : "middle"} className="chart-year-label">{tick.year}</text>)}
      </svg>
    </section>
  );
}

function ChoroplethView({ series, selectedIndex, unit, onSelectIndex }: { series: MonthlyStoryData["series"]; selectedIndex: number; unit: string; onSelectIndex: (index: number) => void }) {
  const values = series.flatMap((point) =>
    point.value !== null && Number.isFinite(point.value) ? [point.value] : [],
  );
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 1;
  const range = maximum - minimum;
  const barWidth = 800;
  const barHeight = 24;
  const gradientId = `choropleth-spectrum-${useId().replace(/:/g, "")}`;
  const selectedPoint = series[selectedIndex];
  const monthName = selectedPoint
    ? new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(selectedPoint.year, selectedPoint.month - 1, 1)))
    : "";
  const selectFromPointer = (event: React.MouseEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    onSelectIndex(Math.min(series.length - 1, Math.floor(ratio * series.length)));
  };
  const selectFromKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex = Math.min(series.length - 1, selectedIndex + 1);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex = Math.max(0, selectedIndex - 1);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = series.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      onSelectIndex(nextIndex);
    }
  };

  return (
    <section className="choropleth-view" aria-label="Monthly data choropleth">
      <div className="choropleth-heading">
        <span>MONTHLY VALUES <i /> LOW TO HIGH</span>
        <span>{series.filter((point) => point.value !== null).length} OBSERVED{series.some((point) => point.isInterpolated) ? ` · ${series.filter((point) => point.isInterpolated).length} ESTIMATED` : ""}</span>
      </div>
      <div className="choropleth-bar-wrap">
        <svg
          className="choropleth-bar"
          viewBox={`0 0 ${barWidth} ${barHeight}`}
          preserveAspectRatio="none"
          role="slider"
          aria-label="Monthly data color timeline"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={series.length - 1}
          aria-valuenow={selectedIndex}
          aria-valuetext={selectedPoint ? `${monthName} ${selectedPoint.year}: ${selectedPoint.isInterpolated ? "estimated " : ""}${formatObservedValue(chartValue(selectedPoint))} ${unit}` : "No data"}
          tabIndex={0}
          onClick={selectFromPointer}
          onKeyDown={selectFromKey}
        >
          <title>{selectedPoint ? `${monthName} ${selectedPoint.year} · ${selectedPoint.isInterpolated ? "estimated " : ""}${formatObservedValue(chartValue(selectedPoint))} ${unit}` : "Monthly values"}</title>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
              {series.map((point, index) => {
            const value = chartValue(point);
            const intensity = value === null || !Number.isFinite(value) || !range
              ? null
              : (value - minimum) / range;
            const hue = intensity === null ? 0 : Math.round(270 * (1 - intensity));
                return <stop
                  key={`${point.year}-${point.month}`}
                  offset={`${series.length > 1 ? index / (series.length - 1) * 100 : 50}%`}
                  stopColor={intensity === null ? "var(--border)" : `hsl(${hue} 92% 55%)`}
                  stopOpacity={intensity === null ? 0.35 : point.isInterpolated ? 0.55 : 1}
                />;
              })}
            </linearGradient>
          </defs>
          <rect x="0" y="0" width={barWidth} height={barHeight} fill={`url(#${gradientId})`} />
          <line
            x1={(selectedIndex + 0.5) / series.length * barWidth}
            x2={(selectedIndex + 0.5) / series.length * barWidth}
            y1="0"
            y2={barHeight}
            className="choropleth-selection"
            pointerEvents="none"
          />
        </svg>
        <div className="choropleth-time-labels">
          <span>{series[0]?.year}</span>
          <span>{selectedPoint ? `${monthName} ${selectedPoint.year}` : ""}</span>
          <span>{series.at(-1)?.year} · LATEST</span>
        </div>
      </div>
      <div className="choropleth-footer"><span>LOW · {formatObservedValue(minimum)}</span><i /><span>HIGH · {formatObservedValue(maximum)}</span></div>
    </section>
  );
}

function DataChart({ series, selectedIndex, unit, events, onSelectIndex }: { series: MonthlyStoryData["series"]; selectedIndex: number; unit: string; events: NotableEvent[]; onSelectIndex: (index: number) => void }) {
  const [visualization, setVisualization] = useState<"line" | "choropleth" | "scatterplot">("line");
  const [activeEvent, setActiveEvent] = useState<NotableEvent | null>(null);
  const [articleEvent, setArticleEvent] = useState<NotableEvent | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 0, height: 190 });
  const articleRef = useRef<HTMLElement | null>(null);
  const closeArticleRef = useRef<HTMLButtonElement | null>(null);
  const readMoreRef = useRef<HTMLButtonElement | null>(null);
  const plotRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: plotWidth, height: plotHeight } = entry.contentRect;
      setPlotSize((previous) => previous.width === plotWidth && previous.height === plotHeight
        ? previous
        : { width: plotWidth, height: plotHeight });
    });
    observer.observe(plot);
    return () => observer.disconnect();
  }, [visualization]);

  const closeArticle = () => {
    setArticleEvent(null);
    window.requestAnimationFrame(() => readMoreRef.current?.focus());
  };

  useEffect(() => {
    if (!articleEvent) return;
    closeArticleRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeArticle();
      if (event.key !== "Tab" || !articleRef.current) return;
      const focusable = [...articleRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex='0']")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [articleEvent]);
  const width = 800;
  const height = 215;
  const viewHeight = 260;
  const numericPoints = series.flatMap((point, index) => {
    const value = chartValue(point);
    return value !== null && Number.isFinite(value)
      ? [{ index, value, isInterpolated: Boolean(point.isInterpolated) }]
      : [];
  });
  const validValues = series.flatMap((point) =>
    point.value !== null && Number.isFinite(point.value) ? [point.value] : [],
  );
  const minimum = validValues.length ? Math.min(...validValues) : 0;
  const maximum = validValues.length ? Math.max(...validValues) : 1;
  const padding = (maximum - minimum || 1) * 0.08;
  const chartMinimum = minimum - padding;
  const chartMaximum = maximum + padding;
  const firstPoint = series[0];
  const lastPoint = series.at(-1);
  const firstMonth = firstPoint ? firstPoint.year * 12 + firstPoint.month : 0;
  const lastMonth = lastPoint ? lastPoint.year * 12 + lastPoint.month : 0;
  const xFor = (index: number) => {
    const point = series[index];
    return (((point.year * 12 + point.month) - firstMonth) / Math.max(1, lastMonth - firstMonth)) * width;
  };
  const yFor = (value: number) => height - ((value - chartMinimum) / (chartMaximum - chartMinimum)) * height;
  let lastLineIndex = -1;
  const observedPoints = numericPoints.filter((point) => !point.isInterpolated);
  const linePath = observedPoints.map(({ index, value }) => {
    const hasContinuousMonth = lastLineIndex >= 0
      && series[index].year * 12 + series[index].month
        === series[lastLineIndex].year * 12 + series[lastLineIndex].month + 1;
    const command = index === lastLineIndex + 1 && hasContinuousMonth ? "L" : "M";
    lastLineIndex = index;
    return `${command}${xFor(index)},${yFor(value)}`;
  }).join(" ");
  const estimatedLinePath = numericPoints.flatMap((point, index) => {
    const next = numericPoints[index + 1];
    if (!next || (!point.isInterpolated && !next.isInterpolated)) return [];
    if (next.index !== point.index + 1) return [];
    return [`M${xFor(point.index)},${yFor(point.value)} L${xFor(next.index)},${yFor(next.value)}`];
  }).join(" ");
  const gapLinePath = observedPoints.flatMap((point, index) => {
    const next = observedPoints[index + 1];
    if (!next) return [];
    const missingMonths = series[next.index].year * 12 + series[next.index].month
      - (series[point.index].year * 12 + series[point.index].month) - 1;
    if (missingMonths < 1 || series.slice(point.index + 1, next.index).some((item) => item.isInterpolated)) return [];
    return [`M${xFor(point.index)},${yFor(point.value)} L${xFor(next.index)},${yFor(next.value)}`];
  }).join(" ");
  const hasCalendarGap = series.some((point, index) => index > 0
    && point.year * 12 + point.month
      > series[index - 1].year * 12 + series[index - 1].month + 1)
    || series.some((point) => chartValue(point) === null);
  const areaPoints = numericPoints.length === series.length
    && !series.some((point) => point.isInterpolated)
    && !hasCalendarGap
    ? `${xFor(0)},${height} ${numericPoints.map(({ index, value }) => `${xFor(index)},${yFor(value)}`).join(" ")} ${xFor(series.length - 1)},${height}`
    : "";
  const current = series[selectedIndex];
  const markerX = xFor(selectedIndex);
  const currentValue = chartValue(current);
  const markerY = currentValue !== null && Number.isFinite(currentValue) ? yFor(currentValue) : null;
  const yearTicks = series.reduce<{ year: number; index: number }[]>((ticks, point, index) => {
    if (ticks.at(-1)?.year !== point.year) ticks.push({ year: point.year, index });
    return ticks;
  }, []);
  const tickInterval = Math.max(1, Math.ceil((yearTicks.length - 1) / 6));
  const visibleYearTicks = yearTicks.filter((tick, index) => index % tickInterval === 0 || index === yearTicks.length - 1);
  const markerRadius = 6;
  const markerGap = 5;
  const clearanceInViewBox = ((markerRadius + markerGap + 1) / plotSize.height) * viewHeight;
  const laneStepInViewBox = ((markerRadius * 2 + markerGap) / plotSize.height) * viewHeight;
  const pointRadius = plotSize.width > 0
    ? Math.ceil(((markerRadius + markerGap + 1) * (series.length - 1)) / plotSize.width) + 1
    : 16;
  const markersPerSide: Record<"above" | "below", number[]> = { above: [], below: [] };
  const eventMarkers = events.flatMap((event) => {
    let eventIndex = -1;
    if (event.month) {
      eventIndex = series.findIndex((point) => point.year === event.year && point.month === event.month);
    } else {
      let closestMonthDistance = Infinity;
      series.forEach((point, index) => {
        if (point.year !== event.year) return;
        const monthDistance = Math.abs(point.month - 6.5);
        if (monthDistance < closestMonthDistance) {
          closestMonthDistance = monthDistance;
          eventIndex = index;
        }
      });
    }
    if (eventIndex < 0) return [];
    const eventValue = chartValue(series[eventIndex]);
    const previousValue = chartValue(series[Math.max(0, eventIndex - 1)]);
    const nextValue = chartValue(series[Math.min(series.length - 1, eventIndex + 1)]);
    const localSeries = series.slice(Math.max(0, eventIndex - pointRadius), Math.min(series.length, eventIndex + pointRadius + 1));
    const localValues = localSeries.flatMap((point) => {
      const value = chartValue(point);
      return value !== null && Number.isFinite(value) ? [value] : [];
    });
    if (!localValues.length) return [];
    const isPeak = eventValue !== null && previousValue !== null && nextValue !== null
      && Number.isFinite(eventValue) && Number.isFinite(previousValue) && Number.isFinite(nextValue)
      && eventValue >= previousValue && eventValue >= nextValue;
    const isValley = eventValue !== null && previousValue !== null && nextValue !== null
      && Number.isFinite(eventValue) && Number.isFinite(previousValue) && Number.isFinite(nextValue)
      && eventValue <= previousValue && eventValue <= nextValue;
    const side = isPeak && !isValley
      ? "above"
      : isValley && !isPeak
        ? "below"
        : markersPerSide.above.length <= markersPerSide.below.length ? "above" : "below";
    const localMinimum = Math.min(...localValues);
    const localMaximum = Math.max(...localValues);
    const localEdge = side === "above" ? yFor(localMaximum) : yFor(localMinimum);
    const markerX = xFor(eventIndex) / width * 100;
    const markerPixelX = markerX / 100 * plotSize.width;
    const lane = markersPerSide[side].findIndex((lastX) => lastX === undefined || Math.abs(markerPixelX - lastX) >= markerRadius * 2 + markerGap);
    const markerLane = lane < 0 ? markersPerSide[side].length : lane;
    markersPerSide[side][markerLane] = markerPixelX;
    const markerY = localEdge + (side === "above" ? -1 : 1) * (clearanceInViewBox + markerLane * laneStepInViewBox);
    return [{ event, markerX, markerY, side }];
  });
  return (
    <div className={`chart-wrap chart-wrap-${visualization}`}>
      <div className="chart-view-toolbar">
        <div className="chart-view-switcher" role="group" aria-label="Choose chart view">
          {([
            ["line", "Line"],
            ["choropleth", "Choropleth"],
            ["scatterplot", "Scatterplot"],
          ] as const).map(([view, label]) => (
            <button key={view} type="button" aria-pressed={visualization === view} className={visualization === view ? "active" : ""} onClick={() => { setActiveEvent(null); setVisualization(view); }}>{label}</button>
          ))}
        </div>
        <div className="chart-view-readout" title={current.reviewNote}><span>{current.year}-{String(current.month).padStart(2, "0")}{current.isInterpolated ? " · ESTIMATE" : chartValue(current) === null ? " · NO DATA" : current.reviewNote ? " · REVIEW" : ""}</span><strong>{current.isInterpolated ? "~" : ""}{formatObservedValue(chartValue(current))} <small>{unit}</small></strong></div>
      </div>
      <div className="chart-visualization">
      {visualization === "line" && <div className="line-chart-view">
        <div className="line-chart-heading">
          <span>MONTHLY OBSERVATION</span>
          <span className="chart-data-key">
            {series.filter((point) => point.value !== null).length} OBSERVED
            {series.some((point) => point.isInterpolated) && <span><i className="chart-key-estimate" />ESTIMATED</span>}
            {hasCalendarGap && <span><i className="chart-key-gap" />MISSING INTERVAL</span>}
          </span>
        </div>
        <div className="line-chart-stage">
          <svg ref={plotRef} viewBox={`0 0 ${width} ${viewHeight}`} preserveAspectRatio="none" role="img" aria-label={`Monthly data chart, ${current.year}: ${current.isInterpolated ? "estimated " : ""}${formatObservedValue(chartValue(current))} ${unit}`}>
            <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".3" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
            {[0, 1, 2, 3, 4].map(i => <line key={i} x1="0" x2={width} y1={i * (height / 4)} y2={i * (height / 4)} className="chart-gridline" />)}
            {areaPoints && <polygon points={areaPoints} fill="url(#area)" />}
            <path d={linePath} fill="none" vectorEffect="non-scaling-stroke" className="chart-line" />
            {estimatedLinePath && <path d={estimatedLinePath} fill="none" vectorEffect="non-scaling-stroke" className="chart-line chart-line-estimated" />}
            {gapLinePath && <path d={gapLinePath} fill="none" vectorEffect="non-scaling-stroke" className="chart-line chart-line-gap" />}
            {numericPoints.filter((point) => point.isInterpolated).map((point) => <circle
              key={`estimate-${series[point.index].year}-${series[point.index].month}`}
              cx={xFor(point.index)}
              cy={yFor(point.value)}
              r="3.5"
              className="chart-estimated-point"
              vectorEffect="non-scaling-stroke"
            />)}
            {visibleYearTicks.map((tick) => <line key={tick.year} x1={xFor(tick.index)} x2={xFor(tick.index)} y1="0" y2={height} className="chart-gridline" opacity=".35" />)}
            {markerY !== null && <>
              <line x1={markerX} x2={markerX} y1="0" y2={height} className="marker-line" vectorEffect="non-scaling-stroke" />
              <circle cx={markerX} cy={markerY} r="7" className="marker-dot" vectorEffect="non-scaling-stroke" />
            </>}
            {visibleYearTicks.map((tick) => <text key={tick.year} x={xFor(tick.index)} y="245" textAnchor={tick.index === 0 ? "start" : tick.index === series.length - 1 ? "end" : "middle"} className="chart-year-label">{tick.year}</text>)}
          </svg>
          <div className="notable-event-layer" role="group" aria-label="Notable events aligned to chart dates">
            {eventMarkers.map(({ event, markerX, markerY, side }) => {
              const date = formatNotableEventDate(event);
              return (
                <button
                  key={event.id}
                  type="button"
                  className={`notable-event-marker ${event.kind === "context" ? "context-marker" : "data-marker"}`}
                  style={{ left: `${markerX}%`, top: `${markerY / viewHeight * 100}%` }}
                  title={`${date} · ${event.title}`}
                  aria-label={`Notable event: ${event.title}, ${formatNotableEventDate(event)}; marker placed ${side} the line`}
                  aria-haspopup="dialog"
                  aria-expanded={activeEvent === event}
                  onClick={() => setActiveEvent(activeEvent === event ? null : event)}
                />
              );
            })}
          </div>
        </div>
        <div className="notable-event-legend" aria-label="Notable event marker legend">
          <span><i className="data-marker-key" /> Visible in data</span>
          <span><i className="context-marker-key" /> Context</span>
          <p>Hollow markers show context outside the data record.</p>
        </div>
      </div>}
      {visualization === "choropleth" && <ChoroplethView series={series} selectedIndex={selectedIndex} unit={unit} onSelectIndex={onSelectIndex} />}
      {visualization === "scatterplot" && <TrendScatterplot series={series} selectedIndex={selectedIndex} unit={unit} />}
      </div>
      {activeEvent && <aside className="notable-event-popover" role="dialog" aria-label={`Notable event: ${activeEvent.title}`}>
        <button type="button" className="notable-event-close" aria-label="Close event details" onClick={() => setActiveEvent(null)}>×</button>
        <strong>{activeEvent.title}</strong>
        <span>{formatNotableEventDate(activeEvent)}</span>
        <div className="notable-event-location">
          <strong>{eventLocations[activeEvent.id]?.label ?? activeEvent.location ?? "Manila Bay"}</strong>
          {eventLocations[activeEvent.id]?.coordinates && <small>{eventLocations[activeEvent.id].coordinates}</small>}
        </div>
        <p>{summarizeNotableEvent(activeEvent.description)}</p>
        <div className="notable-event-sources">
          {activeEvent.sources.slice(0, 1).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.publisher}{source.date ? ` · ${source.date}` : ""}</a>)}
        </div>
        <button ref={readMoreRef} type="button" className="event-read-more" onClick={() => setArticleEvent(activeEvent)}>Read more <span aria-hidden="true">↗</span></button>
      </aside>}
      {articleEvent && <article ref={articleRef} className="event-article" role="dialog" aria-modal="true" aria-label={`${articleEvent.title} technical article`}>
        <header>
          <div><span>{articleEvent.kind === "context" ? "CONTEXT RECORD" : "DATA RECORD"}</span><span>{formatNotableEventDate(articleEvent)}</span></div>
          <button ref={closeArticleRef} type="button" aria-label="Close article" onClick={closeArticle}>×</button>
        </header>
        <div className="event-article-body" tabIndex={0}>
          <div className="event-article-main">
            <h2>{articleEvent.title}</h2>
            <p className="event-article-location">{eventLocations[articleEvent.id]?.label ?? (articleEvent.locationId === "tacloban-leyte" ? "Tacloban, Leyte" : "Manila Bay")}{eventLocations[articleEvent.id]?.coordinates ? ` · ${eventLocations[articleEvent.id].coordinates}` : ""}</p>
            <section><span>EVENT RECORD</span><p>{articleEvent.description}</p></section>
            {articleEvent.dataNote && <section><span>{articleEvent.locationId === "manila-bay" ? "DETRENDED SEASONAL ANOMALY" : "DATA NOTE"}</span><p className="event-article-data-note">{articleEvent.dataNote}</p></section>}
            <section><span>METHOD</span><p>Event context is presented separately from the data series and should not be interpreted as a direct measurement of the event.</p></section>
          </div>
          <aside className="event-article-references">
            <span>REFERENCES</span>
            <ol>
              {articleEvent.sources.map((source) => <li key={source.url}><strong>{source.title}</strong><span>{source.publisher}{source.date ? ` · ${source.date}` : ""}</span><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></li>)}
            </ol>
          </aside>
        </div>
      </article>}
    </div>
  );
}

export function StoryDetail({ initialTheme, selectedLocation, onNavigate, initialMetric = "primary" }: { initialTheme: Theme; selectedLocation: Location; onNavigate: (screen: Screen) => void; initialMetric?: "primary" | "secondary" | "tertiary" }) {
  const primaryDataset = storyDataByLocation[selectedLocation.id];
  const secondaryDataset = secondaryStoryDataByLocation[selectedLocation.id];
  const tertiaryDataset = tertiaryStoryDataByLocation[selectedLocation.id];
  const presentation = storyPresentationByLocation[selectedLocation.id];
  const [selectedMetric, setSelectedMetric] = useState<"primary" | "secondary" | "tertiary">(
    initialMetric === "tertiary" && tertiaryDataset
      ? "tertiary"
      : initialMetric === "secondary" && secondaryDataset
        ? "secondary"
        : "primary",
  );
  const dataset = selectedMetric === "tertiary" && tertiaryDataset
    ? tertiaryDataset
    : selectedMetric === "secondary" && secondaryDataset
      ? secondaryDataset
      : primaryDataset;
  const terraAquaPeriods = dataset.sampling?.terraAquaCrossCheck?.pairedPeriodMeans;
  const terraAquaPre2020 = terraAquaPeriods?.find((period) => period.period === "2002-07 to 2019-12");
  const terraAquaPost2020 = terraAquaPeriods?.find((period) => period.period === "2020-01 onward");
  const terraAquaCaveat = dataset.sampling?.terraAquaCrossCheck?.caveat;
  const eventOnlyDataset = dataset.metric === "event_context_only" || dataset.metric === "study_context_only";
  const contextOnlyLabel = dataset.metric === "study_context_only" ? "STUDY CONTEXT" : "EVENT CONTEXT";
  const timeline = useMemo(
    () => dataset.continuity
      ? interpolateShortMonthlyGaps(dataset.series, dataset.continuity.maximumInterpolatedGapMonths)
      : dataset.series,
    [dataset],
  );
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, timeline.length - 1));
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [narration, setNarration] = useState(true);
  const [audioError, setAudioError] = useState(false);
  const point = timeline[selectedIndex] ?? null;
  const hasObservations = dataset.series.length > 0;
  const years = dataset.series.map((item) => item.year);
  const latestPoint = dataset.series.at(-1) ?? null;
  const partialCurrentYear = latestPoint !== null && latestPoint.year === new Date().getFullYear() && latestPoint.month < 12;
  const formatMonth = (item: MonthlyValue) => new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(item.year, item.month - 1, 1)));
  const selectedDate = point ? `${formatMonth(point)} ${point.year}` : "No valid observation";
  const locationEvents = notableEvents.filter((event) => eventIncludesLocation(event, selectedLocation.id));
  const validValues = dataset.series.flatMap((item) =>
    item.value !== null && Number.isFinite(item.value) ? [item.value] : [],
  );
  const minimum = validValues.length ? Math.min(...validValues) : 0;
  const maximum = validValues.length ? Math.max(...validValues) : 1;
  const reading = chartValue(point ?? undefined);
  const normalizedValue = reading === null || !Number.isFinite(reading) || maximum === minimum
    ? 0.5
    : (reading - minimum) / (maximum - minimum);
  const intensity = Math.round(normalizedValue * 100);
  const bars = useMemo(() => Array.from({ length: 48 }, (_, i) => 18 + ((i * 29 + intensity * (i % 5 + 1)) % 76)), [intensity]);
  const audioThemeByLocation: Record<string, AudioTheme> = {
    "manila-bay": "sea-level",
    "leyte-gulf-tacloban": "sea-level",
    "davao-mindanao": "sea-level",
    "tacloban-leyte": "disasters",
    "payatas-metro-manila": "air-quality",
    "valenzuela-metro-manila": "air-quality",
    "taal-volcano": "air-quality",
    "koronadal-city": "air-quality",
    "nueva-ecija-rice-belt": "agriculture",
    "benguet-vegetable-belt": "agriculture",
    "negros-sugarcane-belt": "agriculture",
    "bohol-ube-landscape": "agriculture",
    "banaue-rice-terraces": "agriculture",
    "surigao-city": "disasters",
    "angat-dam": "water-resources",
    "pantabangan-dam": "water-resources",
    "macabebe-delta": "water-resources",
    "tubbataha-reefs": "biodiversity",
    "mount-hamiguitan": "biodiversity",
    "mount-apo-wildfire": "disasters",
    "philippines-global-co2": "air-quality",
    "metro-cebu-energy": "energy",
    "iloilo-city-energy": "energy",
    "bogo-cebu-tino": "disasters",
  };
  const { start: startAudio, pause: pauseAudio } = useSonification({
    theme: audioThemeByLocation[selectedLocation.id],
    primarySeries: selectedMetric === "primary" ? timeline : dataset.series,
    year: point?.year ?? 2000,
    month: point?.month ?? 1,
    secondarySeries: selectedMetric === "primary" ? secondaryDataset?.series : undefined,
    muted,
  });

  useEffect(() => {
    if (!playing || !timeline.length) return;
    const timer = window.setInterval(() => {
      setSelectedIndex((current) => {
        let next = current;
        for (let offset = 0; offset < timeline.length; offset += 1) {
          next = (current + offset + 1) % timeline.length;
          const value = chartValue(timeline[next]);
          if (value !== null && Number.isFinite(value)) return next;
        }
        return current;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [playing, timeline]);

  const togglePlayback = async () => {
    if (!hasObservations) return;
    if (playing) {
      pauseAudio();
      setPlaying(false);
      return;
    }
    const preferredIndex = selectedIndex === timeline.length - 1 ? 0 : selectedIndex;
    let startIndex = -1;
    for (let offset = 0; offset < timeline.length; offset += 1) {
      const candidate = (preferredIndex + offset) % timeline.length;
      const value = chartValue(timeline[candidate]);
      if (value !== null && Number.isFinite(value)) {
        startIndex = candidate;
        break;
      }
    }
    if (startIndex < 0) return;
    setSelectedIndex(startIndex);
    setAudioError(false);
    try {
      await startAudio(timeline[startIndex].year, timeline[startIndex].month);
      setPlaying(true);
    } catch {
      setPlaying(false);
      setAudioError(true);
    }
  };
  const selectMetric = (metric: "primary" | "secondary" | "tertiary") => {
    const nextDataset = metric === "tertiary" ? tertiaryDataset : metric === "secondary" ? secondaryDataset : primaryDataset;
    if (!nextDataset) return;
    pauseAudio();
    setPlaying(false);
    setSelectedMetric(metric);
    const nextTimeline = nextDataset.continuity
      ? interpolateShortMonthlyGaps(nextDataset.series, nextDataset.continuity.maximumInterpolatedGapMonths)
      : nextDataset.series;
    setSelectedIndex(Math.max(0, nextTimeline.length - 1));
  };
  return (
    <main className="app-screen story-screen map-screen themed" style={{ "--accent": initialTheme.color } as React.CSSProperties}>
      <Header onNavigate={onNavigate} compact />
      <section className="story-header">
        <button className="back-control" onClick={() => onNavigate("location")}><Icon name="arrow" /> LOCATION VIEW</button>
        <div className="story-title">
          <span className="theme-tag"><Icon name={initialTheme.icon} /> {initialTheme.name}</span>
          <h1>{selectedLocation.name}</h1>
          <p>{presentation.region}</p>
        </div>
        <div className="date-range"><span>{eventOnlyDataset ? contextOnlyLabel : partialCurrentYear ? "DATA RECORD · YEAR IN PROGRESS" : "DATA RECORD"}</span><strong>{years.length ? `${years[0]}—${years[years.length - 1]}` : eventOnlyDataset ? dataset.metric === "study_context_only" ? "STUDY ONLY" : "EVENTS ONLY" : "NO VALID DATA"}</strong><i>{dataset.series.length} MONTHLY OBSERVATIONS</i></div>
      </section>
      <div className="example-switcher">
        <span>{eventOnlyDataset ? dataset.metric === "study_context_only" ? "PUBLISHED RESEARCH CONTEXT" : "DATED EVENT RECORDS" : "MONTHLY DATASET"}</span>
        {secondaryDataset || tertiaryDataset ? <>
          <button className={selectedMetric === "primary" ? "active" : ""} aria-pressed={selectedMetric === "primary"} onClick={() => selectMetric("primary")}>PRECIPITATION</button>
          {secondaryDataset && <button className={selectedMetric === "secondary" ? "active" : ""} aria-pressed={selectedMetric === "secondary"} onClick={() => selectMetric("secondary")}>WIND</button>}
          {tertiaryDataset && <button className={selectedMetric === "tertiary" ? "active" : ""} aria-pressed={selectedMetric === "tertiary"} onClick={() => selectMetric("tertiary")}>NIGHTTIME RADIANCE</button>}
        </> : <span>{dataset.metric.replace(/_/g, " ").toUpperCase()}</span>}
        <span>{dataset.series.length} SOURCE OBSERVATIONS</span>
      </div>
      <section className="story-grid">
        <GlobeViewport mode="pinpoint" locationId={selectedLocation.id} className="satellite-image story-map-frame" />
        <div className="data-panel">
          <div className="panel-head"><span>{eventOnlyDataset ? contextOnlyLabel : "DATA CHANNEL / 01"}</span><span>{eventOnlyDataset ? "NO CONTINUOUS SERIES" : "MONTHLY OBSERVATION"}</span></div>
          {hasObservations ? <DataChart
              series={timeline}
              selectedIndex={selectedIndex}
              unit={dataset.unit}
              events={locationEvents}
              onSelectIndex={setSelectedIndex}
            /> : <aside className="story-no-observations" role="status">
              <span>{dataset.metric === "study_context_only" ? "NO NUMERIC SERIES BUNDLED" : eventOnlyDataset ? "NO CONTINUOUS NUMERIC SERIES" : "NO VALID SATELLITE OBSERVATIONS"}</span>
              <p>{dataset.availabilityNote ?? "No valid observations are available for this story. No values are displayed or sonified."}</p>
            </aside>}
          {!hasObservations && eventOnlyDataset && dataset.metric !== "study_context_only" && locationEvents.length > 0 && <section className="story-event-list" aria-label="Historical event markers">
            <h3>Historical event markers · separate from data observations</h3>
            <ol>
              {locationEvents.map((event) => {
                const date = formatNotableEventDate(event);
                return <li key={event.id}>
                  <strong>{date} · {event.title}</strong>
                  <p>{event.description}</p>
                  <span>{event.evidenceStatus ?? "context only (not directly measured)"}</span>
                  {event.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} · {source.publisher}</a>)}
                </li>;
              })}
            </ol>
          </section>}
          {selectedLocation.id === "tacloban-leyte" && selectedMetric === "tertiary" && <aside className="before-record-note">
            <span>Before the record</span>
            <p>In October 1897 an unnamed typhoon on a similar path caused a surge of up to 7 m and an estimated 1,228 deaths. Researchers found Haiyan's surge was about twice as high in San Pedro Bay but similar on the open Pacific coast. <a href="https://doi.org/10.1175/BAMS-D-14-00245.1" target="_blank" rel="noreferrer">Source: Soria et al. 2016</a>.</p>
          </aside>}
          {hasObservations && <div className="scrubber">
            <div className="scrub-meta"><label htmlFor="year-range">TIMELINE SCRUB</label><output>{selectedDate}</output></div>
            <input id="year-range" type="range" min="0" max={timeline.length - 1} value={selectedIndex} onChange={(e) => setSelectedIndex(Number(e.target.value))} aria-label="Data month" />
            <div className="ticks"><span>{years[0]}</span><span>{years[Math.floor(years.length / 2)]}</span><span>LATEST · {years[years.length - 1]}{partialCurrentYear ? " · PARTIAL" : ""}</span></div>
          </div>}
        </div>
        <div className="audio-panel">
          <div className="panel-head"><span>SONIFICATION / LIVE</span><span className={playing ? "playing" : ""}><i /> {audioError ? "AUDIO UNAVAILABLE" : playing ? "PLAYING" : "PAUSED"}</span></div>
          {point && reading !== null ? <div className="waveform" aria-label={`Waveform visualization for ${point.year}: ${point.isInterpolated ? "estimated " : ""}${formatObservedValue(reading)} ${dataset.unit}`}>
              {bars.map((height, i) => <i key={i} style={{ height: `${height}%`, opacity: .34 + ((i % 6) / 9) }} />)}
              <span className="playhead" style={{ left: `${(selectedIndex / Math.max(1, timeline.length - 1)) * 100}%` }} />
            </div> : <div className="waveform waveform-unavailable" role="status">No valid observations to sonify.</div>}
          <div className="transport">
            <button className="transport-main" onClick={() => void togglePlayback()} aria-label={playing ? "Pause" : "Play"} disabled={!hasObservations}><Icon name={playing ? "pause" : "play"} /></button>
            <button onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} disabled={!hasObservations}><Icon name={muted ? "muted" : "volume"} /><span>{muted ? "MUTED" : "AUDIO ON"}</span></button>
            <div className="transport-readout"><span>MONTH</span><strong>{selectedDate}</strong></div>
            <div className="transport-readout"><span>{reading === null ? "MISSING" : point?.isInterpolated ? "ESTIMATED" : "OBSERVED"}</span><strong>{point?.isInterpolated ? "~" : ""}{formatObservedValue(reading)} {point && reading !== null ? dataset.unit : ""}</strong></div>
            {point?.validDailySamples !== undefined && (!dataset.sampling?.refreshRequired && point.candidateDailySamples !== undefined
              ? <div className="transport-readout"><span>VALID / CANDIDATE DAYS</span><strong>{point.validDailySamples} / {point.candidateDailySamples}</strong></div>
              : <div className="transport-readout"><span>VALID SAMPLED DAYS · LEGACY</span><strong>{point.validDailySamples}</strong></div>)}
            {point?.qualityCounts ? <div className="transport-readout"><span>{dataset.qualityPolicy?.countLabel ?? "GOOD / MARGINAL PIXELS"}</span><strong>{point.qualityCounts.goodSamples} / {point.qualityCounts.marginalSamples}</strong></div>
              : point?.validPixelSamples !== undefined && <div className="transport-readout"><span>{dataset.sampling?.pixelSupportLabel ?? "PIXEL SUPPORT · LEGACY"}</span><strong>{point.validPixelSamples}</strong></div>}
            {point?.uncertainty !== undefined && <div className="transport-readout"><span>NOAA GLOBAL-MEAN UNCERTAINTY</span><strong>±{formatObservedValue(point.uncertainty)} ppm</strong></div>}
            {point?.validDailySamples !== undefined && (
              dataset.sampling?.minimumSupportForLowSupportCue
                ? (point.validDailySamples < dataset.sampling.minimumSupportForLowSupportCue.validDailySamples
                  || (point.validPixelSamples ?? 0) < dataset.sampling.minimumSupportForLowSupportCue.validPixelSamples)
                : dataset.sampling?.minimumGoodPixelsPerDailyNeighborhood === 5
                  && (point.validDailySamples < 2 || (point.validPixelSamples ?? 0) < 10)
            ) && <div className="transport-readout"><span>SUPPORT</span><strong>LOW</strong></div>}
            {point?.validSceneCount !== undefined && point.medianValidCoverage !== undefined && <div className="transport-readout"><span>VALID SCENES · MEDIAN COVERAGE</span><strong>{point.validSceneCount} · {(point.medianValidCoverage * 100).toFixed(0)}%</strong></div>}
          </div>
        </div>
        <article className="narrative-panel">
          <span className="index">THE STORY IN THIS SIGNAL</span>
          <h2>{presentation.title}</h2>
          <p>{selectedLocation.story}</p>
          {selectedLocation.storySources && <ul className="story-source-list" aria-label="Story sources">
            {selectedLocation.storySources.map((source) => <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
              <span>{source.publisher}{source.date ? ` · ${source.date}` : ""}</span>
            </li>)}
          </ul>}
        </article>
        <div className="caption-panel">
          <div className="caption-header">
            <span><Icon name="radio" /> LIVE NARRATION</span>
            <button className={`toggle ${narration ? "on" : ""}`} onClick={() => setNarration(!narration)} role="switch" aria-checked={narration}><i /><span>{narration ? "ON" : "OFF"}</span></button>
          </div>
          <div className="caption-feed" aria-live="polite">
            <span>CAPTION · {selectedDate}</span>
            <p>{!point || reading === null ? "No valid observation has been retrieved and quality-checked for this month; no sound is generated." : narration ? `In ${formatMonth(point)} ${point.year}, ${dataset.narrationLabel ?? `the ${initialTheme.name.toLowerCase()} record`} is ${point.isInterpolated ? "estimated at about " : ""}${formatObservedValue(reading)} ${dataset.unit}.` : "Narration is off. Turn it on to hear and read a spoken description of the data."}</p>
          </div>
        </div>
      </section>
      <div className="source-note">
        <span>DATA SOURCE / MISSION</span>
        <p>{dataset.source.mission} · {dataset.source.product} · <a href={dataset.source.url} target="_blank" rel="noreferrer">Source record</a></p>
        {terraAquaPre2020 && terraAquaPost2020 && terraAquaCaveat && <small>Terra/Aqua paired means · 2002–2019 (n={terraAquaPre2020.pairedMonths}): Terra {terraAquaPre2020.terraMean.toFixed(3)}, Aqua {terraAquaPre2020.aquaMean.toFixed(3)}, Δ {terraAquaPre2020.aquaMinusTerra > 0 ? "+" : ""}{terraAquaPre2020.aquaMinusTerra.toFixed(3)}; 2020 onward (n={terraAquaPost2020.pairedMonths}): Terra {terraAquaPost2020.terraMean.toFixed(3)}, Aqua {terraAquaPost2020.aquaMean.toFixed(3)}, Δ {terraAquaPost2020.aquaMinusTerra > 0 ? "+" : ""}{terraAquaPost2020.aquaMinusTerra.toFixed(3)}. {terraAquaCaveat}</small>}
        {dataset.sampling?.boundarySource && <small>Reservoir boundary: <a href={dataset.sampling.boundarySource.url} target="_blank" rel="noreferrer">OpenStreetMap relation 2970167</a> · {dataset.sampling.boundarySource.attribution}</small>}
        {dataset.sampling?.refreshRequired && <small className="data-refresh-warning" role="status">AOD data refresh required: {dataset.sampling.refreshReason}</small>}
        <small>{presentation.scaleNote ?? dataset.scaleNote ?? selectedLocation.dataScaleNote}</small>
      </div>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

function LegalPage({ type, onNavigate }: { type: "privacy" | "terms" | "cookies" | "community" | "about"; onNavigate: (screen: Screen) => void }) {
  const page = legalCopy[type];
  return (
    <main className="app-screen legal-screen">
      <Header onNavigate={onNavigate} compact />
      <article className="legal-content">
        <button className="back-control" onClick={() => onNavigate(type === "about" ? "landing" : "hub")}><Icon name="arrow" /> {type === "about" ? "BACK TO LANDING" : "BACK TO HUB"}</button>
        <span className="index">EARTH JUKEBOX / {type === "about" ? "ABOUT" : "DOCUMENT"}</span>
        <h1>{page.title}</h1>
        <p className="legal-updated">{page.updated}</p>
        <div className="legal-rule" />
        {page.sections.map((section, i) => <section key={section.heading}><span>{String(i + 1).padStart(2, "0")}</span><div><h2>{section.heading}</h2><p>{section.body}</p></div></section>)}
      </article>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

export function EventDetailPage({ eventId }: { eventId: string }) {
  const event = notableEvents.find((candidate) => candidate.id === eventId);
  if (!event) return <main className="event-detail-screen"><h1>Event not found</h1></main>;
  const location = eventLocations[event.id];
  return (
    <main className="app-screen event-detail-screen">
      <Header onNavigate={() => window.close()} compact />
      <article className="event-detail-content">
        <button className="back-control" onClick={() => window.close()}><Icon name="arrow" /> CLOSE WINDOW</button>
        <span className="theme-tag"><Icon name={event.kind === "context" ? "pin" : "radio"} /> {event.kind === "context" ? "CONTEXT" : "VISIBLE IN DATA"}</span>
        <h1>{event.title}</h1>
        <div className="event-detail-date">{formatNotableEventDate(event)}</div>
        <section className="event-detail-location"><span>LOCATION</span><strong>{location?.label ?? event.location ?? "Manila Bay"}</strong>{location?.coordinates && <small>{location.coordinates}</small>}</section>
        <section><span>STORY</span><p>{event.description}</p>{event.dataNote && <p className="event-detail-data-note">{event.dataNote}</p>}</section>
        <section><span>REFERENCES</span><ol className="event-reference-list">
          {event.sources.map((source, index) => <li key={source.url}><div><strong>{source.title}</strong><p>{source.publisher}{source.date ? ` · ${source.date}` : ""}</p><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></div><span>{String(index + 1).padStart(2, "0")}</span></li>)}
        </ol></section>
      </article>
      <Footer onNavigate={() => window.close()} />
    </main>
  );
}

export function ReferencesPage({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  type ResourceTabId = "products" | "documentation" | "stories" | "nasa";
  const [activeTab, setActiveTab] = useState<ResourceTabId>("products");
  const [query, setQuery] = useState("");
  const sourceLocationIds = Array.from(new Set([
    ...notableEvents.flatMap((event) => event.locationIds ?? [event.locationId]),
    ...locations.filter((location) => location.storySources?.length).map((location) => location.id),
  ]));
  const storySourceEntries: { source: { title: string; publisher: string; date?: string; url: string }; usedBy: string }[] = [];
  for (const locationId of sourceLocationIds) {
    const locationEvents = notableEvents.filter((event) => eventIncludesLocation(event, locationId));
    const location = locations.find((item) => item.id === locationId);
    const locationName = location?.name ?? locationId;
    for (const source of [
      ...locationEvents.flatMap((event) => event.sources),
      ...(location?.storySources ?? []),
    ]) storySourceEntries.push({ source, usedBy: locationName });
  }
  for (const source of trendContextSources) storySourceEntries.push({ source, usedBy: "Cross-story context" });
  const storySourceResources = collectUniqueSources(storySourceEntries);
  const visibleStorySources = storySourceResources.filter((source) =>
    resourceMatches(query, source.title, source.publisher, source.date, source.url, ...source.usedBy));
  const visibleProducts = dataProductResources.filter((resource) =>
    resourceMatches(query, resource.mission, resource.product, resource.url, ...resource.usedBy));
  const visibleDocumentation = productReferenceResources.filter((resource) =>
    resourceMatches(query, resource.mission, resource.product, resource.url, ...resource.usedBy));
  const visibleNasaResources = nasaChallengeResources.filter((resource) =>
    resourceMatches(query, resource.category, resource.title, resource.description, resource.url));
  const storySourceCount = storySourceResources.length;
  const resourceTabs: { id: ResourceTabId; label: string; count: number }[] = [
    { id: "products", label: "Data products", count: dataProductResources.length },
    { id: "documentation", label: "Product references", count: productReferenceResources.length },
    { id: "stories", label: "Story sources", count: storySourceCount },
    { id: "nasa", label: "NASA challenge", count: nasaChallengeResources.length },
  ];
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % resourceTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + resourceTabs.length) % resourceTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = resourceTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = resourceTabs[nextIndex];
    setActiveTab(nextTab.id);
    requestAnimationFrame(() => document.getElementById(`resource-tab-${nextTab.id}`)?.focus());
  };
  const activeTabLabel = resourceTabs.find((tab) => tab.id === activeTab)?.label ?? "Resources";

  return (
    <main className="app-screen legal-screen resources-screen">
      <Header onNavigate={onNavigate} compact activeScreen="references" />
      <article className="legal-content resource-content">
        <button className="back-control" onClick={() => onNavigate("landing")}><Icon name="arrow" /> BACK TO LANDING</button>
        <span className="index">EARTH JUKEBOX / RESOURCES</span>
        <h1>Resources &amp; references</h1>
        <p className="legal-updated">Explore the data products, research, reporting, and NASA visualization examples behind this project.</p>
        <div className="resource-summary" aria-label="Resource collection summary">
          <span><strong>{dataProductResources.length}</strong> DATA PRODUCTS</span>
          <span><strong>{productReferenceResources.length}</strong> PRODUCT REFERENCES</span>
          <span><strong>{storySourceCount}</strong> STORY SOURCES</span>
          <span><strong>{nasaChallengeResources.length}</strong> NASA EXAMPLES</span>
        </div>
        <div className="legal-rule" />
        <label className="resource-search">
          <span>SEARCH RESOURCES</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products, locations, publishers, or URLs"
          />
        </label>
        <div className="resource-tabs" role="tablist" aria-label="Resource categories">
          {resourceTabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`resource-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls="resource-panel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}<span>{String(tab.count).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
        <section
          id="resource-panel"
          className="resource-panel"
          role="tabpanel"
          aria-labelledby={`resource-tab-${activeTab}`}
          tabIndex={0}
        >
          <div className="resource-panel-heading">
            <div><span className="index">RESOURCE INDEX / {activeTab.toUpperCase()}</span><h2>{activeTabLabel}</h2></div>
            <span>{activeTab === "products" ? visibleProducts.length : activeTab === "documentation" ? visibleDocumentation.length : activeTab === "stories" ? visibleStorySources.length : visibleNasaResources.length} RESULTS</span>
          </div>
          {activeTab === "products" && (
            visibleProducts.length ? <div className="resource-card-grid">
              {visibleProducts.map((resource) => (
                <article className="resource-card" key={`${resource.url}|${resource.product}`}>
                  <span className="resource-card-kicker">DATA PRODUCT</span>
                  <strong>{resource.mission}</strong>
                  <h3>{resource.product}</h3>
                  <a href={resource.url} target="_blank" rel="noreferrer">OPEN DATA SOURCE <span aria-hidden="true">↗</span></a>
                  <div className="resource-used-by"><span>USED BY</span><p>{resource.usedBy.join(" · ")}</p></div>
                </article>
              ))}
            </div> : <p className="resource-empty">No data products match this search.</p>
          )}
          {activeTab === "documentation" && (
            visibleDocumentation.length ? <div className="resource-card-grid">
              {visibleDocumentation.map((resource) => (
                <article className="resource-card" key={`${resource.url}|${resource.product}`}>
                  <span className="resource-card-kicker">PRODUCT REFERENCE</span>
                  <strong>{resource.mission}</strong>
                  <h3>{resource.product}</h3>
                  <a href={resource.url} target="_blank" rel="noreferrer">OPEN REFERENCE <span aria-hidden="true">↗</span></a>
                  <div className="resource-used-by"><span>USED BY</span><p>{resource.usedBy.join(" · ")}</p></div>
                </article>
              ))}
            </div> : <p className="resource-empty">No product references match this search.</p>
          )}
          {activeTab === "stories" && (
            visibleStorySources.length ? <div className="resource-card-grid resource-source-grid">
              {visibleStorySources.map((source) => (
                <article className="resource-card" key={normalizeResourceUrl(source.url)}>
                  <span className="resource-card-kicker">STORY / EVENT SOURCE</span>
                  <h3>{source.title}</h3>
                  <p>{source.publisher}{source.date ? ` · ${source.date}` : ""}</p>
                  <a href={source.url} target="_blank" rel="noreferrer">OPEN SOURCE <span aria-hidden="true">↗</span></a>
                  <div className="resource-used-by"><span>USED BY</span><p>{source.usedBy.join(" · ")}</p></div>
                </article>
              ))}
            </div> : <p className="resource-empty">No story sources match this search.</p>
          )}
          {activeTab === "nasa" && (
            visibleNasaResources.length ? <div className="resource-card-grid nasa-resource-grid">
              {visibleNasaResources.map((resource) => (
                <article className="resource-card" key={resource.url}>
                  <span className="resource-card-kicker">{resource.category}</span>
                  <h3>{resource.title}</h3>
                  <p>{resource.description}</p>
                  <a href={resource.url} target="_blank" rel="noreferrer">OPEN NASA RESOURCE <span aria-hidden="true">↗</span></a>
                  <small>NASA challenge visualization or reference.</small>
                </article>
              ))}
            </div> : <p className="resource-empty">No NASA challenge resources match this search.</p>
          )}
        </section>
      </article>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

function Contact({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <main className="app-screen legal-screen">
      <Header onNavigate={onNavigate} compact />
      <section className="contact-layout">
        <div className="contact-copy">
          <button className="back-control" onClick={() => onNavigate("hub")}><Icon name="arrow" /> BACK TO HUB</button>
          <span className="index">GROUND CONTROL / SUPPORT</span>
          <h1>Open a channel.</h1>
          <p>Questions about a dataset, an accessibility issue, or an idea for a new place? We’re working on a way to receive messages.</p>
        </div>
        <aside className="contact-form contact-unavailable" role="status">
          <span className="index">CONTACT / NOT CONNECTED</span>
          <h2>Messages aren’t being received yet.</h2>
          <p>This contact form is not connected to an email address or submission service. Please don’t enter personal information here.</p>
        </aside>
      </section>
      <Footer onNavigate={onNavigate} />
    </main>
  );
}

export default function App() {
  const initialEventId = new URLSearchParams(window.location.search).get("event");
  const [screen, setScreen] = useState<Screen>(initialEventId ? "event-detail" : "landing");
  const [hasOpenedGlobe, setHasOpenedGlobe] = useState(false);
  const [theme, setTheme] = useState<Theme>(themes[0]);
  const [locationId, setLocationId] = useState("manila-bay");
  const globeState = useSyncExternalStore(subscribeToGlobe, getGlobeState, getGlobeState);
  const navigate = (next: Screen) => {
    if (["hub", "theme", "location"].includes(next)) setHasOpenedGlobe(true);
    if (next === "hub" || next === "landing") setHub();
    else if (next === "theme" && globeState.stage === "location") goBack();
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selectTheme = (next: Theme) => {
    const themeId = themeIdByScreenId[next.id];
    setTheme(next);
    setGlobeTheme(themeId);
    setLocationId(locationsForTheme(themeId)[0]?.id ?? "");
    navigate("theme");
  };
  const selectLocation = (next: Location) => {
    setLocationId(next.id);
    setGlobeLocation(next.id);
    navigate("location");
  };

  useEffect(() => {
    if (globeState.stage === "hub") {
      if (["hub", "theme", "location"].includes(screen)) setScreen("hub");
      return;
    }
    const nextTheme = themes.find((candidate) => themeIdByScreenId[candidate.id] === globeState.themeId);
    if (nextTheme) setTheme(nextTheme);
    if (globeState.stage === "location" && globeState.locationId) {
      setLocationId(globeState.locationId);
      if (["hub", "theme", "location"].includes(screen)) setScreen("location");
    } else if (["hub", "theme", "location"].includes(screen)) {
      setScreen("theme");
    }
  }, [globeState, screen]);

  const selectedLocation = locationById(locationId) ?? locations[0];
  let content: React.ReactNode;
  if (screen === "landing") content = <Landing onNavigate={navigate} />;
  else if (screen === "hub") content = <Hub onNavigate={navigate} onTheme={selectTheme} />;
  else if (screen === "theme") content = <ThemeView theme={theme} onNavigate={navigate} onLocation={selectLocation} />;
  else if (screen === "location" && selectedLocation) content = <LocationView theme={theme} location={selectedLocation} onNavigate={navigate} />;
  else if (screen === "story" && selectedLocation) content = <StoryDetail initialTheme={theme} selectedLocation={selectedLocation} onNavigate={navigate} />;
  else if (screen === "eic-frames") content = <EicFrameSonification initialTheme={theme} onNavigate={navigate} />;
  else if (screen === "about") content = <LegalPage type="about" onNavigate={navigate} />;
  else if (screen === "contact") content = <Contact onNavigate={navigate} />;
  else if (screen === "references") content = <ReferencesPage onNavigate={navigate} />;
  else if (screen === "event-detail") content = <EventDetailPage eventId={initialEventId ?? ""} />;
  else content = <LegalPage type={screen as "privacy" | "terms" | "cookies" | "community"} onNavigate={navigate} />;

  return (
    <>
      {(hasOpenedGlobe || screen === "landing") && <Suspense fallback={null}><GlobeStage screenKey={screen} /></Suspense>}
      <div className="app-content">{content}</div>
      <div className="visually-hidden" aria-live="polite" aria-atomic="true">
        {globeState.stage === "location" && selectedLocation
          ? `Now viewing ${selectedLocation.name}, ${theme.name.toLowerCase()}`
          : globeState.stage === "theme"
            ? `Now viewing the Philippines, ${theme.name.toLowerCase()}`
            : "Now viewing the whole Earth"}
      </div>
    </>
  );
}
