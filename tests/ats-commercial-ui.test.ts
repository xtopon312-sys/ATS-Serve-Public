import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { toIpcUpdateStatus, UPDATE_STATES } from '../main/update-state';
import { getErrorBoundaryCopy, resolveErrorLanguage } from '../frontend/src/lib/error-boundary-copy';
import { loadLocaleMessages } from '../frontend/src/lib/i18n/loader';
import { LANGUAGES } from '../frontend/src/lib/i18n/languages';
import { localizeCoreReceiptPreview } from '../frontend/src/lib/receipt-preview';
import { menuNavigationTarget } from '../frontend/src/lib/menu-navigation';
import en from '../frontend/src/lib/i18n/messages/en.json';
import pt from '../frontend/src/lib/i18n/messages/pt.json';

test('remote updater availability comes from configuration for every stored state', () => {
  for (const status of UPDATE_STATES) {
    const payload = toIpcUpdateStatus({ status, version: '4.0.0' }, '3.8.7', false);
    assert.equal(payload.remoteUpdatesConfigured, false, status);
    assert.equal(payload.status, status);
    assert.equal(payload.info.version, '3.8.7');
    assert.equal(toIpcUpdateStatus({ status }, '3.8.7', true).remoteUpdatesConfigured, true);
  }
  assert.equal(toIpcUpdateStatus({ status: 'not-checked-yet' }, '3.8.7').remoteUpdatesConfigured, undefined);
});

test('error recovery preserves every supported saved language over the document language', () => {
  for (const language of Object.keys(LANGUAGES)) {
    const storage = { getItem: () => JSON.stringify({ state: { language } }) };
    assert.equal(resolveErrorLanguage(storage, 'pt-BR'), language);
  }
});

test('error recovery survives missing, corrupt and denied storage without changing any stored value', () => {
  assert.equal(resolveErrorLanguage(undefined), 'pt');
  assert.equal(resolveErrorLanguage({ getItem: () => '{broken' }, 'en'), 'en');
  assert.equal(resolveErrorLanguage({ getItem: () => { throw new Error('denied'); } }, 'fr-FR'), 'fr');
  assert.equal(resolveErrorLanguage({ getItem: () => '{"state":{"language":"unknown"}}' }, 'de-DE'), 'de');
  assert.equal(resolveErrorLanguage(undefined, 'unknown'), 'pt');
});

test('bundled Portuguese recovery copy stays usable before its locale chunk loads', () => {
  assert.deepEqual(getErrorBoundaryCopy('pt'), pt.errorBoundary);
  assert.deepEqual(getErrorBoundaryCopy('en'), en.errorBoundary);
  assert.match(getErrorBoundaryCopy('pt').rootDescription, /histórico de pedidos/);
  assert.match(getErrorBoundaryCopy('pt').diagnosticUnavailable, /Nenhum diagnóstico foi enviado/);
});

test('recovery uses actual translated copy for international locales after loading', async () => {
  for (const language of Object.keys(LANGUAGES) as Array<keyof typeof LANGUAGES>) {
    const messages = await loadLocaleMessages(language);
    assert.deepEqual(getErrorBoundaryCopy(language), messages.errorBoundary, language);
    assert.ok((messages.pos as { pixManualNotice?: string }).pixManualNotice, language);
  }
});

test('Portuguese built-in receipt previews are illustrative, non-fiscal and use Brazilian amounts', () => {
  for (const template of ['classic', 'compact']) {
    const preview = localizeCoreReceiptPreview(template, 'pt-BR', 'legacy');
    assert.match(preview, /COMPROVANTE NÃO FISCAL/);
    assert.match(preview, /Modelo ilustrativo/);
    assert.match(preview, /TOTAL R\$/);
    assert.match(preview, /\d+,\d{2}/);
    assert.doesNotMatch(preview, /\+91|Jane Doe|₹|NFC-e|SAT/);
  }
  assert.equal(localizeCoreReceiptPreview('custom', 'pt-BR', 'merchant format'), 'merchant format');
  assert.equal(localizeCoreReceiptPreview('classic', 'en', 'international format'), 'international format');
});

test('native menu navigation resolves to implemented routes and exact settings sections', () => {
  const cases: Record<string, string> = {
    'new-order': '/pos', 'quick-search': '/pos', 'view-orders': '/orders',
    'report-daily': '/dashboard', 'report-sales': '/dashboard', 'report-x': '/dashboard', 'report-z': '/dashboard',
    'settings-business': '/settings?tab=store', 'settings-tax': '/settings?tab=tax',
    'settings-printer': '/settings?tab=receipts-printers', 'settings-kitchen': '/settings?tab=kds',
  };
  for (const [action, target] of Object.entries(cases)) {
    assert.equal(menuNavigationTarget(action), target);
    const [route, query] = target.split('?');
    const file = path.join(__dirname, '../frontend/src/app/(dashboard)', route, 'page.tsx');
    assert.ok(fs.existsSync(file), `${action}: destination page exists`);
    if (query) assert.ok(fs.readFileSync(file, 'utf8').includes(`<TabsContent value="${new URLSearchParams(query).get('tab')}"`));
  }
  assert.equal(menuNavigationTarget('backup-database'), null, 'PIN-protected actions retain their existing handler');
  assert.equal(menuNavigationTarget('unknown-action'), null);
});
