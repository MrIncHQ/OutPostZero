import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

let configured = false;

/**
 * Configure the renderer-wide MapLibre worker and portable protocols once.
 * Map pages are lazy loaded independently, so this cannot belong to one page's
 * mount/unmount lifecycle.
 */
export function ensureMapRuntime(): void {
  if (configured) return;
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
  maplibregl.addProtocol('outpost-tile', async (request) => {
    const match = /^outpost-tile:\/\/package\/([A-F0-9]{24})\/(\d+)\/(\d+)\/(\d+)$/i.exec(request.url);
    if (!match) throw new Error('The offline map requested an invalid tile address.');
    const bytes = await window.outpost.getMapTile(match[1], Number(match[2]), Number(match[3]), Number(match[4]));
    if (!bytes) return { data: new ArrayBuffer(0) };
    const view = new Uint8Array(bytes);
    return { data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) };
  });
  maplibregl.addProtocol('outpost-glyph', async (request) => {
    const match = /^outpost-glyph:\/\/fonts\/([^/]+)\/(\d+-\d+)\.pbf$/i.exec(request.url);
    if (!match) throw new Error('The offline map requested an invalid font asset.');
    const bytes = await window.outpost.getMapGlyph(decodeURIComponent(match[1]), match[2]);
    if (!bytes) throw new Error(`Offline map font data is missing for ${decodeURIComponent(match[1])} ${match[2]}.`);
    const view = new Uint8Array(bytes);
    return { data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) };
  });
  configured = true;
}

export function attachStableMapResize(map: maplibregl.Map): () => void {
  const resize = () => map.resize();
  const frame = window.requestAnimationFrame(resize);
  window.addEventListener('resize', resize);
  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
  };
}
