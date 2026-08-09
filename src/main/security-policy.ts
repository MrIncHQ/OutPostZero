export const RENDERER_CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:5173; frame-src http://127.0.0.1:*";

export function responseHeadersForUrl(url: string, responseHeaders: Record<string, string[]> = {}): Record<string, string[]> {
  if (!url.startsWith('file:')) return { ...responseHeaders };
  return { ...responseHeaders, 'Content-Security-Policy': [RENDERER_CONTENT_SECURITY_POLICY] };
}
