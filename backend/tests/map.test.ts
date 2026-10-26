import assert from "node:assert/strict";
import { test } from "node:test";
import { mapProvider, mapStyleUrl, rewriteMapboxStyle } from "../lib/map";

test("provider selection via env", () => {
  delete process.env.MAP_PROVIDER;
  assert.equal(mapProvider(), "osm");
  assert.ok(mapStyleUrl().startsWith("https://tiles.openfreemap.org/"));
  process.env.MAP_PROVIDER = "mapbox";
  process.env.PUBLIC_BASE_URL = "https://delivery.example.com";
  assert.equal(mapStyleUrl(), "/api/map/style.json");
  assert.equal(mapStyleUrl(true), "https://delivery.example.com/api/map/style.json");
  delete process.env.MAP_PROVIDER;
});

test("mapbox:// URLs are rewritten for MapLibre", () => {
  const out = rewriteMapboxStyle(
    {
      sprite: "mapbox://sprites/mapbox/streets-v12",
      glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
      sources: { composite: { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2" } },
    },
    "pk.test",
  ) as { sprite: string; glyphs: string; sources: { composite: { url: string } } };
  assert.equal(out.sprite, "https://api.mapbox.com/styles/v1/mapbox/streets-v12/sprite?access_token=pk.test");
  assert.equal(out.glyphs, "https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=pk.test");
  assert.equal(out.sources.composite.url, "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2.json?secure&access_token=pk.test");
});
