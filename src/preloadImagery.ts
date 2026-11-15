import globalImageUrl from "./data/earth-global.jpg";
import philippinesImageUrl from "./data/philippines-blue-marble.jpg";

export const imageryUrls = [globalImageUrl, philippinesImageUrl];

const tileUrls = [
  ...[0, 1].flatMap((zoom) => [0, 1].flatMap((x) => [0, 1].map((y) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${zoom}/${y}/${x}.jpg`,
  ))).slice(0, 5),
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/4/10/13",
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/20/27",
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/21/27",
];

function preloadImage(url: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = async () => {
      try {
        await image.decode();
      } catch {
        // The image is already cached even when decode is not supported.
      }
      resolve();
    };
    image.onerror = () => resolve();
    image.src = url;
  });
}

export async function preloadImagery() {
  await Promise.all(imageryUrls.map(preloadImage));

  tileUrls.forEach((url) => {
    const image = new Image();
    image.loading = "eager";
    image.src = url;
  });
}
