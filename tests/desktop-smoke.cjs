const { _electron: electron, expect } = require('@playwright/test');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const data = mkdtempSync(path.join(tmpdir(), 'serveo-desktop-'));
const env = { ...process.env, SERVEO_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SERVEO_DEV_URL;
let app;
const rendererErrors = [];
async function launch() {
  app = await electron.launch(process.env.SERVEO_TEST_EXECUTABLE
    ? { executablePath: path.resolve(process.env.SERVEO_TEST_EXECUTABLE), args: [], env }
    : { args: [path.resolve('.')], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => { rendererErrors.push(error.message); });
  await page.waitForFunction(() => !!window.serveo);
  return page;
}
(async () => {
  mkdirSync('test-results', { recursive: true });
  let page = await launch();
  await page.getByLabel('Shop name', { exact: true }).fill('Pilot Café');
  await page.getByLabel('Your name', { exact: true }).fill('Pilot Owner');
  await page.getByLabel('Username', { exact: true }).fill('pilot');
  await page.getByLabel('Password', { exact: true }).fill('pilot-password-123');
  await page.getByRole('button', { name: 'Create my shop' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Menu & stock' }).click();
  await page.locator('[data-action="new-product"]').first().click();
  await page.getByLabel('Item name', { exact: true }).fill('Chicken Sajji');
  await page.getByLabel('Size / variant', { exact: true }).fill('Half');
  await page.getByLabel('Selling price', { exact: true }).fill('750');
  await page.getByLabel('Stock quantity', { exact: true }).fill('20');
  await page.getByLabel('Track and deduct stock').check();
  await page.getByRole('button', { name: 'Save menu item' }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  // A full catalog must scroll without pushing checkout out of the window.
  await page.evaluate(async () => {
    for (let n = 1; n <= 28; n++) await window.serveo.saveProduct({ id: '', name: `Menu test ${n}`, category: 'BBQ', variant: '', price: 10, stock: 0, trackStock: false, active: true });
  });
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('[data-action="day"]').first().click();
  await page.getByLabel('Opening cash', { exact: true }).fill('1000');
  await page.locator('[data-form="open-day"] button[type="submit"]').click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await page.locator('[data-action="nav:pos"]').first().click();
  await page.getByRole('button', { name: /Chicken Sajji/ }).click();
  await page.getByRole('button', { name: 'Add one', exact: true }).click();
  await page.getByLabel('Cash received', { exact: true }).fill('2000');
  await expect(page.locator('#change-total')).toContainText('500.00');
  for (const [width, height] of [[900, 650], [1366, 768], [1920, 1080]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const check = await page.evaluate(() => {
      const button = document.querySelector('.checkout').getBoundingClientRect();
      const catalog = document.querySelector('#product-grid');
      return { top: button.top, bottom: button.bottom, height: innerHeight, documentHeight: document.documentElement.scrollHeight, catalogScrolls: catalog.scrollHeight > catalog.clientHeight };
    });
    assert.ok(check.top >= 0 && check.bottom <= check.height, `Checkout is visible at ${width}x${height}: ${JSON.stringify(check)}`);
    assert.ok(check.documentHeight <= check.height + 1, 'POS does not require whole-page scrolling');
    assert.ok(check.catalogScrolls, `Long menu has an independent scrollbar at ${width}x${height}: ${JSON.stringify(check)}`);
    await page.locator('#product-grid').evaluate(node => node.scrollTop = node.scrollHeight);
    await expect(page.locator('.checkout')).toBeInViewport({ ratio: 1 });
    if (width === 1366) await page.screenshot({ path: 'test-results/pos-1366.png' });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768));
  // Service options and a large basket keep payment anchored as details grow.
  await page.locator('[data-action="type:delivery"]').click();
  await page.getByLabel('Delivery address', { exact: true }).fill('Test delivery street');
  await page.getByLabel('Phone', { exact: true }).fill('03001234567');
  await page.getByLabel('Customer name', { exact: true }).fill('Pilot customer');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.locator('select[name=paymentMethod]').selectOption('unpaid');
  await expect(page.getByLabel('Cash received', { exact: true })).toBeHidden();
  await page.locator('[data-action="basket-details"]').click();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveAttribute('required', '');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.locator('select[name=paymentMethod]').selectOption('card');
  await expect(page.getByLabel('Cash received', { exact: true })).toBeHidden();
  await page.locator('select[name=paymentMethod]').selectOption('cash');
  await expect(page.getByLabel('Cash received', { exact: true })).toBeVisible();
  await page.locator('[data-action="type:dine-in"]').click();
  await page.getByLabel('Table number', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.locator('[data-action="type:takeaway"]').click();
  for (let n = 1; n <= 12; n++) await page.getByRole('button', { name: new RegExp(`Menu test ${n} Regular`) }).click();
  await expect(page.locator('.checkout')).toBeInViewport({ ratio: 1 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 650));
  await expect(page.locator('.checkout')).toBeInViewport({ ratio: 1 });
  while (await page.locator('[data-action="basket-next"]').isEnabled()) await page.locator('[data-action="basket-next"]').click();
  const basketLayout = await page.locator('.basket').evaluate(node => {
    const lines = node.querySelector('.basket-lines');
    return { scroll: node.scrollHeight, height: node.clientHeight, linesScroll: lines.scrollHeight, linesHeight: lines.clientHeight, rows: lines.querySelectorAll('.basket-item').length };
  });
  assert.ok(basketLayout.scroll <= basketLayout.height + 1, 'Basket panel has no overflow');
  assert.ok(basketLayout.linesScroll <= basketLayout.linesHeight + 1, 'Order items fit each page without a scrollbar');
  assert.ok(basketLayout.rows > 0 && basketLayout.rows < 13, 'A large basket is paginated');
  for (let n = 12; n >= 1; n--) await page.locator(`[data-action="qty:${n}:-1"]`).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1366, 768));
  await page.screenshot({ path: 'test-results/pos.png', fullPage: true });
  await page.getByRole('button', { name: /Place order/ }).click();
  await expect(page.locator('#modal-title')).toHaveText('Order #1');
  // Review controls align with their submit button, without a tall default dialog.
  const alignment = await page.locator('[data-form="status"]').evaluate(form => {
    const select = form.querySelector('select').getBoundingClientRect();
    const button = form.querySelector('button').getBoundingClientRect();
    return Math.abs(select.bottom - button.bottom);
  });
  assert.ok(alignment <= 1, 'Status selector and update button align');
  await page.screenshot({ path: 'test-results/order-popup.png' });
  // Preview all formats without printing or changing the order.
  for (const [kind, title] of [['receipt', 'RECEIPT'], ['kitchen', 'KITCHEN TICKET'], ['invoice', 'INVOICE']]) {
    await page.locator(`[data-action="${kind === 'receipt' ? 'print' : 'preview'}:${kind}"]`).click();
    await expect(page.locator('#modal-title')).toHaveText('Print preview · Order #1');
    await expect(page.frameLocator('.print-preview-frame').getByRole('heading', { name: `${title} #1`, exact: true })).toBeVisible();
    await expect(page.frameLocator('.print-preview-frame').getByText('Chicken Sajji · Half', { exact: true })).toBeVisible();
    assert.equal(await page.frameLocator('.print-preview-frame').locator('body').evaluate(node => getComputedStyle(node).fontFamily), 'Arial, sans-serif');
    if (kind === 'kitchen') await expect(page.frameLocator('.print-preview-frame').locator('body')).not.toContainText('PKR');
    await expect(page.locator('[data-action="print-now"]')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `test-results/preview-${kind}.png` });
  }
  // Test Print routing and cancellation using a fake driver; never send a test job.
  await app.evaluate(({ app }) => {
    globalThis.serveoPrintCalls = [];
    app.on('browser-window-created', (_event, win) => {
      win.webContents.print = (options, callback) => {
        globalThis.serveoPrintCalls.push({ options, url: win.webContents.getURL() });
        callback(false, 'Print job canceled');
      };
    });
  });
  await page.locator('[data-action="print-now"]').click();
  await expect(page.locator('[data-action="print-now"]')).toBeEnabled();
  const calls = await app.evaluate(() => globalThis.serveoPrintCalls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.silent, false);
  assert.ok(decodeURIComponent(calls[0].url).includes('INVOICE #1'));
  await page.locator('[data-action="back-order"]').click();
  let snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.orders[0].total, 1500);
  assert.equal(snapshot.orders[0].table, '', 'Takeaway does not save a previous dine-in table');
  assert.equal(snapshot.orders[0].address, '', 'Takeaway does not save a previous delivery address');
  assert.equal(snapshot.products.find(p => p.name === 'Chicken Sajji').stock, 18);
  assert.equal(snapshot.closing.expectedCash, 2500);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('[data-action="nav:expenses"]').click();
  await page.locator('[data-action="new-expense"]').first().click();
  await page.getByLabel('Category', { exact: true }).fill('Supplies');
  await page.getByLabel('Amount paid', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Record expense', exact: true }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await page.locator('[data-action="day"]').first().click();
  await page.getByLabel('Counted cash', { exact: true }).fill('2400');
  await page.locator('[data-form="close-day"] button[type="submit"]').click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.closing.difference, 0);
  await page.locator('[data-action="nav:dashboard"]').click();
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  await app.close();
  page = await launch();
  await page.getByLabel('Username', { exact: true }).fill('pilot');
  await page.getByLabel('Password', { exact: true }).fill('pilot-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.orders.length, 1);
  assert.deepEqual(rendererErrors, [], 'No renderer JavaScript errors');
  assert.equal(snapshot.expenses.length, 1);
  assert.equal(snapshot.closing.difference, 0);
  const backupPath = path.join(data, 'export-test.sqlite');
  await app.evaluate(({ dialog }, backupPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: backupPath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backupPath] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, backupPath);
  assert.equal(await page.evaluate(() => window.serveo.exportBackup()), backupPath);
  assert.equal(await page.evaluate(() => window.serveo.exportBackup()), backupPath);
  await page.evaluate(async () => {
    const snapshot = await window.serveo.snapshot();
    await window.serveo.saveShop({ ...snapshot.shop, name: 'Changed after backup' });
    await window.serveo.restoreBackup();
    await window.serveo.login('pilot', 'pilot-password-123');
  });
  snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.shop.name, 'Pilot Café');
  assert.equal(snapshot.orders.length, 1);
  // Exercise the refund choice through the actual desktop form.
  await page.reload();
  await page.locator('[data-action="nav:orders"]').first().click();
  await page.locator('[data-action^="order:"]').first().click();
  await page.locator('.danger-zone summary').click();
  await expect(page.getByRole('combobox', { name: /^Stock handling/ })).toHaveValue('waste');
  await page.getByLabel('Reason for full refund', { exact: true }).fill('Prepared food cannot be resold');
  await page.evaluate(() => window.serveo.openDay(1000));
  await page.getByRole('button', { name: /Refund .* & cancel/ }).click();
  snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.orders[0].stockDisposition, 'waste');
  assert.equal(snapshot.products.find(p => p.name === 'Chicken Sajji').stock, 18);
  assert.equal(snapshot.orders[0].refunded, 1500);
  const returned = await page.evaluate(async () => {
    const s = await window.serveo.snapshot();
    const product = s.products.find(p => p.name === 'Chicken Sajji');
    return window.serveo.createOrder({items:[{productId:product.id,quantity:1,note:''}],type:'takeaway',table:'',customer:'',phone:'',address:'',rider:'',note:'',discount:0,deliveryCharge:0,paymentMethod:'cash',cashReceived:750});
  });
  await page.reload();
  await page.locator('[data-action="nav:orders"]').first().click();
  const newest = returned.orders.reduce((a,b) => a.number > b.number ? a : b);
  await page.locator(`[data-action="order:${newest.id}"]`).click();
  await page.locator('.danger-zone summary').click();
  await page.getByRole('combobox', { name: /^Stock handling/ }).selectOption('return');
  await page.getByLabel('Reason for full refund', { exact: true }).fill('Unprepared item returned');
  await page.getByRole('button', { name: /Refund .* & cancel/ }).click();
  snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.orders.find(o => o.id === newest.id).stockDisposition, 'return');
  assert.equal(snapshot.products.find(p => p.name === 'Chicken Sajji').stock, 18);
  assert.deepEqual(rendererErrors, []);
  console.log('Refund desktop passed: safe default wastage, explicit stock return, saved disposition and quantities.');
  console.log('Desktop UI passed: setup, 29-item menu, 3 window sizes, 13-line basket, delivery/dine-in/takeaway, cash/card/unpaid UI, anchored checkout, popup alignment, 3 print previews, print cancellation, sale/change, expense, closing, restart, backup export/overwrite/restore. Data:', data);
})().catch(async error => { console.error(error); if (app) { const windows = app.windows(); if (windows[0]) { console.log(await windows[0].evaluate(() => [...document.querySelectorAll('.workspace,.page-content,.pos-layout,.catalog,.product-grid,.basket')].map(n => ({ cls: n.className, height: n.clientHeight, scroll: n.scrollHeight, children: n.children.length })))); await windows[0].screenshot({ path: 'test-results/failure.png' }).catch(() => {}); } } process.exitCode = 1; }).finally(async () => { if (app) await app.close().catch(() => {}); });
