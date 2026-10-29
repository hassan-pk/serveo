// Public documentation screenshots: synthetic records in a temporary database only.
// Run npm run build first, then node scripts/generate-screenshots.cjs.
const { _electron: electron, expect } = require('@playwright/test');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Store } = require('../dist/main/store');
const directory = mkdtempSync(path.join(tmpdir(), 'serveo-public-screenshots-'));
const password = randomUUID();
const store = new Store(path.join(directory, 'serveo.sqlite'));
store.setup({ shop: { name: 'Bluebird Kitchen · Demo', category: 'Restaurant', phone: '', address: 'Demo Market', currency: 'PKR', footer: 'Thank you for visiting Bluebird Kitchen!', paperWidth: '80' }, owner: { name: 'Demo Owner', username: 'demo-owner', password } });
const catalog = [
  ['Roast Chicken & Rice', 'Sajji', 'Full', 1800],
  ['Roast Chicken & Rice', 'Sajji', 'Half', 950],
  ['Chicken Biryani', 'Rice', 'Regular', 450],
  ['Family Rice Bowl', 'Rice', 'Family', 1200],
  ['Grilled Chicken Skewers', 'BBQ', '6 pieces', 750],
  ['Mixed Grill Platter', 'Platters', 'Family', 2400],
  ['Spiced Grilled Fish', 'Fish', 'Regular', 1100],
  ['Lemon Mint Cooler', 'Drinks', 'Glass', 250],
  ['Fresh Orange Juice', 'Drinks', 'Glass', 300],
  ['Chicken Tikka', 'BBQ', 'Quarter', 550],
  ['Chicken Rice Bowl', 'Rice', 'Regular', 600],
  ['Citrus Iced Tea', 'Drinks', 'Glass', 200],
];
catalog.forEach(([name, category, variant, price], index) => store.saveProduct({ id: `sample-${index}`, name, category, variant, price, stock: index === 6 ? 4 : 50, trackStock: true, active: true }));
store.openDay(5000);
let delivery;
for (let index = 0; index < 12; index++) {
  const type = ['takeaway', 'dine-in', 'delivery'][index % 3];
  const paymentMethod = ['cash', 'card', 'bank', 'unpaid'][index % 4];
  const result = store.createOrder({ items: [{ productId: `sample-${index % 6}`, quantity: 1, note: index % 3 === 0 ? 'Mild spice' : '' }, { productId: 'sample-7', quantity: 2, note: '' }], type, table: type === 'dine-in' ? String(index + 1) : '', customer: `Sample Customer ${String(index + 1).padStart(2, '0')}`, phone: type === 'delivery' ? '000-000-0000' : '', address: type === 'delivery' ? '10 Demo Lane, Sample Town' : '', rider: type === 'delivery' ? 'Demo Rider' : '', note: type === 'delivery' ? 'Call on arrival. Demo order.' : '', discount: 0, deliveryCharge: type === 'delivery' ? 100 : 0, paymentMethod, cashReceived: paymentMethod === 'cash' ? 5000 : 0 });
  const order = result.orders.reduce((a, b) => a.number > b.number ? a : b);
  store.setOrderStatus(order.id, index < 6 ? 'completed' : ['new', 'preparing', 'ready'][index % 3]);
  if (type === 'delivery') delivery = order.id;
}
store.addExpense({ category: 'Kitchen supplies', amount: 650, note: 'Sample packaging purchase' });
store.addExpense({ category: 'Utilities', amount: 400, note: 'Sample daily expense' });
store.close();
let app;
(async () => {
  const output = path.resolve('docs/screenshots');
  mkdirSync(output, { recursive: true });
  const env = { ...process.env, SERVEO_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SERVEO_DEV_URL;
  app = await electron.launch({ args: [path.resolve('.')], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await page.getByLabel('Username', { exact: true }).fill('demo-owner');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  async function capture(name) {
    await page.evaluate(async () => {
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
      document.activeElement?.blur();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  await capture('overview');
  await page.locator('[data-action="nav:pos"]').first().click();
  for (const id of ['sample-0', 'sample-4', 'sample-7']) await page.locator(`[data-action="add:${id}"]`).click();
  await page.getByLabel('Cash received', { exact: true }).fill('3000');
  await capture('point-of-sale');
  await page.locator('[data-action="nav:orders"]').first().click();
  await page.locator('[data-action="filter:all"]').click();
  await capture('orders');
  await page.locator(`[data-action="order:${delivery}"]`).click();
  await page.locator('[data-action="print:invoice"]').click();
  await expect(page.frameLocator('.print-preview-frame').locator('body')).toContainText('Bluebird Kitchen');
  await capture('invoice');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('[data-action="nav:products"]').first().click();
  await capture('menu-and-stock');
  await page.locator('[data-action="product:sample-0"]').click();
  await capture('product-editor');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('[data-action="nav:reports"]').first().click();
  await capture('reports');
  console.log('Generated seven public screenshots using synthetic records only:', output);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
