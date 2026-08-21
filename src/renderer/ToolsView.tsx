import { useMemo, useState } from 'react';

type ToolId = 'calculator' | 'convert' | 'text' | 'network' | 'coordinates' | 'time' | 'compare' | 'password' | 'reference';

export class ExpressionParser {
  private position = 0;
  constructor(private readonly source: string) {}
  parse(): number { const value = this.expression(); this.space(); if (this.position !== this.source.length || !Number.isFinite(value)) throw new Error('Expression is invalid.'); return value; }
  private space() { while (/\s/.test(this.source[this.position] ?? '')) this.position += 1; }
  private take(value: string): boolean { this.space(); if (this.source.slice(this.position, this.position + value.length) !== value) return false; this.position += value.length; return true; }
  private expression(): number { let value = this.term(); for (;;) { if (this.take('+')) value += this.term(); else if (this.take('-')) value -= this.term(); else return value; } }
  private term(): number { let value = this.power(); for (;;) { if (this.take('*')) value *= this.power(); else if (this.take('/')) value /= this.power(); else if (this.take('%')) value %= this.power(); else return value; } }
  private power(): number { const value = this.unary(); return this.take('^') ? value ** this.power() : value; }
  private unary(): number { if (this.take('+')) return this.unary(); if (this.take('-')) return -this.unary(); return this.primary(); }
  private primary(): number {
    if (this.take('(')) { const value = this.expression(); if (!this.take(')')) throw new Error('Missing closing parenthesis.'); return value; }
    this.space(); const name = this.source.slice(this.position).match(/^[a-z]+/i)?.[0];
    if (name) { this.position += name.length; const lower = name.toLowerCase(); if (lower === 'pi') return Math.PI; if (lower === 'e') return Math.E; if (!this.take('(')) throw new Error(`Use ${name}(value).`); const value = this.expression(); if (!this.take(')')) throw new Error('Missing closing parenthesis.'); const functions: Record<string, (input: number) => number> = { sqrt: Math.sqrt, sin: (x) => Math.sin(x * Math.PI / 180), cos: (x) => Math.cos(x * Math.PI / 180), tan: (x) => Math.tan(x * Math.PI / 180), log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil }; if (!functions[lower]) throw new Error(`Unknown function: ${name}`); return functions[lower](value); }
    const match = this.source.slice(this.position).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i); if (!match) throw new Error('Expected a number.'); this.position += match[0].length; return Number(match[0]);
  }
}

const unitGroups = {
  Length: { m: 1, km: 1000, cm: .01, mm: .001, in: .0254, ft: .3048, yd: .9144, mi: 1609.344, nmi: 1852 },
  Mass: { kg: 1, g: .001, mg: .000001, oz: .028349523125, lb: .45359237, ton: 907.18474 },
  Volume: { L: 1, mL: .001, 'US gal': 3.785411784, 'US qt': .946352946, 'US cup': .2365882365, 'fl oz': .0295735296 },
  Speed: { 'm/s': 1, 'km/h': 1 / 3.6, mph: .44704, knot: .514444 },
  Data: { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 },
};

