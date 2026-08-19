import assert from 'node:assert/strict';
import test from 'node:test';
import { documentSearchTerms, relevantDocumentMatches } from '../src/main/ai-retrieval';
import type { DocumentSearchResult } from '../src/shared/contracts';

const survival: DocumentSearchResult = { documentId: 'survival', title: 'The Ultimate Guide to U.S. Army Survival Skills', format: 'pdf', page: 25, excerpt: 'Essential survival skills in the field.', score: -14 };
const bushcraft: DocumentSearchResult = { documentId: 'bushcraft', title: 'Advanced Bushcraft and Wilderness Survival', format: 'pdf', page: 191, excerpt: 'Wilderness survival skills.', score: -10 };
const cyber: DocumentSearchResult = { documentId: 'cyber', title: 'Malware Analysts Cookbook', format: 'pdf', page: 325, excerpt: 'Computer file handles and malware analysis.', score: -8 };

test('removes generic request words and ranks complete survival matches first', () => {
  const searches: string[] = [];
  const provider = { search(query: string) {
    searches.push(query);
    if (query === 'survival skills') return [survival, { ...survival, page: 26 }, bushcraft];
    if (query === 'survival') return [bushcraft, survival];
    if (query === 'skills') return [survival];
    if (query === 'file') return [cyber];
    return [];
  } };
  assert.deepEqual(documentSearchTerms('Find me a PDF file on survival skills'), ['survival', 'skills']);
  const results = relevantDocumentMatches(provider, 'Find me a PDF file on survival skills');
  assert.deepEqual(searches, ['survival skills', 'survival', 'skills']);
  assert.deepEqual(results.map((result) => result.documentId), ['survival', 'bushcraft']);
  assert.equal(results.filter((result) => result.documentId === 'survival').length, 1);
});

test('rejects unrelated one-word fallbacks for a multi-word topic', () => {
  const solar = { ...cyber, documentId: 'solar', title: 'Solar Power Basics', excerpt: 'Solar panels and batteries.' };
  const repair = { ...cyber, documentId: 'repair', title: 'Computer Repair', excerpt: 'Repair a damaged file system.' };
  const provider = { search(query: string) { return query === 'solar' ? [solar] : query === 'repair' ? [repair] : []; } };
  assert.deepEqual(relevantDocumentMatches(provider, 'solar repair manual'), []);
});

test('recovers a misspelled topic from local document titles', () => {
  const searches: string[] = [];
  const provider = {
    suggestTerms: () => ({ survial: ['survival'], skills: [] }),
    search(query: string) { searches.push(query); return query === 'survival skills' ? [survival] : []; },
  };
  assert.equal(relevantDocumentMatches(provider, 'survial skills')[0].documentId, 'survival');
  assert.equal(searches.includes('survival skills'), true);
});

test('uses conservative related phrases for established offline topics', () => {
  const medical = { ...survival, documentId: 'medical', title: 'Emergency Medical Handbook', excerpt: 'Emergency medical treatment and wound care.' };
  const provider = { search(query: string) { return query === 'emergency medical' ? [medical] : []; } };
  assert.equal(relevantDocumentMatches(provider, 'first aid instructions')[0].documentId, 'medical');
});

test('keeps representative offline domains separated', () => {
  const records: Record<string, DocumentSearchResult> = {
    'generator repair': { ...survival, documentId: 'generator', title: 'Generator Repair Manual', excerpt: 'Generator repair procedure.' },
    'land navigation': { ...survival, documentId: 'navigation', title: 'Land Navigation Handbook', excerpt: 'Map, compass, and land navigation.' },
    'malware analysis': { ...cyber, documentId: 'malware', title: 'Malware Analysis Guide', excerpt: 'Malware analysis procedure.' },
  };
  const provider = { search(query: string) { return records[query] ? [records[query]] : []; } };
  for (const [query, expected] of [['generator repair', 'generator'], ['land navigation', 'navigation'], ['malware analysis', 'malware']]) {
    assert.equal(relevantDocumentMatches(provider, query)[0]?.documentId, expected, query);
  }
  assert.deepEqual(relevantDocumentMatches(provider, 'underwater basket weaving'), []);
});
