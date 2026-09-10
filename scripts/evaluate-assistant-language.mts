import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssistantCase, deleteAssistantCase, loadAssistantCase, withAssistantLock } from '../src/server/assistant-store.ts';
import { addDocument, addMessage, analyzeCase } from '../src/server/assistant-service.ts';
import { modelName } from '../src/server/assistant-model.ts';
import type { AssistantCase } from '../src/domain/assistant-types.ts';

// Explicit opt-in: real model calls through the configured LLM endpoint, using synthetic citizen text only.
const directory = mkdtempSync(join(tmpdir(), 'sok-language-eval-'));
process.env.ASSISTANT_DATA_DIR = directory;
let session = createAssistantCase();
const report: unknown[] = [];
const originalDocument = 'Leietaker betaler husleie på 13500 kr per måned.';
const evidence = (value: AssistantCase) => ({ language: value.language, summary: value.summary,
  questions: value.questions, services: value.services.map(service => ({ id: service.id, summary: service.summary, findings: service.findings })),
  runs: value.runs.filter(run => run.revision === value.revision) });

async function check(name: string, language: string, question: string, includeDocument = false) {
  const start = Date.now();
  session = await withAssistantLock(session.id, session.revision, async current => {
    if (includeDocument) addDocument(current, { id: 'language-test-document', kind: 'document', title: 'Syntetisk leieavtale.txt', text: originalDocument,
      url: null, retrievedAt: new Date().toISOString(), purpose: 'Test original Norwegian document language.', period: 'Syntetisk test.' });
    addMessage(current, question);
    await analyzeCase(current);
    return current;
  });
  assert.notEqual(session.status, 'error', session.error || 'Model failed');
  assert.equal(session.language, language);
  assert.equal(session.messages.at(-1)?.language, language);
  assert.equal(loadAssistantCase(session.id).language, language, 'Language persists with the case');
  if (language === 'vi') {
    assert.match(session.summary, /[ăâđêôơưàảãạắấếệựờ]/i, 'Vietnamese reply must contain Vietnamese prose');
    for (const service of session.services) assert.match(service.summary, /[ăâđêôơưàảãạắấếệựờ]/i, 'Specialist must reply in Vietnamese too');
  }
  if (language === 'en') assert.match(session.summary, /\b(you|your|housing|rent|need)\b/i);
  if (language === 'nb') assert.match(session.summary, /\b(du|deg|din|husleie|bolig|trenger)\b/i);
  for (const service of session.services) for (const finding of service.findings) {
    const source = session.sources.find(item => item.id === finding.citation.sourceId);
    assert.ok(source?.text.includes(finding.citation.quote), 'Every original quote remains literal');
  }
  if (session.sources.some(source => source.id === 'language-test-document')) assert.equal(session.sources.find(source => source.id === 'language-test-document')?.text, originalDocument);
  report.push({ name, passed: true, milliseconds: Date.now() - start, evidence: evidence(session) });
  console.log(`PASS ${name} (${Date.now() - start} ms): ${session.summary}`);
}

try {
  assert.equal(session.language, 'nb', 'New cases default to Norwegian Bokmål');
  await check('Vietnamese question selects Vietnamese coordinator and specialist replies', 'vi', 'Tôi cần trợ giúp tiền thuê nhà. Tôi sống một mình, không có con và không chuyển nhà. Tiền thuê hàng tháng của tôi là 13500 kr.');
  await check('Short follow-up and Norwegian attachment preserve Vietnamese', 'vi', 'OK', true);
  await check('New English question changes reply language', 'en', 'What information do you still need from me to prepare help with my rent?');
  await check('Explicit Bokmål preference restores Norwegian', 'nb', 'Svar på norsk bokmål fra nå av. Hva trenger du fra meg for å forberede hjelp med husleien?');
} catch (error) {
  report.push({ passed: false, error: error instanceof Error ? error.message : 'Unknown failure', evidence: evidence(session) });
  console.error(error instanceof Error ? error.message : 'Language evaluation failed');
  process.exitCode = 1;
} finally {
  const target = 'plans/260903-1502-agentic-citizen-service/reports';
  mkdirSync(target, { recursive: true });
  writeFileSync(`${target}/live-language-evaluation.json`, JSON.stringify({ at: new Date().toISOString(), syntheticOnly: true, runtime: 'Microsoft Agent Framework Python',
    models: { coordinator: modelName('coordinator'), specialist: modelName('specialist') }, report }, null, 2));
  deleteAssistantCase(session.id);
  rmSync(directory, { recursive: true, force: true });
}
