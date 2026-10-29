import { customerLabel, serviceLabel } from '../shared/order-display';
import type { Snapshot, Product, Order, OrderInput, Shop, OrderStatus, PaymentMethod } from '../shared/types';
import './styles.css';
import './theme.css';
import sajjiPhoto from './assets/sajji.jpg';
import ricePhoto from './assets/biryani.jpg';
import bbqPhoto from './assets/bbq.jpg';
import drinksPhoto from './assets/drinks.jpg';
import fishPhoto from './assets/fish.jpg';
import { printHTML } from '../shared/printing';
let previewKind: 'receipt' | 'kitchen' | 'invoice' = 'receipt';

const root = document.querySelector<HTMLDivElement>('#app')!;
let state: Snapshot;
let page = 'dashboard', search = '', category = 'All', orderFilter = 'active';
let modal = '', selected = '', notice = '', success = '', busy = false;
let modalReturnAction = '';
let basket: OrderInput = newBasket();
let logo = '';
let productImage: string | undefined;
let productImageBusy = false;
let productImageRequest = 0;
let recoveryStage: '' | 'token' | 'password' = '';
let basketPage = 0, basketPageSize = 2;
let basketResize: ResizeObserver | undefined;
function newBasket(): OrderInput { return { items: [], type: 'takeaway', table: '', customer: '', phone: '', address: '', rider: '', note: '', discount: 0, deliveryCharge: 0, paymentMethod: 'cash', cashReceived: 0 }; }
const e = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: number) => `${e(state?.shop?.currency || 'PKR')} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: string) => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const owner = () => state.user?.role === 'owner';
const today = (d: string) => new Date(d).toDateString() === new Date().toDateString();
const button = (label: string, action: string, cls = 'button', extra = '') => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const field = (label: string, name: string, value: unknown = '', type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${e(value)}" ${extra}></label>`;
const select = (label: string, name: string, values: string[], current: string, labels = values) => `<label>${label}<select name="${name}">${values.map((v, i) => `<option value="${e(v)}" ${v === current ? 'selected' : ''}>${e(labels[i])}</option>`).join('')}</select></label>`;
const empty = (title: string, detail: string) => `<div class="empty"><span class="empty-mark">—</span><h3>${title}</h3><p>${detail}</p></div>`;
function formError() { return notice ? `<div class="notice error" role="alert">${e(notice)}</div>` : ''; }
function submit(label: string) { return `<button class="button primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : label}</button>`; }
function total() { return Math.max(0, basket.items.reduce((sum, item) => sum + (state.products.find(p => p.id === item.productId)?.price || 0) * item.quantity, 0) - basket.discount + basket.deliveryCharge); }
async function mutate(action: () => Promise<Snapshot | null>, message = '') {
  if (busy) return;
  const savedForms = [...root.querySelectorAll<HTMLFormElement>('form[data-form]')].map(form => ({ name: form.dataset.form, inputs: [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')].filter(input => input.type !== 'file' && (!['change-password','recovery-token','verify-recovery','reset-password'].includes(form.dataset.form || '') || input.type !== 'password')).map(input => ({ name: input.name, value: input.value, checked: input instanceof HTMLInputElement ? input.checked : false })) }));
  busy = true; notice = ''; document.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach(b => b.disabled = true);
  try { const next = await action(); if (next) state = next; modal = ''; if (message) success = message; }
  catch (err) { notice = (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  finally { busy = false; render(); if (notice) savedForms.forEach(saved => { const form = [...root.querySelectorAll<HTMLFormElement>('form[data-form]')].find(f => f.dataset.form === saved.name); saved.inputs.forEach(input => { const target = form?.elements.namedItem(input.name); if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) { target.value = input.value; if (target instanceof HTMLInputElement) target.checked = input.checked; } }); }); }
}
function shopFields(shop?: Shop | null) {
  return `<div class="form-grid">${field('Shop name', 'name', shop?.name, 'text', 'required maxlength="120"')}${select('Business category', 'category', ['Restaurant', 'BBQ shop', 'Fast food', 'Café', 'Bakery', 'Other'], shop?.category || 'Restaurant')}${field('Contact number', 'phone', shop?.phone, 'tel')}${field('Currency code', 'currency', shop?.currency || 'PKR', 'text', 'required maxlength="8"')}${field('Address', 'address', shop?.address)}${select('Receipt paper', 'paperWidth', ['80', '58', 'A4'], shop?.paperWidth || '80', ['80 mm thermal', '58 mm thermal', 'A4'])}<label class="full">Receipt footer<input name="footer" value="${e(shop?.footer || 'Thank you for your visit!')}" maxlength="200"></label><label class="full">Shop logo <span class="muted">Optional · PNG or JPEG, up to 1 MB</span><input type="file" name="logo" accept="image/png,image/jpeg"></label></div>`;
}
function recoveryOption() {
  return `<details class="recovery-option"><summary>Add a recovery token (optional)</summary>${field('Recovery token', 'recoveryToken', '', 'password', 'minlength="12" maxlength="200" autocomplete="off"')}<p class="hint">Choose a private phrase of 12–200 characters, different from your password. Remember it or keep it somewhere safe: it can reset your password if you forget it.</p></details>`;
}
function auth() {
  if (state.shop && recoveryStage) {
    const verify = recoveryStage === 'token';
    root.innerHTML = `<main class="auth recovery-auth"><aside class="auth-brand"><div class="wordmark">s<span>erveo</span><i></i></div><div><span class="eyebrow">ACCOUNT RECOVERY</span><h1>Back to<br>business.</h1><p>Your recovery token helps you get back into your account.</p></div><span class="small">SERVEO / DESKTOP</span></aside><section class="auth-content"><div class="auth-form"><span class="eyebrow">${verify ? 'STEP 1 OF 2' : 'STEP 2 OF 2'}</span><h2>${verify ? 'Forgot your password?' : 'Set a new password.'}</h2><p class="muted">${verify ? 'Enter your username and the latest recovery token you set for this account.' : 'Your token is verified. Choose a new password within five minutes.'}</p>${formError()}<form data-form="${verify ? 'verify-recovery' : 'reset-password'}">${verify ? `${field('Username', 'username', '', 'text', 'required autocomplete="username"')}${field('Recovery token', 'recoveryToken', '', 'password', 'required maxlength="200" autocomplete="off"')}` : `${field('New password', 'newPassword', '', 'password', 'required minlength="8" maxlength="200" autocomplete="new-password"')}${field('Confirm new password', 'confirmPassword', '', 'password', 'required minlength="8" maxlength="200" autocomplete="new-password"')}`}${submit(verify ? 'Verify token' : 'Reset password & sign in')}</form>${button('Back to sign in', 'back-login', 'text-button')}<p class="hint">${verify ? 'Recovery works only if you previously saved a token for this account.' : 'Your business records will stay as they are.'}</p></div></section></main>`;
    return;
  }

  const setup = !state.shop;
  root.innerHTML = `<main class="auth"><aside class="auth-brand"><div class="wordmark">s<span>erveo</span><i></i></div><div><span class="eyebrow">MADE FOR YOUR EVERYDAY</span><h1>Keep business<br>moving.</h1><p>From the first order to the last receipt.<br>Your shop, together in one place.</p><div class="auth-line"></div><p class="small">Works offline. Stays on your computer.</p></div><span class="small">SERVEO / DESKTOP</span></aside><section class="auth-content"><div class="auth-form ${setup ? 'wide' : ''}"><span class="eyebrow">${setup ? 'A FRESH START' : 'WELCOME BACK'}</span><h2>${setup ? 'Make yourself at home.' : `Let’s open ${e(state.shop?.name)}.`}</h2><p class="muted">${setup ? 'Set up your shop and create your private owner account.' : 'Sign in to start your working day.'}</p>${formError()}<form data-form="${setup ? 'setup' : 'login'}">${setup ? `${shopFields()}<h3>Your owner account</h3><div class="form-grid">${field('Your name', 'ownerName', '', 'text', 'required')}${field('Username', 'username', '', 'text', 'required autocomplete="username"')}${field('Password', 'password', '', 'password', 'required minlength="8" autocomplete="new-password"')}<p class="hint">Use at least 8 characters. Keep this password safe; records live on this computer.</p></div>` : `${field('Username', 'username', '', 'text', 'required autocomplete="username"')}${field('Password', 'password', '', 'password', 'required autocomplete="current-password"')}`}${setup ? recoveryOption() : ''}${submit(setup ? 'Create my shop' : 'Sign in')} </form>${!setup ? button('Forgot password?', 'forgot-password', 'text-button forgot-password') : ''}<p class="hint">${setup ? 'No demo business or menu will be added. You’re starting with a clean shop.' : `Serveo ${e(state.version)} · Local desktop workspace`}</p></div></section></main>`;
}
const nav = [['dashboard', 'Overview'], ['pos', 'New sale'], ['orders', 'Orders'], ['products', 'Menu & stock'], ['expenses', 'Cash & expenses'], ['reports', 'Reports'], ['settings', 'Settings']];
const navPaths: Record<string, string> = {
 dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 pos: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="10"/>',
 orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
 products: '<path d="M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4"/>',
 expenses: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M16 14h2"/>',
 reports: '<path d="M4 3v18h17M8 16v-4M13 16V8M18 16V5"/>',
 settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
};
const navIcon = (id: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${navPaths[id]}</svg>`;
function render() {
  if (!state) return;
  basketResize?.disconnect();
  const focusBefore = document.activeElement as HTMLElement | null;
  if (modal && focusBefore?.dataset.action && !focusBefore.closest('.modal')) modalReturnAction = focusBefore.dataset.action;
  root.classList.toggle('pos-active', page === 'pos' && !!state.user);
  if (!state.shop || !state.user) return auth();
  if (!owner() && ['products', 'reports', 'settings'].includes(page)) page = 'dashboard';
  root.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="wordmark">s<span>erveo</span><i></i></div><div class="shop-identity"><div class="shop-avatar">${state.shop.logo ? `<img src="${e(state.shop.logo)}" alt="Shop logo">` : e(state.shop.name.slice(0, 1))}</div><div><strong>${e(state.shop.name)}</strong><span>${e(state.shop.category)}</span></div></div><span class="nav-caption">YOUR WORKSPACE</span><nav>${nav.filter(([id]) => owner() || !['products', 'reports', 'settings'].includes(id)).map(([id, name]) => button(`<span class="nav-icon" aria-hidden="true">${navIcon(id)}</span>${name}${id === 'orders' ? `<span class="nav-count">${state.orders.filter(o => !['completed', 'cancelled'].includes(o.status)).length}</span>` : ''}`, `nav:${id}`, `nav-item ${page === id ? 'active' : ''}`)).join('')}</nav><div class="sidebar-bottom"><span class="offline"><i></i> Offline & on your computer</span><div class="user-card"><span class="user-avatar">${e(state.user.name.slice(0, 1))}</span><button type="button" class="user-identity" data-action="change-password" title="Change password" aria-label="Change password for ${e(state.user.name)}"><strong>${e(state.user.name)}</strong><span>${e(state.user.role)}</span></button>${button('↪', 'logout', 'logout', 'aria-label="Sign out" title="Sign out"')}</div></div></aside><main class="workspace"><header class="topbar"><span>${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span><div class="topbar-right"><span class="day-state ${state.closing && !state.closing.closedAt ? 'open' : ''}"><i></i>${state.closing && !state.closing.closedAt ? 'Cash drawer open' : 'Cash drawer closed'}</span>${button(state.closing && !state.closing.closedAt ? 'View drawer' : 'Open day', 'day', 'button small-button')}</div></header><div class="page-content">${notice ? `<div class="notice error" role="alert">${e(notice)}${button('Dismiss', 'dismiss', 'text-button')}</div>` : ''}${success ? `<div class="notice good" role="status">${e(success)}${button('Dismiss', 'dismiss', 'text-button')}</div>` : ''}${page === 'dashboard' ? dashboard() : page === 'pos' ? pos() : page === 'orders' ? orders() : page === 'products' ? products() : page === 'expenses' ? expenses() : page === 'reports' ? reports() : settings()}</div></main></div>${modal ? modalView() : ''}`;
  const lines = root.querySelector<HTMLElement>('.basket-lines');
  if (lines) {
    basketResize = new ResizeObserver(([entry]) => {
      const size = Math.max(1, Math.floor(entry.contentRect.height / 88));
      if (size !== basketPageSize) { basketPageSize = size; render(); }
    });
    basketResize.observe(lines);
  }
  if (modal) queueMicrotask(() => root.querySelector<HTMLElement>('.modal input, .modal select, .modal button')?.focus());
  else if (modalReturnAction) { const action = modalReturnAction; modalReturnAction = ''; queueMicrotask(() => [...root.querySelectorAll<HTMLButtonElement>('[data-action]')].find(b => b.dataset.action === action)?.focus()); }
}
function heading(eyebrow: string, title: string, description: string, action = '') { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
function stats(items: [string, string, string][]) { return `<div class="stats">${items.map(([label, value, foot]) => `<article class="stat"><span>${label}</span><strong>${value}</strong><small>${foot}</small></article>`).join('')}</div>`; }
function dashboard() {
  const orders = state.orders.filter(o => today(o.createdAt) && o.status !== 'cancelled');
  const active = state.orders.filter(o => !['cancelled', 'completed'].includes(o.status));
  return `${heading('THE BIG PICTURE', `Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${e(state.user!.name.split(' ')[0])}.`, 'Here’s how your shop is doing today.', button('+ New sale', 'nav:pos', 'button primary'))}${stats([['Today’s sales', money(orders.reduce((s, o) => s + o.total - o.refunded, 0)), `${orders.length} orders placed today`], ['In the kitchen', String(active.length), 'Orders still in progress'], ['Outstanding balance', money(state.orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + Math.max(0, o.total - o.paid), 0)), 'Across all unpaid orders'], ['Expected drawer cash', money(state.closing?.expectedCash || 0), state.closing && !state.closing.closedAt ? 'Includes opening cash and movements' : 'Open a day to track your drawer']])}<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Live orders</h2><p>Keep every order moving.</p></div>${button('View all →', 'nav:orders', 'text-button')}</div>${active.length ? orderRows(active.slice(0, 6)) : empty('A clear counter.', 'New orders will appear here as they come in.')}</section><aside class="panel start-panel"><span class="eyebrow">READY FOR THE DAY</span><h2>Small steps.<br>Smoother service.</h2><p>${state.products.length ? 'Your menu is ready. Open the drawer, then take your first order.' : 'Add your menu to start taking orders. Each size can have its own price.'}</p>${owner() ? button('Manage menu →', 'nav:products', 'button') : button('Take an order →', 'nav:pos', 'button')}<div class="divider"></div><h3>Low stock</h3>${state.products.filter(p => p.active && p.trackStock && p.stock <= 5).slice(0, 5).map(p => `<div class="stock-line"><span>${e(p.name)} ${e(p.variant)}</span><strong>${p.stock} left</strong></div>`).join('') || '<p class="muted small">No low-stock items to flag.</p>'}</aside></div>`;
}
function basketRow(i: OrderInput['items'][number], index: number) {
  const p = state.products.find(p => p.id === i.productId);
  return `<div class="basket-item"><div><strong title="${e(p?.name)}">${e(p?.name)}</strong><small>${e(p?.variant || 'Regular')} · ${money(p?.price || 0)}</small><input class="item-note" aria-label="Kitchen note for ${e(p?.name)}" placeholder="Kitchen note…" data-note="${index}" value="${e(i.note)}"></div><div class="quantity">${button('−', `qty:${index}:-1`, '', 'aria-label="Remove one"')}<span>${i.quantity}</span>${button('+', `qty:${index}:1`, '', 'aria-label="Add one"')}</div></div>`;
}
function pos() {
  const categories = ['All', ...new Set(state.products.filter(p => p.active).map(p => p.category))];
  const list = state.products.filter(p => p.active && (category === 'All' || p.category === category) && `${p.name} ${p.variant}`.toLowerCase().includes(search.toLowerCase()));
  basketPage = Math.max(0, Math.min(basketPage, Math.ceil(basket.items.length / basketPageSize) - 1));
  const start = basketPage * basketPageSize;
  const summary = [basket.customer, basket.type === 'dine-in' && basket.table ? 'Table ' + basket.table : '', basket.type === 'delivery' && basket.address ? basket.address : ''].filter(Boolean).join(' · ');
  return `${heading('POINT OF SALE', 'New order.', 'Select your menu items and take payment.')}<div class="pos-layout"><section class="catalog"><div class="search-wrap"><span aria-hidden="true">⌕</span><input id="product-search" type="search" aria-label="Search menu" placeholder="Search your menu…" value="${e(search)}"></div><div class="chips">${categories.map(c => button(e(c), 'category', `chip ${category === c ? 'selected' : ''}`, `data-value="${e(c)}"`)).join('')}</div><div class="product-grid" id="product-grid">${productCards(list)}</div></section><aside class="panel basket"><div class="panel-heading"><div><span class="eyebrow">CURRENT ORDER</span><h2>Your order <span class="count">${basket.items.reduce((n, i) => n + i.quantity, 0)}</span></h2></div>${basket.items.length ? button('Clear', 'clear-basket', 'text-button') : ''}</div><form data-form="sale"><div class="segmented">${['takeaway', 'dine-in', 'delivery'].map(t => button(t === 'dine-in' ? 'Dine-in' : t[0].toUpperCase() + t.slice(1), `type:${t}`, basket.type === t ? 'selected' : '')).join('')}</div>${button(`<span>Order details <small>${e(summary || 'Customer, extras & notes')}</small></span><span aria-hidden="true">↗</span>`, 'basket-details', 'order-details-button')}<div class="basket-lines">${basket.items.length ? basket.items.slice(start, start + basketPageSize).map((i, offset) => basketRow(i, start + offset)).join('') : '<div class="basket-empty"><strong>No items yet</strong><p>Choose items from the menu.</p></div>'}</div><div class="basket-pager" aria-label="Order item pages">${button('Previous', 'basket-prev', 'text-button', basketPage === 0 ? 'disabled' : '')}<span aria-live="polite">${basket.items.length ? `${start + 1}–${Math.min(start + basketPageSize, basket.items.length)} of ${basket.items.length} items` : 'Your order is empty'}</span>${button('Next', 'basket-next', 'text-button', start + basketPageSize >= basket.items.length ? 'disabled' : '')}</div><div class="basket-payment"><div class="total-row"><span>Total to pay</span><strong id="basket-total">${money(total())}</strong></div>${select('Payment method', 'paymentMethod', ['cash', 'card', 'bank', 'unpaid'], basket.paymentMethod, ['Cash', 'Card', 'Bank transfer', 'Unpaid / customer credit'])}<div id="cash-field" ${basket.paymentMethod === 'cash' ? '' : 'hidden'}>${field('Cash received', 'cashReceived', basket.cashReceived || '', 'number', 'min="0" step="0.01"')}<div class="change-row">Change <strong id="change-total">${money(Math.max(0, basket.cashReceived - total()))}</strong></div></div>${!state.closing || state.closing.closedAt ? '<p class="hint">Open the cash drawer before placing an order.</p>' : ''}<button type="submit" class="button primary checkout" ${!basket.items.length || !state.closing || !!state.closing.closedAt ? 'disabled' : ''}>Place order <span>→</span></button></div></form></aside></div>`;
}
const productPhoto = (p: Product) => {
  if (p.image !== undefined) return p.image;
  const category = p.category.toLowerCase();
  if (/fish/.test(category)) return fishPhoto;
  if (/bbq|platter/.test(category)) return bbqPhoto;
  if (/drink/.test(category)) return drinksPhoto;
  if (/rice/.test(category)) return ricePhoto;
  if (/sajji|main menu/.test(category)) return sajjiPhoto;
  return '';
};
function productCards(list: Product[]) { return list.length ? list.map((p, i) => {
  const photo = productPhoto(p);
  return `<button type="button" class="product-card" data-action="add:${e(p.id)}" ${p.trackStock && p.stock <= 0 ? 'disabled' : ''}><div class="product-art art-${i % 4} ${photo ? 'with-photo' : ''}">${photo ? `<img src="${photo}" alt="" loading="lazy">` : `<span>${e(p.name.slice(0, 2).toUpperCase())}</span>`}<i aria-hidden="true">+</i></div><div class="product-card-body"><span class="product-category">${e(p.category)}</span><h3>${e(p.name)}</h3><span class="variant">${e(p.variant || 'Regular')}</span><div><strong>${money(p.price)}</strong><small>${p.trackStock ? `${p.stock} left` : 'Available'}</small></div></div></button>`;
}).join('') : empty('Your menu starts here.', owner() ? 'Add products in Menu & stock, or try another search.' : 'Ask your owner to add menu items, or try another search.'); }
function orderRows(list: Order[]) { return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer / service</th><th>Status</th><th>Payment</th><th class="align-right">Total</th><th></th></tr></thead><tbody>${list.map(o => `<tr><td><strong>#${o.number}</strong><small>${date(o.createdAt)}</small></td><td>${e(customerLabel(o))}<small>${e(serviceLabel(o.type))}${o.table ? ` · Table ${e(o.table)}` : ''}</small></td><td><span class="badge ${o.status}">${e(o.status)}</span></td><td><span class="payment-state ${o.paid >= o.total ? 'paid' : ''}">${o.refunded ? 'Refunded' : o.paid >= o.total ? 'Paid' : 'Unpaid'}</span><small>${e(o.paymentMethod)}</small></td><td class="align-right"><strong>${money(o.total)}</strong></td><td>${button('View →', `order:${e(o.id)}`, 'text-button')}</td></tr>`).join('')}</tbody></table></div>`; }
function orders() {
  const list = state.orders.filter(o => orderFilter === 'all' || (orderFilter === 'active' ? !['completed', 'cancelled'].includes(o.status) : orderFilter === 'unpaid' ? o.paid < o.total && o.status !== 'cancelled' : o.status === orderFilter));
  return `${heading('KITCHEN & COUNTER', 'Every order, in order.', 'Preparation and payment are tracked separately.', button('+ New sale', 'nav:pos', 'button primary'))}<div class="chips">${['active', 'all', 'new', 'preparing', 'ready', 'completed', 'unpaid', 'cancelled'].map(v => button(v[0].toUpperCase() + v.slice(1), `filter:${v}`, `chip ${orderFilter === v ? 'selected' : ''}`)).join('')}</div><section class="panel">${list.length ? orderRows(list) : empty('Nothing waiting here.', 'Orders matching this filter will appear here.')}</section>`;
}
function products() {
  return `${heading('YOUR MENU', 'Made for your counter.', 'Manage prices, sizes, and the stock you sell.', button('+ Add menu item', 'new-product', 'button primary'))}<section class="panel">${state.products.length ? `<div class="table-wrap"><table><thead><tr><th>Menu item</th><th>Category</th><th>Price</th><th>Stock</th><th>Visibility</th><th></th></tr></thead><tbody>${state.products.map(p => `<tr><td><strong>${e(p.name)}</strong><small>${e(p.variant || 'Regular')}</small></td><td>${e(p.category)}</td><td>${money(p.price)}</td><td>${p.trackStock ? `<span class="${p.stock <= 5 ? 'low' : ''}">${p.stock} available</span>` : 'Not tracked'}</td><td><span class="badge ${p.active ? 'ready' : 'cancelled'}">${p.active ? 'On menu' : 'Archived'}</span></td><td>${button('Edit →', `product:${e(p.id)}`, 'text-button')}</td></tr>`).join('')}</tbody></table></div>` : empty('A menu of your own.', 'Add your first item. Create a separate item for each size or variant.')}</section>`;
}
function expenses() {
  return `${heading('DAILY OPERATIONS', 'Make the numbers meet.', 'Track cash expenses and reconcile the drawer at closing.', owner() ? button('+ Record expense', 'new-expense', 'button primary') : '')}<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Expense book</h2><p>Expenses are paid from your cash drawer.</p></div></div>${state.expenses.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="align-right">Amount</th></tr></thead><tbody>${state.expenses.map(x => `<tr><td>${date(x.date)}</td><td><strong>${e(x.category)}</strong></td><td>${e(x.note || '—')}</td><td class="align-right">${money(x.amount)}</td></tr>`).join('')}</tbody></table></div>` : empty('Everything accounted for.', 'Record cash paid for supplies, utilities, or other daily expenses.')}</section><aside class="panel drawer-panel"><span class="eyebrow">CASH DRAWER</span><h2>${state.closing && !state.closing.closedAt ? 'Your day is open.' : 'Ready when you are.'}</h2>${state.closing ? `<dl><div><dt>Opened</dt><dd>${date(state.closing.openedAt)}</dd></div><div><dt>Opening cash</dt><dd>${money(state.closing.openingCash)}</dd></div><div><dt>Expected cash</dt><dd>${money(state.closing.expectedCash)}</dd></div>${state.closing.closedAt ? `<div><dt>Counted cash</dt><dd>${money(state.closing.countedCash || 0)}</dd></div><div><dt>Difference</dt><dd>${money(state.closing.difference || 0)}</dd></div>` : ''}</dl>` : '<p>Add the cash already in your drawer before taking your first order.</p>'}${button(state.closing && !state.closing.closedAt ? owner() ? 'Close & reconcile day' : 'View cash drawer' : 'Open a new day', 'day', 'button primary')}</aside></div>`;
}
function reports() {
  const all = state.orders.filter(o => o.status !== 'cancelled');
  const sales = all.reduce((s, o) => s + o.total - o.refunded, 0), collections = all.reduce((s, o) => s + o.paid - o.refunded, 0);
  const best = new Map<string, { qty: number; sales: number }>();
  all.filter(o => !o.refunded).forEach(o => o.items.forEach(i => { const key = i.name || state.products.find(p => p.id === i.productId)?.name || 'Menu item'; const old = best.get(key) || { qty: 0, sales: 0 }; best.set(key, { qty: old.qty + i.quantity, sales: old.sales + i.quantity * (i.price || 0) }); }));
  return `${heading('BUSINESS REPORTS', 'A clearer view of business.', 'All-time totals from your recorded transactions. Sales and collections are separate.')}${stats([['Net sales', money(sales), 'Orders less recorded refunds'], ['Net collections', money(collections), 'Payments received less refunds'], ['Outstanding', money(Math.max(0, sales - collections)), 'Customer balances still to collect'], ['Recorded expenses', money(state.expenses.reduce((s, x) => s + x.amount, 0)), 'Cash expenses · not a profit estimate']])}<div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Best-selling items</h2><p>Quantity sold, excluding fully refunded orders.</p></div></div>${best.size ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th class="align-right">Units sold</th><th class="align-right">Item sales</th></tr></thead><tbody>${[...best].sort((a, b) => b[1].qty - a[1].qty).slice(0, 10).map(([name, x]) => `<tr><td>${e(name)}</td><td class="align-right">${x.qty}</td><td class="align-right">${money(x.sales)}</td></tr>`).join('')}</tbody></table></div>` : empty('Your story is still starting.', 'Your best sellers will appear after your first sale.')}</section><aside class="panel drawer-panel"><span class="eyebrow">COLLECTIONS BY METHOD</span><h2>How customers pay.</h2><dl>${(['cash', 'card', 'bank'] as const).map(m => `<div><dt>${m === 'bank' ? 'Bank transfer' : m[0].toUpperCase() + m.slice(1)}</dt><dd>${money(all.filter(o => o.paymentMethod === m).reduce((s, o) => s + o.paid - o.refunded, 0))}</dd></div>`).join('')}</dl><p class="hint">Collections can include payments for older orders. Unpaid orders contribute to sales and outstanding balances, never to cash received.</p></aside></div>`;
}
function settings() {
  return `${heading('MAKE IT YOURS', 'Your shop. Your settings.', 'Business identity, team access, and local backups.')}<div class="settings-grid"><section class="panel padded"><h2>Shop & receipts</h2><p class="muted">These details appear on your printed receipts.</p><form data-form="shop">${shopFields(state.shop)}${submit('Save shop details')}</form></section><div><section class="panel padded account-panel"><h2>Your account</h2><p class="muted">Signed in as <strong>${e(state.user!.username)}</strong>. Change your password using your current password.</p><div class="button-row">${button('Change password', 'change-password', 'button')}</div></section><section class="panel padded"><h2>Back up your business</h2><p class="muted">Export a database copy to another drive regularly. Restoring replaces the current records.</p><div class="button-row">${button('Export backup', 'export', 'button primary')}${button('Restore backup', 'restore', 'button')}</div><p class="hint">Automatic local backups are managed by the desktop app. Exported backups contain your shop’s records and accounts.</p><details><summary>Local data location</summary><code>${e(state.dataPath)}</code></details></section><section class="panel padded team-panel"><div class="panel-heading"><h2>Your team</h2>${button('+ Add cashier', 'new-user', 'text-button')}</div>${state.users.map(u => `<div class="team-member"><span class="user-avatar">${e(u.name[0])}</span><div><strong>${e(u.name)}</strong><small>${e(u.username)}</small></div><span class="badge">${e(u.role)}</span></div>`).join('')}<p class="hint">Cashiers can take orders, receive payments, update preparation status, and open the cash drawer. Owners also control expenses, closing, discounts, refunds, menu, reports, and settings.</p></section><p class="hint">Serveo ${e(state.version)} · Built for one shop, one computer.</p></div></div>`;
}
function modalView() {
  let title = '', body = '';
  if (modal === 'basket-details') {
    title = 'Order details';
    body = `<form data-form="basket-details"><div class="form-grid">${field('Customer name', 'customer', basket.customer, 'text', basket.paymentMethod === 'unpaid' || basket.type === 'delivery' ? 'required' : '')}${field('Phone', 'phone', basket.phone, 'tel', basket.type === 'delivery' ? 'required' : '')}${basket.type === 'dine-in' ? field('Table number', 'table', basket.table, 'text', 'required') : ''}${basket.type === 'delivery' ? `${field('Delivery address', 'address', basket.address, 'text', 'required')}${field('Rider name', 'rider', basket.rider)}` : ''}${field('Discount', 'discount', basket.discount, 'number', `min="0" step="0.01" ${!owner() ? 'disabled' : ''}`)}${basket.type === 'delivery' ? field('Delivery charge', 'deliveryCharge', basket.deliveryCharge, 'number', 'min="0" step="0.01"') : ''}<label class="full">Order instructions<textarea name="note" rows="2" placeholder="Allergies, preparation instructions…">${e(basket.note)}</textarea></label></div><div class="details-footer">${submit('Save details')}</div></form>`;
  } else if (modal === 'product') {
    const p = state.products.find(p => p.id === selected);
    title = p ? 'Edit menu item' : 'Add to your menu';
    body = `<form data-form="product"><div class="product-image-editor"><div id="product-image-preview">${(productImage === undefined ? (p ? productPhoto(p) : '') : productImage) ? `<img src="${e(productImage === undefined ? productPhoto(p!) : productImage)}" alt="Product image preview">` : '<span>No product image</span>'}</div><div><label>Product image<input type="file" name="productImage" accept="image/png,image/jpeg,image/webp"></label><p class="hint">Choose a PNG, JPG or WebP up to 8 MB. Saved offline with this item.</p>${button('Remove image', 'remove-product-image', 'button small-button')}<p id="product-image-error" class="low" role="status"></p></div></div><div class="form-grid">${field('Item name', 'name', p?.name, 'text', 'required')}${field('Category', 'category', p?.category || 'Main menu', 'text', 'required')}${field('Size / variant', 'variant', p?.variant, 'text', 'placeholder="e.g. Full, Large, Regular"')}${field('Selling price', 'price', p?.price ?? '', 'number', 'required min="0" step="0.01"')}${field('Stock quantity', 'stock', p?.stock || 0, 'number', 'required min="0" step="1"')}<label class="checkbox"><input name="trackStock" type="checkbox" ${p?.trackStock ? 'checked' : ''}> Track and deduct stock</label><label class="checkbox full"><input name="active" type="checkbox" ${!p || p.active ? 'checked' : ''}> Show this item on the menu</label></div><p class="hint">For sizes or variants, add each one as its own menu item. Uncheck visibility to archive an item without changing past orders.</p>${submit('Save menu item')}</form>`;
  } else if (modal === 'expense') {
    title = 'Record a cash expense'; body = `<form data-form="expense">${field('Category', 'category', '', 'text', 'required placeholder="e.g. Utilities, supplies, wages"')}${field('Amount paid', 'amount', '', 'number', 'required min="0.01" step="0.01"')}${field('Note', 'note', '', 'text', 'placeholder="What was this payment for?"')}${submit('Record expense')}</form>`;
  } else if (modal === 'day') {
    const closing = state.closing && !state.closing.closedAt;
    title = closing ? owner() ? 'Close & reconcile your day' : 'Your cash drawer' : 'Open your cash drawer';
    body = `<p class="muted">${closing ? owner() ? 'Count the cash in your drawer. Serveo will record any difference.' : 'Your owner can close and reconcile this drawer at the end of the day.' : 'Enter the cash already in your drawer before today’s trading.'}</p>${closing ? `<div class="summary-total"><span>Expected cash</span><strong>${money(state.closing!.expectedCash)}</strong></div>` : ''}${!closing || owner() ? `<form data-form="${closing ? 'close-day' : 'open-day'}">${field(closing ? 'Counted cash' : 'Opening cash', 'cash', '', 'number', 'required min="0" step="0.01"')}${submit(closing ? 'Close day' : 'Open day')}</form>` : ''}`;
  } else if (modal === 'change-password') {
    title = 'Change password';
    body = `<p class="muted">Update the password for <strong>${e(state.user!.username)}</strong>. You will stay signed in.</p><form data-form="change-password">${field('Current password', 'currentPassword', '', 'password', 'required maxlength="200" autocomplete="current-password"')}${field('New password', 'newPassword', '', 'password', 'required minlength="8" maxlength="200" autocomplete="new-password"')}${field('Confirm new password', 'confirmPassword', '', 'password', 'required minlength="8" maxlength="200" autocomplete="new-password"')}<p class="hint">Use 8?200 characters and choose a different password from your current one.</p>${submit('Update password')}</form><div class="account-recovery-box"><h3>Recovery token</h3><p class="hint">${state.user?.recoveryEnabled ? 'A recovery token is set. Only your latest saved token can reset this account.' : 'No token is set yet. Add one so you can recover this account if you forget your password.'}</p>${button(state.user?.recoveryEnabled ? 'Replace recovery token' : 'Set recovery token', 'recovery-token', 'button')}</div>`;
  } else if (modal === 'recovery-token') {
    title = state.user?.recoveryEnabled ? 'Replace recovery token' : 'Set recovery token';
    body = `<p class="muted">Choose a private token and remember it. Replacing it makes the previous token stop working.</p><form data-form="recovery-token">${field('Current password', 'currentPassword', '', 'password', 'required maxlength="200" autocomplete="current-password"')}${field('New recovery token', 'recoveryToken', '', 'password', 'required minlength="12" maxlength="200" autocomplete="off"')}${field('Confirm recovery token', 'confirmToken', '', 'password', 'required minlength="12" maxlength="200" autocomplete="off"')}<p class="hint">Use 12–200 characters, different from your password. Keep this token safe; it can reset your password.</p>${submit('Save recovery token')}</form>`;
  } else if (modal === 'user') {
    title = 'Add a team member'; body = `<form data-form="user">${field('Full name', 'name', '', 'text', 'required')}${field('Username', 'username', '', 'text', 'required autocomplete="off"')}${field('Password', 'password', '', 'password', 'required minlength="8" autocomplete="new-password"')}${select('Role', 'role', ['cashier', 'owner'], 'cashier', ['Cashier', 'Owner'])}${recoveryOption()}${submit('Create account')}</form>`;
  } else if (modal === 'order') {
    const o = state.orders.find(o => o.id === selected)!;
    title = `Order #${o.number}`;
    body = `<div class="order-print-toolbar"><span>Preview & print</span><div class="button-row">${button('Receipt', 'print:receipt')}${button('Kitchen ticket', 'print:kitchen')}${button('A4 invoice', 'print:invoice')}</div></div><div class="order-meta"><span class="badge ${o.status}">${e(o.status)}</span><span>${date(o.createdAt)}</span><span>${e(serviceLabel(o.type))}${o.table ? ` · Table ${e(o.table)}` : ''}</span></div><h3>${e(customerLabel(o))}</h3><p class="muted">${[o.phone, o.type === 'delivery' ? o.address : '', o.type === 'delivery' && o.rider ? 'Rider: ' + o.rider : ''].filter(Boolean).map(e).join('<br>')}</p>${o.note ? `<div class="kitchen-note"><strong>Kitchen instructions</strong><p>${e(o.note)}</p></div>` : ''}<div class="receipt-items">${o.items.map(i => `<div><span><strong>${i.quantity} × ${e(i.name || state.products.find(p => p.id === i.productId)?.name)}</strong>${i.note ? `<small>${e(i.note)}</small>` : ''}</span><span>${money((i.price || 0) * i.quantity)}</span></div>`).join('')}</div>${o.stockDisposition ? `<p class="hint">Refund stock: ${o.stockDisposition === 'return' ? 'Returned deducted quantities' : 'No stock return / wastage'}</p>` : ''}<dl class="order-totals"><div><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd></div><div><dt>Discount</dt><dd>− ${money(o.discount)}</dd></div><div><dt>Delivery</dt><dd>${money(o.deliveryCharge)}</dd></div><div class="grand"><dt>Total</dt><dd>${money(o.total)}</dd></div><div><dt>Received · ${e(o.paymentMethod)}</dt><dd>${money(o.paid)}</dd></div>${o.paymentMethod === 'cash' && o.paid ? `<div><dt>Cash tendered / change</dt><dd>${money(o.cashReceived)} / ${money(o.change)}</dd></div>` : ''}${o.refunded ? `<div><dt>Refunded</dt><dd>${money(o.refunded)}</dd></div>` : ''}</dl>${o.status !== 'cancelled' && !o.refunded ? `<div class="divider"></div>${o.status !== 'completed' ? `<form data-form="status" class="inline-form">${select('Preparation status', 'status', ['new', 'preparing', 'ready', 'completed'], o.status)}${submit('Update status')}</form>` : ''}${o.paid < o.total ? `<form data-form="payment"><h3>Collect outstanding payment</h3><p class="muted">Balance: ${money(o.total - o.paid)}</p><div class="form-grid">${select('Payment method', 'method', ['cash', 'card', 'bank'], 'cash', ['Cash', 'Card', 'Bank transfer'])}${field('Cash received (for cash)', 'cashReceived', '', 'number', 'min="0" step="0.01"')}</div>${submit('Collect payment')}</form>` : ''}${owner() ? `<details class="danger-zone"><summary>${o.paid > 0 ? 'Refund this order' : 'Cancel this order'}</summary>${o.paid > 0 ? `<form data-form="refund">${field('Reason for full refund', 'reason', '', 'text', 'required')}${select('Stock handling', 'stockDisposition', ['waste', 'return'], 'waste', ['No stock return / wastage', 'Return deducted quantities to stock'])}<button type="submit" class="button danger">Refund ${money(o.paid)} & cancel</button><p class="hint">Choose stock return only for items that can be sold again. Older orders without deduction history require manual stock review.</p></form>` : button('Cancel this unpaid order', 'cancel-order', 'button danger') + (o.items.some(i => i.stockDeducted === undefined) ? '<p class="hint">This older order has no stock deduction history. Cancellation will not return stock automatically; review and adjust quantities manually.</p>' : '')}</details>` : ''}` : ''}`;
  } else if (modal === 'preview') {
    const order = state.orders.find(o => o.id === selected)!;
    title = `Print preview · Order #${order.number}`;
    const format = previewKind === 'invoice' ? 'A4 invoice' : previewKind === 'kitchen' ? 'Kitchen ticket' : 'Receipt';
    body = `<div class="preview-controls"><div class="button-row">${(['receipt', 'kitchen', 'invoice'] as const).map(kind => button(kind === 'invoice' ? 'A4 invoice' : kind === 'kitchen' ? 'Kitchen ticket' : 'Receipt', 'preview:' + kind, `button ${kind === previewKind ? 'selected' : ''}`, `aria-pressed="${kind === previewKind}"`)).join('')}</div><span class="hint">${previewKind === 'invoice' ? 'A4' : state.shop!.paperWidth === 'A4' ? 'A4' : state.shop!.paperWidth + ' mm'} paper · Printer margins may vary</span></div><iframe class="print-preview-frame" title="${format} preview" sandbox="" srcdoc="${e(printHTML(state.shop!, order, previewKind))}"></iframe><footer class="preview-footer">${button('Back to order', 'back-order')}${button('Print…', 'print-now', 'button primary')}</footer>`;
  } else if (modal === 'restore') {
    title = 'Restore a saved backup'; body = `<p>Restoring replaces this shop’s current records and accounts with the selected backup. Export a current backup first if you want to keep a separate copy.</p><p class="hint">A recovery copy is saved automatically before restoring.</p>${button('Choose backup & restore', 'confirm-restore', 'button danger')}`;
  } else if (modal === 'clear') {
    title = 'Clear this unsaved order?'; body = `<p>Your current basket will be cleared.</p>${button('Clear order', 'confirm-clear', 'button danger')}`;
  }
  return `<div class="modal-overlay"><section class="modal ${modal === 'order' ? 'order-modal' : modal === 'preview' ? 'preview-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${title}</h2>${button('×', 'close-modal', 'close-button', 'aria-label="Close dialog"')}</header>${formError()}${body}</section></div>`;
}
function readShop(data: FormData): Shop { return { name: String(data.get('name')), category: String(data.get('category')), phone: String(data.get('phone')), address: String(data.get('address')), currency: String(data.get('currency')).toUpperCase(), footer: String(data.get('footer')), paperWidth: String(data.get('paperWidth')) as Shop['paperWidth'], logo: logo || state.shop?.logo || '' }; }
root.addEventListener('click', async event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!target || busy) return;
  const action = target.dataset.action!; notice = ''; success = '';
  if (action === 'forgot-password') { recoveryStage = 'token'; render(); }
  else if (action === 'back-login') { recoveryStage = ''; await mutate(() => window.serveo.logout()); }
  else if (action === 'recovery-token') { modal = 'recovery-token'; render(); }
  else if (action.startsWith('nav:')) { page = action.slice(4); render(); }
  else if (action === 'logout') { basket = newBasket(); await mutate(() => window.serveo.logout()); }
  else if (action === 'dismiss') { notice = ''; success = ''; render(); }
  else if (action === 'category') { category = target.dataset.value!; render(); }
  else if (action.startsWith('filter:')) { orderFilter = action.slice(7); render(); }
  else if (action.startsWith('add:')) { const id = action.slice(4); const p = state.products.find(p => p.id === id)!; const i = basket.items.find(i => i.productId === id); if (p.trackStock && (i?.quantity || 0) >= p.stock) { notice = 'There is no more stock available for this item.'; } else if (i) i.quantity++; else basket.items.push({ productId: id, quantity: 1, note: '' }); basketPage = Math.floor((basket.items.length - 1) / basketPageSize); render(); }
  else if (action.startsWith('qty:')) { const [, n, delta] = action.split(':'); const item = basket.items[+n]; const p = state.products.find(p => p.id === item.productId)!; if (+delta > 0 && p.trackStock && item.quantity >= p.stock) notice = 'There is no more stock available for this item.'; else item.quantity += +delta; basket.items = basket.items.filter(i => i.quantity > 0); render(); }
  else if (action === 'basket-details') { modal = 'basket-details'; render(); }
  else if (action === 'basket-prev') { basketPage--; render(); }
  else if (action === 'basket-next') { basketPage++; render(); }
  else if (action.startsWith('type:')) { basket.type = action.slice(5) as OrderInput['type']; if(basket.type !== 'delivery') basket.deliveryCharge = 0; if (basket.type === 'dine-in' && !basket.table || basket.type === 'delivery' && (!basket.address.trim() || !basket.customer.trim() || !basket.phone.trim())) modal = 'basket-details'; render(); }
  else if (action === 'clear-basket') { modal = 'clear'; render(); }
  else if (action === 'confirm-clear') { basket = newBasket(); modal = ''; render(); }
  else if (action === 'new-product' || action.startsWith('product:')) { selected = action === 'new-product' ? '' : action.slice(8); productImage = state.products.find(p => p.id === selected)?.image; productImageBusy = false; productImageRequest++; modal = 'product'; render(); }
  else if (action.startsWith('order:')) { selected = action.slice(6); modal = 'order'; render(); }
  else if (action === 'remove-product-image') { productImageRequest++; productImageBusy = false; productImage = ''; document.getElementById('product-image-preview')!.innerHTML = '<span>No product image</span>'; const form = target.closest('form')!; form.querySelector<HTMLInputElement>('[name=productImage]')!.value = ''; form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = false; document.getElementById('product-image-error')!.textContent = ''; }
  else if (action === 'new-expense') { modal = 'expense'; render(); }
  else if (action === 'change-password') { modal = 'change-password'; render(); }
  else if (action === 'new-user') { modal = 'user'; render(); }
  else if (action === 'day') { modal = 'day'; render(); }
  else if (action === 'close-modal') { modal = ''; render(); }
  else if (action.startsWith('print:') || action.startsWith('preview:')) { previewKind = action.split(':')[1] as typeof previewKind; modal = 'preview'; render(); }
  else if (action === 'back-order') { modal = 'order'; render(); }
  else if (action === 'print-now') { busy = true; target.disabled = true; try { await window.serveo.printOrder(selected, previewKind); } catch (err) { notice = (err as Error).message; } finally { busy = false; render(); } }
  else if (action === 'cancel-order') await mutate(() => window.serveo.setOrderStatus(selected, 'cancelled'), 'Order cancelled.');
  else if (action === 'export') { try { const path = await window.serveo.exportBackup(); if (path) success = `Backup saved: ${path}`; } catch (err) { notice = (err as Error).message; } render(); }
  else if (action === 'restore') { modal = 'restore'; render(); }
  else if (action === 'confirm-restore') await mutate(() => window.serveo.restoreBackup(), 'Backup restored. Sign in using the restored account.');
});
root.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.closest('[data-form="change-password"]')) root.querySelector<HTMLInputElement>('input[name=confirmPassword]')?.setCustomValidity('');
  if (input.id === 'product-search') { search = input.value; const list = state.products.filter(p => p.active && (category === 'All' || p.category === category) && `${p.name} ${p.variant}`.toLowerCase().includes(search.toLowerCase())); document.getElementById('product-grid')!.innerHTML = productCards(list); return; }
  if (input.dataset.note !== undefined) { basket.items[+input.dataset.note].note = input.value; return; }
  if (input.closest('[data-form="sale"]') && input.name) {
    const numeric = ['discount', 'deliveryCharge', 'cashReceived'].includes(input.name);
    (basket as unknown as Record<string, unknown>)[input.name] = numeric ? Number(input.value) : input.value;
    const totalNode = document.getElementById('basket-total'), changeNode = document.getElementById('change-total');
    if (totalNode) totalNode.innerHTML = money(total()); if (changeNode) changeNode.innerHTML = money(Math.max(0, basket.cashReceived - total()));
    if (input.name === 'paymentMethod') { document.getElementById('cash-field')!.hidden = input.value !== 'cash'; if (input.value === 'unpaid' && !basket.customer.trim()) { modal = 'basket-details'; render(); } }
  }
});
root.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement;
  if (input.name === 'productImage' && input.files?.[0]) {
    const file=input.files[0], request=++productImageRequest;
    const form=input.closest('form')!, save=form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const feedback=document.getElementById('product-image-error')!;
    productImageBusy=true; save.disabled=true; feedback.textContent='Preparing image?';
    try {
      if(file.size>8*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPG or WebP smaller than 8 MB.');
      const bitmap=await createImageBitmap(file);
      try {
        const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height));
        const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const context=canvas.getContext('2d'); if(!context) throw new Error('Could not prepare this image.');
        context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
        if(request!==productImageRequest || !form.isConnected) return;
        productImage=canvas.toDataURL('image/jpeg',0.85);
        document.getElementById('product-image-preview')!.innerHTML=`<img src="${e(productImage)}" alt="Product image preview">`;
        feedback.textContent='Image ready. Save the menu item to keep it.';
      } finally {bitmap.close();}
    } catch(err) {if(request===productImageRequest && form.isConnected) feedback.textContent=(err as Error).message;}
    finally {if(request===productImageRequest){productImageBusy=false;save.disabled=false;input.value='';}}
    return;
  }
  if (input.name === 'logo'  && input.files?.[0]) {
    const file = input.files[0];
    if (file.size > 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) { notice = 'Choose a PNG or JPEG image smaller than 1 MB.'; input.value = ''; const existing = root.querySelector('.logo-error'); if (existing) existing.remove(); input.insertAdjacentHTML('afterend', `<span class="logo-error low">${e(notice)}</span>`); return; }
    logo = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
  }
});
root.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target as HTMLFormElement; if (!form.reportValidity()) return;
  const data = new FormData(form), get = (n: string) => String(data.get(n) || ''), num = (n: string) => Number(data.get(n) || 0);
  switch (form.dataset.form) {
    case 'setup': await mutate(() => window.serveo.setup({ shop: readShop(data), owner: { name: get('ownerName'), username: get('username'), password: get('password'), recoveryToken: get('recoveryToken') } }), 'Your shop is ready. Add your menu, then open the day.'); break;
    case 'login': await mutate(() => window.serveo.login(get('username'), get('password'))); break;
    case 'shop': await mutate(() => window.serveo.saveShop(readShop(data)), 'Shop details saved.'); break;
    case 'product': if(productImageBusy) break; await mutate(() => window.serveo.saveProduct({ id: selected, name: get('name'), category: get('category'), variant: get('variant'), price: num('price'), stock: num('stock'), trackStock: data.has('trackStock'), active: data.has('active'), image: productImage }), 'Menu item saved.'); break;
    case 'basket-details':
      Object.assign(basket, { customer: get('customer'), phone: get('phone'), table: get('table'), address: get('address'), rider: get('rider'), discount: num('discount'), deliveryCharge: basket.type === 'delivery' ? num('deliveryCharge') : 0, note: get('note') });
      modal = ''; render(); break;
    case 'sale': {
      if (basket.type === 'dine-in' && !basket.table.trim() || basket.type === 'delivery' && (!basket.address.trim() || !basket.customer.trim() || !basket.phone.trim()) || basket.paymentMethod === 'unpaid' && !basket.customer.trim()) { notice = 'Complete the required order details before placing this order.'; modal = 'basket-details'; render(); break; }
      const before = state.orders.length; await mutate(() => window.serveo.createOrder({ ...basket, table: basket.type === 'dine-in' ? basket.table : '', address: basket.type === 'delivery' ? basket.address : '', rider: basket.type === 'delivery' ? basket.rider : '' }));
      if (state.orders.length > before && !notice) { basket = newBasket(); page = 'orders'; selected = state.orders.reduce((a, b) => a.number > b.number ? a : b).id; modal = 'order'; success = 'Order saved. Choose a receipt or kitchen ticket below.'; render(); }
      break;
    }
    case 'status': await mutate(() => window.serveo.setOrderStatus(selected, get('status') as OrderStatus), 'Preparation status updated.'); break;
    case 'payment': await mutate(() => window.serveo.collectPayment(selected, get('method') as PaymentMethod, num('cashReceived')), 'Payment collected.'); break;
    case 'refund': await mutate(() => window.serveo.refundOrder(selected, get('reason'), get('stockDisposition') as 'return' | 'waste'), 'Full refund recorded.'); break;
    case 'expense': await mutate(() => window.serveo.addExpense({ category: get('category'), amount: num('amount'), note: get('note') }), 'Cash expense recorded.'); break;
    case 'open-day': await mutate(() => window.serveo.openDay(num('cash')), 'Cash drawer opened. You’re ready to trade.'); break;
    case 'close-day': await mutate(() => window.serveo.closeDay(num('cash')), 'Day closed and cash reconciled.'); break;
    case 'verify-recovery':
      if (busy) break;
      busy = true; notice = ''; document.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach(b => b.disabled = true);
      try { await window.serveo.beginPasswordReset(get('username'), get('recoveryToken')); recoveryStage = 'password'; }
      catch (err) { notice = (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
      finally { busy = false; render(); }
      break;
    case 'reset-password':
      if (get('newPassword') !== get('confirmPassword')) { notice = 'New passwords do not match.'; render(); break; }
      await mutate(() => window.serveo.resetPassword(get('newPassword'), get('confirmPassword')), 'Password reset. You are signed in.');
      if (state.user) recoveryStage = '';
      break;
    case 'recovery-token':
      await mutate(() => window.serveo.setRecoveryToken({ currentPassword: get('currentPassword'), recoveryToken: get('recoveryToken'), confirmToken: get('confirmToken') }), 'Recovery token saved. Remember it: only this latest token can reset your password.');
      break;
    case 'change-password':
      if (get('newPassword') !== get('confirmPassword')) { const confirmation = form.elements.namedItem('confirmPassword') as HTMLInputElement; confirmation.setCustomValidity('New passwords do not match.'); confirmation.reportValidity(); break; }
      await mutate(() => window.serveo.changePassword({ currentPassword: get('currentPassword'), newPassword: get('newPassword'), confirmPassword: get('confirmPassword') }), 'Password changed. Use your new password the next time you sign in.'); break;
    case 'user': await mutate(() => window.serveo.saveUser({ name: get('name'), username: get('username'), password: get('password'), role: get('role') as 'owner' | 'cashier', recoveryToken: get('recoveryToken') }), 'Team account created.'); break;
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modal) { modal = ''; notice = ''; render(); }
  if (event.key === 'Tab' && modal) { const focusable = [...root.querySelectorAll<HTMLElement>('.modal button:not(:disabled),.modal input:not(:disabled),.modal select:not(:disabled),.modal textarea:not(:disabled)')].filter(node => node.getClientRects().length > 0); const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
});
async function start() { if (!window.serveo) { root.innerHTML = '<main class="desktop-required"><div class="wordmark">serveo</div><h1>Open Serveo on your desktop.</h1><p>This workspace uses the desktop application to keep your records in a local SQLite database.</p></main>'; return; } try { state = await window.serveo.snapshot(); render(); } catch (err) { root.innerHTML = `<main class="desktop-required"><h1>Serveo couldn’t open your records.</h1><p>${e((err as Error).message)}</p><p>Restart the application and check that the data folder is available.</p></main>`; } }
void start();
