import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol, TileType } from 'pmtiles';
import type { MapDownloadRequest, MapDownloadStatus, MapLocationResult, MapPackage, MapPlaceInput, MapsState } from '../shared/contracts';

const protocol = new Protocol({ metadata: true });
let protocolInstalled = false;
if (!protocolInstalled) { maplibregl.addProtocol('pmtiles', protocol.tile); protocolInstalled = true; }

function formatBytes(bytes: number): string { return bytes < 1024 ** 3 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`; }
function estimatedMapBytes(radiusKilometers: number, latitude: number, maxZoom: number): number {
  const latitudeDelta = radiusKilometers / 111.32; const longitudeDelta = radiusKilometers / (111.32 * Math.max(.08, Math.cos(latitude * Math.PI / 180)));
  const longitudeFraction = Math.min(360, longitudeDelta * 2) / 360;
  const latitudeFraction = Math.abs(Math.sin(Math.min(85, latitude + latitudeDelta) * Math.PI / 180) - Math.sin(Math.max(-85, latitude - latitudeDelta) * Math.PI / 180)) / 2;
  return Math.ceil(60 * 1024 * 1024 + 120 * 1024 ** 3 * longitudeFraction * latitudeFraction * 2 ** (maxZoom - 15));
}
function radians(value: number): number { return value * Math.PI / 180; }
function measurement(a: [number, number], b: [number, number]): { distance: string; bearing: string } {
  const radius = 6371; const dLat = radians(b[1] - a[1]); const dLon = radians(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  const kilometers = radius * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  const y = Math.sin(dLon) * Math.cos(radians(b[1])); const z = Math.cos(radians(a[1])) * Math.sin(radians(b[1])) - Math.sin(radians(a[1])) * Math.cos(radians(b[1])) * Math.cos(dLon);
  const degrees = (Math.atan2(y, z) * 180 / Math.PI + 360) % 360;
  return { distance: kilometers < 1 ? `${(kilometers * 1000).toFixed(0)} m` : `${kilometers.toFixed(2)} km`, bearing: `${degrees.toFixed(1)}°` };
}

export function MapsView({ requestedPlaceId, onRequestHandled }: { requestedPlaceId?: string; onRequestHandled?: () => void }) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<maplibregl.Map | undefined>(undefined); const markers = useRef<maplibregl.Marker[]>([]);
  const [state, setState] = useState<MapsState>(); const [selectedPackage, setSelectedPackage] = useState<MapPackage>();
  const [cursor, setCursor] = useState<[number, number]>([-98.5795, 39.8283]); const [zoom, setZoom] = useState(3);
  const [measureMode, setMeasureMode] = useState(false); const measureModeRef = useRef(false); const measureStart = useRef<[number, number] | undefined>(undefined); const [measureResult, setMeasureResult] = useState('');
  const [place, setPlace] = useState<MapPlaceInput>({ name: '', latitude: 39.8283, longitude: -98.5795, note: '', favorite: false });
  const [message, setMessage] = useState(''); const [confirmPackage, setConfirmPackage] = useState<MapPackage>();
  const [showDownloader, setShowDownloader] = useState(false);
  const [downloadRequest, setDownloadRequest] = useState<MapDownloadRequest>({ title: '', latitude: 39.8283, longitude: -98.5795, radiusKilometers: 100, maxZoom: 12 });
  const [downloadStatus, setDownloadStatus] = useState<MapDownloadStatus>({ state: 'idle', percent: 0, downloadedBytes: 0, estimatedBytes: 0, elapsedSeconds: 0, message: 'Choose an area to download.' });
  const [locationQuery, setLocationQuery] = useState(''); const [locationResults, setLocationResults] = useState<MapLocationResult[]>([]); const [locationSearching, setLocationSearching] = useState(false);
  const [locationConfirmed, setLocationConfirmed] = useState(false); const [selectedLocationLabel, setSelectedLocationLabel] = useState('No location selected');

  async function refresh() { const next = await window.outpost.getMaps(); setState(next); return next; }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!['resolving', 'downloading', 'verifying'].includes(downloadStatus.state)) return;
    const timer = window.setInterval(() => { void window.outpost.getMapDownloadStatus().then(setDownloadStatus); }, 500);
    return () => window.clearInterval(timer);
  }, [downloadStatus.state]);
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: container.current, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101713' } }] }, center: cursor, zoom, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl(), 'top-right'); map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('mousemove', (event: maplibregl.MapMouseEvent) => setCursor([event.lngLat.lng, event.lngLat.lat])); map.on('zoomend', () => setZoom(map.getZoom()));
    map.on('click', (event: maplibregl.MapMouseEvent) => {
      const point: [number, number] = [event.lngLat.lng, event.lngLat.lat]; setCursor(point); setPlace((current) => ({ ...current, latitude: point[1], longitude: point[0] }));
      if (!measureModeRef.current) return;
      if (!measureStart.current) { measureStart.current = point; setMeasureResult('Select the ending point.'); return; }
      const result = measurement(measureStart.current, point); setMeasureResult(`${result.distance} · bearing ${result.bearing}`);
      const data = { type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: [measureStart.current, point] } };
      const source = map.getSource('measurement') as maplibregl.GeoJSONSource | undefined;
      if (source) source.setData(data); else { map.addSource('measurement', { type: 'geojson', data }); map.addLayer({ id: 'measurement-line', type: 'line', source: 'measurement', paint: { 'line-color': '#e0a44f', 'line-width': 3, 'line-dasharray': [2, 2] } }); }
      measureStart.current = undefined;
    });
    mapRef.current = map; return () => { map.remove(); mapRef.current = undefined; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !state) return; markers.current.forEach((marker) => marker.remove()); markers.current = state.places.map((saved) => {
      const element = document.createElement('button'); element.className = saved.favorite ? 'map-marker favorite' : 'map-marker'; element.title = saved.name;
      element.addEventListener('click', () => { setPlace(saved); mapRef.current?.flyTo({ center: [saved.longitude, saved.latitude], zoom: Math.max(12, mapRef.current.getZoom()) }); });
      return new maplibregl.Marker({ element }).setLngLat([saved.longitude, saved.latitude]).addTo(mapRef.current!);
    });
    if (requestedPlaceId) { const saved = state.places.find((item) => item.id === requestedPlaceId); if (saved) { setPlace(saved); mapRef.current.flyTo({ center: [saved.longitude, saved.latitude], zoom: 13 }); } onRequestHandled?.(); }
  }, [state, requestedPlaceId, onRequestHandled]);

  async function loadPackage(item: MapPackage) {
    const map = mapRef.current; if (!map) return; setSelectedPackage(item); setMessage(`Opening ${item.title}...`);
    try {
      if (item.format === 'mbtiles') {
        if (item.tileType === 'vector') {
          const layers: maplibregl.LayerSpecification[] = [];
          (item.sourceLayers ?? []).forEach((sourceLayer, index) => {
            layers.push({ id: `mb-fill-${index}`, type: 'fill', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': index % 2 ? '#314b3f' : '#263d34', 'fill-opacity': .72, 'fill-outline-color': '#577064' } });
            layers.push({ id: `mb-line-${index}`, type: 'line', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': index % 3 ? '#8c9c91' : '#d2a15c', 'line-width': 1.2 } });
            layers.push({ id: `mb-point-${index}`, type: 'circle', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#d8a65e', 'circle-radius': 3 } });
          });
          map.setStyle({ version: 8, sources: { offline: { type: 'vector', tiles: [`outpost-map://tile/${item.id}/{z}/{x}/{y}`], minzoom: item.minZoom, maxzoom: item.maxZoom } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101713' } }, ...layers] });
        } else map.setStyle({ version: 8, sources: { offline: { type: 'raster', tiles: [`outpost-map://tile/${item.id}/{z}/{x}/{y}`], tileSize: 256, minzoom: item.minZoom, maxzoom: item.maxZoom } }, layers: [{ id: 'offline-raster', type: 'raster', source: 'offline' }] });
        if (item.bounds) map.fitBounds([[item.bounds[0], item.bounds[1]], [item.bounds[2], item.bounds[3]]], { padding: 30, duration: 0 });
      } else {
        const archive = new PMTiles(item.readerUrl); protocol.add(archive); const header = await archive.getHeader();
        if (header.tileType === TileType.Mvt || header.tileType === TileType.Mlt) {
          const metadata = await archive.getMetadata() as { vector_layers?: Array<{ id: string }> }; const sourceLayers = metadata.vector_layers?.map((layer) => layer.id) ?? [];
          const layers: maplibregl.LayerSpecification[] = [];
          sourceLayers.forEach((sourceLayer, index) => {
            layers.push({ id: `fill-${index}`, type: 'fill', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': index % 2 ? '#314b3f' : '#263d34', 'fill-opacity': .72, 'fill-outline-color': '#577064' } });
            layers.push({ id: `line-${index}`, type: 'line', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': index % 3 ? '#8c9c91' : '#d2a15c', 'line-width': 1.2 } });
            layers.push({ id: `point-${index}`, type: 'circle', source: 'offline', 'source-layer': sourceLayer, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#d8a65e', 'circle-radius': 3 } });
          });
          map.setStyle({ version: 8, sources: { offline: { type: 'vector', url: `pmtiles://${item.readerUrl}` } }, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#101713' } }, ...layers] });
        } else map.setStyle({ version: 8, sources: { offline: { type: 'raster', url: `pmtiles://${item.readerUrl}`, tileSize: 256 } }, layers: [{ id: 'offline-raster', type: 'raster', source: 'offline' }] });
        if (header.minLon < header.maxLon && header.minLat < header.maxLat) map.fitBounds([[header.minLon, header.minLat], [header.maxLon, header.maxLat]], { padding: 30, duration: 0 });
      }
      setMessage(`${item.title} is being served entirely from this drive.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not open this map package.'); }
  }

  async function savePlace() { const saved = await window.outpost.saveMapPlace(place); const next = await refresh(); setPlace(saved); setState(next); setMessage(`${saved.name} saved on this drive.`); }
  async function deletePlace() { if (!place.id) return; setState(await window.outpost.deleteMapPlace(place.id)); setPlace({ name: '', latitude: cursor[1], longitude: cursor[0], note: '', favorite: false }); }
  async function importMaps() { const result = await window.outpost.importMapPackages(); setState(result.state); setMessage(result.message); }
  async function downloadMap() {
    if (!locationConfirmed) { setMessage('Search for and select a location, use the map cursor, or confirm the entered coordinates first.'); return; }
    const existing = new Set(state?.packages.map((item) => item.id) ?? []);
    setDownloadStatus({ state: 'resolving', title: downloadRequest.title, percent: 0, downloadedBytes: 0, estimatedBytes: estimatedMapBytes(downloadRequest.radiusKilometers, downloadRequest.latitude, downloadRequest.maxZoom), elapsedSeconds: 0, message: 'Finding the newest map build...' });
    const result = await window.outpost.downloadMap(downloadRequest); setState(result.state); setMessage(result.message); setDownloadStatus(await window.outpost.getMapDownloadStatus());
    if (result.ok) { const added = result.state.packages.find((item) => !existing.has(item.id)); setShowDownloader(false); if (added) await loadPackage(added); }
  }
  async function searchLocations() {
    setLocationSearching(true); setLocationConfirmed(false);
    try { const results = await window.outpost.searchMapLocations(locationQuery); setLocationResults(results); if (!results.length) setMessage('No matching locations were found. Try adding a state or country.'); }
    catch (error) { setLocationResults([]); setMessage(error instanceof Error ? error.message : 'Location search failed.'); }
    finally { setLocationSearching(false); }
  }
  function chooseLocation(result: MapLocationResult) {
    const shortName = result.displayName.split(',')[0]?.trim() || 'Offline map';
    setDownloadRequest((current) => ({ ...current, title: `${shortName} offline map`, latitude: result.latitude, longitude: result.longitude }));
    setSelectedLocationLabel(result.displayName); setLocationConfirmed(true); setLocationResults([]); mapRef.current?.flyTo({ center: [result.longitude, result.latitude], zoom: 8 });
  }
  async function removePackage() { if (!confirmPackage) return; const result = await window.outpost.removeMapPackage(confirmPackage.id); setState(result.state); if (selectedPackage?.id === confirmPackage.id) setSelectedPackage(undefined); setConfirmPackage(undefined); setMessage(result.message); }
  async function importGpx() { const result = await window.outpost.importGpx(); setState(result.state); setMessage(result.message); }

  return <section className="page-panel maps-panel">
    <div className="page-heading"><div><p className="section-label">OFFLINE MAPS</p><h2>{selectedPackage?.title ?? 'Portable map workspace'}</h2></div><div className="map-heading-actions"><button className="secondary-button" onClick={() => void importGpx()}>IMPORT GPX</button><button className="secondary-button" onClick={() => void window.outpost.exportGpx().then((result) => setMessage(result.message))}>EXPORT GPX</button><button className="primary-button" onClick={() => { setShowDownloader(true); setLocationConfirmed(false); setSelectedLocationLabel('No location selected'); setLocationResults([]); }}>DOWNLOAD MAP</button><button className="secondary-button" onClick={() => void importMaps()}>IMPORT MAP FILE</button></div></div>
    {message && <div className="module-result">{message}</div>}{confirmPackage && <div className="download-confirm library-remove-confirm"><div><b>Remove {confirmPackage.title}?</b><p>The selected map package will be deleted. Saved places remain.</p></div><div><button className="secondary-button" onClick={() => setConfirmPackage(undefined)}>KEEP IT</button><button className="danger-button" onClick={() => void removePackage()}>REMOVE MAP</button></div></div>}
    {showDownloader && <section className="map-downloader">
      <div className="map-download-heading"><div><p className="section-label">DOWNLOAD FOR OFFLINE USE</p><h3>Choose one area and its detail</h3><p>Only this region downloads. It is saved directly on this drive and opens later without internet.</p></div><button className="secondary-button" disabled={['resolving', 'downloading', 'verifying'].includes(downloadStatus.state)} onClick={() => setShowDownloader(false)}>CLOSE</button></div>
      <div className="map-location-search"><label>FIND THE LOCATION YOU WANT<input value={locationQuery} placeholder="City, county, state, or country" maxLength={120} onChange={(event) => setLocationQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchLocations(); }} /></label><button className="primary-button" disabled={locationSearching || locationQuery.trim().length < 2} onClick={() => void searchLocations()}>{locationSearching ? 'SEARCHING...' : 'SEARCH LOCATIONS'}</button></div>
      {locationResults.length > 0 && <div className="map-location-results">{locationResults.map((result) => <button key={result.id} onClick={() => chooseLocation(result)}><b>{result.displayName}</b><small>{result.latitude.toFixed(5)}, {result.longitude.toFixed(5)}</small></button>)}</div>}
      <div className={locationConfirmed ? 'map-selected-location confirmed' : 'map-selected-location'}><span>{locationConfirmed ? 'SELECTED DOWNLOAD CENTER' : 'LOCATION REQUIRED'}</span><strong>{selectedLocationLabel}</strong>{locationConfirmed && <small>{downloadRequest.latitude.toFixed(6)}, {downloadRequest.longitude.toFixed(6)}</small>}</div>
      <div className="map-download-form">
        <label>MAP NAME<input value={downloadRequest.title} maxLength={100} onChange={(event) => setDownloadRequest({ ...downloadRequest, title: event.target.value })} /></label>
        <label>CENTER LATITUDE<input type="number" min="-85" max="85" step="any" value={downloadRequest.latitude} onChange={(event) => { setLocationConfirmed(false); setSelectedLocationLabel('Confirm the edited coordinates'); setDownloadRequest({ ...downloadRequest, latitude: Number(event.target.value) }); }} /></label>
        <label>CENTER LONGITUDE<input type="number" min="-180" max="180" step="any" value={downloadRequest.longitude} onChange={(event) => { setLocationConfirmed(false); setSelectedLocationLabel('Confirm the edited coordinates'); setDownloadRequest({ ...downloadRequest, longitude: Number(event.target.value) }); }} /></label>
        <label>AREA AROUND CENTER<select value={downloadRequest.radiusKilometers} onChange={(event) => setDownloadRequest({ ...downloadRequest, radiusKilometers: Number(event.target.value) })}><option value={25}>25 km - town</option><option value={100}>100 km - local area</option><option value={300}>300 km - regional</option><option value={800}>800 km - multi-state</option></select></label>
        <label>DETAIL LEVEL<select value={downloadRequest.maxZoom} onChange={(event) => setDownloadRequest({ ...downloadRequest, maxZoom: Number(event.target.value) as 8 | 12 | 15 })}><option value={8}>Overview - cities and main roads</option><option value={12}>Road detail - recommended</option><option value={15}>Street detail - largest</option></select></label>
        <div className="map-coordinate-actions"><button className="secondary-button" onClick={() => { setDownloadRequest({ ...downloadRequest, latitude: cursor[1], longitude: cursor[0] }); setSelectedLocationLabel(`Map cursor at ${cursor[1].toFixed(6)}, ${cursor[0].toFixed(6)}`); setLocationConfirmed(true); }}>USE MAP CURSOR</button><button className="secondary-button" onClick={() => { setSelectedLocationLabel(`Confirmed coordinates ${downloadRequest.latitude.toFixed(6)}, ${downloadRequest.longitude.toFixed(6)}`); setLocationConfirmed(true); }}>CONFIRM COORDINATES</button></div>
      </div>
      <div className="map-download-summary"><span>ROUGH SIZE ESTIMATE</span><strong>{locationConfirmed ? formatBytes(estimatedMapBytes(downloadRequest.radiusKilometers, downloadRequest.latitude, downloadRequest.maxZoom)) : 'Choose a location'}</strong><small>Actual size varies with map density. Higher detail can take substantially longer.</small></div>
      {downloadStatus.state !== 'idle' && <div className="map-download-progress"><div><b>{downloadStatus.message}</b><strong>{downloadStatus.percent.toFixed(1)}%</strong></div><div className="progress-track"><span style={{ width: `${downloadStatus.percent}%` }} /></div><small>{formatBytes(downloadStatus.downloadedBytes)} written · {downloadStatus.elapsedSeconds}s elapsed{downloadStatus.sourceDate ? ` · map data ${downloadStatus.sourceDate}` : ''}</small></div>}
      <div className="map-download-actions">{['resolving', 'downloading', 'verifying'].includes(downloadStatus.state) ? <button className="danger-button" onClick={() => void window.outpost.cancelMapDownload().then(setDownloadStatus)}>CANCEL DOWNLOAD</button> : <button className="primary-button" disabled={!locationConfirmed || !downloadRequest.title.trim()} onClick={() => void downloadMap()}>DOWNLOAD THIS CONFIRMED REGION</button>}<p>Location search and map data: © OpenStreetMap contributors · packaged with the official Protomaps PMTiles extractor.</p></div>
    </section>}
    <div className="map-workspace"><aside className="map-sidebar"><section><p>MAP PACKAGES</p>{state?.packages.map((item) => <div className={selectedPackage?.id === item.id ? 'map-package active' : 'map-package'} key={item.id}><button onClick={() => void loadPackage(item)}><b>{item.title}</b><small>{item.format.toUpperCase()} · {formatBytes(item.size)}</small></button><button onClick={() => setConfirmPackage(item)}>×</button></div>)}{!state?.packages.length && <small>Download a region here or import an existing PMTiles or MBTiles archive. Nothing downloads until you choose it.</small>}</section><section><p>SAVED PLACES</p>{state?.places.map((saved) => <button className="saved-place" key={saved.id} onClick={() => { setPlace(saved); mapRef.current?.flyTo({ center: [saved.longitude, saved.latitude], zoom: 13 }); }}><b>{saved.favorite ? '★ ' : ''}{saved.name}</b><small>{saved.latitude.toFixed(5)}, {saved.longitude.toFixed(5)}</small></button>)}</section></aside>
      <div className="map-main"><div className="map-toolbar"><span>{cursor[1].toFixed(6)}, {cursor[0].toFixed(6)} · ZOOM {zoom.toFixed(1)}</span><button onClick={() => void navigator.clipboard.writeText(`${cursor[1].toFixed(6)}, ${cursor[0].toFixed(6)}`)}>COPY COORDINATES</button><button className={measureMode ? 'active' : ''} onClick={() => { const next = !measureMode; setMeasureMode(next); measureModeRef.current = next; measureStart.current = undefined; setMeasureResult(next ? 'Select the starting point.' : ''); }}>{measureMode ? 'STOP MEASURING' : 'MEASURE'}</button>{measureResult && <strong>{measureResult}</strong>}</div><div ref={container} className="map-canvas" /></div>
      <aside className="place-editor"><p className="section-label">PLACE / MARKER</p><label>NAME<input value={place.name} onChange={(event) => setPlace({ ...place, name: event.target.value })} /></label><div><label>LATITUDE<input type="number" step="any" value={place.latitude} onChange={(event) => setPlace({ ...place, latitude: Number(event.target.value) })} /></label><label>LONGITUDE<input type="number" step="any" value={place.longitude} onChange={(event) => setPlace({ ...place, longitude: Number(event.target.value) })} /></label></div><label>MAP NOTE<textarea value={place.note} onChange={(event) => setPlace({ ...place, note: event.target.value })} /></label><label className="place-favorite"><input type="checkbox" checked={place.favorite} onChange={(event) => setPlace({ ...place, favorite: event.target.checked })} /> FAVORITE PLACE</label><button className="primary-button" onClick={() => void savePlace()}>{place.id ? 'SAVE CHANGES' : 'SAVE THIS PLACE'}</button>{place.id && <button className="danger-button" onClick={() => void deletePlace()}>DELETE PLACE</button>}<button className="secondary-button" onClick={() => setPlace({ name: '', latitude: cursor[1], longitude: cursor[0], note: '', favorite: false })}>NEW MARKER AT CURSOR</button></aside>
    </div>
  </section>;
}
