import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { MapPackage, ModuleSummary, RemoteIdContact, RemoteIdPort, RemoteIdState } from '../shared/contracts';
import { offlineMapStyle } from './map-rendering';

const EMPTY_STATE: RemoteIdState = { installed: false, enabled: false, connection: 'disconnected', serialLinesReceived: 0, ignoredLinesReceived: 0, observationsReceived: 0, contacts: [] };

function contactName(contact: RemoteIdContact): string { return contact.aircraft.id ?? contact.source.address ?? contact.sourceKey; }
function displayNumber(value: number | undefined, suffix: string, digits = 1): string { return value === undefined ? 'Not broadcast' : `${value.toFixed(digits)} ${suffix}`; }

function radarFeatures(state: RemoteIdState) {
  const contacts: GeoJSON.Feature[] = []; const trails: GeoJSON.Feature[] = []; const secondary: GeoJSON.Feature[] = [];
  for (const contact of state.contacts) {
    const { latitude, longitude } = contact.aircraft;
    if (latitude !== undefined && longitude !== undefined) contacts.push({ type: 'Feature', id: contact.sourceKey, properties: { sourceKey: contact.sourceKey, heading: contact.aircraft.headingDeg ?? 0, priority: contact.sourceKey === state.prioritySourceKey }, geometry: { type: 'Point', coordinates: [longitude, latitude] } });
    if (contact.track.length > 1) trails.push({ type: 'Feature', properties: { sourceKey: contact.sourceKey, priority: contact.sourceKey === state.prioritySourceKey }, geometry: { type: 'LineString', coordinates: contact.track.map((point) => [point.longitude, point.latitude]) } });
    if (contact.secondaryPosition) secondary.push({ type: 'Feature', properties: { sourceKey: contact.sourceKey, kind: contact.secondaryPosition.kind }, geometry: { type: 'Point', coordinates: [contact.secondaryPosition.longitude, contact.secondaryPosition.latitude] } });
  }
  return {
    contacts: { type: 'FeatureCollection', features: contacts } as GeoJSON.FeatureCollection,
    trails: { type: 'FeatureCollection', features: trails } as GeoJSON.FeatureCollection,
    secondary: { type: 'FeatureCollection', features: secondary } as GeoJSON.FeatureCollection,
  };
}

function updateRadarLayers(map: MapLibreMap | undefined, state: RemoteIdState): void {
  if (!map?.isStyleLoaded()) return;
  const data = radarFeatures(state);
  if (!map.getSource('rid-trails')) map.addSource('rid-trails', { type: 'geojson', data: data.trails });
  if (!map.getSource('rid-secondary')) map.addSource('rid-secondary', { type: 'geojson', data: data.secondary });
  if (!map.getSource('rid-contacts')) map.addSource('rid-contacts', { type: 'geojson', data: data.contacts });
  if (!map.getLayer('rid-trails')) map.addLayer({ id: 'rid-trails', type: 'line', source: 'rid-trails', paint: { 'line-color': ['case', ['boolean', ['get', 'priority'], false], '#f2b85e', '#6eb895'], 'line-width': ['case', ['boolean', ['get', 'priority'], false], 4, 2], 'line-opacity': .8 } });
  if (!map.getLayer('rid-secondary')) map.addLayer({ id: 'rid-secondary', type: 'circle', source: 'rid-secondary', paint: { 'circle-radius': 6, 'circle-color': '#78a9d1', 'circle-stroke-width': 2, 'circle-stroke-color': '#dbeaf5' } });
  if (!map.getLayer('rid-contact-halo')) map.addLayer({ id: 'rid-contact-halo', type: 'circle', source: 'rid-contacts', paint: { 'circle-radius': ['case', ['boolean', ['get', 'priority'], false], 16, 11], 'circle-color': ['case', ['boolean', ['get', 'priority'], false], '#d89a46', '#396a58'], 'circle-opacity': .35 } });
  if (!map.getLayer('rid-contacts')) map.addLayer({ id: 'rid-contacts', type: 'symbol', source: 'rid-contacts', layout: { 'text-field': '▲', 'text-font': ['Noto Sans Regular'], 'text-size': 18, 'text-rotate': ['get', 'heading'], 'text-rotation-alignment': 'map', 'text-allow-overlap': true }, paint: { 'text-color': ['case', ['boolean', ['get', 'priority'], false], '#ffd184', '#8de1bd'], 'text-halo-color': '#07100b', 'text-halo-width': 1.5 } });
  (map.getSource('rid-contacts') as GeoJSONSource).setData(data.contacts);
  (map.getSource('rid-trails') as GeoJSONSource).setData(data.trails);
  (map.getSource('rid-secondary') as GeoJSONSource).setData(data.secondary);
}

