import type { UnifiedSearchResult } from '../shared/contracts';
import { DatabaseService } from './database-service';
import { DocumentService } from './document-service';
import { MediaService } from './media-service';

function fts(query: string): string | null {
  const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 12) ?? [];
  return tokens.length ? tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ') : null;
}

export class UnifiedSearchService {
  constructor(private readonly database: DatabaseService, private readonly documents: DocumentService, private readonly media?: MediaService) {}
  search(query: string): UnifiedSearchResult[] {
    const expression = fts(query); if (!expression) return [];
    const documentResults: UnifiedSearchResult[] = this.documents.search(query).slice(0, 30).map((item) => ({ source: 'document', id: item.documentId, title: item.title, excerpt: item.excerpt, context: `${item.format.toUpperCase()} · PAGE ${item.page}`, page: item.page }));
    const noteResults: UnifiedSearchResult[] = this.database.searchNotes(expression).map((item) => ({ source: 'note', id: item.id, title: item.title, excerpt: item.excerpt, context: item.context }));
    const mapResults: UnifiedSearchResult[] = this.database.searchMapPlaces(expression).map((item) => ({ source: 'map', id: item.id, title: item.title, excerpt: item.excerpt, context: `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`, latitude: item.latitude, longitude: item.longitude }));
    const mediaResults: UnifiedSearchResult[] = (this.media?.state(query).items ?? []).slice(0, 30).map((item) => ({ source: 'media', id: item.id, title: item.title, excerpt: [...item.tags, ...item.collections].join(' · ') || item.fileName, context: `${item.kind.toUpperCase()} · PORTABLE MEDIA` }));
    return [...noteResults, ...documentResults, ...mediaResults, ...mapResults].slice(0, 80);
  }
}
