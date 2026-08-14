import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { AiChatProgress, AiDownloadStatus, AiSource, AiState, ModuleSummary } from '../shared/contracts';
import './ai.css';

function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB']; let amount = value; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount.toFixed(unit >= 3 ? 1 : 0)} ${units[unit]}`;
}

interface ChatMessage { role: 'user' | 'assistant'; content: string }

export function AiView({ onModules }: { onModules: (modules: ModuleSummary[]) => void }) {
  const [state, setState] = useState<AiState>();
  const [download, setDownload] = useState<AiDownloadStatus>();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [prompt, setPrompt] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<AiSource[]>([]);
  const [chatProgress, setChatProgress] = useState<AiChatProgress>();

  async function refresh() { setState(await window.outpost.getAiState()); }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!busy.startsWith('download') && busy !== 'runtime') return;
    const timer = window.setInterval(() => void window.outpost.getAiDownloadStatus().then(setDownload), 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function operation(key: string, action: () => Promise<{ message: string; state: AiState }>) {
    setBusy(key); setMessage('');
    try { const result = await action(); setState(result.state); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Local AI action failed.'); }
    finally { setBusy(''); setDownload(await window.outpost.getAiDownloadStatus()); onModules(await window.outpost.refreshModules()); }
  }

  async function send(event: FormEvent) {
    event.preventDefault(); const content = prompt.trim(); if (!content || busy) return;
    const next: ChatMessage[] = [...chat, { role: 'user', content }]; setChat([...next, { role: 'assistant', content: '' }]); setPrompt(''); setBusy('chat'); setSources([]);
    const timer = window.setInterval(() => void window.outpost.getAiChatProgress().then((progress) => {
      setChatProgress(progress); setSources(progress.sources);
      setChat([...next, { role: 'assistant', content: progress.response }]);
    }), 120);
    try {
      const result = await window.outpost.chatWithAi(next); setState(result.state); setMessage(result.message);
      setSources(result.sources ?? []); if (result.response) setChat([...next, { role: 'assistant', content: result.response }]);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The local AI request failed.'); }
    finally { window.clearInterval(timer); setChatProgress(await window.outpost.getAiChatProgress()); setBusy(''); }
  }

  const selected = useMemo(() => state?.models.find((model) => model.selected), [state]);
  if (!state) return <section className="page-panel"><p className="section-label">LOCAL AI</p><h2>Inspecting this computer...</h2></section>;
  const activeDownload = download && !['idle', 'complete', 'cancelled', 'error'].includes(download.state);
  const needsRuntime = !state.runtimeInstalled || (state.accelerationSupported && !state.acceleratorInstalled);
  const percent = activeDownload && download.totalBytes ? Math.min(100, download.downloadedBytes / download.totalBytes * 100) : 0;

  return (
    <section className="page-panel ai-page">
      <div className="page-heading"><div><p className="section-label">LOCAL AI · OPTIONAL</p><h2>Choose what this computer can safely run.</h2></div><button className="secondary-button" onClick={() => void refresh()} disabled={Boolean(busy)}>RECHECK COMPUTER</button></div>
      <p className="page-intro">Models stay on this drive. Outpost Zero checks the connected computer every time and never starts an incompatible selection.</p>
      <div className={`ai-host ${state.supportedHost ? 'compatible' : 'blocked'}`}>
        <div><small>CURRENT COMPUTER</small><b>{state.hardware.cpuModel}</b><span>{bytes(state.hardware.totalMemoryBytes)} RAM · {state.hardware.logicalCores} logical cores · {state.hardware.gpuDevices.join(', ') || 'CPU mode'}</span></div>
        <strong>{state.supportedHost ? 'AI CAPABLE' : 'AI LOCKED'}</strong><p>{state.hostMessage}</p>
      </div>
      {message && <div className="module-result" role="status">{message}</div>}
      {activeDownload && <div className="ai-download"><div><b>{download.title}</b><span>{percent.toFixed(1)}% · {bytes(download.downloadedBytes)} of {bytes(download.totalBytes)}</span></div><div className="ai-progress"><i style={{ width: `${percent}%` }} /></div><p>{download.message}</p><button className="secondary-button" onClick={() => void window.outpost.cancelAiDownload()}>CANCEL</button></div>}

      <div className="ai-runtime">
        <div><p className="section-label">STEP 1 · PORTABLE ENGINE</p><h3>llama.cpp portable runtime</h3><p>{state.runtimeMessage} Everything stays on this drive and CPU fallback remains available when the drive moves.</p></div>
        <div><span className={state.runtimeInstalled ? 'ready' : ''}>{state.runtimeInstalled ? `INSTALLED · ${state.runtimeVersion} · ${state.runtimeBackend.toUpperCase()}` : `NOT INSTALLED · ${bytes(18_423_015)}`}</span>{needsRuntime && <button className="primary-button" disabled={Boolean(busy) || !state.supportedHost} onClick={() => void operation('runtime', () => window.outpost.installAiRuntime())}>{state.runtimeInstalled ? `INSTALL GPU ACCELERATOR · ${bytes(34_172_931)}` : 'INSTALL RUNTIME'}</button>}</div>
      </div>

      <div className="ai-model-heading"><div><p className="section-label">STEP 2 · SELECT ONE MODEL</p><h3>Recommended for this computer</h3></div><p>No model downloads until you choose it.</p></div>
      <div className="ai-models">
        {state.models.map((model) => <article className={`${model.recommended ? 'recommended' : ''} ${!model.compatible ? 'incompatible' : ''}`} key={model.id}>
          <div className="ai-model-title"><div><small>{model.tier.toUpperCase()}</small><h3>{model.name}</h3></div>{model.recommended && <strong>RECOMMENDED</strong>}</div>
          <p>{model.parameters} parameters · {model.quantization} · {bytes(model.downloadBytes)} download</p>
          <dl><div><dt>Memory</dt><dd>{bytes(model.minimumMemoryBytes)} minimum</dd></div><div><dt>CPU</dt><dd>{model.minimumLogicalCores}+ logical cores</dd></div><div><dt>Context</dt><dd>{model.contextLength.toLocaleString()} tokens</dd></div><div><dt>Publisher</dt><dd>{model.publisher}</dd></div><div><dt>License</dt><dd>{model.license}</dd></div></dl>
          <div className={`ai-compatibility ${model.compatible ? 'yes' : 'no'}`}>{model.compatibilityMessage}</div>
          <div className="ai-model-actions">
            {!model.installed && <button className={model.recommended ? 'primary-button' : 'secondary-button'} disabled={Boolean(busy)} onClick={() => void operation(`download:${model.id}`, () => window.outpost.downloadAiModel(model.id))}>{model.compatible ? 'DOWNLOAD' : 'DOWNLOAD FOR ANOTHER PC'} · {bytes(model.downloadBytes)}</button>}
            {model.installed && !model.selected && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void operation(`select:${model.id}`, () => window.outpost.selectAiModel(model.id))}>SELECT</button>}
            {model.installed && model.selected && <span className="ai-selected">SELECTED</span>}
            {model.installed && <button className="danger-button" disabled={Boolean(busy) || state.running} onClick={() => window.confirm(`Remove ${model.name} from this drive?`) && void operation(`remove:${model.id}`, () => window.outpost.removeAiModel(model.id))}>REMOVE</button>}
          </div>
        </article>)}
      </div>

      <div className="ai-control">
        <div><p className="section-label">STEP 3 · ENABLE ONLY WHEN NEEDED</p><h3>{selected ? selected.name : 'No model selected'}</h3><p>{selected && !selected.compatible ? 'This installed model is locked on the current computer. Select a compatible lower tier.' : state.running ? 'The model is active only inside this app.' : 'AI remains off until you explicitly start it.'}</p></div>
        <div>{selected && <button className="secondary-button" disabled={Boolean(busy) || state.running} onClick={() => void operation('none', () => window.outpost.selectAiModel(null))}>USE NO MODEL</button>}{!state.running ? <button className="primary-button" disabled={Boolean(busy) || !state.runtimeInstalled || !selected?.installed || !selected.compatible} onClick={() => void operation('start', () => window.outpost.startAi())}>{busy === 'start' ? 'LOADING MODEL...' : 'START LOCAL AI'}</button> : <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void operation('stop', () => window.outpost.stopAi())}>STOP LOCAL AI</button>}</div>
      </div>

      {state.enabled && <div className="ai-chat">
        {busy === 'chat' && chatProgress && <div className="ai-chat-progress"><b>{chatProgress.phase === 'searching' ? 'SEARCHING LIBRARY' : 'GENERATING RESPONSE'}</b><span>{(chatProgress.elapsedMs / 1000).toFixed(1)} seconds{chatProgress.tokensPerSecond ? ` · ${chatProgress.tokensPerSecond.toFixed(1)} tokens/sec` : ''}</span><p>{chatProgress.message}</p></div>}
        <div className="ai-chat-history">{chat.length === 0 ? <div className="ai-empty"><b>Local assistant ready</b><p>Ask a question. Outpost Zero searches indexed documents and installed Kiwix libraries first, then uses model knowledge when local sources do not answer it. Important answers still need verification.</p></div> : chat.map((entry, index) => <div className={`ai-message ${entry.role}`} key={`${entry.role}-${index}`}><small>{entry.role === 'user' ? 'YOU' : selected?.name}</small><p>{entry.content || (busy === 'chat' ? 'Waiting for the first token…' : '')}</p></div>)}</div>
        {sources.length > 0 && <div className="ai-sources"><small>LOCAL SOURCES USED</small>{sources.map((source, index) => <div key={source.id}><b>[S{index + 1}] {source.title}</b><span>{source.location}</span><p>{source.excerpt}</p></div>)}</div>}
        <form onSubmit={send}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={12_000} placeholder="Ask the offline assistant..." /><button className="primary-button" disabled={!prompt.trim() || Boolean(busy)}>{busy === 'chat' ? (chatProgress?.phase === 'generating' ? 'GENERATING...' : 'SEARCHING LIBRARY...') : 'SEND'}</button></form>
      </div>}
    </section>
  );
}
