import { FormEvent, useEffect, useRef, useState } from 'react';
import type { MedicationRecord, MedicationState, MedicationSuggestion } from '../shared/contracts';
import './medication.css';

const WARNING = 'This is an offline reference and may be incomplete or outdated. It does not diagnose, prescribe, replace a pharmacist or clinician, guarantee a pill\'s identity, or make an unknown medication safe to take. For poisoning or an urgent exposure in the U.S., call Poison Control at 1-800-222-1222; call emergency services for severe symptoms.';

function list(values: string[]): string { return values.length ? values.join(', ') : 'Not listed in this record'; }
function Section({ title, text }: { title: string; text: string }) { return text ? <details className="med-section"><summary>{title}</summary><p>{text}</p></details> : null; }

export function MedicationView() {
  const [state, setState] = useState<MedicationState>(); const [accepted, setAccepted] = useState(false);
  const [query, setQuery] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<MedicationRecord>();
  const [suggestions, setSuggestions] = useState<MedicationSuggestion[]>([]); const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionBusy, setSuggestionBusy] = useState(false); const suggestionRequest = useRef(0);
  useEffect(() => { void window.outpost.getMedicationState().then(setState).catch((error) => setMessage(String(error))); }, []);
  useEffect(() => {
    const current = ++suggestionRequest.current; const cleaned = query.trim();
    if (!state?.acknowledged || cleaned.length < 2) { setSuggestions([]); setSuggestionBusy(false); return; }
    setSuggestionBusy(true);
    const timer = window.setTimeout(() => { void window.outpost.getMedicationSuggestions(cleaned).then((items) => {
      if (suggestionRequest.current === current) { setSuggestions(items); setShowSuggestions(items.length > 0); }
    }).catch(() => { if (suggestionRequest.current === current) setSuggestions([]); }).finally(() => { if (suggestionRequest.current === current) setSuggestionBusy(false); }); }, 450);
    return () => window.clearTimeout(timer);
  }, [query, state?.acknowledged]);
  async function acknowledge() { if (!accepted) return; setState(await window.outpost.acknowledgeMedicationDisclaimer(true)); }
  async function searchValue(searchQuery: string, driveOnly: boolean) {
    const cleaned = searchQuery.trim(); if (!cleaned) return; setBusy(true); setMessage(''); setSelected(undefined); setShowSuggestions(false);
    try {
      if (driveOnly) {
        const next = await window.outpost.getMedicationState(cleaned); setState(next);
        setMessage(next.records.length ? `${next.records.length} saved FDA records matched.` : 'No saved records matched. Use Search Medication while connected once to save FDA labels to this drive.');
      } else {
        try { const result = await window.outpost.fetchMedicationFromFda(cleaned); setState(result.state); setMessage(result.message); }
        catch (onlineError) {
          const local = await window.outpost.getMedicationState(cleaned); setState(local);
          setMessage(local.records.length ? `FDA is unavailable, so ${local.records.length} saved ${local.records.length === 1 ? 'record is' : 'records are'} shown from this drive.` : `${onlineError instanceof Error ? onlineError.message : 'FDA is unavailable.'} No matching record is saved on this drive yet.`);
        }
      }
    } finally { setBusy(false); }
  }
  function search(event: FormEvent, driveOnly: boolean) { event.preventDefault(); void searchValue(query, driveOnly); }
  function chooseSuggestion(suggestion: MedicationSuggestion) {
    setQuery(suggestion.value); setSuggestions([]); setShowSuggestions(false); void searchValue(suggestion.value, false);
  }
  if (!state) return <section className="page-panel"><p className="section-label">MEDICATION REFERENCE</p><h2>Opening local FDA reference...</h2>{message && <div className="module-result">{message}</div>}</section>;
  if (!state.acknowledged) return <section className="page-panel medication-gate">
    <p className="section-label">SAFETY ACKNOWLEDGMENT REQUIRED</p><h2>Medication reference, not medical advice.</h2>
    <div className="med-warning"><b>Read this before continuing</b><p>{WARNING}</p><p>Do not use color, shape, or imprint alone to decide that an unknown pill is safe. Data can change after it is saved to this drive.</p></div>
    <label className="med-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)}/><span>I understand these limits and will treat all results as reference information only.</span></label>
    <button className="primary-button" disabled={!accepted} onClick={() => void acknowledge()}>ENTER MEDICATION REFERENCE</button>
  </section>;
  return <section className="page-panel medication-page">
    <div className="page-heading"><div><p className="section-label">OFFLINE MEDICATION REFERENCE</p><h2>Search saved FDA labels</h2></div><span className="med-cache-count">{state.cachedRecords} SAVED RECORDS</span></div>
    <div className="med-banner" role="note">REFERENCE ONLY · VERIFY THE PACKAGE AND ASK A PHARMACIST OR CLINICIAN WHEN POSSIBLE</div>
    <form className="med-search" onSubmit={(event) => search(event, false)}><div className="med-search-box"><input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setShowSuggestions(suggestions.length > 0)} onBlur={() => window.setTimeout(() => setShowSuggestions(false), 160)} autoComplete="off" aria-autocomplete="list" aria-expanded={showSuggestions} aria-controls="medication-suggestions" placeholder="Start typing a brand, generic name, ingredient, or NDC"/>{suggestionBusy && <span className="med-suggestion-loading">FINDING NAMES...</span>}{showSuggestions && <div className="med-suggestions" id="medication-suggestions" role="listbox">{suggestions.map((suggestion) => <button type="button" role="option" key={`${suggestion.source}-${suggestion.value}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}><span><b>{suggestion.label}</b><small>{suggestion.detail}</small></span><i>{suggestion.source === 'FDA' ? 'FDA' : 'ON DRIVE'}</i></button>)}</div>}</div><button className="primary-button" disabled={busy}>{busy ? 'SEARCHING...' : 'SEARCH MEDICATION'}</button><button className="secondary-button" type="button" disabled={busy} onClick={() => void searchValue(query, true)}>THIS DRIVE ONLY</button></form>
    <p className="med-source-note">Search Medication retrieves current matching labels from the official openFDA endpoint and saves them here. If FDA cannot be reached, it automatically falls back to records already on this drive.</p>
    {message && <div className="module-result" role="status">{message}</div>}
    <div className="med-tabs"><button className="active">FDA LABELS</button><button disabled title="No current authoritative pill-identification dataset has been approved for this build.">PILL ID · DATA SOURCE REQUIRED</button></div>
    <div className="pill-status"><b>Pill identification needs a licensed offline data source</b><p>The former federal Pillbox dataset was retired and its final files are not updated. Private services such as Drugs.com provide imprint, color, shape, and image matching, but their database cannot be copied into Outpost Zero without permission and redistribution rights. This section will remain unavailable until a current authoritative dataset is legally licensed and validated.</p></div>
    <div className={selected ? 'med-workspace selected' : 'med-workspace'}><div className="med-results">{state.records.map((record) => <button key={record.id} className={selected?.id === record.id ? 'active' : ''} onClick={() => setSelected(record)}><b>{record.brandNames[0] ?? record.genericNames[0] ?? 'FDA label record'}</b><span>{list(record.genericNames)}</span><small>{list(record.substances)} · {list(record.productNdcs)}</small></button>)}{!state.records.length && <div className="empty-state"><b>No matching saved labels</b><p>Search this drive, or briefly connect and retrieve current records directly from FDA.</p></div>}</div>
      {selected && <article className="med-details"><button className="med-close" onClick={() => setSelected(undefined)}>CLOSE</button><p className="section-label">FDA LABEL RECORD</p><h3>{selected.brandNames[0] ?? selected.genericNames[0] ?? 'Drug label'}</h3><dl><div><dt>Generic</dt><dd>{list(selected.genericNames)}</dd></div><div><dt>Ingredient</dt><dd>{list(selected.substances)}</dd></div><div><dt>Manufacturer</dt><dd>{list(selected.manufacturerNames)}</dd></div><div><dt>Route / form</dt><dd>{list([...selected.routes, ...selected.dosageForms])}</dd></div><div><dt>NDC</dt><dd>{list(selected.productNdcs)}</dd></div><div><dt>Saved</dt><dd>{new Date(selected.retrievedAt).toLocaleDateString()}</dd></div></dl><Section title="Indications and usage" text={selected.indications}/><Section title="Warnings" text={selected.warnings}/><Section title="Contraindications" text={selected.contraindications}/><Section title="Dosage and administration" text={selected.dosageAndAdministration}/><Section title="Adverse reactions" text={selected.adverseReactions}/><Section title="Drug interactions" text={selected.drugInteractions}/><Section title="Storage and handling" text={selected.storage}/></article>}
    </div>
    {state.cachedRecords > 0 && <button className="danger-button med-clear" onClick={() => { if (confirm('Remove all cached FDA label records from this drive?')) void window.outpost.removeMedicationCache().then((result) => { setState(result.state); setMessage(result.message); setSelected(undefined); }); }}>REMOVE CACHED FDA RECORDS</button>}
  </section>;
}
