import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printHTML } from '../src/main/printing';
import type { Shop, Order } from '../src/shared/types';

const shop: Shop = { name: '<script>alert(1)</script>', category: 'Cafe', phone: '123', address: 'Main road', currency: 'PKR', footer: 'Thank you', paperWidth: '80', logo: 'javascript:alert(1)' };
const order: Order = { id: '1', number: 42, createdAt: '2026-01-01T12:00:00Z', status: 'new', subtotal: 100, total: 100, paid: 100, change: 50, refunded: 0, createdBy: 'Owner', type: 'takeaway', table: '', customer: '<img src=x>', phone: '', address: '', rider: '', note: 'No salt', discount: 0, deliveryCharge: 0, paymentMethod: 'cash', cashReceived: 150, items: [{ productId: 'tea', quantity: 2, name: 'Tea <strong>', price: 50, note: 'No sugar' }] };

test('receipt escapes business and order text and excludes unsafe logos', () => {
  const html = printHTML(shop, order, 'receipt');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Tea &lt;strong&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('src="javascript:'));
  assert.ok(html.includes('Received: PKR 150.00'));
  assert.ok(html.includes('Change: PKR 50.00'));
});

test('kitchen ticket retains preparation notes and excludes all money', () => {
  const html = printHTML(shop, order, 'kitchen');
  assert.ok(html.includes('KITCHEN TICKET'));
  assert.ok(html.includes('No sugar'));
  assert.ok(html.includes('No salt'));
  assert.ok(!html.includes('PKR'));
  assert.ok(!html.includes('Collected:'));
});

test('all print formats retain service/customer identity and hide unrelated service fields',()=>{
 for(const type of ['delivery','dine-in','takeaway'] as const) for(const kind of ['receipt','kitchen','invoice'] as const){
  const o={...order,type,customer:'Named Customer',phone:'03001234567',address:'Delivery Street',rider:'Rider Ali',table:'7'};
  const html=printHTML(shop,o,kind);
  assert.ok(html.includes('Named Customer'));assert.ok(html.includes('03001234567'));
  assert.equal(html.includes('Delivery Street'),type==='delivery');assert.equal(html.includes('Rider Ali'),type==='delivery');assert.equal(html.includes('Table 7'),type==='dine-in');
 }
 for(const kind of ['receipt','kitchen','invoice'] as const){
  const html=printHTML(shop,{...order,type:'delivery',customer:''},kind);
  assert.ok(html.includes('Delivery customer'));assert.ok(!html.includes('Walk-in customer'));
 }
});
