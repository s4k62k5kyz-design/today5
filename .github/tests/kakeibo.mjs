import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const fixture = `FamilyMart 二の橋店
東京都港区麻布十番1-2-10
2016年09月29日 12:45
十六茶 151円
値引 -22円
吊るしベーコン 198円
茶碗蒸し 133円
商品合計 482円
値引合計 22円
小計 460円
合計 460円
内消費税等 34円
お預り 510円
お釣り 50円`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', msg => {
  if (msg.type() === 'error') pageErrors.push('console: ' + msg.text());
});

await page.route('**/functions/v1/receipt-analyzer', async route => {
  if (route.request().method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, configured: false }) });
  } else {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  }
});

await page.addInitScript(({ fixture }) => {
  window.Tesseract = {
    recognize: async (_canvas, _langs, opts = {}) => {
      opts.logger?.({ status: 'recognizing text', progress: 0.2 });
      opts.logger?.({ status: 'recognizing text', progress: 0.7 });
      opts.logger?.({ status: 'recognizing text', progress: 1 });
      return { data: { text: fixture } };
    }
  };
}, { fixture });

await page.goto('http://127.0.0.1:4173/kakeibo/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.__appTest === 'object');

assert.equal(await page.title(), 'くらし家計簿');
assert.equal(await page.locator('[data-nav]').count(), 4);
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'mobile layout overflow');

await page.evaluate(() => window.__appTest.reset());

const parsed = await page.evaluate(f => window.__appTest.parseReceiptText(f), fixture);
assert.equal(parsed.total, 460, 'final total must be 460, not product subtotal 482');
assert.equal(parsed.date, '2016-09-29');
assert.match(parsed.merchant, /FamilyMart/i);
assert.equal(parsed.category, '食費');
assert.equal(parsed.items.length, 3);
assert.equal(parsed.items[0].amount, 129);
assert.equal(parsed.items.reduce((s, x) => s + x.amount, 0), 460);

// manual expense registration
const today = await page.evaluate(() => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
});
const currentYM = today.slice(0, 7);
await page.click('#quickExpense');
await page.fill('#entryAmount', '1234');
await page.fill('#entryDate', today);
await page.fill('#entryMemo', '動作確認');
await page.locator('#entryForm button[type=submit]').click();
assert.equal(await page.evaluate(() => window.__appTest.db().tx.length), 1);
assert.equal(await page.evaluate(k => window.__appTest.totals(k).expense, currentYM), 1234);

// budget
await page.click('[data-nav=plan]');
await page.fill('#budgetInput', '10000');
await page.click('#saveBudget');
assert.equal(await page.evaluate(k => window.__appTest.db().budgets[k], currentYM), 10000);

// receipt one-tap flow: quick button -> file chooser -> auto analyze -> filled fields
await page.click('[data-nav=home]');
const chooserPromise = page.waitForEvent('filechooser');
await page.click('#quickReceipt');
const chooser = await chooserPromise;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNfWQAAAAASUVORK5CYII=', 'base64');
await chooser.setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: png });
await page.waitForSelector('#receiptResult:not(.hidden)', { timeout: 10000 });
assert.equal(await page.inputValue('#receiptTotal'), '460');
assert.match(await page.inputValue('#receiptMerchant'), /FamilyMart/i);
assert.equal(await page.inputValue('#receiptCategory'), '食費');
await page.click('#saveReceipt');
const receiptTx = await page.evaluate(() => window.__appTest.db().tx.filter(x => x.source === 'receipt').at(-1));
assert.equal(receiptTx.amount, 460);
assert.equal(receiptTx.items.length, 3);

// automatic savings: previous month budget 10,000 - expense 7,000 = 3,000
const saving = await page.evaluate(() => {
  const d = window.__appTest.db();
  const p = new Date(); p.setDate(1); p.setMonth(p.getMonth()-1);
  const key = p.getFullYear() + '-' + String(p.getMonth()+1).padStart(2,'0');
  const date = key + '-15';
  d.budgets[key] = 10000;
  d.tx.push({ id:'test-prev', type:'expense', amount:7000, date, category:'食費', memo:'test', merchant:'', items:[], source:'manual', recurringId:'', createdAt:Date.now() });
  window.__appTest.syncAutoSavings();
  return d.autoSavings[key]?.amount;
});
assert.equal(saving, 3000);

// recurring should post once, never duplicate
const recCounts = await page.evaluate(() => {
  const d = window.__appTest.db();
  d.recurring.push({ id:'rec-test', type:'expense', name:'固定費テスト', amount:500, day:1, category:'通信', active:true });
  const a = window.__appTest.syncRecurring();
  const b = window.__appTest.syncRecurring();
  return [a,b,d.tx.filter(x => String(x.recurringId).startsWith('rec-test:')).length];
});
assert.deepEqual(recCounts, [1,0,1]);

assert.deepEqual(pageErrors, [], 'no page/console errors');
await browser.close();
console.log('Kakeibo end-to-end tests passed');
