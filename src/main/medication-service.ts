import fs from 'node:fs';
import path from 'node:path';
import type { MedicationOperationResult, MedicationRecord, MedicationState } from '../shared/contracts';
import { PortablePathService } from './portable-path';

export const MEDICATION_DISCLAIMER_VERSION = '2026-08-10.1';

interface MedicationStore {
  schemaVersion: 1;
  disclaimerVersion: string;
  acknowledgedAt: string | null;
  lastOnlineRefreshAt: string | null;
  records: MedicationRecord[];
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

export class MedicationService {
  private readonly statePath: string;
  constructor(private readonly paths: PortablePathService, private readonly fetcher: typeof globalThis.fetch = globalThis.fetch) {
    this.statePath = paths.resolve('Data/Medication/fda-reference.json');
  }

  private load(): MedicationStore {
    try {
      const value = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<MedicationStore>;
      if (value.schemaVersion === 1 && Array.isArray(value.records)) return {
        schemaVersion: 1, disclaimerVersion: value.disclaimerVersion ?? MEDICATION_DISCLAIMER_VERSION,
        acknowledgedAt: value.disclaimerVersion === MEDICATION_DISCLAIMER_VERSION ? value.acknowledgedAt ?? null : null,
        lastOnlineRefreshAt: value.lastOnlineRefreshAt ?? null, records: value.records,
      };
    } catch { /* First use or recoverable metadata damage. */ }
    return { schemaVersion: 1, disclaimerVersion: MEDICATION_DISCLAIMER_VERSION, acknowledgedAt: null, lastOnlineRefreshAt: null, records: [] };
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
    return { disclaimerVersion: MEDICATION_DISCLAIMER_VERSION, acknowledged: Boolean(store.acknowledgedAt),
      acknowledgedAt: store.acknowledgedAt, cachedRecords: store.records.length, lastOnlineRefreshAt: store.lastOnlineRefreshAt, records };
  }

  acknowledge(accepted: boolean): MedicationState {
    const store = this.load(); store.disclaimerVersion = MEDICATION_DISCLAIMER_VERSION; store.acknowledgedAt = accepted ? new Date().toISOString() : null;
    this.save(store); return this.state();
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

  clear(): MedicationOperationResult {
    const store = this.load(); store.records = []; store.lastOnlineRefreshAt = null; this.save(store);
    return { ok: true, message: 'Cached FDA label records were removed. Your acknowledgment setting was kept.', state: this.state() };
  }
}
