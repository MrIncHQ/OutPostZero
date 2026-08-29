export const RENDERER_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: outpost-doc: outpost-attachment: outpost-map: outpost-media: outpost-nature:; media-src 'self' blob: outpost-media:; connect-src 'self' outpost-map: outpost-attachment: outpost-media: http://127.0.0.1:* ws://127.0.0.1:5173; frame-src http://127.0.0.1:* outpost-doc: outpost-attachment:; worker-src 'self' blob:";

export function responseHeadersForUrl(url: string, responseHeaders: Record<string, string[]> = {}): Record<string, string[]> {
  if (!url.startsWith('file:')) return { ...responseHeaders };
  return { ...responseHeaders, 'Content-Security-Policy': [RENDERER_CONTENT_SECURITY_POLICY] };
}
