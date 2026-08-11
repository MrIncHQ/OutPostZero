import fs from 'node:fs';
import path from 'node:path';
import type {
  MedicationOperationResult, MedicationRecord, MedicationState, MedicationSuggestion,
  PillMatch, PillRecord, PillSearchQuery,
} from '../shared/contracts';
import { PortablePathService } from './portable-path';

export const MEDICATION_DISCLAIMER_VERSION = '2026-08-10.2';

interface MedicationStore {
  schemaVersion: 2;
  disclaimerVersion: string;
  acknowledgedAt: string | null;
  lastOnlineRefreshAt: string | null;
  records: MedicationRecord[];
  pills: PillRecord[];
}

interface StarterPillIndex {
  schemaVersion: 1;
  sourceRelease: string;
  records: Array<[string, string, string, string, string, string, string, string, number | null]>;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
}

function section(value: unknown): string {
  return strings(value).join('\n\n').slice(0, 40000);
}

function mapLabel(raw: Record<string, unknown>, retrievedAt: string): MedicationRecord {
  const openfda = raw.openfda && typeof raw.openfda === 'object' ? raw.openfda as Record<string, unknown> : {};
  const id = typeof raw.id === 'string' ? raw.id : `${strings(openfda.brand_name)[0] ?? 'drug'}-${strings(openfda.product_ndc)[0] ?? retrievedAt}`;
  return {
    id, brandNames: strings(openfda.brand_name), genericNames: strings(openfda.generic_name),
    substances: strings(openfda.substance_name), manufacturerNames: strings(openfda.manufacturer_name),
    productNdcs: strings(openfda.product_ndc), routes: strings(openfda.route), dosageForms: strings(openfda.dosage_form),
    indications: section(raw.indications_and_usage), warnings: section(raw.warnings) || section(raw.warnings_and_cautions),
    contraindications: section(raw.contraindications), dosageAndAdministration: section(raw.dosage_and_administration),
    adverseReactions: section(raw.adverse_reactions), drugInteractions: section(raw.drug_interactions),
    storage: section(raw.storage_and_handling), retrievedAt,
  };
}

function normalizeImprint(value: string): string {
  return value.toLocaleUpperCase().replace(/[^A-Z0-9]/g, '');
}

