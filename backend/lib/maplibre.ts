"use client";

import * as maplibregl from "maplibre-gl";

// maplibre-gl 6 loads the renderer as a separate worker; without this URL every map stays blank.
maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export { maplibregl };
