import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
import {File} from 'node:buffer';

const source=readFileSync(new URL('../_worker.js',import.meta.url),'utf8').replace('export default {','const worker = {');
const catalogText=readFileSync(new URL('../catalog.v2026-11-17.js',import.meta.url),'utf8');
const catalog=JSON.parse(catalogText.trim().slice('globalThis.NX_CATALOG = '.length,-1));
const factory=new Function('TextEncoder','Response','crypto','URL','fetch','File','FormData','Request',source+
  '\nreturn {worker,formattedUsage,deviceIds,omanMonth,VERIFIED_PLANS,VERIFIED_SPECS,usageRequest,countVisitor,submitOrder,handleDecision};');
const uuid='8f8125fb-e978-41af-9767-1d41fa1260ab';
const key='aef93f65-cc39-40dc-a513-3d487e91787c';
const accessHash=createHash('sha256').update(key).digest('hex');
const lpa='LPA:1$activation.example$code-123';
function environment(status='ready'){
  const order={id:uuid,access_hash:accessHash,status,topup_id:'test-topup',mode:'production',delivery:JSON.stringify({lpa}),product_name:'Test',duration:'1 day',price_baisa:450};
  const visitors=new Set();
  const calls={db:[],network:[],visitors,telegram:0,orders:0};
  const db={prepare(sql){
    return {bind(...params){
      return {
        async first(){
          calls.db.push({kind:'first',sql,params});
          if(sql.includes('SELECT * FROM orders WHERE'))return params[0]===uuid&&params[1]===accessHash?order:null;
          if(sql.includes('COUNT(*)'))return {total:visitors.size};
          if(sql.includes('INSERT INTO orders'))return null;
          return null;
        },
        async all(){
          calls.db.push({kind:'all',sql,params});
          return {results:sql.includes('instr(delivery')&&order.delivery.includes(params[0])?[order]:[]};
        },
        async run(){
          calls.db.push({kind:'run',sql,params});
          if(sql.includes('monthly_visitors'))visitors.add(params[0]+':'+params[1]);
          return {success:true};
        }
      };
    }};
  }};
  const env={ORDERS_DB:db,MICROESIM_ACCOUNT:'test-account',MICROESIM_SECRET:'test-secret',MICROESIM_SALT:'abcd',
    MICROESIM_MODE:'production',MICROESIM_PLAN_MAP:'{}',TELEGRAM_BOT_TOKEN:'fake-token',
    TELEGRAM_WEBHOOK_SECRET:'test-webhook-secret',TELEGRAM_CHAT_ID:'123',
    VISITOR_HASH_SECRET:'test-monthly-hash-key',
    ASSETS:{async fetch(){return new Response(catalogText,{status:200})}}};
  return {env,order,calls};
}
function engine(calls,options={}){
  const mockFetch=async (url,request)=>{
    calls.network.push({url:String(url),method:request?.method});
    if(String(url).includes('api.telegram.org')){
      calls.telegram++;return Response.json({ok:true,result:{message_id:1}});
    }
    if(options.providerDown)return new Response('unavailable',{status:503});
    if(String(url).endsWith('/topupDetail'))return Response.json({code:1,result:{device_ids:['device-a']}});
    if(String(url).endsWith('/deviceDetail'))return Response.json({code:1,result:options.deviceData??{data_usage:0,data_usage_daily:1500,is_daily:true,daily_reset_time:'12:00'}});
    if(String(url).endsWith('/esimSubscribe'))return Response.json({code:1,result:{topup_id:'test-topup'}});
    throw Error('Unexpected network request');
  };
  return factory(TextEncoder,Response,webcrypto,URL,mockFetch,File,FormData,Request);
}
const track='https://nexsubstore.com/order/'+uuid+'/'+key;
function usage(reference){
  return new Request('https://nexsubstore.com/api/usage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference})});
}
function form(product_id,variant,extras={}){
  const f=new FormData();f.set('name','Test Customer');f.set('product_id',product_id);f.set('variant',String(variant));
  f.set('catalog_version','2026-11-17');
  for(const [key,value]of Object.entries(extras))f.set(key,value);
  return new Request('https://nexsubstore.com/api/order',{method:'POST',body:f});
}
test('17 pinned plans precisely match duration, price and MicroeSIM ID',()=>{
  const {VERIFIED_PLANS,VERIFIED_SPECS}=engine({network:[],telegram:0});
  assert.equal(Object.keys(VERIFIED_PLANS).length,17);
  assert.equal(Object.keys(VERIFIED_SPECS).length,17);
  for(const [variant,id]of Object.entries(VERIFIED_PLANS)){
    assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    const [product,index]=variant.split(':');
    const actual=catalog.find(p=>p.id===product).d[Number(index)];
    assert.deepEqual([actual[0],actual[1]],[VERIFIED_SPECS[variant].days,VERIFIED_SPECS[variant].price]);
  }
  assert.equal(catalog.find(p=>p.id==='mb500').d[0][1],300);
  assert.equal(catalog.find(p=>p.id==='un').t,'باقات اللامحدود (عُمان و+52)');
});
test('0 MB and decimal MB/GB conversion, explicit units',()=>{
  const f=engine({network:[],telegram:0}).formattedUsage;
  assert.equal(f(0).formatted,'0 MB');
  assert.equal(f('0 MB').formatted,'0 MB');
  assert.equal(f(999).formatted,'999 MB');
  assert.equal(f(1000).formatted,'1 GB');
  assert.equal(f(1500).formatted,'1.5 GB');
  assert.equal(f('2 GB').formatted,'2 GB');
  assert.equal(f(500).assumed_mb,true);
  assert.equal(f(null),null);
  assert.equal(f('bogus'),null);
});
test('device ID arrays, duplicates and month timezone',()=>{
  const api=engine({network:[],telegram:0});
  assert.deepEqual(api.deviceIds({device_ids:['a','a','b']}),['a','b']);
  assert.match(api.omanMonth(),/^\d{4}-\d{2}$/);
});
test('usage with authorized order link returns total zero and optional daily data',async()=>{
  const {env,calls}=environment();
  const result=await engine(calls).usageRequest(usage(track),env);
  assert.equal(result.status,200);
  const data=await result.json();
  assert.equal(data.devices[0].usage.formatted,'0 MB');
  assert.equal(data.devices[0].daily.formatted,'1.5 GB');
  assert.equal(data.devices[0].daily_reset_time,'12:00');
  assert.equal(calls.network.filter(x=>x.url.includes('microesim')).length,2);
});
test('full LPA QR payload matches ready order and never follows any URL',async()=>{
  const {env,calls}=environment();
  const response=await engine(calls).usageRequest(usage(lpa),env);
  assert.equal(response.status,200);
  assert.equal(calls.network.length,2);
});
test('bad link, wrong activation value and pending order fail without provider calls',async()=>{
  const invalid=environment();
  assert.equal((await engine(invalid.calls).usageRequest(usage(track.replace(key,uuid)),invalid.env)).status,404);
  assert.equal((await engine(invalid.calls).usageRequest(usage(lpa+'-wrong'),invalid.env)).status,404);
  assert.equal(invalid.calls.network.length,0);
  const pending=environment('pending');
  assert.equal((await engine(pending.calls).usageRequest(usage(track),pending.env)).status,409);
  assert.equal(pending.calls.network.length,0);
});
test('provider failure is returned with no private identifiers or provider error text',async()=>{
  const {env,calls}=environment();
  const response=await engine(calls,{providerDown:true}).usageRequest(usage(track),env);
  assert.equal(response.status,502);
  const result=await response.text();
  assert.equal(result.includes(uuid)||result.includes(key)||result.includes(lpa),false);
});
test('other subscriptions rejected, Netflix/OSN+ keep same-site Telegram ordering',async()=>{
  const {env,calls}=environment();
  const api=engine(calls);
  assert.equal((await api.submitOrder(form('s-sh',0,{whatsapp:'96890000000'}),env)).status,403);
  assert.equal((await api.submitOrder(form('s-nf',0,{whatsapp:'96890000000'}),env)).status,200);
  assert.equal((await api.submitOrder(form('s-osn',0,{whatsapp:'96890000000'}),env)).status,200);
  assert.equal(calls.telegram,2);
});
test('eSIM requires sender WhatsApp and receipt, with server catalog version',async()=>{
  const {env,calls}=environment();
  const api=engine(calls);
  assert.equal((await api.submitOrder(form('gb1',0),env)).status,400);
  assert.equal((await api.submitOrder(form('gb1',0,{transfer_whatsapp:'96890000000'}),env)).status,400);
  const wrongVersion=form('gb1',0,{transfer_whatsapp:'96890000000'});
  const versionData=await wrongVersion.formData();versionData.set('catalog_version','older');
  assert.equal((await api.submitOrder(new Request('https://nexsubstore.com/api/order',{method:'POST',body:versionData}),env)).status,409);
  assert.equal(calls.telegram,0);
});
test('same browser visited twice counts once; different browser counts twice',async()=>{
  const {env,calls}=environment();
  const api=engine(calls);
  const first=await api.countVisitor(new Request('https://nexsubstore.com/api/visitor',{method:'POST'}),env);
  const cookie=first.headers.get('Set-Cookie').split(';')[0];
  await api.countVisitor(new Request('https://nexsubstore.com/api/visitor',{method:'POST',headers:{Cookie:cookie}}),env);
  assert.equal(calls.visitors.size,1);
  await api.countVisitor(new Request('https://nexsubstore.com/api/visitor',{method:'POST'}),env);
  assert.equal(calls.visitors.size,2);
});
test('visitor statistics command is admin-only',async()=>{
  const {env,calls}=environment();
  const api=engine(calls);
  const telegramReq=from=>({headers:new Headers({'X-Telegram-Bot-Api-Secret-Token':env.TELEGRAM_WEBHOOK_SECRET}),json:async()=>({message:{text:'زوار الشهر',chat:{type:'private',id:123},from:{id:from}}})});
  await api.handleDecision(telegramReq(777),env);
  assert.equal(calls.telegram,0);
  await api.handleDecision(telegramReq(123),env);
  assert.equal(calls.telegram,1);
});
