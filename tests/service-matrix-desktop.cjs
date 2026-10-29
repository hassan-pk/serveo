const {_electron:electron,expect}=require('@playwright/test');
const {mkdtempSync}=require('node:fs');const {tmpdir}=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');
const data=mkdtempSync(path.join(tmpdir(),'serveo-service-matrix-'));const env={...process.env,SERVEO_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;delete env.SERVEO_DEV_URL;
let app;let page;const errors=[];
async function launch(){app=await electron.launch(process.env.SERVEO_TEST_EXECUTABLE?{executablePath:path.resolve(process.env.SERVEO_TEST_EXECUTABLE),args:[],env}:{args:[path.resolve('.')],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));}
(async()=>{
 await launch();await page.getByLabel('Shop name',{exact:true}).fill('Service Matrix');await page.getByLabel('Your name',{exact:true}).fill('Owner');await page.getByLabel('Username',{exact:true}).fill('owner');await page.getByLabel('Password',{exact:true}).fill('matrix-password');await page.getByRole('button',{name:'Create my shop'}).click();
 await page.evaluate(async()=>{await window.serveo.saveProduct({id:'tea',name:'Matrix Tea',category:'Drinks',variant:'',price:100,stock:0,trackStock:false,active:true});await window.serveo.openDay(1000);});await page.reload();
 const recorded=[];
 for(const type of ['delivery','dine-in','takeaway']) for(const method of ['cash','card','bank','unpaid']){
  await page.locator('[data-action="nav:pos"]').first().click();await page.locator('[data-action="add:tea"]').click();
  // Select payment first; delivery or credit may automatically open details.
  await page.locator('select[name=paymentMethod]').selectOption(method);
  if(await page.locator('[data-form="basket-details"]').count())await page.getByRole('button',{name:'Close dialog'}).click();
  await page.locator(`[data-action="type:${type}"]`).click();
  if(!await page.locator('[data-form="basket-details"]').count())await page.locator('[data-action="basket-details"]').click();
  const customer=`${type} ${method} Customer`;
  await page.getByLabel('Customer name',{exact:true}).fill(customer);await page.getByLabel('Phone',{exact:true}).fill('03001234567');
  if(type==='delivery'){
   await page.getByLabel('Delivery address',{exact:true}).fill('Street 9');await page.getByLabel('Rider name',{exact:true}).fill('Rider Ali');await page.getByLabel('Delivery charge',{exact:true}).fill('50');
   // Missing phone must prevent detail save; no order may be created.
   await page.getByLabel('Phone',{exact:true}).fill('');await page.getByRole('button',{name:'Save details',exact:true}).click();await expect(page.locator('[data-form="basket-details"]')).toBeVisible();await page.getByLabel('Phone',{exact:true}).fill('03001234567');
  }
  if(type==='dine-in')await page.getByLabel('Table number',{exact:true}).fill('7');
  await page.getByRole('button',{name:'Save details',exact:true}).click();
  if(method==='cash')await page.getByLabel('Cash received',{exact:true}).fill('500');
  await page.locator('.checkout').click();await expect(page.locator('.order-modal')).toBeVisible();
  const modal=page.locator('.order-modal');await expect(modal).toContainText(customer);await expect(modal).not.toContainText('Walk-in customer');await expect(modal).toContainText('03001234567');
  if(type==='delivery' && method==='cash')await page.screenshot({path:'test-results/delivery-order-016.png'});
  const snap=await page.evaluate(()=>window.serveo.snapshot());const o=snap.orders.reduce((a,b)=>a.number>b.number?a:b);recorded.push({id:o.id,customer,type,method});
  assert.equal(o.type,type);assert.equal(o.customer,customer);assert.equal(o.address,type==='delivery'?'Street 9':'');assert.equal(o.table,type==='dine-in'?'7':'');assert.equal(o.rider,type==='delivery'?'Rider Ali':'');assert.equal(o.deliveryCharge,type==='delivery'?50:0);assert.equal(o.total,type==='delivery'?150:100);assert.equal(o.cashReceived,method==='cash'?500:0);
  for(const kind of ['receipt','kitchen','invoice']){
   await page.locator(`[data-action="print:${kind}"]`).click();const body=page.frameLocator('.print-preview-frame').locator('body');await expect(body).toContainText(customer);await expect(body).toContainText('03001234567');await expect(body).toContainText(type==='delivery'?'Delivery':type==='dine-in'?'Dine-in':'Takeaway');
   if(type==='delivery'){await expect(body).toContainText('Street 9');await expect(body).toContainText('Rider Ali');}else{await expect(body).not.toContainText('Street 9');await expect(body).not.toContainText('Rider Ali');}
   if(type==='dine-in')await expect(body).toContainText('Table 7');else await expect(body).not.toContainText('Table 7');
   if(type==='delivery' && method==='cash' && kind==='invoice')await page.screenshot({path:'test-results/delivery-invoice-016.png'});
   await page.locator('[data-action="back-order"]').click();
  }
  if(method==='unpaid'){
   await page.locator('[data-form="payment"] select[name=method]').selectOption('cash');
   await page.locator('[data-form="payment"] input[name=cashReceived]').fill('500');
   await page.getByRole('button',{name:'Collect payment',exact:true}).click();
   await page.locator(`[data-action="order:${o.id}"]`).click();
   await expect(page.locator('.order-modal')).toContainText(customer);
   const collected=await page.evaluate(id=>window.serveo.snapshot().then(s=>s.orders.find(o=>o.id===id)),o.id);
   assert.equal(collected.type,type);assert.equal(collected.customer,customer);assert.equal(collected.paid,collected.total);
   await page.locator('[data-action="print:invoice"]').click();await expect(page.frameLocator('.print-preview-frame').locator('body')).toContainText(customer);await page.locator('[data-action="back-order"]').click();
  }
  await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.locator(`[data-action="order:${o.id}"]`).locator('..').locator('..')).toContainText(customer);
 }
 // Switching away from delivery must clear the fee, including in the displayed total.
 await page.locator('[data-action="nav:pos"]').first().click();await page.locator('[data-action="add:tea"]').click();await page.locator('[data-action="type:delivery"]').click();
 await page.getByLabel('Customer name',{exact:true}).fill('Switch customer');await page.getByLabel('Phone',{exact:true}).fill('03001234567');await page.getByLabel('Delivery address',{exact:true}).fill('Old delivery address');await page.getByLabel('Delivery charge',{exact:true}).fill('80');await page.getByRole('button',{name:'Save details',exact:true}).click();
 await expect(page.locator('#basket-total')).toContainText('180.00');await page.locator('[data-action="type:takeaway"]').click();await expect(page.locator('#basket-total')).toContainText('100.00');await page.getByLabel('Cash received',{exact:true}).fill('100');await page.locator('.checkout').click();await expect(page.locator('.order-modal')).toBeVisible();
 const switched=await page.evaluate(()=>window.serveo.snapshot());const last=switched.orders.reduce((a,b)=>a.number>b.number?a:b);assert.equal(last.type,'takeaway');assert.equal(last.address,'');assert.equal(last.deliveryCharge,0);
 await app.close();await launch();await page.getByLabel('Username',{exact:true}).fill('owner');await page.getByLabel('Password',{exact:true}).fill('matrix-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();const persisted=await page.evaluate(()=>window.serveo.snapshot());assert.equal(persisted.orders.length,13);for(const expected of recorded){const actual=persisted.orders.find(o=>o.id===expected.id);assert.equal(actual.customer,expected.customer);assert.equal(actual.type,expected.type);}
 assert.deepEqual(errors,[]);console.log('Service matrix passed: 12 actual sales, all 3 service types x 4 payment methods, 39 document previews, later unpaid cash collection, required delivery details, service switching/fee cleanup, order list/detail, and restart persistence. Temporary data:',data);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
