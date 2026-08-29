import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [payloadArgument, privateKeyArgument, outputArgument] = process.argv.slice(2);
if (!payloadArgument || !privateKeyArgument || !outputArgument) throw new Error('Usage: node scripts/sign-nature-catalog.mjs <payload-json> <private-key> <output-json>');
const payload = JSON.parse(fs.readFileSync(path.resolve(payloadArgument), 'utf8'));
if (payload.schemaVersion !== 1 || !Array.isArray(payload.entries) || typeof payload.publishedAt !== 'string') throw new Error('Nature catalog payload is invalid.');
const signedPayload = Buffer.from(JSON.stringify(payload));
const signature = crypto.sign(null, signedPayload, fs.readFileSync(path.resolve(privateKeyArgument), 'utf8'));
const envelope = { schemaVersion: 1, signedPayload: signedPayload.toString('base64'), signature: signature.toString('base64') };
const output = path.resolve(outputArgument); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, entries: payload.entries.length, publishedAt: payload.publishedAt }, null, 2));
