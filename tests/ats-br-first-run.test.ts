import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveBrazilianTimeZone } from '../shared/new-install-defaults';
import { COUNTRIES, formatCurrencyForTenant, formatDateForTenant, getCountryByCode } from '../main/countries';

const Module = require('module');
const originalLoad = Module._load;
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-br-first-run-'));
let profileDir = path.join(testRoot, 'fresh');
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => profileDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};
const { initDatabase, getDatabase, closeDatabase, getSettingValue, now } = require('../main/db');
const { authRoutes } = require('../main/routes/auth');
const { settingsRoutes } = require('../main/routes/settings');
const { createApp } = require('./helpers/test-setup');
const request = require('supertest');
const api = createApp({ '/api/auth': authRoutes, '/api/settings': settingsRoutes });
let assertions = 0;
function equal(actual: unknown, expected: unknown, label: string): void {
  assert.deepEqual(actual, expected, label);
  assertions++;
}
function fresh(name: string): void {
  try { closeDatabase(); } catch { /* First profile has no open database. */ }
  profileDir = path.join(testRoot, name);
  fs.mkdirSync(profileDir, { recursive: true });
  initDatabase();
}
function regionalSettings(): Record<string, string> {
  return Object.fromEntries(getDatabase().prepare(`SELECT key, value FROM settings WHERE key IN
    ('country', 'currency', 'currency_symbol', 'language', 'timezone', 'business_day_start_time', 'invoice_financial_year_start_month') ORDER BY key`).all().map((row: any) => [row.key, row.value]));
}
function methods(): unknown[] {
  return getDatabase().prepare('SELECT id, name, is_active, sort_order FROM payment_methods ORDER BY id').all();
}
function ownerPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'Proprietário sintético', email: 'owner@example.test', password: 'Synthetic123',
    business_name: 'Restaurante de teste', setup_profile: 'empty', terms_accepted: true, ...extra };
}
async function setup(extra: Record<string, unknown> = {}) {
  return request(api).post('/api/auth/setup/initialize').send(ownerPayload(extra));
}

