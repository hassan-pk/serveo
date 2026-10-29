import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/main/store';
import type { OrderInput, Shop } from '../src/shared/types';
const shop:Shop={name:'Test Cafe',category:'Cafe',phone:'',address:'',currency:'PKR',footer:'Thanks',paperWidth:'80'};
const sale=(id:string,method:OrderInput['paymentMethod']='cash'):OrderInput=>({items:[{productId:id,quantity:2,note:''}],type:'takeaway',table:'',customer:'A',phone:'',address:'',rider:'',note:'',discount:0,deliveryCharge:0,paymentMethod:method,cashReceived:500});
function fixture() { const dir=mkdtempSync(join(tmpdir(),'serveo-store-'));const path=join(dir,'db.sqlite');const s=new Store(path);s.setup({shop,owner:{name:'Owner',username:'owner',password:'password123'}});s.saveProduct({id:'p',name:'Tea',category:'Drinks',variant:'',price:100,stock:10,trackStock:true,active:true}); return {s,dir,path}; }

test('password change verifies current password, confirmation and length without changing records',()=>{
  const {s,dir,path}=fixture();
  try {
    const input={currentPassword:'password123',newPassword:'new-owner-password',confirmPassword:'new-owner-password'};
    assert.throws(()=>s.changePassword({...input,currentPassword:'wrong'}),/Current password/);
    assert.throws(()=>s.changePassword({...input,newPassword:'short',confirmPassword:'short'}),/8–200/);
    assert.throws(()=>s.changePassword({...input,newPassword:'x'.repeat(201),confirmPassword:'x'.repeat(201)}),/8–200/);
    assert.throws(()=>s.changePassword({...input,confirmPassword:'different'}),/do not match/);
    assert.throws(()=>s.changePassword({...input,newPassword:'password123',confirmPassword:'password123'}),/different/);
    s.login('owner','password123');
    const inspector=new DatabaseSync(path,{readOnly:true});
    const before=inspector.prepare("SELECT salt,hash FROM users WHERE username='owner'").get() as {salt:string;hash:string};
    const changed=s.changePassword(input);
    assert.equal(changed.user?.username,'owner');
    assert.equal(changed.products[0].id,'p');
    const after=inspector.prepare("SELECT salt,hash FROM users WHERE username='owner'").get() as {salt:string;hash:string};
    assert.notEqual(before.salt,after.salt); assert.notEqual(before.hash,after.hash);
    assert.notEqual(after.hash,input.newPassword);
    const audits=inspector.prepare("SELECT details FROM audit WHERE action='change-password'").all();
    assert.equal(audits.length,1); assert.ok(!JSON.stringify(audits).includes(input.newPassword));
    inspector.close();
    s.logout();
    assert.throws(()=>s.changePassword(input),/log in/);
    assert.throws(()=>s.login('owner','password123'),/Incorrect/);
    s.login('owner',input.newPassword); s.close();
    const reopened=new Store(path);
    reopened.login('owner',input.newPassword); assert.equal(reopened.snapshot().products.length,1); reopened.close();
  } finally {try{s.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});

test('cashiers can change only their own password and cannot change owner credentials',()=>{
  const {s,dir}=fixture();
  try {
    s.saveUser({name:'Cashier',username:'cashier',password:'cashier-old-password',role:'cashier'});
    s.login('cashier','cashier-old-password');
    assert.throws(()=>s.changePassword({currentPassword:'password123',newPassword:'new-password-123',confirmPassword:'new-password-123'}),/Current password/);
    s.changePassword({currentPassword:'cashier-old-password',newPassword:'cashier-new-password',confirmPassword:'cashier-new-password'});
    s.logout(); assert.throws(()=>s.login('cashier','cashier-old-password'),/Incorrect/);
    s.login('cashier','cashier-new-password'); assert.equal(s.snapshot().user?.role,'cashier');
    s.logout(); s.login('owner','password123'); assert.equal(s.snapshot().user?.role,'owner');
  } finally {s.close();rmSync(dir,{recursive:true,force:true});}
});

test('signup recovery token verifies before reset, signs in and keeps records',()=>{
  const dir=mkdtempSync(join(tmpdir(),'serveo-recovery-')),path=join(dir,'db.sqlite'),s=new Store(path);
  const token='my private shop recovery phrase';
  try {
    s.setup({shop,owner:{name:'Owner',username:'owner',password:'original-password',recoveryToken:token}});
    s.saveProduct({id:'p',name:'Tea',category:'Drinks',variant:'',price:100,stock:10,trackStock:true,active:true});
    assert.equal(s.snapshot().user?.recoveryEnabled,true);
    assert.ok(!JSON.stringify(s.snapshot()).includes(token));
    const inspector=new DatabaseSync(path,{readOnly:true});
    const row=inspector.prepare('SELECT salt,hash FROM recovery_credentials').get() as {salt:string;hash:string};
    assert.equal(row.salt.length,32);assert.equal(row.hash.length,128);assert.notEqual(row.hash,token);inspector.close();
    s.logout();
    assert.throws(()=>s.resetPassword('replacement-password','replacement-password'),/Verify your recovery token/);
    assert.throws(()=>s.beginPasswordReset('owner','incorrect-token'),/Username or recovery token is incorrect/);
    assert.throws(()=>s.beginPasswordReset('missing-user',token),/Username or recovery token is incorrect/);
    s.beginPasswordReset('OWNER',token);
    assert.throws(()=>s.resetPassword('short','short'),/8–200/);
    assert.throws(()=>s.resetPassword('replacement-password','mismatch'),/do not match/);
    const result=s.resetPassword('replacement-password','replacement-password');
    assert.equal(result.user?.username,'owner');assert.equal(result.products[0].stock,10);
    assert.throws(()=>s.resetPassword('another-password','another-password'),/Verify/);
    s.logout();assert.throws(()=>s.login('owner','original-password'),/Incorrect/);
    s.login('owner','replacement-password');
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('only the latest self-service token works, with password verification and expiry',()=>{
  const {s,dir}=fixture();
  const first='first private recovery token',last='last private recovery token';
  try{
    assert.equal(s.snapshot().user?.recoveryEnabled,false);
    assert.throws(()=>s.setRecoveryToken({currentPassword:'wrong',recoveryToken:first,confirmToken:first}),/Current password/);
    assert.throws(()=>s.setRecoveryToken({currentPassword:'password123',recoveryToken:'short',confirmToken:'short'}),/12–200/);
    assert.throws(()=>s.setRecoveryToken({currentPassword:'password123',recoveryToken:first,confirmToken:last}),/do not match/);
    s.setRecoveryToken({currentPassword:'password123',recoveryToken:first,confirmToken:first});
    s.setRecoveryToken({currentPassword:'password123',recoveryToken:last,confirmToken:last});
    s.logout();assert.throws(()=>s.beginPasswordReset('owner',first),/incorrect/);
    s.beginPasswordReset('owner',last);
    const realNow=Date.now;try{Date.now=()=>realNow()+6*60*1000;assert.throws(()=>s.resetPassword('replacement-password','replacement-password'),/Verify/);}finally{Date.now=realNow;}
    assert.throws(()=>s.resetPassword('replacement-password','replacement-password'),/Verify/);
    s.beginPasswordReset('owner',last);s.logout();
    assert.throws(()=>s.resetPassword('replacement-password','replacement-password'),/Verify/);
    s.login('owner','password123');assert.equal(s.snapshot().products.length,1);
  } finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('recovery tokens survive backup/restart; legacy backups without tokens still restore',()=>{
  const {s,dir,path}=fixture();const token='my portable recovery phrase';
  try{
    s.setRecoveryToken({currentPassword:'password123',recoveryToken:token,confirmToken:token});
    const backup=join(dir,'recovery.sqlite');s.backupTo(backup);
    s.close();const reopened=new Store(path);
    reopened.beginPasswordReset('owner',token);reopened.resetPassword('new-password-123','new-password-123');
    reopened.restoreFrom(backup);reopened.beginPasswordReset('owner',token);reopened.resetPassword('another-password-123','another-password-123');
    const legacy=join(dir,'legacy.sqlite');reopened.backupTo(legacy);
    const db=new DatabaseSync(legacy);db.exec('DROP TABLE recovery_credentials');db.close();
    reopened.restoreFrom(legacy);reopened.login('owner','another-password-123');assert.equal(reopened.snapshot().user?.recoveryEnabled,false);
    reopened.close();
  }finally{try{s.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});
test('trading day separates unpaid sales, collections, expenses and refunds',()=>{const {s,dir}=fixture();try {assert.throws(()=>s.createOrder(sale('p')),/Open the cash/);s.openDay(1000);let snap=s.createOrder(sale('p'));const paid=snap.orders[0];assert.equal(paid.change,300);snap=s.createOrder(sale('p','unpaid'));const credit=snap.orders[0];assert.equal(snap.closing?.expectedCash,1200);assert.equal(snap.products[0].stock,6);s.addExpense({amount:50,category:'Supplies',note:''});snap=s.collectPayment(credit.id,'cash',200);assert.equal(snap.closing?.expectedCash,1350);assert.throws(()=>s.collectPayment(credit.id,'cash',200));snap=s.refundOrder(paid.id,'Returned','return');assert.equal(snap.products[0].stock,8);assert.equal(snap.closing?.expectedCash,1150);assert.throws(()=>s.refundOrder(paid.id,'Again','return'));snap=s.closeDay(1140);assert.equal(snap.closing?.difference,-10);}finally{s.close();rmSync(dir,{recursive:true,force:true});}});
test('stock rollback, owner permissions and restart persistence',()=>{const {s,dir,path}=fixture();try{s.openDay(0);const input=sale('p');input.items.push({productId:'missing',quantity:1,note:''});assert.throws(()=>s.createOrder(input));assert.equal(s.snapshot().products[0].stock,10);s.saveUser({name:'Cashier',username:'cashier',password:'password123',role:'cashier'});s.logout();assert.equal(s.snapshot().orders.length,0);assert.throws(()=>s.login('cashier','wrong'));s.login('cashier','password123');assert.throws(()=>s.saveShop(shop),/Owner/);assert.throws(()=>s.refundOrder('no','reason','waste'),/Owner/);assert.throws(()=>s.closeDay(0),/Owner/);assert.throws(()=>s.createOrder({...sale('p'),discount:1}),/Owner/);s.createOrder(sale('p'));s.close();const reopened=new Store(path);assert.equal(reopened.snapshot().user,null);reopened.login('owner','password123');assert.equal(reopened.snapshot().orders.length,1);reopened.close();}finally{try{s.close();}catch{}rmSync(dir,{recursive:true,force:true});}});
test('SQLite backup restore returns previous records and rejects invalid files',()=>{const {s,dir}=fixture();try{const backup=join(dir,'backup.sqlite');s.backupTo(backup);s.openDay(10);s.createOrder(sale('p'));s.restoreFrom(backup);assert.equal(s.snapshot().user,null);s.login('owner','password123');assert.equal(s.snapshot().orders.length,0);assert.equal(s.snapshot().products[0].stock,10);assert.throws(()=>s.restoreFrom(join(dir,'missing.sqlite')));assert.equal(s.snapshot().shop?.name,'Test Cafe');}finally{s.close();rmSync(dir,{recursive:true,force:true});}});
test('future database versions and malformed backups are rejected without losing live data',()=>{const {s,dir,path}=fixture();try{const future=join(dir,'future.sqlite');s.backupTo(future);const futureDb=new DatabaseSync(future);futureDb.exec('PRAGMA user_version=2');futureDb.close();assert.throws(()=>new Store(future),/newer version/);const check=new DatabaseSync(future);assert.equal((check.prepare('PRAGMA user_version').get() as {user_version:number}).user_version,2);check.close();const bad=join(dir,'bad.sqlite');s.backupTo(bad);const badDb=new DatabaseSync(bad);badDb.prepare("UPDATE records SET data=? WHERE kind='product'").run(JSON.stringify({id:'p',name:'Tea',price:'wrong'}));badDb.close();assert.throws(()=>s.restoreFrom(bad));assert.equal(s.snapshot().user?.role,'owner');assert.equal(s.snapshot().products[0].stock,10);assert.equal(s.snapshot().dataPath,path);}finally{s.close();rmSync(dir,{recursive:true,force:true});}});
test('duplicate order lines cannot oversell stock and unpaid cancellation restores once',()=>{const {s,dir}=fixture();try{s.openDay(0);const input=sale('p');input.items=[{productId:'p',quantity:6,note:''},{productId:'p',quantity:6,note:''}];assert.throws(()=>s.createOrder(input),/stock/);assert.equal(s.snapshot().products[0].stock,10);const order=s.createOrder(sale('p','unpaid')).orders[0];assert.equal(s.setOrderStatus(order.id,'cancelled').products[0].stock,10);assert.throws(()=>s.setOrderStatus(order.id,'cancelled'));assert.equal(s.snapshot().products[0].stock,10);}finally{s.close();rmSync(dir,{recursive:true,force:true});}});

test('refund and cancellation use original deductions despite tracking changes',()=>{
 const {s,dir}=fixture();try {
  s.openDay(0);
  s.saveProduct({...s.snapshot().products[0],trackStock:false});
  const untracked=s.createOrder(sale('p')).orders[0];
  s.saveProduct({...s.snapshot().products[0],trackStock:true});
  assert.equal(s.refundOrder(untracked.id,'Returned','return').products[0].stock,10);
  const tracked=s.createOrder(sale('p')).orders[0];
  s.saveProduct({...s.snapshot().products[0],trackStock:false});
  assert.equal(s.refundOrder(tracked.id,'Returned','return').products[0].stock,10);
  s.saveProduct({...s.snapshot().products[0],trackStock:true});
  const unpaid=s.createOrder(sale('p','unpaid')).orders[0];
  s.saveProduct({...s.snapshot().products[0],trackStock:false});
  assert.equal(s.setOrderStatus(unpaid.id,'cancelled').products[0].stock,10);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('wastage refund does not return stock and cannot be repeated',()=>{
 const {s,dir}=fixture();try {
  s.openDay(1000);const o=s.createOrder(sale('p')).orders[0];
  assert.throws(()=>s.refundOrder(o.id,'Reason','invalid' as any),/Invalid option/);
  let snap=s.refundOrder(o.id,'Already prepared','waste');
  assert.equal(snap.products[0].stock,8);assert.equal(snap.closing?.expectedCash,1000);
  assert.equal(snap.orders[0].stockDisposition,'waste');
  assert.throws(()=>s.refundOrder(o.id,'Again','return'),/cannot be refunded/);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('older order backup remains usable without guessing stock deductions',()=>{
 const {s,dir}=fixture();try {
  s.openDay(1000);const o=s.createOrder(sale('p')).orders[0];
  const backup=join(dir,'legacy.sqlite');s.backupTo(backup);
  const db=new DatabaseSync(backup);const legacy={...o,items:o.items.map(({stockDeducted,...item})=>item)};
  db.prepare("UPDATE records SET data=? WHERE kind='order' AND id=?").run(JSON.stringify(legacy),o.id);db.close();
  s.restoreFrom(backup);s.login('owner','password123');
  assert.throws(()=>s.refundOrder(o.id,'Return','return'),/unknown/);
  assert.equal(s.snapshot().products[0].stock,8);assert.equal(s.snapshot().orders[0].refunded,0);
  assert.equal(s.refundOrder(o.id,'Manual stock review','waste').products[0].stock,8);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('zero-total orders are settled and cannot be collected repeatedly',()=>{
 const {s,dir}=fixture();try {
  s.openDay(0);
  for(const method of ['cash','unpaid'] as const){
   const o=s.createOrder({...sale('p',method),discount:200,cashReceived:0}).orders[0];
   assert.equal(o.total,0);
   assert.throws(()=>s.collectPayment(o.id,'cash',0),/cannot be collected/);
   assert.throws(()=>s.collectPayment(o.id,'card',0),/cannot be collected/);
  }
  assert.equal(s.snapshot().closing?.expectedCash,0);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('store requires service and credit details and normalizes irrelevant fields',()=>{
 const {s,dir}=fixture();try {
  s.openDay(0);
  assert.throws(()=>s.createOrder({...sale('p'),type:'delivery',address:'  '}),/delivery address/);
  assert.throws(()=>s.createOrder({...sale('p'),type:'dine-in',table:''}),/table/);
  assert.throws(()=>s.createOrder({...sale('p','unpaid'),customer:'  '}),/customer/);
  assert.equal(s.snapshot().products[0].stock,10);assert.equal(s.snapshot().orders.length,0);
  const o=s.createOrder({...sale('p'),table:'stale',address:'stale',rider:'stale'}).orders[0];
  assert.equal(o.table,'');assert.equal(o.address,'');assert.equal(o.rider,'');assert.equal(o.number,1);
  assert.doesNotThrow(()=>s.createOrder({...sale('p'),type:'delivery',address:'Main road',phone:'03001234567'}));
  assert.doesNotThrow(()=>s.createOrder({...sale('p'),type:'dine-in',table:'4'}));
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});

test('product images persist through restart and backups, reject unsafe data and support removal',()=>{
 const {s,dir,path}=fixture();let restarted:Store|undefined;try {
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=';
  const product=s.snapshot().products[0];
  s.saveProduct({...product,image});
  assert.equal(s.snapshot().products[0].image,image);
  for(const invalid of ['https://example.com/image.jpg','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YmFk','data:image/jpeg;base64,'+'A'.repeat(1500001)]) assert.throws(()=>s.saveProduct({...product,image:invalid}),/image/);
  assert.equal(s.snapshot().products[0].image,image);
  const backup=join(dir,'image.sqlite');s.backupTo(backup);
  s.saveProduct({...product,image:''});assert.equal(s.snapshot().products[0].image,'');
  s.restoreFrom(backup);s.login('owner','password123');assert.equal(s.snapshot().products[0].image,image);
  s.close();restarted=new Store(path);restarted.login('owner','password123');assert.equal(restarted.snapshot().products[0].image,image);
  restarted.saveProduct({...restarted.snapshot().products[0],image:''});assert.equal(restarted.snapshot().products[0].image,'');
 }finally{try{s.close();}catch{}restarted?.close();rmSync(dir,{recursive:true,force:true});}
});

test('service/payment matrix preserves identity and clears unrelated service/tender fields',()=>{
 const {s,dir}=fixture();try{
  s.openDay(1000);s.saveProduct({...s.snapshot().products[0],trackStock:false});
  for(const type of ['delivery','dine-in','takeaway'] as const) for(const paymentMethod of ['cash','card','bank','unpaid'] as const){
   const input={...sale('p',paymentMethod),type,customer:`${type} ${paymentMethod}`,phone:'03001234567',address:'Delivery street',table:'7',rider:'Rider Ali',deliveryCharge:50,cashReceived:500};
   const o=s.createOrder(input).orders[0];
   assert.equal(o.type,type);assert.equal(o.customer,input.customer);assert.equal(o.phone,input.phone);
   assert.equal(o.address,type==='delivery'?input.address:'');assert.equal(o.rider,type==='delivery'?input.rider:'');assert.equal(o.table,type==='dine-in'?'7':'');
   assert.equal(o.deliveryCharge,type==='delivery'?50:0);assert.equal(o.total,type==='delivery'?250:200);
   assert.equal(o.cashReceived,paymentMethod==='cash'?500:0);assert.equal(o.paid,paymentMethod==='unpaid'?0:o.total);
  }
  const before=s.snapshot().orders.length;
  for(const missing of ['customer','phone','address'])assert.throws(()=>s.createOrder({...sale('p'),type:'delivery',customer:'Ali',phone:'03001234567',address:'Road',[missing]:'   '}),/Invalid/);
  assert.equal(s.snapshot().orders.length,before);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
