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
  suggestTerms?(tokens: string[], limitPerToken?: number): Record<string, string[]>;
}

const RELATED_SEARCHES: Array<{ terms: string[]; queries: string[] }> = [
  { terms: ['first', 'aid'], queries: ['emergency medical', 'wound treatment'] },
  { terms: ['map', 'reading'], queries: ['navigation compass', 'land navigation'] },
  { terms: ['food', 'preservation'], queries: ['canning food', 'dehydrating food'] },
  { terms: ['car', 'repair'], queries: ['automotive repair', 'vehicle maintenance'] },
  { terms: ['wilderness', 'survival'], queries: ['bushcraft survival', 'emergency shelter'] },
];

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
  const suggestions = provider.suggestTerms?.(terms, 1) ?? {};
  const corrections = new Map(terms.map((term) => [term, suggestions[term]?.[0] ?? term]));
  const correctedPhrase = terms.map((term) => corrections.get(term)!).join(' ');
  const relatedQueries = RELATED_SEARCHES.filter((entry) => entry.terms.every((term) => terms.includes(term))).flatMap((entry) => entry.queries);
  const relevanceTerms = [...new Set([...terms, ...corrections.values(), ...relatedQueries.flatMap((value) => value.split(' '))])];
  const candidates = new Map<string, { result: DocumentSearchResult; rank: number; strong: boolean }>();
  const addResults = (results: DocumentSearchResult[], searchWeight: number, strong = false) => {
    results.forEach((result, index) => {
      const titleMatches = countTermMatches(result.title, relevanceTerms);
      const excerptMatches = countTermMatches(result.excerpt, relevanceTerms);
      const fullTitleMatch = terms.length > 1 && result.title.toLocaleLowerCase().includes(phrase);
      const rank = searchWeight - index + titleMatches * 180 + excerptMatches * 35 + (fullTitleMatch ? 500 : 0) + Math.max(0, -result.score);
      const key = `${result.documentId}:${result.page}`;
      const existing = candidates.get(key);
      if (!existing || rank > existing.rank) candidates.set(key, { result, rank, strong: strong || Boolean(existing?.strong) });
    });
  };

  // SQLite FTS uses AND for this query, making it the strongest signal when every meaningful topic word is present.
  const exactResults = provider.search(phrase); addResults(exactResults, 1_000, true);
  if (!exactResults.length && correctedPhrase !== phrase) addResults(provider.search(correctedPhrase), 850, true);
  for (const related of relatedQueries) addResults(provider.search(related), 500, true);
  const recoveryTerms = exactResults.length ? terms : [...terms, ...corrections.values()];
  for (const term of [...new Set(recoveryTerms)]) addResults(provider.search(term), 150);

  const bestPerDocument = new Map<string, { result: DocumentSearchResult; rank: number; strong: boolean }>();
  for (const candidate of candidates.values()) {
    const coverage = countTermMatches(`${candidate.result.title} ${candidate.result.excerpt}`, relevanceTerms);
    if (!candidate.strong && coverage < Math.min(2, terms.length)) continue;
    const existing = bestPerDocument.get(candidate.result.documentId);
    if (!existing || candidate.rank > existing.rank) bestPerDocument.set(candidate.result.documentId, candidate);
  }
  return [...bestPerDocument.values()].sort((left, right) => right.rank - left.rank).slice(0, limit).map(({ result }) => result);
}
