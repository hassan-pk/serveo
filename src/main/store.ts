import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { User, Shop, Product, Order, OrderInput, OrderStatus, PaymentMethod, Expense, Closing, Snapshot, SetupInput, Role, ChangePasswordInput, RecoveryTokenInput, StockDisposition } from '../shared/types';
const now = () => new Date().toISOString();
function text(v: unknown, field: string, required = false): string { if (typeof v !== 'string' || v.length > 10000 || (required && !v.trim())) throw new Error(`Invalid ${field}`); return v.trim(); }
function money(v: unknown, field: string): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new Error(`Invalid ${field}`); return Math.round(v * 100) / 100; }
function member<T extends string>(v: T, allowed: string[]): T { if (!allowed.includes(v)) throw new Error('Invalid option'); return v; }
export class Store {
  private db!: DatabaseSync;
  private user: User | null = null;
  private recovery: {userId:string;expires:number} | null = null;
  constructor(private filePath: string) { mkdirSync(dirname(filePath), { recursive: true }); this.connect(); }
  private connect() {
    this.db = new DatabaseSync(this.filePath);
    const version = (this.db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
    if (version > 1) { this.db.close(); throw new Error('This database requires a newer version of Serveo'); }
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY,closingId TEXT NOT NULL,amount REAL NOT NULL,kind TEXT NOT NULL,createdAt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,userId TEXT,action TEXT NOT NULL,details TEXT NOT NULL,createdAt TEXT NOT NULL); PRAGMA user_version=1;`);
    this.db.exec('CREATE TABLE IF NOT EXISTS recovery_credentials(userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,salt TEXT NOT NULL,hash TEXT NOT NULL)');
  }
  close() { this.db.close(); }
  private tx<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  private all<T>(kind: string): T[] { return (this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as { data: string }[]).map(r => JSON.parse(r.data)); }
  private get<T>(kind: string, id: string): T { const r = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id) as {data:string}|undefined; if (!r) throw new Error(`${kind} not found`); return JSON.parse(r.data); }
  private put<T extends {id:string}>(kind: string, value: T) { this.db.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,value.id,JSON.stringify(value)); }
  private audit(action: string, details = '') { this.db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(randomUUID(),this.user?.id || null,action,details,now()); }
  private auth(owner = false): User { if (!this.user) throw new Error('Please log in'); if (owner && this.user.role !== 'owner') throw new Error('Owner permission required'); return this.user; }
  private activeDay(): Closing { const c = this.all<Closing>('closing').find(c => !c.closedAt); if (!c) throw new Error('Open the cash drawer before recording transactions'); return c; }
  private movement(amount: number, kind: string) { const c = this.activeDay(); this.db.prepare('INSERT INTO movements VALUES(?,?,?,?,?)').run(randomUUID(),c.id,amount,kind,now()); }
  private expected(c: Closing) { const row = this.db.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM movements WHERE closingId=?').get(c.id) as {amount:number}; return Math.round((c.openingCash+row.amount)*100)/100; }
  snapshot(): Snapshot {
    const r = this.db.prepare("SELECT value FROM meta WHERE key='shop'").get() as {value:string}|undefined;
    const base: Snapshot = { shop:r ? JSON.parse(r.value):null,user:this.user ? {...this.user,recoveryEnabled:!!this.db.prepare('SELECT userId FROM recovery_credentials WHERE userId=?').get(this.user.id)} : null,users:[],products:[],orders:[],expenses:[],closing:null,dataPath:this.filePath,version:'0.1.6' };
    if (!this.user) return base;
    const c = this.all<Closing>('closing')[0] || null;
    return {...base, users:this.user.role==='owner' ? this.db.prepare('SELECT id,name,username,role FROM users').all() as unknown as User[]:[], products:this.all<Product>('product'),orders:this.all<Order>('order'),expenses:this.user.role==='owner'?this.all<Expense>('expense'):[],closing:c ? {...c,expectedCash:c.closedAt?c.expectedCash:this.expected(c)}:null};
  }
  private validateShop(s: Shop): Shop { return {name:text(s.name,'shop name',true),category:text(s.category,'category',true),phone:text(s.phone,'phone'),address:text(s.address,'address'),currency:text(s.currency,'currency',true),footer:text(s.footer,'footer'),paperWidth:member(s.paperWidth,['80','58','A4']),logo:s.logo ? this.logo(s.logo):undefined}; }
  private logo(v: string) { if (typeof v !== 'string' || v.length > 3e6 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error('Logo must be a PNG, JPEG or WebP under 2 MB'); return v; }
  setup(input: SetupInput) {
    if (this.snapshot().shop) throw new Error('Shop is already configured');
    const shop = this.validateShop(input.shop);
    this.tx(() => { this.insertUser({...input.owner,role:'owner'}); this.db.prepare("INSERT INTO meta VALUES('shop',?)").run(JSON.stringify(shop)); this.audit('setup'); });
    return this.login(input.owner.username,input.owner.password);
  }
  private insertUser(i: {name:string;username:string;password:string;role:Role;recoveryToken?:string}) {
    const name=text(i.name,'name',true), username=text(i.username,'username',true).toLowerCase();
    if (typeof i.password !== 'string' || i.password.length < 8 || i.password.length > 200) throw new Error('Password must have 8–200 characters');
    member(i.role,['owner','cashier']); const salt=randomBytes(16).toString('hex');
    const token = i.recoveryToken ? this.validateToken(i.recoveryToken) : '';
    if (token && token === i.password) throw new Error('Choose a recovery token different from your password');
    const id = randomUUID();
    this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,name,username,i.role,salt,scryptSync(i.password,salt,64).toString('hex'));
    if (token) this.writeToken(id,token);
  }
  login(username: string,password:string) {
    this.recovery=null;
    const r=this.db.prepare('SELECT * FROM users WHERE username=?').get(text(username,'username',true).toLowerCase()) as (User & {salt:string;hash:string})|undefined;
    if (typeof password!=='string' || password.length>200 || !r || !timingSafeEqual(scryptSync(password,r.salt,64),Buffer.from(r.hash,'hex'))) throw new Error('Incorrect username or password');
    this.user={id:r.id,name:r.name,username:r.username,role:r.role}; this.audit('login'); return this.snapshot();
  }
  logout() { this.user=null; this.recovery=null; return this.snapshot(); }
  changePassword(input: ChangePasswordInput) {
    const user = this.auth();
    if (!input || typeof input.currentPassword !== 'string' || input.currentPassword.length > 200) throw new Error('Current password is incorrect');
    const account = this.db.prepare('SELECT salt,hash FROM users WHERE id=?').get(user.id) as {salt:string;hash:string}|undefined;
    if (!account || !timingSafeEqual(scryptSync(input.currentPassword,account.salt,64),Buffer.from(account.hash,'hex'))) throw new Error('Current password is incorrect');
    if (typeof input.newPassword !== 'string' || input.newPassword.length < 8 || input.newPassword.length > 200) throw new Error('New password must have 8–200 characters');
    if (input.newPassword !== input.confirmPassword) throw new Error('New passwords do not match');
    if (input.newPassword === input.currentPassword) throw new Error('Choose a different new password');
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(input.newPassword,salt,64).toString('hex');
    this.tx(() => {
      this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,user.id);
      this.audit('change-password',user.id);
    });
    return this.snapshot();
  }
  private validateToken(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length < 12 || value.length > 200) throw new Error('Recovery token must have 12–200 characters');
    return value.trim();
  }
  private writeToken(userId: string, token: string) {
    const salt=randomBytes(16).toString('hex'),hash=scryptSync(token,salt,64).toString('hex');
    this.db.prepare('INSERT INTO recovery_credentials VALUES(?,?,?) ON CONFLICT(userId) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(userId,salt,hash);
  }
  setRecoveryToken(input: RecoveryTokenInput) {
    const user=this.auth();
    if (!input || typeof input.currentPassword!=='string' || input.currentPassword.length>200) throw new Error('Current password is incorrect');
    const account=this.db.prepare('SELECT salt,hash FROM users WHERE id=?').get(user.id) as {salt:string;hash:string};
    if (!timingSafeEqual(scryptSync(input.currentPassword,account.salt,64),Buffer.from(account.hash,'hex'))) throw new Error('Current password is incorrect');
    const token=this.validateToken(input.recoveryToken);
    if(typeof input.confirmToken!=='string' || token!==input.confirmToken.trim()) throw new Error('Recovery tokens do not match');
    if(token===input.currentPassword) throw new Error('Choose a recovery token different from your password');
    this.tx(()=>{this.writeToken(user.id,token);this.audit('set-recovery-token',user.id);});
    this.recovery=null;
    return this.snapshot();
  }
  beginPasswordReset(username: string, token: string) {
    this.recovery=null;
    if(this.user) throw new Error('Sign out before resetting a forgotten password');
    const name=text(username,'username',true).toLowerCase();
    if(typeof token!=='string' || token.length>200) throw new Error('Username or recovery token is incorrect');
    const record=this.db.prepare('SELECT r.userId,r.salt,r.hash FROM recovery_credentials r JOIN users u ON u.id=r.userId WHERE u.username=?').get(name) as {userId:string;salt:string;hash:string}|undefined;
    const actual=scryptSync(token.trim(),record?.salt || '00000000000000000000000000000000',64);
    if(!record || !timingSafeEqual(actual,Buffer.from(record.hash,'hex'))) throw new Error('Username or recovery token is incorrect');
    this.recovery={userId:record.userId,expires:Date.now()+5*60*1000};
  }
  resetPassword(password: string, confirmation: string) {
    if(this.user || !this.recovery || Date.now()>=this.recovery.expires) {this.recovery=null;throw new Error('Verify your recovery token again to reset your password');}
    if(typeof password!=='string' || password.length<8 || password.length>200) throw new Error('New password must have 8–200 characters');
    if(password!==confirmation) throw new Error('New passwords do not match');
    const user=this.db.prepare('SELECT id,name,username,role FROM users WHERE id=?').get(this.recovery.userId) as unknown as User|undefined;
    if(!user) {this.recovery=null;throw new Error('Verify your recovery token again to reset your password');}
    const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
    this.tx(()=>{this.db.prepare('UPDATE users SET salt=?,hash=? WHERE id=?').run(salt,hash,user.id);this.audit('reset-password',user.id);});
    this.recovery=null;this.user=user;
    return this.snapshot();
  }
  saveUser(i: {name:string;username:string;password:string;role:Role;recoveryToken?:string}) { this.auth(true); this.tx(()=>{this.insertUser(i);this.audit('create-user',i.username);}); return this.snapshot(); }
  saveShop(s: Shop) { this.auth(true); const shop=this.validateShop(s); this.db.prepare("UPDATE meta SET value=? WHERE key='shop'").run(JSON.stringify(shop)); this.audit('shop-settings'); return this.snapshot(); }
  private productImage(value: unknown): string {
    if (value === '') return '';
    if (typeof value !== 'string' || value.length > 1500000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Product image must be a PNG, JPEG or WebP smaller than 1 MB');
    const [header,encoded]=value.split(','); const bytes=Buffer.from(encoded,'base64');
    const valid=header.includes('/png') ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : header.includes('/jpeg') ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if(!valid || bytes.length>1024*1024) throw new Error('Invalid product image');
    return value;
  }
  saveProduct(p: Product) {
    this.auth(true); const item:Product={id:p.id || randomUUID(),name:text(p.name,'product name',true),category:text(p.category,'category',true),variant:text(p.variant,'variant'),price:money(p.price,'price'),stock:money(p.stock,'stock'),trackStock:!!p.trackStock,active:!!p.active,image:p.image===undefined?undefined:this.productImage(p.image)};
    this.put('product',item); this.audit('save-product',item.id); return this.snapshot();
  }
  createOrder(i: OrderInput) {
    const u=this.auth(); this.activeDay();
    if (!Array.isArray(i.items) || !i.items.length || i.items.length>200) throw new Error('Add at least one item');
    const type=member(i.type,['dine-in','takeaway','delivery']);
    const table=type==='dine-in'?text(i.table,'table',true):'';
    const address=type==='delivery'?text(i.address,'delivery address',true):'';
    const rider=type==='delivery'?text(i.rider,'rider'):'';
    const customer=text(i.customer,'customer name',type==='delivery'||i.paymentMethod==='unpaid');
    const phone=text(i.phone,'customer phone',type==='delivery');
    this.tx(() => {
      const items=i.items.map(line => { const p=this.get<Product>('product',line.productId); if (!p.active) throw new Error('Product is inactive'); if (!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>9999) throw new Error('Invalid quantity'); if (p.trackStock && p.stock<line.quantity) throw new Error(`Insufficient stock: ${p.name}`); if(p.trackStock) this.put('product',{...p,stock:p.stock-line.quantity}); return {productId:p.id,quantity:line.quantity,note:text(line.note,'item note'),name:p.name+(p.variant?' · '+p.variant:''),price:p.price,stockDeducted:p.trackStock?line.quantity:0}; });
      const subtotal=Math.round(items.reduce((s,l)=>s+l.price*l.quantity,0)*100)/100, discount=money(i.discount,'discount'),deliveryCharge=type==='delivery'?money(i.deliveryCharge,'delivery charge'):0;
      if(discount>subtotal) throw new Error('Discount cannot exceed subtotal'); if(discount && u.role!=='owner') throw new Error('Owner permission required for discounts');
      const total=Math.round((subtotal-discount+deliveryCharge)*100)/100, method=member(i.paymentMethod,['cash','card','bank','unpaid']), received=method==='cash'?money(i.cashReceived,'cash received'):0;
      if(method==='cash' && received<total) throw new Error('Cash received is less than total');
      const number=Number((this.db.prepare("SELECT value FROM meta WHERE key='orderNumber'").get() as {value:string}|undefined)?.value || 0)+1;
      this.db.prepare("INSERT INTO meta VALUES('orderNumber',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(number));
      const o:Order={items,type,table,customer,phone,address,rider,note:text(i.note,'note'),discount,deliveryCharge,paymentMethod:method,cashReceived:received,id:randomUUID(),number,createdAt:now(),status:'new',subtotal,total,paid:method==='unpaid'?0:total,change:method==='cash'?Math.round((received-total)*100)/100:0,refunded:0,createdBy:u.id};
      this.put('order',o); if(method==='cash') this.movement(total,'sale'); this.audit('create-order',o.id);
    }); return this.snapshot();
  }
  private restock(o: Order) {
    // Old orders did not record deductions. Never infer them from today's product settings.
    for (const item of o.items) {
      if (item.stockDeducted === undefined) {
        this.audit('legacy-stock-review',`${o.id}:${item.productId}: deduction unknown; adjust stock manually if required`);
        continue;
      }
      if (item.stockDeducted > 0) {
        const product=this.get<Product>('product',item.productId);
        this.put('product',{...product,stock:product.stock+item.stockDeducted});
      }
    }
  }
  setOrderStatus(id: string,status:OrderStatus) {
    this.auth(); member(status,['new','preparing','ready','completed','cancelled']);
    this.tx(()=> { const o=this.get<Order>('order',id); if(o.status==='cancelled'||o.refunded) throw new Error('Order is already cancelled or refunded'); if(status==='cancelled') {this.auth(true); if(o.paid>0) throw new Error('Refund paid orders instead of cancelling'); this.restock(o);} this.put('order',{...o,status}); this.audit('order-status',`${id}:${status}`); }); return this.snapshot();
  }
  collectPayment(id:string,method:PaymentMethod,cashReceived:number) { this.auth(); this.activeDay(); member(method,['cash','card','bank']); const cash=method==='cash'?money(cashReceived,'cash received'):0; this.tx(()=> {const o=this.get<Order>('order',id); if(o.status==='cancelled'||o.paid>=o.total||o.refunded) throw new Error('Order cannot be collected'); if(method==='cash'&&cash<o.total) throw new Error('Cash received is less than total'); this.put('order',{...o,paid:o.total,paymentMethod:method,cashReceived:cash,change:method==='cash'?Math.round((cash-o.total)*100)/100:0}); if(method==='cash') this.movement(o.total,'collection'); this.audit('collect-payment',id);}); return this.snapshot(); }
  refundOrder(id:string,reason:string,disposition:StockDisposition) {
    this.auth(true); this.activeDay();
    const note=text(reason,'refund reason',true);
    member(disposition,['return','waste']);
    this.tx(()=> {
      const o=this.get<Order>('order',id);
      if(o.paid<=0||o.refunded>0||o.status==='cancelled') throw new Error('Order cannot be refunded');
      if(disposition==='return') {
        if(o.items.some(item=>item.stockDeducted===undefined)) throw new Error('Stock deductions are unknown for this older order. Choose no stock return and adjust stock manually if needed.');
        this.restock(o);
      }
      if(o.paymentMethod==='cash') this.movement(-o.paid,'refund');
      this.put('order',{...o,refunded:o.paid,status:'cancelled',stockDisposition:disposition});
      this.audit('refund',`${id}: ${note}; stock=${disposition}`);
    }); return this.snapshot();
  }
  addExpense(i:{category:string;amount:number;note:string}) { this.auth(true); this.activeDay(); const amount=money(i.amount,'expense amount'); if(!amount) throw new Error('Expense must be greater than zero'); this.tx(()=>{ const e:Expense={id:randomUUID(),category:text(i.category,'category',true),amount,note:text(i.note,'note'),date:now()}; this.put('expense',e); this.movement(-amount,'expense'); this.audit('expense',e.id);}); return this.snapshot(); }
  openDay(openingCash:number) { this.auth(); const amount=money(openingCash,'opening cash'); if(this.all<Closing>('closing').some(c=>!c.closedAt)) throw new Error('Cash drawer is already open'); this.put('closing',{id:randomUUID(),openedAt:now(),closedAt:null,openingCash:amount,expectedCash:amount,countedCash:null,difference:null} as Closing); this.audit('open-day'); return this.snapshot(); }
  closeDay(countedCash:number) { this.auth(true); const amount=money(countedCash,'counted cash'),c=this.activeDay(),expected=this.expected(c); this.put('closing',{...c,closedAt:now(),expectedCash:expected,countedCash:amount,difference:Math.round((amount-expected)*100)/100}); this.audit('close-day'); return this.snapshot(); }
  backupTo(path:string) { if(resolve(path)===resolve(this.filePath)) throw new Error('Choose a different backup path'); this.db.exec('VACUUM INTO '+"'"+path.replace(/'/g,"''")+"'"); }
  restoreFrom(path:string) {
    this.auth(true); if(resolve(path)===resolve(this.filePath)) throw new Error('Choose a backup file');
    const candidate=new DatabaseSync(path,{readOnly:true});
    try {
      if(candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_credentials'").get()) {
        for(const row of candidate.prepare('SELECT userId,salt,hash FROM recovery_credentials').all() as {userId:string;salt:string;hash:string}[]) {
          if(!/^[a-f0-9]{32}$/.test(row.salt)||!/^[a-f0-9]{128}$/.test(row.hash)||!candidate.prepare('SELECT id FROM users WHERE id=?').get(row.userId)) throw new Error('Invalid backup recovery credentials');
        }
      }
      for (const row of candidate.prepare('SELECT kind,id,data FROM records').all() as {kind:string;id:string;data:string}[]) {
        const value = JSON.parse(row.data);
        if (!value || value.id !== row.id) throw new Error('Backup contains invalid records');
        if (row.kind === 'product') { text(value.name,'product name',true); text(value.category,'category',true); money(value.price,'price'); money(value.stock,'stock'); if(value.image!==undefined)this.productImage(value.image); if(typeof value.active!=='boolean'||typeof value.trackStock!=='boolean') throw new Error('Invalid product'); }
        else if (row.kind === 'order') { if(!Array.isArray(value.items)||!value.items.length) throw new Error('Invalid order'); member(value.status,['new','preparing','ready','completed','cancelled']);member(value.paymentMethod,['cash','card','bank','unpaid']);if(value.stockDisposition!==undefined)member(value.stockDisposition,['return','waste']);for(const key of ['subtotal','total','paid','refunded','discount','deliveryCharge','cashReceived','change']) money(value[key],key); if(!Number.isInteger(value.number)) throw new Error('Invalid order number'); for(const item of value.items) {text(item.productId,'product id',true);text(item.name,'item name',true);money(item.price,'price');if(item.stockDeducted!==undefined && (!Number.isInteger(item.stockDeducted)||item.stockDeducted<0||item.stockDeducted>item.quantity))throw new Error('Invalid stock deduction');if(!Number.isInteger(item.quantity)||item.quantity<1)throw new Error('Invalid item quantity');} }
        else if (row.kind === 'expense') {money(value.amount,'expense');text(value.category,'category',true);}
        else if (row.kind === 'closing') {money(value.openingCash,'opening cash');if(typeof value.openedAt!=='string'||!Number.isFinite(Date.parse(value.openedAt)))throw new Error('Invalid closing');}
        else throw new Error('Unknown backup record');
      }
      for(const user of candidate.prepare('SELECT * FROM users').all() as {name:string;username:string;role:string;salt:string;hash:string}[]) {text(user.name,'user',true);text(user.username,'username',true);member(user.role,['owner','cashier']);if(!/^[a-f0-9]{32}$/.test(user.salt)||! /^[a-f0-9]{128}$/.test(user.hash))throw new Error('Invalid backup credentials');}
      const integrity=candidate.prepare('PRAGMA integrity_check').get() as Record<string,string>; if(Object.values(integrity)[0]!=='ok') throw new Error('Backup is damaged'); const version=candidate.prepare('PRAGMA user_version').get() as {user_version:number}; if(version.user_version!==1) throw new Error('Unsupported backup version'); for(const table of ['meta','users','records','movements','audit']) candidate.prepare(`SELECT * FROM ${table} LIMIT 1`).get(); const shop=candidate.prepare("SELECT value FROM meta WHERE key='shop'").get() as {value:string}|undefined; if(!shop) throw new Error('Backup has no shop'); this.validateShop(JSON.parse(shop.value)); if(!candidate.prepare("SELECT id FROM users WHERE role='owner'").get()) throw new Error('Backup has no owner'); } finally {candidate.close();}
    this.db.close(); try {copyFileSync(path,this.filePath);} finally {this.connect();this.user=null;}
  }
}
