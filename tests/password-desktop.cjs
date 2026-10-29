const { _electron: electron, expect } = require('@playwright/test');
const { Store } = require('../dist/main/store');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = mkdtempSync(path.join(tmpdir(), 'serveo-password-'));
const store = new Store(path.join(directory, 'serveo.sqlite'));
store.setup({ shop: { name: 'Password Test Cafe', category: 'Cafe', phone: '', address: '', currency: 'PKR', footer: '', paperWidth: '80' }, owner: { name: 'Owner', username: 'owner', password: 'owner-old-password' } });
store.saveUser({ name: 'Cashier', username: 'cashier', password: 'cashier-old-password', role: 'cashier' });
store.saveProduct({ id: 'tea', name: 'Tea', category: 'Drinks', variant: '', price: 100, stock: 20, trackStock: true, active: true });
store.openDay(1000);
store.close();
let app, page;
const errors = [];
async function launch() {
  const env = { ...process.env, SERVEO_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE; delete env.SERVEO_DEV_URL;
  app = await electron.launch(process.env.SERVEO_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.SERVEO_TEST_EXECUTABLE), args: [], env } : { args: [path.resolve('.')], env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
}
async function login(username, password) {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function fill(current, next, confirm = next) {
  await page.getByLabel('Current password', { exact: true }).fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Confirm new password', { exact: true }).fill(confirm);
}
(async () => {
  mkdirSync('test-results', { recursive: true });
  await launch(); await login('owner', 'owner-old-password');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('[data-action="nav:settings"]').click();
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await fill('incorrect-current', 'owner-new-password');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.locator('.modal [role="alert"]')).toContainText('Current password is incorrect');
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await fill('owner-old-password', 'owner-new-password', 'different-confirmation');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  assert.equal(await page.getByLabel('Confirm new password', { exact: true }).evaluate(input => input.validationMessage), 'New passwords do not match.');
  await page.getByLabel('Confirm new password', { exact: true }).fill('owner-new-password');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Password changed');
  let snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.user.username, 'owner'); assert.equal(snapshot.products[0].id, 'tea'); assert.equal(snapshot.closing.openingCash, 1000);
  await page.locator('[data-action="logout"]').click();
  await login('owner', 'owner-old-password');
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  await login('owner', 'owner-new-password');
  await expect(page.locator('.sidebar')).toBeVisible();
  await app.close(); await launch(); await login('owner', 'owner-new-password');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.locator('[data-action="logout"]').click(); await login('cashier', 'cashier-old-password');
  await expect(page.locator('[data-action="nav:settings"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Change password for Cashier', exact: true }).click();
  await fill('cashier-old-password', 'cashier-new-password');
  await page.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.locator('[data-action="logout"]').click(); await login('cashier', 'cashier-old-password');
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  await login('cashier', 'cashier-new-password'); await expect(page.locator('.sidebar')).toBeVisible();
  snapshot = await page.evaluate(() => window.serveo.snapshot());
  assert.equal(snapshot.user.role, 'cashier'); assert.equal(snapshot.products[0].stock, 20);
  assert.deepEqual(errors, []);
  console.log('Password desktop passed: owner Settings and cashier profile access, wrong current password, mismatch validation, cleared secret fields after failure, old login rejection, new login acceptance, restart persistence, unchanged shop data. Isolated database:', directory);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close().catch(() => {}); });
