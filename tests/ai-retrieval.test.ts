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
