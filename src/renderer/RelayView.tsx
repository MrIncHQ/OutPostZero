import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { RelayPeer, RelayState, RelayTransfer } from '../shared/contracts';
import './relay.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 10) return 'now'; if (seconds < 60) return `${seconds}s`; if (seconds < 3600) return `${Math.floor(seconds / 60)}m`; return `${Math.floor(seconds / 3600)}h`;
}

export function RelayView() {
  const [state, setState] = useState<RelayState>(); const [selected, setSelected] = useState('room');
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState<string>(); const [message, setMessage] = useState('');
  async function refresh() { setState(await window.outpost.getRelayState()); }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { if (!state?.enabled) return; const timer = window.setInterval(() => void refresh(), 1_500); return () => window.clearInterval(timer); }, [state?.enabled]);
  const peer = state?.peers.find((item) => item.id === selected);
  const messages = useMemo(() => state?.messages.filter((item) => selected === 'room' ? item.scope === 'room' : item.scope === 'direct' && item.peerId === selected) ?? [], [state?.messages, selected]);
  useEffect(() => { if (!state || !messages.some((item) => !item.read)) return; void window.outpost.markRelayRead(selected, selected === 'room' ? 'room' : 'direct').then(setState); }, [selected, state?.messages.length]);
  async function operation(name: string, work: () => Promise<{ message: string; state: RelayState }>) { setBusy(name); try { const result = await work(); setState(result.state); setMessage(result.message); } catch (error) { setMessage(error instanceof Error ? error.message : 'Local Relay operation failed.'); } finally { setBusy(undefined); } }
  async function send(event: FormEvent) { event.preventDefault(); const body = draft.trim(); if (!body) return; setDraft(''); await operation('send', () => window.outpost.sendRelayMessage(selected, selected === 'room' ? 'room' : 'direct', body)); }
  function choosePeer(next: string) { setSelected(next); setMessage(''); }
  if (!state) return <section className="page-panel"><p className="section-label">LOCAL RELAY</p><h2>Preparing the local radio room...</h2></section>;
  return <section className="page-panel relay-panel">
    <div className="page-heading relay-heading"><div><p className="section-label">ENCRYPTED LAN COMMUNICATION</p><h2>Local Relay</h2><p>No cloud, account, browser, or internet connection. Relay traffic stays on this local network.</p></div><button className={state.enabled ? 'danger-button' : 'primary-button'} disabled={Boolean(busy)} onClick={() => void operation('toggle', state.enabled ? window.outpost.stopRelay : window.outpost.startRelay)}>{busy === 'toggle' ? 'PLEASE WAIT...' : state.enabled ? 'STOP LOCAL RELAY' : 'START LOCAL RELAY'}</button></div>
    <div className="relay-security-strip"><span className={state.enabled ? 'online' : ''} /> <b>{state.enabled ? `LISTENING · PORT ${state.port}` : 'RELAY OFF'}</b><i>{state.transport}</i><small>IDENTITY {state.identityFingerprint}</small></div>
    {state.firewallMessage && <div className="warning">{state.firewallMessage}</div>}{message && <div className="module-result">{message}</div>}
    <div className="relay-layout">
      <aside className="relay-peers">
        <div className="relay-section-title"><span>CONVERSATIONS</span><small>{state.peers.filter((item) => item.online).length} NEARBY</small></div>
        <button className={selected === 'room' ? 'relay-peer active' : 'relay-peer'} onClick={() => choosePeer('room')}><span className="peer-presence room" /><div><b>Local Room</b><small>Fan-out encryption to nearby peers</small></div><em>{state.messages.filter((item) => item.scope === 'room' && !item.read).length || ''}</em></button>
        {state.peers.map((item) => <button className={selected === item.id ? 'relay-peer active' : 'relay-peer'} key={item.id} onClick={() => choosePeer(item.id)}><span className={item.online ? 'peer-presence online' : 'peer-presence'} /><div><b>{item.displayName}</b><small>{item.identityChanged ? 'IDENTITY CHANGED' : item.verified ? 'Verified device' : 'Verification required'} · {relativeTime(item.lastSeenAt)}</small></div><em>{state.messages.filter((entry) => entry.peerId === item.id && !entry.read).length || ''}</em></button>)}
        {!state.peers.length && <div className="relay-empty"><b>No nearby Outposts yet</b><p>Start Local Relay on another device connected to this LAN. Discovery normally appears within a few seconds.</p></div>}
        <label className="relay-history"><input type="checkbox" checked={state.historyEnabled} onChange={(event) => void window.outpost.setRelayHistory(event.target.checked).then(setState)} /><span><b>Save chat history</b><small>{state.historyEnabled ? 'Stored only under Data/Chat on this drive.' : 'Messages disappear when this app closes.'}</small></span></label>
      </aside>
      <section className="relay-conversation">
        <div className="conversation-heading"><div><p className="section-label">{selected === 'room' ? 'SHARED LOCAL ROOM' : 'DIRECT MESSAGE'}</p><h3>{selected === 'room' ? 'Everyone nearby' : peer?.displayName ?? 'Select a peer'}</h3></div>{peer && <div className={peer.verified ? 'trust-badge verified' : 'trust-badge'}>{peer.verified ? 'VERIFIED' : 'UNVERIFIED'}</div>}</div>
        {peer && !peer.verified && <PeerVerification peer={peer} onVerify={() => void window.outpost.verifyRelayPeer(peer.id).then(setState)} onForget={() => void window.outpost.forgetRelayPeer(peer.id).then((next) => { setState(next); setSelected('room'); })} />}
        <div className="relay-messages">{messages.map((item) => <article className={item.direction === 'outgoing' ? 'relay-message outgoing' : 'relay-message'} key={item.id}><div><b>{item.senderName}</b><time>{new Date(item.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{item.body}</p>{item.direction === 'outgoing' && <small>{item.delivered ? 'Delivered' : 'Not delivered'}</small>}</article>)}{!messages.length && <div className="conversation-empty"><b>{selected === 'room' ? 'The local room is quiet' : 'No messages yet'}</b><p>{state.enabled ? 'Messages use authenticated TLS 1.3 connections directly between portable Outposts.' : 'Start Local Relay to send and receive.'}</p></div>}</div>
        <form className="relay-composer" onSubmit={(event) => void send(event)}><textarea value={draft} maxLength={4000} placeholder={selected === 'room' ? 'Message everyone nearby...' : peer ? `Message ${peer.displayName}...` : 'Select a peer...'} disabled={!state.enabled || (selected !== 'room' && (!peer || !peer.online))} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div><small>{draft.length}/4000</small>{peer && <button type="button" className="secondary-button" disabled={!state.enabled || !peer.online || Boolean(busy)} onClick={() => void operation('file', () => window.outpost.sendRelayFile(peer.id))}>SEND FILE</button>}<button className="primary-button" disabled={!draft.trim() || !state.enabled || Boolean(busy) || (selected !== 'room' && (!peer || !peer.online))}>{busy === 'send' ? 'SENDING...' : 'SEND'}</button></div></form>
      </section>
      <aside className="relay-transfers"><div className="relay-section-title"><span>FILE TRANSFERS</span><small>SHA-256 VERIFIED</small></div>{state.transfers.slice().reverse().map((transfer) => <TransferCard key={transfer.id} transfer={transfer} onState={setState} />)}{!state.transfers.length && <div className="relay-empty"><b>No file transfers</b><p>Files are accepted explicitly, encrypted in transit, and saved directly to this portable drive.</p></div>}</aside>
    </div>
  </section>;
}

function PeerVerification({ peer, onVerify, onForget }: { peer: RelayPeer; onVerify: () => void; onForget: () => void }) {
  return <div className={peer.identityChanged ? 'peer-verification changed' : 'peer-verification'}><div><b>{peer.identityChanged ? 'WARNING · IDENTITY CHANGED' : `FIRST TIME CONNECTING TO ${peer.displayName.toUpperCase()}`}</b><p>Compare this code on both Outposts before marking the device verified.</p></div><strong>{peer.verificationCode}</strong><code>{peer.fingerprint}</code><div><button className="secondary-button" onClick={onForget}>FORGET</button><button className="primary-button" onClick={onVerify}>MARK VERIFIED</button></div></div>;
}

function TransferCard({ transfer, onState }: { transfer: RelayTransfer; onState: (state: RelayState) => void }) {
  const percent = transfer.size ? Math.min(100, transfer.transferredBytes / transfer.size * 100) : 0;
  return <article className="relay-transfer"><div><b>{transfer.fileName}</b><span>{transfer.direction === 'incoming' ? `FROM ${transfer.peerName}` : `TO ${transfer.peerName}`}</span></div><p>{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.size)} · {transfer.status}</p><div className="progress-track"><span style={{ width: `${percent}%` }} /></div>{transfer.message && <small>{transfer.message}</small>}{transfer.status === 'offered' && <div className="transfer-actions"><button onClick={() => void window.outpost.declineRelayFile(transfer.id).then((result) => onState(result.state))}>DECLINE</button><button onClick={() => void window.outpost.acceptRelayFile(transfer.id, 'documents').then((result) => onState(result.state))}>SAVE TO DOCUMENTS</button><button onClick={() => void window.outpost.acceptRelayFile(transfer.id, 'media').then((result) => onState(result.state))}>SAVE TO MEDIA</button></div>}{['waiting', 'transferring'].includes(transfer.status) && <button className="transfer-cancel" onClick={() => void window.outpost.cancelRelayTransfer(transfer.id).then((result) => onState(result.state))}>CANCEL</button>}{transfer.relativePath && <code>{transfer.relativePath}</code>}</article>;
}
