const Module = require('module');
const originalLoad = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-br-pix-'));
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return { app: { isPackaged: true, getPath: () => testDir, getVersion: () => 'test' } };
  return originalLoad.apply(this, arguments as any);
};

const {
  initTestDb, createApp, startServer, seedOwnerUser, seedManagerUser, seedCategory, seedProduct,
  api, assert, assertEqual, getResults, closeDatabase, now,
} = require('./helpers/test-setup');
const { orderRoutes } = require('../main/routes/orders');
const { billRoutes } = require('../main/routes/bills');
const { paymentMethodRoutes } = require('../main/routes/payment-methods');
const { refundRoutes } = require('../main/routes/refunds');
const { reportRoutes } = require('../main/routes/reports');
const { cashClosureRoutes } = require('../main/routes/cash-closures');
const { localDateInTimezone } = require('../main/db');
const { formatReceipt, escPosToText } = require('../main/printers/thermal');
const { buildBillPrintContext, buildBillPrintData } = require('../main/printers/document-classic');
const { buildBillDocument, getBlock } = require('../shared/print');
const { LATIN_THERMAL_CAPABILITIES } = require('../shared/print/thermal-capabilities');

function frontendPrintModules() {
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: unknown, isMain: boolean, options: unknown) {
    const target = request === '@countries' ? path.resolve(__dirname, '../main/countries.ts')
      : request.startsWith('@/') ? path.resolve(__dirname, '../frontend/src', request.slice(2))
      : request.startsWith('@print/') ? path.resolve(__dirname, '../shared/print', request.slice(7)) : request;
    return originalResolve.call(this, target, parent, isMain, options);
  };
  try {
    return {
      web: require('../frontend/src/lib/printer/web-print'),
      encoder: require('../frontend/src/lib/printer/receipt-encoder'),
      document: require('../frontend/src/lib/printer/print-document'),
    };
  } finally { Module._resolveFilename = originalResolve; }
}