const morse: Record<string, string> = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.' };
const elements: Array<[string, string, number]> = [
  ['H', 'Hydrogen', 1], ['He', 'Helium', 2], ['Li', 'Lithium', 3], ['Be', 'Beryllium', 4], ['B', 'Boron', 5], ['C', 'Carbon', 6],
  ['N', 'Nitrogen', 7], ['O', 'Oxygen', 8], ['F', 'Fluorine', 9], ['Ne', 'Neon', 10], ['Na', 'Sodium', 11], ['Mg', 'Magnesium', 12],
  ['Al', 'Aluminium', 13], ['Si', 'Silicon', 14], ['P', 'Phosphorus', 15], ['S', 'Sulfur', 16], ['Cl', 'Chlorine', 17], ['Ar', 'Argon', 18],
  ['K', 'Potassium', 19], ['Ca', 'Calcium', 20], ['Sc', 'Scandium', 21], ['Ti', 'Titanium', 22], ['V', 'Vanadium', 23], ['Cr', 'Chromium', 24],
  ['Mn', 'Manganese', 25], ['Fe', 'Iron', 26], ['Co', 'Cobalt', 27], ['Ni', 'Nickel', 28], ['Cu', 'Copper', 29], ['Zn', 'Zinc', 30],
  ['Ga', 'Gallium', 31], ['Ge', 'Germanium', 32], ['As', 'Arsenic', 33], ['Se', 'Selenium', 34], ['Br', 'Bromine', 35], ['Kr', 'Krypton', 36],
  ['Rb', 'Rubidium', 37], ['Sr', 'Strontium', 38], ['Y', 'Yttrium', 39], ['Zr', 'Zirconium', 40], ['Nb', 'Niobium', 41], ['Mo', 'Molybdenum', 42],
  ['Tc', 'Technetium', 43], ['Ru', 'Ruthenium', 44], ['Rh', 'Rhodium', 45], ['Pd', 'Palladium', 46], ['Ag', 'Silver', 47], ['Cd', 'Cadmium', 48],
  ['In', 'Indium', 49], ['Sn', 'Tin', 50], ['Sb', 'Antimony', 51], ['Te', 'Tellurium', 52], ['I', 'Iodine', 53], ['Xe', 'Xenon', 54],
  ['Cs', 'Caesium', 55], ['Ba', 'Barium', 56], ['La', 'Lanthanum', 57], ['Ce', 'Cerium', 58], ['Pr', 'Praseodymium', 59], ['Nd', 'Neodymium', 60],
  ['Pm', 'Promethium', 61], ['Sm', 'Samarium', 62], ['Eu', 'Europium', 63], ['Gd', 'Gadolinium', 64], ['Tb', 'Terbium', 65], ['Dy', 'Dysprosium', 66],
  ['Ho', 'Holmium', 67], ['Er', 'Erbium', 68], ['Tm', 'Thulium', 69], ['Yb', 'Ytterbium', 70], ['Lu', 'Lutetium', 71], ['Hf', 'Hafnium', 72],
  ['Ta', 'Tantalum', 73], ['W', 'Tungsten', 74], ['Re', 'Rhenium', 75], ['Os', 'Osmium', 76], ['Ir', 'Iridium', 77], ['Pt', 'Platinum', 78],
  ['Au', 'Gold', 79], ['Hg', 'Mercury', 80], ['Tl', 'Thallium', 81], ['Pb', 'Lead', 82], ['Bi', 'Bismuth', 83], ['Po', 'Polonium', 84],
  ['At', 'Astatine', 85], ['Rn', 'Radon', 86], ['Fr', 'Francium', 87], ['Ra', 'Radium', 88], ['Ac', 'Actinium', 89], ['Th', 'Thorium', 90],
  ['Pa', 'Protactinium', 91], ['U', 'Uranium', 92], ['Np', 'Neptunium', 93], ['Pu', 'Plutonium', 94], ['Am', 'Americium', 95], ['Cm', 'Curium', 96],
  ['Bk', 'Berkelium', 97], ['Cf', 'Californium', 98], ['Es', 'Einsteinium', 99], ['Fm', 'Fermium', 100], ['Md', 'Mendelevium', 101], ['No', 'Nobelium', 102],
  ['Lr', 'Lawrencium', 103], ['Rf', 'Rutherfordium', 104], ['Db', 'Dubnium', 105], ['Sg', 'Seaborgium', 106], ['Bh', 'Bohrium', 107], ['Hs', 'Hassium', 108],
  ['Mt', 'Meitnerium', 109], ['Ds', 'Darmstadtium', 110], ['Rg', 'Roentgenium', 111], ['Cn', 'Copernicium', 112], ['Nh', 'Nihonium', 113], ['Fl', 'Flerovium', 114],
  ['Mc', 'Moscovium', 115], ['Lv', 'Livermorium', 116], ['Ts', 'Tennessine', 117], ['Og', 'Oganesson', 118],
];