export function RemoteIdRadarView({ packages, onModules }: { packages: MapPackage[]; onModules?: (modules: ModuleSummary[]) => void }) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<MapLibreMap | undefined>(undefined); const stateRef = useRef(EMPTY_STATE);
  const [state, setState] = useState<RemoteIdState>(EMPTY_STATE); const [ports, setPorts] = useState<RemoteIdPort[]>([]);
  const [selectedPort, setSelectedPort] = useState(''); const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedSourceKey, setSelectedSourceKey] = useState<string>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const selectedContact = useMemo(() => state.contacts.find((contact) => contact.sourceKey === selectedSourceKey), [state.contacts, selectedSourceKey]);

  function acceptState(next: RemoteIdState) { stateRef.current = next; setState(next); if (next.selectedPort) setSelectedPort(next.selectedPort); updateRadarLayers(mapRef.current, next); }
  async function refreshPorts() { try { const next = await window.outpost.listRemoteIdPorts(); setPorts(next); setSelectedPort((current) => next.some((port) => port.path === current) ? current : next[0]?.path ?? ''); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not list serial ports.'); } }
  useEffect(() => { void window.outpost.getRemoteIdState().then(acceptState); const unsubscribe = window.outpost.onRemoteIdUpdate(acceptState); return unsubscribe; }, []);
  useEffect(() => {
    if (!state.enabled) return;
    void refreshPorts();
    if (state.connection === 'connected' || state.connection === 'scanner-ready') return;
    const timer = window.setInterval(() => void refreshPorts(), 2_000);
    return () => window.clearInterval(timer);
  }, [state.enabled, state.connection]);
  useEffect(() => { if (!selectedPackageId && packages[0]) setSelectedPackageId(packages[0].id); }, [packages, selectedPackageId]);
  useEffect(() => {
    if (!container.current || mapRef.current || !state.installed || !state.enabled) return;
    const initialPackage = packages.find((candidate) => candidate.id === selectedPackageId);
    const map = new maplibregl.Map({ container: container.current, style: initialPackage ? offlineMapStyle(initialPackage) : { version: 8, glyphs: 'outpost-glyph://fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c1410' } }] }, center: [-98.5795, 39.8283], zoom: 3, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl(), 'top-right'); map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left'); map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('style.load', () => { updateRadarLayers(map, stateRef.current); if (initialPackage?.bounds) map.fitBounds([[initialPackage.bounds[0], initialPackage.bounds[1]], [initialPackage.bounds[2], initialPackage.bounds[3]]], { padding: 30, duration: 0 }); });
    map.on('click', (event) => { if (!map.getLayer('rid-contacts')) return; const feature = map.queryRenderedFeatures(event.point, { layers: ['rid-contacts'] })[0]; const sourceKey = feature?.properties?.sourceKey as string | undefined; if (sourceKey) setSelectedSourceKey(sourceKey); });
    const observer = new ResizeObserver(() => map.resize()); observer.observe(container.current);
    mapRef.current = map; window.requestAnimationFrame(() => map.resize());
    return () => { observer.disconnect(); map.remove(); mapRef.current = undefined; };
  }, [state.installed, state.enabled]);
  useEffect(() => { const map = mapRef.current; if (!map) return; const item = packages.find((candidate) => candidate.id === selectedPackageId); if (!item) { map.setStyle({ version: 8, glyphs: 'outpost-glyph://fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0c1410' } }] }); return; } map.setStyle(offlineMapStyle(item)); if (item.bounds) map.fitBounds([[item.bounds[0], item.bounds[1]], [item.bounds[2], item.bounds[3]]], { padding: 30, duration: 0 }); }, [selectedPackageId, packages]);
  useEffect(() => { updateRadarLayers(mapRef.current, state); }, [state]);

  async function installAndStart() { setBusy('install'); try { await window.outpost.installModule('remote-id-radar'); const result = await window.outpost.startModule('remote-id-radar'); onModules?.(result.modules); acceptState(await window.outpost.getRemoteIdState()); setMessage('Remote ID Radar installed and enabled. Select the ESP32 serial port.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Radar installation failed.'); } finally { setBusy(''); } }
  async function start() { setBusy('start'); try { const result = await window.outpost.startModule('remote-id-radar'); onModules?.(result.modules); acceptState(await window.outpost.getRemoteIdState()); setMessage(result.message); } catch (error) { setMessage(error instanceof Error ? error.message : 'Radar could not start.'); } finally { setBusy(''); } }
  async function connect() { if (!selectedPort) return; setBusy('connect'); try { acceptState(await window.outpost.connectRemoteId(selectedPort)); setMessage(`Connected to ${selectedPort}. Waiting for receiver data...`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Receiver connection failed.'); } finally { setBusy(''); } }
  async function prioritize(sourceKey?: string) { acceptState(await window.outpost.setRemoteIdPriority(sourceKey)); setSelectedSourceKey(sourceKey); setMessage(sourceKey ? 'Priority tracking enabled. This contact is rendered immediately; background contacts are batched.' : 'Priority tracking cleared.'); }
  const serialActive = state.connection === 'connected' || state.connection === 'scanner-ready';
  const activityMessage = state.serialLinesReceived === 0
    ? 'No serial lines have arrived during this connection. If the ESP32 only prints readiness during startup, leave Outpost connected and power-cycle or reset the receiver.'
    : state.observationsReceived === 0
      ? `${state.serialLinesReceived} serial line${state.serialLinesReceived === 1 ? '' : 's'} received. The receiver is talking to Outpost, but it has not sent an aircraft observation yet.`
      : `${state.observationsReceived} aircraft observation${state.observationsReceived === 1 ? '' : 's'} received during this connection.`;

  if (!state.installed) return <section className="radar-setup"><p className="section-label">OPTIONAL RECEIVER</p><h3>Remote ID Radar is not installed</h3><p className="radar-hardware-notice"><strong>EXTERNAL HARDWARE REQUIRED</strong><span>You need a separate, compatible ESP32-S3 Remote ID receiver connected by USB. Outpost Zero cannot detect drones by itself.</span></p><p>This capability remains completely inactive until installed and explicitly started. It reads supported receiver data over USB serial without using the internet.</p><button className="primary-button" disabled={Boolean(busy)} onClick={() => void installAndStart()}>{busy ? 'INSTALLING...' : 'INSTALL RADAR MODULE'}</button></section>;
  if (!state.enabled) return <section className="radar-setup"><p className="section-label">RECEIVER STOPPED</p><h3>Remote ID Radar is installed but off</h3><p className="radar-hardware-notice"><strong>EXTERNAL HARDWARE REQUIRED</strong><span>Connect a compatible ESP32-S3 Remote ID receiver by USB before starting the radar.</span></p><p>No COM port is open and no receiver data is being monitored.</p><button className="primary-button" disabled={Boolean(busy)} onClick={() => void start()}>{busy ? 'STARTING...' : 'START RADAR MODULE'}</button></section>;

  return <section className="radar-workspace">
    <div className="radar-command"><div><p className="section-label">USB RECEIVER · {state.connection.replace('-', ' ').toUpperCase()}</p><strong>{serialActive ? state.receiver?.name ?? `Connected on ${state.selectedPort}` : state.connection === 'error' ? 'Receiver connection error' : 'Choose the ESP32 serial port'}</strong><small>{state.connection === 'scanner-ready' ? `Scanner ready on ${state.selectedPort} · Wi-Fi + BLE monitoring active` : state.receiver ? `${state.receiver.transports.join(', ') || 'transport not reported'} · firmware ${state.receiver.firmwareVersion}` : 'Remote ID data stays on this computer and portable drive.'}</small></div><div className="radar-connect"><select value={selectedPort} onChange={(event) => setSelectedPort(event.target.value)}><option value="">Select COM port</option>{ports.map((port) => <option key={port.path} value={port.path}>{port.path}{port.manufacturer ? ` · ${port.manufacturer}` : ''}</option>)}</select><button className="secondary-button" onClick={() => void refreshPorts()}>REFRESH</button>{serialActive ? <button className="secondary-button" onClick={() => void window.outpost.disconnectRemoteId().then(acceptState)}>DISCONNECT</button> : <button className="primary-button" disabled={!selectedPort || Boolean(busy)} onClick={() => void connect()}>{busy === 'connect' ? 'CONNECTING...' : state.connection === 'error' ? 'RECONNECT' : 'CONNECT'}</button>}</div></div>
    {message && <div className="module-result">{message}</div>}{state.lastError && <div className="module-result radar-error">{state.lastError}</div>}
    {serialActive && <div className={state.serialLinesReceived ? 'radar-activity active' : 'radar-activity waiting'}><div><small>SERIAL LINES</small><b>{state.serialLinesReceived}</b></div><div><small>AIRCRAFT MESSAGES</small><b>{state.observationsReceived}</b></div><div><small>DEBUG / OTHER</small><b>{state.ignoredLinesReceived}</b></div><div><small>LAST ACTIVITY</small><b>{state.lastSerialLineAt ? new Date(state.lastSerialLineAt).toLocaleTimeString() : 'NONE'}</b></div><p>{activityMessage}</p></div>}
    <div className="radar-basemap"><label>RADAR BASEMAP<select value={selectedPackageId} onChange={(event) => setSelectedPackageId(event.target.value)}><option value="">No offline basemap</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><span>{state.contacts.length} CONTACT{state.contacts.length === 1 ? '' : 'S'} · {state.prioritySourceKey ? 'PRIORITY ACTIVE' : 'NORMAL SCAN'}</span></div>
    <div className="radar-overview"><aside className="radar-contacts"><div className="radar-list-heading"><b>DETECTED SOURCES</b><button onClick={() => void window.outpost.clearRemoteIdContacts().then(acceptState)}>CLEAR</button></div>{state.contacts.length ? state.contacts.map((contact) => <button className={contact.sourceKey === selectedSourceKey ? 'active' : ''} key={contact.sourceKey} onClick={() => { setSelectedSourceKey(contact.sourceKey); if (contact.aircraft.longitude !== undefined && contact.aircraft.latitude !== undefined) mapRef.current?.flyTo({ center: [contact.aircraft.longitude, contact.aircraft.latitude], zoom: Math.max(12, mapRef.current.getZoom()) }); }}><b>{contactName(contact)}</b><small>{contact.source.transport.toUpperCase()} · {contact.source.rssiDbm === undefined ? 'RSSI unknown' : `${contact.source.rssiDbm} dBm`}</small><time>{new Date(contact.lastSeenAt).toLocaleTimeString()}</time></button>) : <p>No Remote ID contacts received yet.</p>}</aside><aside className="radar-details">{selectedContact ? <><p className="section-label">SELECTED CONTACT</p><h3>{contactName(selectedContact)}</h3>{state.prioritySourceKey === selectedContact.sourceKey ? <button className="priority-button active" onClick={() => void prioritize(undefined)}>PRIORITY TRACKING ON · CLEAR</button> : <button className="priority-button" onClick={() => void prioritize(selectedContact.sourceKey)}>MAKE PRIORITY CONTACT</button>}<p className="priority-help">Priority contacts render immediately. If supported, the ESP32 is also asked to focus forwarding. Outpost cannot make a drone broadcast faster.</p><dl><div><dt>ALTITUDE MSL</dt><dd>{displayNumber(selectedContact.aircraft.altitudeMslM, 'm')}</dd></div><div><dt>HEIGHT AGL</dt><dd>{displayNumber(selectedContact.aircraft.heightAglM, 'm')}</dd></div><div><dt>SPEED</dt><dd>{displayNumber(selectedContact.aircraft.horizontalSpeedMps, 'm/s')}</dd></div><div><dt>HEADING</dt><dd>{displayNumber(selectedContact.aircraft.headingDeg, '°', 0)}</dd></div><div><dt>SIGNAL</dt><dd>{displayNumber(selectedContact.source.rssiDbm, 'dBm', 0)}</dd></div><div><dt>STATUS</dt><dd>{selectedContact.aircraft.status ?? 'Not broadcast'}</dd></div><div><dt>SECONDARY POSITION</dt><dd>{selectedContact.secondaryPosition?.kind ?? 'Not broadcast'}</dd></div><div><dt>OPERATOR ID</dt><dd>{selectedContact.operatorId ?? 'Not broadcast'}</dd></div></dl></> : <><p className="section-label">CONTACT DETAILS</p><h3>Select a detected source</h3><p>Aircraft position, altitude, speed, heading, signal strength, identifiers, path, and secondary position appear here when broadcast.</p></>}</aside></div>
    <div className="radar-map-shell"><div ref={container} className="radar-map" /></div>
    <p className="radar-disclaimer">Situational awareness only. Remote ID reception can be incomplete, delayed, spoofed, or out of range. Do not use this display for collision avoidance or infer a person’s identity from an operator ID.</p>
  </section>;
}
