import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const [consoPath, attributesPath, outputPath, releaseDate = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!consoPath || !attributesPath || !outputPath) {
  throw new Error('Usage: node scripts/build-rxnorm-pill-index.mjs RXNCONSO.RRF RXNSAT.RRF output.json YYYY-MM-DD');
}

const COLORS = new Map([
  ['C48323', 'BLACK'], ['C48324', 'GRAY'], ['C48325', 'WHITE'], ['C48326', 'RED'],
  ['C48327', 'PURPLE'], ['C48328', 'PINK'], ['C48329', 'GREEN'], ['C48330', 'YELLOW'],
  ['C48331', 'ORANGE'], ['C48332', 'BROWN'], ['C48333', 'BLUE'], ['C48334', 'TURQUOISE'],
]);
const SHAPES = new Map([
  ['C48335', 'BULLET'], ['C48336', 'CAPSULE'], ['C48337', 'CLOVER'], ['C48338', 'DIAMOND'],
  ['C48339', 'DOUBLE CIRCLE'], ['C48340', 'FREEFORM'], ['C48341', 'GEAR'], ['C48342', 'HEPTAGON'],
  ['C48343', 'HEXAGON'], ['C48344', 'OCTAGON'], ['C48345', 'OVAL'], ['C48346', 'PENTAGON'],
  ['C48347', 'RECTANGLE'], ['C48348', 'ROUND'], ['C48349', 'SEMI-CIRCLE'], ['C48350', 'SQUARE'],
  ['C48351', 'TEAR'], ['C48352', 'TRAPEZOID'], ['C48353', 'TRIANGLE'],
]);
const wanted = new Set(['IMPRINT_CODE', 'COLOR', 'COLORTEXT', 'SHAPE', 'SHAPETEXT', 'SIZE', 'SCORE', 'SPL_SET_ID', 'NDC']);

async function lines(filePath, visit) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) visit(line);
}

const names = new Map();
await lines(consoPath, (line) => {
  const fields = line.split('|');
  if (fields[11] === 'MTHSPL' && fields[7] && fields[14]) names.set(fields[7], fields[14]);
});

const grouped = new Map();
await lines(attributesPath, (line) => {
  const fields = line.split('|');
  const aui = fields[3]; const attribute = fields[8];
  if (fields[9] !== 'MTHSPL' || !aui || !wanted.has(attribute)) return;
  let record = grouped.get(aui);
  if (!record) { record = { aui, code: fields[5], values: new Map() }; grouped.set(aui, record); }
  const values = record.values.get(attribute) ?? [];
  if (fields[10] && !values.includes(fields[10])) values.push(fields[10]);
  record.values.set(attribute, values);
});

const normalized = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const rows = [];
const seen = new Set();
for (const record of grouped.values()) {
  const first = (attribute) => record.values.get(attribute)?.[0] ?? '';
  const imprint = first('IMPRINT_CODE');
  if (!imprint || !normalized(imprint)) continue;
  const color = COLORS.get(first('COLOR')) ?? first('COLORTEXT').toUpperCase();
  const shape = SHAPES.get(first('SHAPE')) ?? first('SHAPETEXT').toUpperCase();
  const ndc = record.code || first('NDC').split('-').slice(0, 2).join('-');
  const name = names.get(record.aui) ?? 'FDA-listed solid oral medication';
  const key = `${ndc}|${normalized(imprint)}|${color}|${shape}|${name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const scoreValue = Number(first('SCORE'));
  rows.push([record.aui, first('SPL_SET_ID'), name, ndc, imprint, color, shape, first('SIZE'), Number.isFinite(scoreValue) && first('SCORE') ? scoreValue : null]);
}
rows.sort((a, b) => String(a[4]).localeCompare(String(b[4])) || String(a[2]).localeCompare(String(b[2])));

const output = {
  schemaVersion: 1,
  source: 'NLM RxNorm Current Prescribable Content; physical characteristics from FDA/DailyMed SPL (MTHSPL)',
  sourceRelease: releaseDate,
  generatedAt: new Date().toISOString(),
  attribution: 'This product uses publicly available data courtesy of the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.',
  fields: ['id', 'setId', 'name', 'productNdc', 'imprint', 'color', 'shape', 'size', 'score'],
  records: rows,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, 'utf8');
const bytes = fs.statSync(outputPath).size;
process.stdout.write(`Wrote ${rows.length.toLocaleString()} pill records (${(bytes / 1024 / 1024).toFixed(2)} MiB) to ${outputPath}\n`);