function dms(value: number, latitude: boolean): string { const direction = value < 0 ? (latitude ? 'S' : 'W') : (latitude ? 'N' : 'E'); const absolute = Math.abs(value); const degrees = Math.floor(absolute); const minutesValue = (absolute - degrees) * 60; const minutes = Math.floor(minutesValue); return `${degrees}° ${minutes}' ${((minutesValue - minutes) * 60).toFixed(2)}" ${direction}`; }
export function subnet(ip: string, prefix: number): string {
  const parts = ip.split('.').map(Number); if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) || prefix < 0 || prefix > 32) return 'Enter a valid IPv4 address and prefix.';
  const raw = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0; const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; const network = raw & mask; const broadcast = (network | (~mask >>> 0)) >>> 0;
  const show = (number: number) => [24, 16, 8, 0].map((shift) => (number >>> shift) & 255).join('.'); const usable = prefix >= 31 ? 0 : Math.max(0, 2 ** (32 - prefix) - 2);
  return `Network: ${show(network)}\nMask: ${show(mask)}\nBroadcast: ${show(broadcast)}\nUsable hosts: ${usable.toLocaleString()}\nHost range: ${usable ? `${show(network + 1)} – ${show(broadcast - 1)}` : 'Point-to-point / host route'}`;
}
function lineDiff(left: string, right: string): string { const a = left.split('\n'); const b = right.split('\n'); const lines: string[] = []; const length = Math.max(a.length, b.length); for (let index = 0; index < length; index += 1) { if (a[index] === b[index]) lines.push(`  ${a[index] ?? ''}`); else { if (a[index] !== undefined) lines.push(`- ${a[index]}`); if (b[index] !== undefined) lines.push(`+ ${b[index]}`); } } return lines.join('\n'); }
function randomPassword(length: number, symbols: boolean): string { const alphabet = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789${symbols ? '!@#$%^&*()-_=+[]{}' : ''}`; const bytes = crypto.getRandomValues(new Uint32Array(length)); return [...bytes].map((value) => alphabet[value % alphabet.length]).join(''); }

export function ToolsView() {
  const [tool, setTool] = useState<ToolId>('calculator'); const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [category, setCategory] = useState<keyof typeof unitGroups>('Length'); const units = Object.keys(unitGroups[category]); const [fromUnit, setFromUnit] = useState('m'); const [toUnit, setToUnit] = useState('ft'); const [amount, setAmount] = useState(1);
  const [second, setSecond] = useState(''); const [option, setOption] = useState('json'); const [prefix, setPrefix] = useState(24); const [latitude, setLatitude] = useState(39.8283); const [longitude, setLongitude] = useState(-98.5795); const [days, setDays] = useState(30); const [passwordLength, setPasswordLength] = useState(20); const [symbols, setSymbols] = useState(true); const [elementQuery, setElementQuery] = useState('');
  const converted = useMemo(() => { const group = unitGroups[category] as Record<string, number>; return amount * (group[fromUnit] ?? 1) / (group[toUnit] ?? 1); }, [amount, category, fromUnit, toUnit]);

  async function transform() {
    try {
      if (option === 'json') setOutput(JSON.stringify(JSON.parse(input), null, 2));
      else if (option === 'base64-encode') setOutput(btoa(unescape(encodeURIComponent(input))));
      else if (option === 'base64-decode') setOutput(decodeURIComponent(escape(atob(input.trim()))));
      else if (option === 'url-encode') setOutput(encodeURIComponent(input)); else if (option === 'url-decode') setOutput(decodeURIComponent(input));
      else if (option === 'hex-encode') setOutput([...new TextEncoder().encode(input)].map((byte) => byte.toString(16).padStart(2, '0')).join(' '));
      else if (option === 'hex-decode') setOutput(new TextDecoder().decode(new Uint8Array(input.trim().split(/\s+/).map((value) => Number.parseInt(value, 16)))));
      else if (option.startsWith('sha-')) { const algorithm = option.toUpperCase(); const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input)); setOutput([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()); }
      else if (option === 'morse') setOutput(input.toUpperCase().split('').map((character) => character === ' ' ? '/' : morse[character] ?? '?').join(' '));
    } catch (error) { setOutput(error instanceof Error ? error.message : 'Transformation failed.'); }
  }

  const navigation: Array<[ToolId, string]> = [['calculator', 'Calculator'], ['convert', 'Unit Converter'], ['text', 'Text & Encoding'], ['network', 'Network'], ['coordinates', 'Coordinates'], ['time', 'Date & Time'], ['compare', 'Regex & Diff'], ['password', 'Passwords'], ['reference', 'Reference']];
  return <section className="page-panel tools-panel"><div className="page-heading"><div><p className="section-label">OFFLINE UTILITIES</p><h2>Tools that need no connection.</h2></div><span className="tools-private">ALL WORK STAYS IN THIS WINDOW</span></div><div className="tools-layout"><aside className="tool-nav">{navigation.map(([id, label]) => <button className={tool === id ? 'active' : ''} onClick={() => { setTool(id); setInput(''); setOutput(''); }} key={id}>{label}</button>)}</aside><div className="tool-surface">
    {tool === 'calculator' && <><p className="section-label">SCIENTIFIC CALCULATOR</p><h3>Calculate an expression</h3><input className="tool-primary-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { try { setOutput(String(new ExpressionParser(input).parse())); } catch (error) { setOutput(error instanceof Error ? error.message : 'Invalid expression'); } } }} placeholder="sqrt(144) + sin(30) * 10" /><div className="tool-help">Operators: + − × ÷ % ^ · Functions: sqrt, sin, cos, tan, log, ln, abs, round · Constants: pi, e</div><button className="primary-button" onClick={() => { try { setOutput(String(new ExpressionParser(input).parse())); } catch (error) { setOutput(error instanceof Error ? error.message : 'Invalid expression'); } }}>CALCULATE</button>{output && <pre className="tool-output">{output}</pre>}</>}
    {tool === 'convert' && <><p className="section-label">UNIT CONVERTER</p><h3>Convert measurements</h3><div className="tool-form-grid"><label>CATEGORY<select value={category} onChange={(event) => { const next = event.target.value as keyof typeof unitGroups; setCategory(next); const nextUnits = Object.keys(unitGroups[next]); setFromUnit(nextUnits[0]); setToUnit(nextUnits[1]); }}>{Object.keys(unitGroups).map((name) => <option key={name}>{name}</option>)}</select></label><label>VALUE<input type="number" value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label><label>FROM<select value={fromUnit} onChange={(event) => setFromUnit(event.target.value)}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label><label>TO<select value={toUnit} onChange={(event) => setToUnit(event.target.value)}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><pre className="tool-output">{amount.toLocaleString()} {fromUnit} = {converted.toLocaleString(undefined, { maximumSignificantDigits: 12 })} {toUnit}</pre></>}
    {tool === 'text' && <><p className="section-label">TEXT / ENCODING / HASH</p><h3>Transform text locally</h3><select value={option} onChange={(event) => setOption(event.target.value)}><option value="json">Format JSON</option><option value="base64-encode">Base64 encode</option><option value="base64-decode">Base64 decode</option><option value="url-encode">URL encode</option><option value="url-decode">URL decode</option><option value="hex-encode">Text to hex</option><option value="hex-decode">Hex to text</option><option value="sha-256">SHA-256</option><option value="sha-384">SHA-384</option><option value="sha-512">SHA-512</option><option value="morse">Text to Morse code</option></select><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste text here" /><button className="primary-button" onClick={() => void transform()}>TRANSFORM</button><textarea className="tool-output-area" value={output} readOnly placeholder="Result" /></>}
    {tool === 'network' && <><p className="section-label">IPV4 SUBNET CALCULATOR</p><h3>Inspect a network</h3><div className="tool-form-grid"><label>IP ADDRESS<input value={input} onChange={(event) => setInput(event.target.value)} placeholder="192.168.1.25" /></label><label>PREFIX<input type="number" min="0" max="32" value={prefix} onChange={(event) => setPrefix(Number(event.target.value))} /></label></div><pre className="tool-output">{subnet(input || '192.168.1.25', prefix)}</pre></>}
    {tool === 'coordinates' && <><p className="section-label">COORDINATE CONVERTER</p><h3>Decimal degrees to DMS</h3><div className="tool-form-grid"><label>LATITUDE<input type="number" step="any" value={latitude} onChange={(event) => setLatitude(Number(event.target.value))} /></label><label>LONGITUDE<input type="number" step="any" value={longitude} onChange={(event) => setLongitude(Number(event.target.value))} /></label></div><pre className="tool-output">{dms(latitude, true)}\n{dms(longitude, false)}\n\nDecimal: {latitude.toFixed(6)}, {longitude.toFixed(6)}</pre></>}
    {tool === 'time' && <><p className="section-label">DATE / TIME</p><h3>Calculate dates and timestamps</h3><div className="tool-form-grid"><label>START DATE<input type="date" value={input} onChange={(event) => setInput(event.target.value)} /></label><label>DAYS TO ADD<input type="number" value={days} onChange={(event) => setDays(Number(event.target.value))} /></label></div><pre className="tool-output">{input ? new Date(new Date(`${input}T00:00:00`).getTime() + days * 86400000).toLocaleDateString() : 'Choose a starting date.'}\n\nCurrent Unix timestamp: {Math.floor(Date.now() / 1000)}\nCurrent UTC: {new Date().toISOString()}</pre></>}
    {tool === 'compare' && <><p className="section-label">REGEX TESTER / DIFF</p><h3>Test or compare text</h3><select value={option} onChange={(event) => setOption(event.target.value)}><option value="diff">Line diff</option><option value="regex">Regular expression</option></select><div className="tool-compare"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={option === 'diff' ? 'Original text' : 'Text to search'} /><textarea value={second} onChange={(event) => setSecond(event.target.value)} placeholder={option === 'diff' ? 'Changed text' : 'Pattern, for example: \b[A-Z]{2}\d+\b'} /></div><button className="primary-button" onClick={() => { try { setOutput(option === 'diff' ? lineDiff(input, second) : [...input.matchAll(new RegExp(second, 'g'))].map((match) => `${match.index}: ${match[0]}`).join('\n') || 'No matches.'); } catch (error) { setOutput(error instanceof Error ? error.message : 'Invalid pattern.'); } }}>RUN</button><pre className="tool-output diff-output">{output}</pre></>}
    {tool === 'password' && <><p className="section-label">PASSWORD GENERATOR</p><h3>Create locally random passwords</h3><div className="tool-form-grid"><label>LENGTH<input type="number" min="8" max="128" value={passwordLength} onChange={(event) => setPasswordLength(Math.max(8, Math.min(128, Number(event.target.value))))} /></label><label className="tool-checkbox"><input type="checkbox" checked={symbols} onChange={(event) => setSymbols(event.target.checked)} /> INCLUDE SYMBOLS</label></div><button className="primary-button" onClick={() => setOutput(randomPassword(passwordLength, symbols))}>GENERATE</button><pre className="tool-output password-output">{output}</pre></>}
    {tool === 'reference' && <><p className="section-label">PERIODIC REFERENCE</p><h3>All 118 elements</h3><input className="tool-primary-input" value={elementQuery} onChange={(event) => setElementQuery(event.target.value)} placeholder="Search symbol, name, or atomic number" /><div className="element-grid">{elements.filter((item) => item.join(' ').toLowerCase().includes(elementQuery.toLowerCase())).map(([symbol, name, number]) => <div key={symbol}><b>{symbol}</b><span>{name}</span><small>{number}</small></div>)}</div></>}
  </div></div></section>;
}
