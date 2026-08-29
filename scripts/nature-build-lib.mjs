import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const INFRA_RANKS = new Set(['subsp', 'ssp', 'var', 'subvar', 'f', 'forma']);

export function unescapeTsv(value) {
  return String(value ?? '').replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}

export function splitTsv(line) {
  return line.replace(/^\uFEFF/, '').split('\t').map(unescapeTsv);
}

export async function* streamTsvRows(input) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let headers;
  for await (const line of lines) {
    if (!headers) { headers = splitTsv(line).map((header) => header.replace(/^[^:]+:/u, '')); continue; }
    if (!line.trim()) continue;
    const values = splitTsv(line);
    yield Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  }
}

export function streamFileRows(file) {
  return streamTsvRows(fs.createReadStream(file, { encoding: 'utf8' }));
}

export async function* streamArchiveRows(archive, entry) {
  const child = spawn('tar', ['-xOf', archive, entry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  let stderr = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    yield* streamTsvRows(child.stdout);
    const code = await completed;
    if (code !== 0) throw new Error(`Could not stream ${entry} from ${archive}: ${stderr.trim() || `tar exited with ${code}`}`);
  } finally { if (child.exitCode === null) child.kill(); }
}

export function field(row, ...names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== '') return String(row[name]);
  return '';
}

export function canonicalScientificName(value) {
  const cleaned = String(value ?? '').normalize('NFKC').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const tokens = cleaned.split(' ');
  if (tokens.length < 2) return cleaned.toLocaleLowerCase();
  const selected = [tokens[0], tokens[1]];
  const third = tokens[2]?.replace(/[.,]$/g, '');
  if (third && INFRA_RANKS.has(third.toLocaleLowerCase()) && tokens[3]) selected.push(third.toLocaleLowerCase(), tokens[3]);
  else if (third && /^[a-z][a-z-]+$/u.test(third)) selected.push(third);
  return selected.join(' ').toLocaleLowerCase();
}

export function regionalNameKeys(row) {
  const names = [field(row, 'canonicalName', 'canonical_name'), field(row, 'scientificName', 'scientific_name', 'name')].filter(Boolean);
  return new Set(names.flatMap((name) => [name.normalize('NFKC').trim().toLocaleLowerCase(), canonicalScientificName(name)]).filter(Boolean));
}

export function usageNameKeys(row) {
  const names = [field(row, 'scientificName', 'name'), field(row, 'canonicalName')].filter(Boolean);
  const assembled = field(row, 'uninomial') || [field(row, 'genericName', 'genus'), field(row, 'specificEpithet'), field(row, 'infraspecificEpithet')].filter(Boolean).join(' ');
  if (assembled) names.push(assembled);
  return new Set(names.flatMap((name) => [name.normalize('NFKC').trim().toLocaleLowerCase(), canonicalScientificName(name)]).filter(Boolean));
}

export function matchesRegional(row, regionalKeys) {
  if (!regionalKeys) return true;
  return [...usageNameKeys(row)].some((key) => regionalKeys.has(key));
}
