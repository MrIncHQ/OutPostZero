import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { MapPackage } from '../shared/contracts';

export const OFFLINE_BASEMAP_LAYERS = (protomapsLayers('offline', namedFlavor('dark'), { lang: 'en' }) as unknown as LayerSpecification[]).map((layer) => {
  if (layer.type !== 'symbol') return layer;
  const layout = { ...layer.layout } as Record<string, unknown>; const paint = { ...layer.paint } as Record<string, unknown>;
  for (const key of Object.keys(layout)) if (key.startsWith('icon-')) delete layout[key];
  for (const key of Object.keys(paint)) if (key.startsWith('icon-')) delete paint[key];
  return { ...layer, layout, paint } as LayerSpecification;
});

export function isProtomapsPackage(item: MapPackage): boolean {
  const sourceLayers = new Set(item.sourceLayers ?? []);
  return ['earth', 'roads', 'places', 'water'].every((layer) => sourceLayers.has(layer));
}

export function offlineMapStyle(item: MapPackage): StyleSpecification {
  if (item.tileType === 'vector') {
    const styledLayers: LayerSpecification[] = isProtomapsPackage(item) ? OFFLINE_BASEMAP_LAYERS : [
      { id: 'background', type: 'background', paint: { 'background-color': '#101713' } },
      ...(item.sourceLayers ?? []).flatMap((sourceLayer, index): LayerSpecification[] => [
        { id: `mb-fill-${index}`, type: 'fill', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': index % 2 ? '#314b3f' : '#263d34', 'fill-opacity': .72, 'fill-outline-color': '#577064' } },
        { id: `mb-line-${index}`, type: 'line', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': index % 3 ? '#8c9c91' : '#d2a15c', 'line-width': 1.2 } },
        { id: `mb-point-${index}`, type: 'circle', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#d8a65e', 'circle-radius': 3 } },
      ]),
    ];
    return { version: 8, glyphs: 'outpost-glyph://fonts/{fontstack}/{range}.pbf', sources: { offline: { type: 'vector', tiles: [`outpost-tile://package/${item.id}/{z}/{x}/{y}`], minzoom: item.minZoom, maxzoom: item.maxZoom, attribution: isProtomapsPackage(item) ? '© OpenStreetMap · Protomaps' : undefined } }, layers: styledLayers };
  }
  if (item.tileType === 'raster') return { version: 8, glyphs: 'outpost-glyph://fonts/{fontstack}/{range}.pbf', sources: { offline: { type: 'raster', tiles: [`outpost-tile://package/${item.id}/{z}/{x}/{y}`], tileSize: 256, minzoom: item.minZoom, maxzoom: item.maxZoom } }, layers: [{ id: 'offline-raster', type: 'raster', source: 'offline' }] };
  throw new Error('This map package uses an unsupported tile format.');
}
