import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('local AI sources open exact documents or Kiwix articles and Enter submits', () => {
  const ai = fs.readFileSync('src/renderer/AiView.tsx', 'utf8');
  const app = fs.readFileSync('src/renderer/App.tsx', 'utf8');
  assert.match(ai, /onOpenSource\(source\)/);
  assert.match(ai, /requestSubmit\(\)/);
  assert.match(ai, /event\.shiftKey/);
  assert.match(app, /source\.documentId/);
  assert.match(app, /source\.articlePath/);
  assert.match(app, /requestedArticlePath/);
});

test('local AI startup is single-flight and uses one inference slot', () => {
  const service = fs.readFileSync('src/main/ai-service.ts', 'utf8');
  assert.match(service, /if \(this\.startPromise\) return this\.startPromise/);
  assert.match(service, /'--parallel', '1'/);
  assert.match(service, /Date\.now\(\) \+ 180_000/);
});
