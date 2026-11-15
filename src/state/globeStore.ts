import { locationById, type ThemeId } from "../data/locations";

export type GlobeStage = "hub" | "theme" | "location";

export type GlobeState = {
  stage: GlobeStage;
  themeId: ThemeId | null;
  locationId: string | null;
};

export type StageChangeListener = (state: GlobeState, previous: GlobeState) => void;

let state: GlobeState = { stage: "hub", themeId: null, locationId: null };
const listeners = new Set<StageChangeListener>();
let mapZoomHandler: ((delta: number) => void) | null = null;

export const getGlobeState = () => state;

export function subscribeToGlobe(listener: () => void) {
  listeners.add(listener as StageChangeListener);
  return () => { listeners.delete(listener as StageChangeListener); };
}

export function setMapZoomHandler(handler: (delta: number) => void) {
  mapZoomHandler = handler;
  return () => {
    if (mapZoomHandler === handler) mapZoomHandler = null;
  };
}

export function requestMapZoom(delta: -1 | 1) {
  mapZoomHandler?.(delta);
}

function update(next: GlobeState) {
  const previous = state;
  if (
    previous.stage === next.stage &&
    previous.themeId === next.themeId &&
    previous.locationId === next.locationId
  ) return;
  state = next;
  listeners.forEach((listener) => listener(state, previous));
}

export function setHub() {
  update({ stage: "hub", themeId: null, locationId: null });
}

export function setTheme(themeId: ThemeId) {
  update({ stage: "theme", themeId, locationId: null });
}

export function setLocation(locationId: string) {
  const location = locationById(locationId);
  if (!location) return;
  update({ stage: "location", themeId: location.themeId, locationId });
}

export function returnToTheme() {
  if (state.stage === "location") {
    update({ stage: "theme", themeId: state.themeId, locationId: null });
  }
}

export function goBack() {
  if (state.stage === "location") return returnToTheme();
  if (state.stage === "theme") return setHub();
}

export function onStageChange(listener: StageChangeListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