async function main(): Promise<void> {
  for (const zone of ['America/Sao_Paulo', 'America/Fortaleza', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha']) {
    equal(resolveBrazilianTimeZone(zone), zone, `Brazilian IANA zone retained: ${zone}`);
  }
  equal(resolveBrazilianTimeZone('Brazil/East'), 'America/Sao_Paulo', 'Brazilian legacy alias canonicalized');
  for (const zone of ['America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'UTC', '', 'Not/AZone']) {
    equal(resolveBrazilianTimeZone(zone), 'America/Sao_Paulo', `invalid/non-Brazilian detection falls back: ${zone}`);
  }
  equal(COUNTRIES[0].code, 'BR', 'Brazil is prominent in shared country list');
  equal(formatCurrencyForTenant(1234567.89, 'BR', 'BRL').replace(/\s/g, ' '), 'R$ 1.234.567,89', 'BRL grouping and decimals');
  equal(formatCurrencyForTenant(1234.56, 'US', 'USD'), '$1,234.56', 'US currency formatting preserved');
  equal(getCountryByCode('BR')?.locale, 'pt-BR', 'Brazilian date/display locale');
  const brazilDate = formatDateForTenant(new Date('2026-10-16T15:30:00Z'), 'BR', 'America/Sao_Paulo', undefined, { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' });
  assert.match(brazilDate, /16\/10\/2026/); assertions++;
  assert.match(brazilDate, /12:30/); assertions++;

  fresh('fresh');
  equal(regionalSettings(), { business_day_start_time: '00:00', country: 'BR', currency: 'BRL', currency_symbol: 'R$', invoice_financial_year_start_month: '1', language: 'pt', timezone: resolveBrazilianTimeZone() }, 'fresh install Brazilian defaults');
  equal(methods(), [], 'no methods created before owner selects setup country');
  const initialized = await setup();
  equal(initialized.status, 200, 'default Brazilian setup succeeds');
  for (const [key, value] of Object.entries({ country: 'BR', currency: 'BRL', language: 'pt', timezone: resolveBrazilianTimeZone() })) {
    equal(initialized.body.tenant[key], value, `setup tenant exposes ${key}`);
  }
  equal(methods().map((row: any) => row.name), ['PIX'], 'Brazilian setup creates reusable custom PIX');
  equal(getSettingValue('cloud_sync_enabled'), '0', 'cloud remains off');
  equal(getSettingValue('whatsapp_enabled'), 'false', 'WhatsApp remains off');
  equal(getSettingValue('loyalty_enabled'), 'false', 'loyalty starts disabled after new-store setup');
  equal(getSettingValue('feature_loyalty_entitled'), '1', 'local loyalty remains available for explicit configuration');
  equal(getSettingValue('cloud_orders_enabled'), '0', 'online orders remain off');
  const beforeRestart = { settings: regionalSettings(), methods: methods() };
  closeDatabase(); initDatabase();
  equal({ settings: regionalSettings(), methods: methods() }, beforeRestart, 'Brazilian defaults and PIX persist unchanged after restart');
  equal(getSettingValue('loyalty_enabled'), 'false', 'new-store loyalty remains off after restart');
  equal((await setup({ country: 'US', currency: 'USD', language: 'en', timezone: 'America/New_York' })).status, 403, 'existing owner cannot silently reinitialize');
  equal(regionalSettings(), beforeRestart.settings, 'blocked reinitialization preserves region');

  const ownerAuth = `Bearer ${initialized.body.access_token}`;
  const loyaltyEnabled = await request(api).put('/api/settings/loyalty').set('Authorization', ownerAuth)
    .send({ loyalty_enabled: true });
  equal(loyaltyEnabled.status, 200, 'entitled owner can explicitly enable loyalty');
  equal(loyaltyEnabled.body.loyalty_enabled, true, 'manual loyalty activation remains functional');
  equal((await setup()).status, 403, 'configured owner cannot rerun setup to reset operational choices');
  closeDatabase(); initDatabase();
  equal(getSettingValue('loyalty_enabled'), 'true', 'explicit loyalty activation survives restart and rejected setup');
  const changed = await request(api).put('/api/settings/business').set('Authorization', ownerAuth)
    .send({ country: 'CA', currency: 'CAD', timezone: 'America/Vancouver' });
  equal(changed.status, 200, 'manual country/timezone setting accepted');
  equal(getSettingValue('country'), 'CA', 'manual country persisted');
  equal(getSettingValue('currency'), 'CAD', 'manual currency persisted');
  equal(getSettingValue('timezone'), 'America/Vancouver', 'manual timezone independent of country suggestion');
  equal(getSettingValue('language'), 'pt', 'country change does not change UI language');
  closeDatabase(); initDatabase();
  equal(getSettingValue('timezone'), 'America/Vancouver', 'manual timezone survives restart');

  fresh('manual-brazil');
  equal((await setup({ timezone: 'America/Manaus' })).status, 200, 'manual Brazilian timezone accepted');
  equal(getSettingValue('timezone'), 'America/Manaus', 'manual Manaus retained');

  fresh('international');
  const canadian = await setup({ country: 'CA', language: 'fr', timezone: 'America/Vancouver' });
  equal(canadian.status, 200, 'international setup succeeds');
  equal(getSettingValue('currency'), 'CAD', 'omitted currency follows manually selected country');
  equal(getSettingValue('language'), 'fr', 'manual international language retained');
  equal(methods(), [], 'international setup does not insert PIX');

  fresh('invalid');
  equal((await setup({ country: 'XX' })).status, 400, 'unknown country rejected');
  equal((await setup({ timezone: 'Not/AZone' })).status, 400, 'invalid timezone rejected');
  equal((await setup({ currency: 'REAIS' })).status, 400, 'invalid currency rejected');
  equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM users').get().count, 0, 'invalid settings leave setup retryable');
  equal(methods(), [], 'invalid setup creates no payment methods');

  fresh('express-brazil');
  equal((await setup({ setup_profile: 'express' })).status, 200, 'Brazilian express setup succeeds');
  equal(getDatabase().prepare("SELECT name, price FROM products WHERE id = 'prod-express-meal'").get(), { name: 'Refeição', price: 25 }, 'Brazilian starter meal has Portuguese name and BRL example price');
  fresh('demo-brazil');
  equal((await setup({ setup_profile: 'demo' })).status, 200, 'Brazilian demo setup succeeds');
  equal(getDatabase().prepare("SELECT name, price FROM products WHERE id = 'prod-demo-coxinha'").get(), { name: 'Coxinha de Frango', price: 8 }, 'Brazilian demonstration menu uses BRL examples');
  fresh('express-india');
  equal((await setup({ country: 'IN', language: 'en', setup_profile: 'express' })).status, 200, 'international express setup succeeds');
  equal(getDatabase().prepare("SELECT name, price FROM products WHERE id = 'prod-express-meal'").get(), { name: 'Meal', price: 150 }, 'international example prices retained');

  for (const profile of [
    { country: 'IN', currency: 'INR', currency_symbol: '₹', language: 'en', timezone: 'Asia/Kolkata', business_day_start_time: '05:30', invoice_financial_year_start_month: '4' },
    { country: 'IR', currency: 'IRR', currency_symbol: 'ریال', language: 'fa', timezone: 'Asia/Tehran', business_day_start_time: '04:00', invoice_financial_year_start_month: '3' },
    { country: 'BR', currency: 'USD', currency_symbol: '$', language: 'es', timezone: 'America/Rio_Branco', business_day_start_time: '06:00', invoice_financial_year_start_month: '7' },
  ]) {
    fresh(`existing-${profile.country}`);
    const db = getDatabase();
    db.prepare(`INSERT INTO users (id, name, email, password, role) VALUES ('existing', 'Existing', 'existing@example.test', 'hash', 'owner')`).run();
    const update = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    for (const [key, value] of Object.entries(profile)) update.run(key, value, now());
    const loyaltyChoice = profile.country === 'IR' ? 'false' : 'true';
    update.run('loyalty_enabled', loyaltyChoice, now());
    db.prepare(`INSERT INTO payment_methods (name, is_active, sort_order) VALUES ('Transferência preservada', 0, 7)`).run();
    const before = { settings: regionalSettings(), methods: methods() };
    closeDatabase(); initDatabase();
    equal({ settings: regionalSettings(), methods: methods() }, before, `existing ${profile.country} settings/methods survive reopen`);
    equal((await setup()).status, 403, `existing ${profile.country} initialization remains closed`);
    equal({ settings: regionalSettings(), methods: methods() }, before, `existing ${profile.country} cannot acquire new defaults or PIX`);
    equal(getSettingValue('loyalty_enabled'), loyaltyChoice, `existing ${profile.country} loyalty choice survives reopen and refused setup`);
  }
  console.log(`ATS Brazilian first-run: ${assertions}/${assertions} assertions passed; isolated synthetic profiles only.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  try { closeDatabase(); } catch { /* Cleanup after setup failure. */ }
  Module._load = originalLoad;
  fs.rmSync(testRoot, { recursive: true, force: true });
});