async function main() {
  console.log('ATS FINAL-01 Brazilian PIX: real temporary SQLite + authenticated HTTP + receipt renderers');
  let db = initTestDb();
  for (const [key, value] of Object.entries({ country: 'BR', currency: 'BRL', timezone: 'America/Sao_Paulo', business_day_start_time: '00:00', language: 'pt', telemetry_enabled: 'false', loyalty_enabled: 'false' })) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, now());
  }
  const owner = seedOwnerUser(db);
  const manager = seedManagerUser(db);
  const headers = owner.authHeader;
  db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(require('bcryptjs').hashSync('9753', 10), owner.userId);
  seedCategory(db, 'br-food', 'Pratos');
  seedProduct(db, 'br-meal', 'br-food', 'Refeição brasileira', 100.01);
  const app = createApp({ '/api/orders': orderRoutes, '/api/bills': billRoutes, '/api/payment-methods': paymentMethodRoutes, '/api/refunds': refundRoutes, '/api/reports': reportRoutes, '/api/cash-closures': cashClosureRoutes });
  const { baseUrl, server } = await startServer(app);
  const post = (url: string, body: unknown, extra: Record<string, string> = {}) => api(baseUrl, url, { method: 'POST', body, headers: { ...headers, ...extra } });
  const cents = (value: number) => Math.round(Number(value) * 100);
  const pay = (bill: any, payments: unknown[], key: string) => post(`/api/bills/${bill.id}/payments`, { payments }, { 'Idempotency-Key': key });
  async function makeBill() {
    const order = await post('/api/orders', { type: 'takeaway', items: [{ product_id: 'br-meal', quantity: 1 }] });
    assertEqual(order.status, 201, 'synthetic Brazilian meal order created');
    const bill = await post('/api/bills/generate', { order_id: order.data.order.id });
    assertEqual(bill.status, 201, 'bill generated through authoritative route');
    assertEqual(bill.data.bill.total, 100.01, 'BRL retains centavos without whole-unit rounding');
    return bill.data.bill;
  }
  try {
    assertEqual((await api(baseUrl, '/api/payment-methods')).status, 401, 'payment configuration requires authentication');
    const configured = await post('/api/payment-methods', { name: 'PIX' });
    assertEqual(configured.status, 201, 'existing installation configures PIX through custom-method API');
    const pix = configured.data.payment_method.id;
    assertEqual((await post('/api/payment-methods', { name: 'pix' })).status, 409, 'PIX configuration is case-insensitively unique');
    const other = (await post('/api/payment-methods', { name: 'Vale refeição' })).data.payment_method.id;
    const full = await makeBill();
    const fullLines = [{ method: 'custom', payment_method_id: pix, amount: 100.01, transaction_id: 'pix-full-001' }];
    const fullPaid = await pay(full, fullLines, 'br-full');
    assertEqual(fullPaid.status, 200, 'full PIX declaration accepted');
    assertEqual(fullPaid.data.bill.payment_status, 'paid', 'declared full payment settles bill locally');
    assertEqual(fullPaid.data.bill.payment_details[0].method, 'PIX', 'canonical PIX name stored');
    assertEqual((await pay(full, fullLines, 'br-full')).status, 200, 'identical retry replays successful response');
    assertEqual((await pay(full, [{ ...fullLines[0], amount: 90 }], 'br-full')).status, 409, 'altered retry is rejected');
    assertEqual((await pay(full, fullLines, 'br-full-new-key')).status, 200, 'transaction reference replay cannot double-charge');
    assertEqual(JSON.parse(db.prepare('SELECT payment_details FROM bills WHERE id = ?').get(full.id).payment_details).length, 1, 'retries retain exactly one ledger line');

    const mixed = await makeBill();
    const mixedPaid = await pay(mixed, [
      { method: 'custom', payment_method_id: pix, amount: 40.01 },
      { method: 'card', amount: 30 },
      { method: 'custom', payment_method_id: other, amount: 10 },
      { method: 'cash', amount: 50 },
    ], 'br-mixed');
    assertEqual(mixedPaid.status, 200, 'PIX + card + voucher + cash accepted atomically');
    const cashLine = mixedPaid.data.bill.payment_details.find((line: any) => line.method === 'cash');
    assertEqual(cashLine.amount, 20, 'only required cash is applied to the sale');
    assertEqual(cashLine.tendered_amount, 50, 'cash tender recorded separately');
    assertEqual(cashLine.change_amount, 30, 'cash change calculated exactly');
    assertEqual(cents(mixedPaid.data.bill.paid_amount), 10001, 'mixed payments sum to exact payable cents');

    const partial = await makeBill();
    const first = await pay(partial, [{ method: 'pix', amount: 0.01, transaction_id: 'pix-partial-001' }], 'br-partial');
    assertEqual(first.status, 200, 'one-cent partial PIX accepted');
    assertEqual(first.data.bill.balance, 100, 'partial leaves exact remaining balance');
    assertEqual(first.data.bill.payment_status, 'partial', 'partial payment status preserved');
    const beforeCompletion = await api(baseUrl, '/api/reports/summary', { headers });
    assertEqual(cents(beforeCompletion.data.summary.paymentMethods.find((row: any) => row.method === 'PIX').total), 14003, 'live report includes partial PIX without counting it twice');
    assertEqual((await pay(partial, [{ method: 'pix', amount: 100 }], 'br-partial-complete')).status, 200, 'remaining PIX settles partial bill');

    const rejected = await makeBill();
    assertEqual((await pay(rejected, [{ method: 'pix', amount: 100.02 }], 'br-over')).status, 400, 'PIX cannot exceed payable balance or generate change');
    assertEqual((await pay(rejected, [{ method: 'pix', amount: 0 }], 'br-zero')).status, 400, 'zero PIX amount rejected');
    assertEqual((await pay(rejected, [{ method: 'pix', amount: 1.001 }], 'br-precision')).status, 400, 'fractional centavos rejected');
    assertEqual((await pay(rejected, [{ method: 'pix', amount: 10, transaction_id: 'pix-full-001' }], 'br-cross-bill')).status, 409, 'transaction reference cannot be reused on another bill');
    assertEqual((await pay(rejected, [{ method: 'pix', amount: 10, transaction_id: 'same' }, { method: 'pix', amount: 10, transaction_id: 'same' }], 'br-duplicate-lines')).status, 409, 'duplicate batch references rejected atomically');
    assertEqual(db.prepare('SELECT paid_amount FROM bills WHERE id = ?').get(rejected.id).paid_amount, 0, 'all rejected batches leave bill unchanged');

    const refundBody = { bill_id: full.id, method: 'pix', amount: 10, override_pin: '9753', reason: 'Devolução sintética' };
    assertEqual((await post('/api/refunds', { ...refundBody, override_pin: '0000' })).status, 403, 'invalid approval PIN blocks PIX refund');
    assertEqual((await post('/api/refunds', { ...refundBody, amount: 100.02 })).status, 400, 'PIX refund cannot exceed paid amount');
    assertEqual((await post('/api/refunds', { ...refundBody, method: 'PIX inexistente' })).status, 400, 'unknown refund method rejected');
    const refund = await post('/api/refunds', refundBody, { 'Idempotency-Key': 'br-refund' });
    assertEqual(refund.status, 201, 'authorized PIX refund recorded');
    assertEqual(refund.data.refund.method, 'PIX', 'refund case canonicalized for financial grouping');
    assertEqual((await post('/api/refunds', refundBody, { 'Idempotency-Key': 'br-refund' })).data.refund.id, refund.data.refund.id, 'refund retry replays same record');
    assertEqual((await post('/api/refunds', { ...refundBody, amount: 2, method: 'cash' }, { 'Idempotency-Key': 'br-cash-refund' })).status, 201, 'refund may use a different method per existing product rule');
    assertEqual((await api(baseUrl, `/api/payment-methods/${pix}`, { method: 'PUT', body: { name: 'Vale refeição' }, headers })).status, 409, 'rename into an existing method is rejected');
    assertEqual(db.prepare('SELECT method FROM refunds WHERE id = ?').get(refund.data.refund.id).method, 'PIX', 'rename collision leaves refund ledger unchanged');

    const day = localDateInTimezone(new Date(), 'America/Sao_Paulo');
    const report = (await api(baseUrl, `/api/reports/financial-summary?start_date=${day}&end_date=${day}`, { headers })).data.financialSummary;
    assertEqual(cents(report.grossCollected), 30003, 'financial report gross totals reconcile');
    assertEqual(cents(report.refunded), 1200, 'financial report refunds reconcile');
    assertEqual(cents(report.netCollected), 28803, 'financial report net totals reconcile');
    assertEqual(cents(report.paymentMethods.find((row: any) => row.method === 'PIX').total), 23003, 'PIX receipts less PIX refunds grouped together');
    assertEqual(cents(report.paymentMethods.find((row: any) => row.method === 'cash').total), 1800, 'drawer receives only applied cash less cash refund');
    const history = await api(baseUrl, '/api/orders', { headers });
    const historicFull = history.data.orders.find((order: any) => order.id === full.order_id);
    assertEqual(historicFull.bill.payment_details[0].method, 'PIX', 'order history preserves PIX declaration');

    const fullDetail = (await api(baseUrl, `/api/bills/${full.id}`, { headers })).data.bill;
    const business = { name: 'Restaurante Sintético', country: 'BR', currency: 'BRL', currency_symbol: 'R$', timezone: 'America/Sao_Paulo' };
    const unsupportedWarnings: any[] = [];
    assertEqual(formatReceipt(fullDetail.order, fullDetail, business, 'classic', 48, false, false, 'full', unsupportedWarnings, false, 'pt').length, 0, 'unconfigured ASCII profile refuses unsupported accented financial product instead of dropping it');
    assert(unsupportedWarnings.some((warning) => warning.kind === 'financial'), 'unsupported printer profile surfaces a financial-text warning');
    const asciiOrder = { ...fullDetail.order, items: fullDetail.order.items.map((item: any) => ({ ...item, product_name: 'Prato brasileiro' })) };
    const asciiReceipt = escPosToText(formatReceipt(asciiOrder, fullDetail, { ...business, name: 'Restaurante' }, 'classic', 48, false, false, 'full', [], false, 'en'));
    assert(asciiReceipt.includes('COMPROVANTE NAO FISCAL'), 'non-fiscal thermal designation remains printable on generic ASCII profile');
    for (const language of ['pt', 'en']) {
      const context = buildBillPrintContext({ columns: 48, language, business });
      const document = buildBillDocument(buildBillPrintData(fullDetail.order, fullDetail, business, false), context);
      assertEqual(getBlock(document, 'document-meta').title.primary, 'COMPROVANTE NÃO FISCAL', `${language}: Brazilian receipt is non-fiscal independently of language`);
      for (const template of ['classic', 'compact']) {
        const text = escPosToText(formatReceipt(fullDetail.order, fullDetail, business, template, 48, false, false, 'full', [], false, language, undefined, LATIN_THERMAL_CAPABILITIES));
        assert(/COMPROVANTE N.O FISCAL/.test(text), `${language}/${template}: backend thermal receipt includes non-fiscal designation`);
        assert(text.includes('PIX'), `${language}/${template}: backend thermal receipt names PIX`);
        assert(text.includes('R$'), `${language}/${template}: backend receipt identifies BRL`);
      }
    }
    const intl = buildBillPrintContext({ columns: 48, language: 'en', business: { ...business, country: 'IN', currency: 'INR' } });
    assertEqual(getBlock(buildBillDocument(buildBillPrintData(fullDetail.order, fullDetail, business, false), intl), 'document-meta').title.conceptId, 'print.invoiceTitle', 'international receipt title contract preserved');
    const frontend = frontendPrintModules();
    await frontend.document.ensurePrintLanguagesLoaded(['pt']);
    const tenant = { ...business, business_name: business.name };
    const html = frontend.web.generateBillHtml(fullDetail, tenant, { languages: ['pt'] });
    assert(html.includes('COMPROVANTE NÃO FISCAL'), 'browser receipt visibly identifies non-fiscal document');
    assert(html.includes('PIX'), 'browser receipt carries PIX payment');
    for (const fn of [frontend.encoder.buildClassicReceiptBytes, frontend.encoder.buildCompactReceiptBytes]) {
      const bytes = fn(fullDetail, tenant, { paperWidth: 80, languages: ['pt'], capabilities: LATIN_THERMAL_CAPABILITIES });
      assert(/COMPROVANTE N.O FISCAL/.test(escPosToText(Buffer.from(bytes))), 'WebUSB receipt includes non-fiscal designation');
    }

    const closeBody = { business_date: day, opening_float_cents: 10000, counted_cash_cents: 11800 };
    assertEqual((await api(baseUrl, '/api/cash-closures', { method: 'POST', body: closeBody, headers: manager.authHeader })).status, 403, 'manager cannot bypass owner-only cash closure');
    const close = await post('/api/cash-closures', closeBody);
    assertEqual(close.status, 201, 'owner cash closure created');
    assertEqual(close.data.zReport.expected_cash_cents, 11800, 'PIX and card excluded from physical drawer expectation');
    assertEqual(close.data.zReport.variance_cents, 0, 'counted drawer reconciles');
    assertEqual(close.data.zReport.net_collected_cents, 28803, 'immutable close net reconciles');
    assertEqual(close.data.zReport.payment_methods.find((row: any) => row.method === 'PIX').total_cents, 23003, 'immutable close names and totals PIX');
    const zBody = require('../main/printers/thermal').buildZReportBody(close.data.zReport, 'pt', { columns: 48, capabilities: LATIN_THERMAL_CAPABILITIES }, []);
    const zText = escPosToText(zBody);
    assert(zText.includes('PIX') && zText.includes('230,03'), 'Portuguese BRL cash-close receipt renders exact PIX net with decimal comma');
    assert(zText.includes('118,00'), 'Portuguese BRL cash-close receipt renders exact drawer expectation');
    const zWarnings: any[] = [];
    assertEqual(require('../main/printers/thermal').buildZReportBody(close.data.zReport, 'pt', { columns: 48 }, zWarnings).length, 0, 'unconfigured ASCII cash-close printer refuses unsupported Portuguese financial labels');
    assert(zWarnings.some((warning) => warning.kind === 'financial'), 'Portuguese cash-close refusal surfaces required printer-capability configuration');
    assertEqual((await post('/api/cash-closures', closeBody)).status, 409, 'duplicate close rejected');

    assertEqual((await api(baseUrl, `/api/payment-methods/${pix}`, { method: 'PUT', body: { is_active: false }, headers })).status, 200, 'operator may disable PIX');
    assertEqual((await pay(rejected, [{ method: 'custom', payment_method_id: pix, amount: 1 }], 'br-disabled')).status, 400, 'disabled PIX cannot receive new payments');
    assertEqual((await post('/api/refunds', { ...refundBody, amount: 1 })).status, 201, 'historical original PIX can still be refunded after disabling');
    const rename = await api(baseUrl, `/api/payment-methods/${pix}`, { method: 'PUT', body: { name: 'PIX loja', is_active: true }, headers });
    assertEqual(rename.status, 200, 'existing custom method can be renamed');
    assertEqual(db.prepare('SELECT method FROM refunds WHERE id = ?').get(refund.data.refund.id).method, 'PIX loja', 'refund follows rename atomically for live report consistency');
    const staleAliasRefund = await post('/api/refunds', { ...refundBody, amount: 1 });
    assertEqual(staleAliasRefund.status, 201, 'original historical PIX alias remains refundable after rename');
    assertEqual(staleAliasRefund.data.refund.method, 'PIX loja', 'historical alias resolves original payment identity to its current name');
    const aliasReport = (await api(baseUrl, `/api/reports/financial-summary?start_date=${day}&end_date=${day}`, { headers })).data.financialSummary;
    assertEqual(cents(aliasReport.paymentMethods.find((row: any) => row.method === 'PIX loja').total), 22803, 'historical alias refund reconciles with renamed PIX receipts');
    assert(!aliasReport.paymentMethods.some((row: any) => row.method === 'PIX'), 'historical alias cannot create an orphan refund line');
    const reusedName = (await post('/api/payment-methods', { name: 'PIX' })).data.payment_method.id;
    await api(baseUrl, `/api/payment-methods/${reusedName}`, { method: 'PUT', body: { is_active: false }, headers });
    assertEqual((await post('/api/refunds', { ...refundBody, amount: 1 })).status, 400, 'reused historical name does not authorize a different disabled payment identity');
    await api(baseUrl, `/api/payment-methods/${reusedName}`, { method: 'DELETE', headers });
    assertEqual((await api(baseUrl, `/api/payment-methods/${pix}`, { method: 'DELETE', headers })).status, 409, 'used PIX method cannot be deleted');
    const merged = await post(`/api/payment-methods/${pix}/merge`, { target_type: 'card' });
    assertEqual(merged.status, 200, 'explicit custom-method merge preserves existing mechanism');
    assertEqual(db.prepare('SELECT method FROM refunds WHERE id = ?').get(refund.data.refund.id).method, 'card', 'merged refund canonicalizes built-in card');
    const mergedReport = (await api(baseUrl, `/api/reports/financial-summary?start_date=${day}&end_date=${day}`, { headers })).data.financialSummary;
    assertEqual(cents(mergedReport.paymentMethods.find((row: any) => row.method === 'card').total), 25803, 'merged receipts and refunds reconcile into one card line');

    const snapshot = db.prepare('SELECT * FROM cash_closures WHERE id = ?').get(close.data.zReport.id);
    closeDatabase();
    db = initTestDb();
    assertEqual(JSON.stringify(db.prepare('SELECT * FROM cash_closures WHERE id = ?').get(snapshot.id)), JSON.stringify(snapshot), 'closed snapshot survives database close/reopen unchanged despite later rename/merge');
    assertEqual(db.prepare('SELECT paid_amount FROM bills WHERE id = ?').get(full.id).paid_amount, 100.01, 'payment amount persists after database restart');
    assertEqual(db.prepare('SELECT COUNT(*) AS n FROM refunds WHERE bill_id = ?').get(full.id).n, 4, 'four authorized refunds persist without retry duplication');
    assertEqual(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', 'SQLite integrity check passes after restart');
  } finally {
    await new Promise<void>((resolve) => server.close(resolve));
    closeDatabase();
  }
  const results = getResults();
  console.log(`\nATS BR PIX: ${results.passed}/${results.total} passed; ${results.failed} failed.`);
  process.exit(results.failed ? 1 : 0);
}

main().catch((error) => { console.error(error); closeDatabase(); process.exit(1); });