function stringCell(row: unknown[], index: number): string {
  const value = row[index];
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function mapDailyMedRows(payload: unknown, retrievedAt: string): PillRecord[] {
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as Record<string, unknown>;
  const columns = (Array.isArray(value.COLUMNS) ? value.COLUMNS : value.columns) as unknown;
  const rows = (Array.isArray(value.DATA) ? value.DATA : value.data) as unknown;
  if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
  const names = columns.map((column) => String(column).toLocaleUpperCase());
  const at = (name: string) => names.indexOf(name);
  return rows.filter((row): row is unknown[] => Array.isArray(row)).map((row) => {
    const setId = stringCell(row, at('SETID'));
    const productNdc = stringCell(row, at('PRODUCT_CODE'));
    const imprint = stringCell(row, at('SPLIMPRINT'));
    const scoreText = stringCell(row, at('SPLSCORE'));
    return {
      id: `${setId || 'daily-med'}:${productNdc}:${normalizeImprint(imprint)}`,
      setId,
      name: stringCell(row, at('NAME')) || 'FDA-listed solid oral medication',
      productNdc,
      imprint,
      color: stringCell(row, at('SPLCOLOR')) || stringCell(row, at('COLOR_TEXT')),
      shape: stringCell(row, at('SPLSHAPE')) || stringCell(row, at('SHAPE_TEXT')),
      size: stringCell(row, at('SPLSIZE')),
      score: scoreText && Number.isFinite(Number(scoreText)) ? Number(scoreText) : null,
      publishedDate: stringCell(row, at('PUBLISHED_DATE')),
      retrievedAt,
    };
  }).filter((record) => Boolean(record.imprint && record.productNdc));
}

export class MedicationService {
  private readonly statePath: string;
  private starterCache: { release: string; records: PillRecord[] } | null | undefined;
  constructor(private readonly paths: PortablePathService, private readonly fetcher: typeof globalThis.fetch = globalThis.fetch, private readonly starterIndexPath?: string) {
    this.statePath = paths.resolve('Data/Medication/fda-reference.json');
  }

  private starter(): { release: string; records: PillRecord[] } | null {
    if (this.starterCache !== undefined) return this.starterCache;
    try {
      if (!this.starterIndexPath) return this.starterCache = null;
      const value = JSON.parse(fs.readFileSync(this.starterIndexPath, 'utf8')) as StarterPillIndex;
      if (value.schemaVersion !== 1 || !Array.isArray(value.records)) return this.starterCache = null;
      const retrievedAt = `${value.sourceRelease}T00:00:00.000Z`;
      const records = value.records.map((row): PillRecord => ({
        id: `starter:${row[0]}`, setId: row[1], name: row[2], productNdc: row[3], imprint: row[4],
        color: row[5], shape: row[6], size: row[7], score: row[8], publishedDate: value.sourceRelease, retrievedAt,
      }));
      return this.starterCache = { release: value.sourceRelease, records };
    } catch { return this.starterCache = null; }
  }

  private load(): MedicationStore {
    try {
      const value = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Omit<Partial<MedicationStore>, 'schemaVersion'> & { schemaVersion?: number };
      if ((value.schemaVersion === 1 || value.schemaVersion === 2) && Array.isArray(value.records)) return {
        schemaVersion: 2,
        disclaimerVersion: value.disclaimerVersion ?? MEDICATION_DISCLAIMER_VERSION,
        acknowledgedAt: value.disclaimerVersion === MEDICATION_DISCLAIMER_VERSION ? value.acknowledgedAt ?? null : null,
        lastOnlineRefreshAt: value.lastOnlineRefreshAt ?? null,
        records: value.records,
        pills: Array.isArray(value.pills) ? value.pills : [],
      };
    } catch { /* First use or recoverable metadata damage. */ }
    return { schemaVersion: 2, disclaimerVersion: MEDICATION_DISCLAIMER_VERSION, acknowledgedAt: null, lastOnlineRefreshAt: null, records: [], pills: [] };
  }

  private save(store: MedicationStore): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8'); fs.renameSync(temporary, this.statePath);
  }

  state(query = ''): MedicationState {
    const store = this.load(); const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const records = store.records.filter((record) => {
      const haystack = [...record.brandNames, ...record.genericNames, ...record.substances, ...record.manufacturerNames,
        ...record.productNdcs, ...record.routes, ...record.dosageForms].join(' ').toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    }).sort((a, b) => (a.brandNames[0] ?? a.genericNames[0] ?? '').localeCompare(b.brandNames[0] ?? b.genericNames[0] ?? ''));
    const starter = this.starter();
    return {
      disclaimerVersion: MEDICATION_DISCLAIMER_VERSION, acknowledged: Boolean(store.acknowledgedAt),
      acknowledgedAt: store.acknowledgedAt, cachedRecords: store.records.length, cachedPills: store.pills.length,
      starterPills: starter?.records.length ?? 0, pillIndexRelease: starter?.release ?? null,
      lastOnlineRefreshAt: store.lastOnlineRefreshAt, records,
    };
  }

  acknowledge(accepted: boolean): MedicationState {
    const store = this.load(); store.disclaimerVersion = MEDICATION_DISCLAIMER_VERSION; store.acknowledgedAt = accepted ? new Date().toISOString() : null;
    this.save(store); return this.state();
  }

  async suggestions(query: string): Promise<MedicationSuggestion[]> {
    const cleaned = query.trim().replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 80);
    const token = cleaned.split(/\s+/).filter(Boolean).at(-1) ?? '';
    if (token.length < 2) return [];
    const suggestions = new Map<string, MedicationSuggestion>();
    for (const record of this.state(cleaned).records.slice(0, 8)) {
      const label = record.brandNames[0] ?? record.genericNames[0] ?? record.substances[0]; if (!label) continue;
      suggestions.set(label.toLocaleLowerCase(), { value: label, label, detail: record.genericNames[0] ?? record.substances[0] ?? 'Saved FDA label', source: 'drive' });
    }
    try {
      const terms = ['openfda.brand_name', 'openfda.generic_name', 'openfda.substance_name']
        .map((field) => encodeURIComponent(`${field}:${token}*`)).join('+');
      const response = await this.fetcher(`https://api.fda.gov/drug/label.json?search=${terms}&limit=12`, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const payload = await response.json() as { results?: Array<Record<string, unknown>> };
        for (const raw of payload.results ?? []) {
          const openfda = raw.openfda && typeof raw.openfda === 'object' ? raw.openfda as Record<string, unknown> : {};
          const brands = strings(openfda.brand_name); const generics = strings(openfda.generic_name); const substances = strings(openfda.substance_name);
          const label = brands[0] ?? generics[0] ?? substances[0]; if (!label) continue;
          const key = label.toLocaleLowerCase(); if (!suggestions.has(key)) suggestions.set(key, { value: label, label, detail: generics[0] ?? substances[0] ?? 'FDA drug label', source: 'FDA' });
          if (suggestions.size >= 10) break;
        }
      }
    } catch { /* Suggestions are optional; local matches and normal search still work offline. */ }
    return [...suggestions.values()].slice(0, 10);
  }

  async fetch(query: string): Promise<MedicationOperationResult> {
    const cleaned = query.trim().replace(/["\\]/g, '').slice(0, 100);
    if (cleaned.length < 2) throw new Error('Enter at least two letters, an ingredient, or an NDC.');
    const store = this.load();
    if (!store.acknowledgedAt) throw new Error('Accept the medication-reference warning before retrieving FDA records.');
    const fields = /^\d{4,5}-?\d{3,4}/.test(cleaned) ? ['openfda.product_ndc'] : ['openfda.brand_name', 'openfda.generic_name', 'openfda.substance_name'];
    const retrievedAt = new Date().toISOString(); const found = new Map<string, MedicationRecord>();
    for (const field of fields) {
      const search = `${field}:\"${cleaned}\"`;
      const response = await this.fetcher(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(search)}&limit=25`, { headers: { Accept: 'application/json' } });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`FDA lookup failed with HTTP ${response.status}. Existing offline records are still available.`);
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      for (const raw of payload.results ?? []) { const record = mapLabel(raw, retrievedAt); found.set(record.id, record); }
    }
    const merged = new Map(store.records.map((record) => [record.id, record])); for (const [id, record] of found) merged.set(id, record);
    store.records = [...merged.values()]; store.lastOnlineRefreshAt = retrievedAt; this.save(store);
    return { ok: true, message: found.size ? `${found.size} current FDA ${found.size === 1 ? 'label was' : 'labels were'} saved to this drive for offline use.` : 'No FDA label records matched that exact name. Try a generic name, active ingredient, brand, or NDC.', state: this.state(cleaned) };
  }

  private async ndcsFor(query: string): Promise<string[]> {
    if (/^\d{4,6}-\d{3,4}(?:-\d{1,2})?$/.test(query)) return [query];
    const ndcs = new Set<string>();
    for (const record of this.state(query).records) for (const ndc of record.productNdcs) ndcs.add(ndc);
    const fields = ['brand_name', 'generic_name', 'active_ingredients.name'];
    for (const field of fields) {
      const response = await this.fetcher(`https://api.fda.gov/drug/ndc.json?search=${encodeURIComponent(`${field}:\"${query}\"`)}&limit=25`, { headers: { Accept: 'application/json' } });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`FDA product lookup failed with HTTP ${response.status}.`);
      const payload = await response.json() as { results?: Array<Record<string, unknown>> };
      for (const result of payload.results ?? []) if (typeof result.product_ndc === 'string') ndcs.add(result.product_ndc);
      if (ndcs.size >= 30) break;
    }
    return [...ndcs].slice(0, 30);
  }

  async fetchPillRecords(query: string): Promise<MedicationOperationResult> {
    const cleaned = query.trim().replace(/["\\]/g, '').slice(0, 100);
    if (cleaned.length < 2) throw new Error('Enter a medication name, active ingredient, or NDC.');
    const store = this.load();
    if (!store.acknowledgedAt) throw new Error('Accept the medication-reference warning before retrieving FDA records.');
    const ndcs = await this.ndcsFor(cleaned);
    if (!ndcs.length) return { ok: true, message: 'No current FDA product records matched that name or NDC.', state: this.state() };
    const retrievedAt = new Date().toISOString(); const found = new Map<string, PillRecord>();
    for (let offset = 0; offset < ndcs.length; offset += 4) {
      const batch = await Promise.all(ndcs.slice(offset, offset + 4).map(async (ndc) => {
        const response = await this.fetcher(`https://dailymed.nlm.nih.gov/dailymed/services/v1/ndc/${encodeURIComponent(ndc)}/imprintdata.json`, { headers: { Accept: 'application/json' } });
        if (response.status === 404) return [];
        if (!response.ok) throw new Error(`DailyMed pill-characteristic lookup failed with HTTP ${response.status}.`);
        return mapDailyMedRows(await response.json(), retrievedAt);
      }));
      for (const records of batch) for (const record of records) found.set(record.id, record);
    }
    const merged = new Map(store.pills.map((record) => [record.id, record])); for (const [id, record] of found) merged.set(id, record);
    store.pills = [...merged.values()]; store.lastOnlineRefreshAt = retrievedAt; this.save(store);
    return {
      ok: true,
      message: found.size ? `${found.size} current FDA/DailyMed pill ${found.size === 1 ? 'record was' : 'records were'} saved to this drive. Pill matching now works offline for those records.` : 'FDA found matching products, but no current solid-pill characteristics were supplied for them.',
      state: this.state(),
    };
  }

  searchPills(query: PillSearchQuery): PillMatch[] {
    const target = normalizeImprint(query.imprint);
    if (target.length < 1) throw new Error('Enter the letters or numbers printed on the pill.');
    const color = query.color?.trim().toLocaleUpperCase() ?? '';
    const shape = query.shape?.trim().toLocaleUpperCase() ?? '';
    const combined = new Map<string, PillRecord>();
    for (const record of [...(this.starter()?.records ?? []), ...this.load().pills]) {
      combined.set(`${record.productNdc}|${normalizeImprint(record.imprint)}|${record.color}|${record.shape}|${record.name}`, record);
    }
    return [...combined.values()].map((record): PillMatch | null => {
      const stored = normalizeImprint(record.imprint);
      if (!stored || (!stored.includes(target) && !target.includes(stored))) return null;
      if (color && record.color.toLocaleUpperCase() !== color) return null;
      if (shape && record.shape.toLocaleUpperCase() !== shape) return null;
      return { ...record, match: stored === target ? 'exact' : 'partial' };
    }).filter((record): record is PillMatch => Boolean(record)).sort((a, b) => (a.match === b.match ? a.name.localeCompare(b.name) : a.match === 'exact' ? -1 : 1)).slice(0, 100);
  }

  clear(): MedicationOperationResult {
    const store = this.load(); store.records = []; store.pills = []; store.lastOnlineRefreshAt = null; this.save(store);
    return { ok: true, message: 'Cached FDA label and pill-characteristic records were removed. Your acknowledgment setting was kept.', state: this.state() };
  }
}
