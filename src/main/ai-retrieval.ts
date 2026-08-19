import type { DocumentSearchResult } from '../shared/contracts';

const SEARCH_STOP_WORDS = new Set([
  'a', 'about', 'an', 'and', 'are', 'book', 'books', 'can', 'could', 'do', 'does', 'document', 'documents',
  'explain', 'file', 'files', 'find', 'for', 'from', 'give', 'have', 'help', 'how', 'i', 'in', 'info',
  'information', 'is', 'it', 'me', 'of', 'on', 'one', 'ones', 'our', 'pdf', 'pdfs', 'please', 'show',
  'source', 'sources', 'tell', 'that', 'the', 'these', 'this', 'those', 'to', 'use', 'we', 'what', 'when',
  'where', 'which', 'with', 'you', 'your',
]);

export interface DocumentSearchProvider {
  search(query: string): DocumentSearchResult[];
}

export function documentSearchTerms(query: string): string[] {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return [...new Set(tokens.filter((token) => !SEARCH_STOP_WORDS.has(token)))].slice(0, 8);
}

function countTermMatches(value: string, terms: string[]): number {
  const normalized = value.toLocaleLowerCase();
  return terms.reduce((count, term) => count + (normalized.includes(term) ? 1 : 0), 0);
}

/** Finds the best page in each matching document instead of allowing generic words or duplicate pages to fill the source list. */
export function relevantDocumentMatches(provider: DocumentSearchProvider, query: string, limit = 5): DocumentSearchResult[] {
  const terms = documentSearchTerms(query);
  if (!terms.length) return [];

  const phrase = terms.join(' ');
  const candidates = new Map<string, { result: DocumentSearchResult; rank: number }>();
  const addResults = (results: DocumentSearchResult[], searchWeight: number) => {
    results.forEach((result, index) => {
      const titleMatches = countTermMatches(result.title, terms);
      const excerptMatches = countTermMatches(result.excerpt, terms);
      const fullTitleMatch = terms.length > 1 && result.title.toLocaleLowerCase().includes(phrase);
      const rank = searchWeight - index + titleMatches * 180 + excerptMatches * 35 + (fullTitleMatch ? 500 : 0) + Math.max(0, -result.score);
      const key = `${result.documentId}:${result.page}`;
      const existing = candidates.get(key);
      if (!existing || rank > existing.rank) candidates.set(key, { result, rank });
    });
  };

  // SQLite FTS uses AND for this query, making it the strongest signal when every meaningful topic word is present.
  addResults(provider.search(phrase), 1_000);
  for (const term of terms) addResults(provider.search(term), 150);

  const bestPerDocument = new Map<string, { result: DocumentSearchResult; rank: number }>();
  for (const candidate of candidates.values()) {
    const existing = bestPerDocument.get(candidate.result.documentId);
    if (!existing || candidate.rank > existing.rank) bestPerDocument.set(candidate.result.documentId, candidate);
  }
  return [...bestPerDocument.values()].sort((left, right) => right.rank - left.rank).slice(0, limit).map(({ result }) => result);
}
