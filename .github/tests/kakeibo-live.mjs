import fs from 'node:fs';

const targetUrl = 'https://s4k62k5kyz-design.github.io/today5/kakeibo/';
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

fs.writeFileSync('/tmp/receipt.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNfWQAAAAASUVORK5CYII=', 'base64'));

const created = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(targetUrl), { method:'PUT' });
if (!created.ok) throw new Error('Could not create Chrome tab: ' + created.status);
const info = await created.json();
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ ws.onopen=resolve; ws.onerror=reject; });

let id=0;
const pending=new Map();
const exceptions=[];
let chooserOpened=false;
ws.onmessage=(e)=>{
  const m=JSON.parse(e.data);
  if(m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); return; }
  if(m.method==='Runtime.exceptionThrown') exceptions.push(m.params?.exceptionDetails?.text || 'runtime exception');
  if(m.method==='Page.fileChooserOpened') chooserOpened=true;
};
function cmd(method,params={}){return new Promise(res=>{const n=++id;pending.set(n,res);ws.send(JSON.stringify({id:n,method,params}))})}
async function ev(expression){
  const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.result?.exceptionDetails) throw new Error('Evaluate failed: '+JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function waitFor(expr,timeout=10000){
  const end=Date.now()+timeout;
  while(Date.now()<end){ if(await ev(expr)) return true; await new Promise(r=>setTimeout(r,150)); }
  throw new Error('Timed out waiting for '+expr);
}

await cmd('Page.enable');
await cmd('Runtime.enable');
await cmd('DOM.enable');
await cmd('Page.setInterceptFileChooserDialog',{enabled:true});
await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
await new Promise(r=>setTimeout(r,3500));

const basic=await ev(`(() => ({
  title:document.title,
  url:location.href,
  testHook:typeof window.__appTest,
  navs:document.querySelectorAll('[data-nav]').length,
  overflow:document.documentElement.scrollWidth-window.innerWidth,
  receiptButton:document.getElementById('quickReceipt')?.textContent||''
}))()`);
console.log(JSON.stringify({basic}));
if(basic.title!=='くらし家計簿') throw new Error('Wrong title: '+basic.title);
if(basic.testHook!=='object') throw new Error('App JS did not initialize');
if(basic.navs!==4) throw new Error('Bottom nav count wrong');
if(basic.overflow>1) throw new Error('Mobile horizontal overflow: '+basic.overflow);
if(!basic.receiptButton.includes('レシート登録')) throw new Error('Receipt button missing');

const parsed=await ev('window.__appTest.parseReceiptText('+JSON.stringify(fixture)+')');
console.log(JSON.stringify({parsed}));
if(parsed.total!==460) throw new Error('Receipt total wrong: '+parsed.total);
if(parsed.items.length!==3) throw new Error('Receipt item count wrong: '+parsed.items.length);
if(parsed.items[0].amount!==129) throw new Error('Discount allocation wrong: '+parsed.items[0].amount);
if(parsed.items.reduce((s,x)=>s+x.amount,0)!==460) throw new Error('Item sum is not 460');
if(parsed.category!=='食費') throw new Error('Receipt category wrong: '+parsed.category);

// Clean state and manual expense
await ev('window.__appTest.reset(); true');
const manual=await ev(`(() => {
  const d=new Date();
  const date=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  document.getElementById('quickExpense').click();
  document.getElementById('entryAmount').value='1234';
  document.getElementById('entryDate').value=date;
  document.getElementById('entryMemo').value='動作確認';
  document.getElementById('entryForm').requestSubmit();
  return {date,key:date.slice(0,7)};
})()`);
await new Promise(r=>setTimeout(r,200));
if((await ev('window.__appTest.db().tx.length'))!==1) throw new Error('Manual expense was not saved');
if((await ev('window.__appTest.totals('+JSON.stringify(manual.key)+').expense'))!==1234) throw new Error('Manual expense total wrong');

// Budget
await ev(`(() => {
  document.querySelector('[data-nav="plan"]').click();
  document.getElementById('budgetInput').value='10000';
  document.getElementById('saveBudget').click();
  return true;
})()`);
if((await ev('window.__appTest.db().budgets['+JSON.stringify(manual.key)+']'))!==10000) throw new Error('Budget did not save');

// One-tap receipt button must open the modal AND the browser file chooser.
const receiptOpened=await ev(`(() => {
  document.querySelector('[data-nav="home"]').click();
  document.getElementById('quickReceipt').click();
  return document.getElementById('receiptDialog').open;
})()`);
if(!receiptOpened) throw new Error('One-tap receipt button did not open receipt flow');
for(let i=0;i<20&&!chooserOpened;i++) await new Promise(r=>setTimeout(r,100));
if(!chooserOpened) throw new Error('One-tap receipt button did not open the browser file chooser');

// Stub OCR engine and call the real file-change handler with a real File object.
await ev(`(() => {
  window.Tesseract={
    recognize:async(_c,_l,o={})=>{
      o.logger?.({status:'recognizing text',progress:.3});
      o.logger?.({status:'recognizing text',progress:1});
      return {data:{text:${JSON.stringify(fixture)}}};
    }
  };
  return true;
})()`);
await ev(`(async () => {
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNfWQAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const file=new File([bytes], 'receipt.png', {type:'image/png'});
  await document.getElementById('receiptImage').onchange({target:{files:[file]}});
  return true;
})()`);
await waitFor("!document.getElementById('receiptResult').classList.contains('hidden')",10000);
const filled=await ev(`(() => ({
  total:document.getElementById('receiptTotal').value,
  merchant:document.getElementById('receiptMerchant').value,
  category:document.getElementById('receiptCategory').value,
  status:document.getElementById('scanState').textContent
}))()`);
console.log(JSON.stringify({filled}));
if(filled.total!=='460') throw new Error('Auto-filled receipt total wrong: '+filled.total);
if(!/FamilyMart/i.test(filled.merchant)) throw new Error('Merchant not auto-filled');
if(filled.category!=='食費') throw new Error('Category not auto-filled');
await ev("document.getElementById('saveReceipt').click(); true");
const savedReceipt=await ev("window.__appTest.db().tx.filter(x=>x.source==='receipt').at(-1)");
if(savedReceipt?.amount!==460) throw new Error('Saved receipt amount wrong');

// Automatic monthly savings
const saving=await ev(`(() => {
  const d=window.__appTest.db();
  const p=new Date();p.setDate(1);p.setMonth(p.getMonth()-1);
  const key=p.getFullYear()+'-'+String(p.getMonth()+1).padStart(2,'0');
  d.budgets[key]=10000;
  d.tx.push({id:'prev-test',type:'expense',amount:7000,date:key+'-15',category:'食費',memo:'test',merchant:'',items:[],source:'manual',recurringId:'',createdAt:Date.now()});
  window.__appTest.syncAutoSavings();
  return d.autoSavings[key]?.amount;
})()`);
if(saving!==3000) throw new Error('Automatic savings wrong: '+saving);

// Recurring must be idempotent
const recurring=await ev(`(() => {
  const d=window.__appTest.db();
  d.recurring.push({id:'rec-live',type:'expense',name:'固定費テスト',amount:500,day:1,category:'通信',active:true});
  const a=window.__appTest.syncRecurring();
  const b=window.__appTest.syncRecurring();
  return [a,b,d.tx.filter(x=>String(x.recurringId).startsWith('rec-live:')).length];
})()`);
if(JSON.stringify(recurring)!==JSON.stringify([1,0,1])) throw new Error('Recurring duplicate prevention failed: '+JSON.stringify(recurring));

if(exceptions.length) throw new Error('Runtime exceptions: '+JSON.stringify(exceptions));
console.log('Live Kakeibo browser verification passed');
ws.close();
