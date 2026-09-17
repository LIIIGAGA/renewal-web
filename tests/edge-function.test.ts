import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto, createHmac } from 'node:crypto';
import ts from 'typescript';

const secret = 'a'.repeat(64);
async function worker(options: { active?:boolean; providerStatus?:number; confirmed?:boolean; provider?:string; providerBody?:string; serviceName?:string } = {}) {
  const source = (await readFile(new URL('../supabase/functions/send-reminders/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/,'');
  const code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const billingAt = new Date(Date.now()+23*3600000).toISOString();
  const claim = {delivery_id:'delivery-1',subscription_id:'subscription-1',user_id:'owner-1',billing_at:billingAt,lease_token:'lease-1'};
  const subscription = {id:'subscription-1',active:options.active??true,reminder_enabled:true,next_billing_at:billingAt,timezone:'Asia/Shanghai',price:20,currency:'USD',service_name:options.serviceName??'Test Service',plan:'Plus',auto_renew:true,cancellation_method:'Cancel in settings',cancellation_url:'https://example.com/cancel',notes:'Personal notes'};
  const results: Record<string,unknown>[] = []; const emails: {url:string;init:RequestInit}[]=[]; let databaseCalls=0;
  const db = {
    from(table:string) { return {select(){return {eq(){return {async maybeSingle(){ return {data:table==='subscriptions'?subscription:{user_id:'owner-1'},error:null}; }};}};}}; },
    auth:{admin:{async getUserById(){return {data:{user:{email:'owner@example.com',email_confirmed_at:options.confirmed===false?null:'confirmed'}},error:null};}}},
    async rpc(name:string,args?:Record<string,unknown>) {
      if(name==='claim_due_reminders')return {data:[claim],error:null};
      if(name==='prepare_reminder')return {data:args!.payload,error:null};
      results.push(args!); return {data:null,error:null};
    },
  };
  let handler!: (request:Request)=>Promise<Response>;
  vm.runInNewContext(code,{
    Deno:{env:{get(name:string){return ({EMAIL_PROVIDER:options.provider,ALIYUN_ACCESS_KEY_ID:'test-id',ALIYUN_ACCESS_KEY_SECRET:'test-secret',ALIYUN_DM_ACCOUNT:'reminder@example.com',CRON_SECRET:secret,RESEND_API_KEY:options.provider==='aliyun'?undefined:'server-key',REMINDER_FROM:'Renewal <reminder@example.com>',APP_URL:'https://app.example.com',SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-service-role'} as Record<string,string|undefined>)[name];}},serve(h:typeof handler){handler=h;}},
    createClient(){databaseCalls++;return db;},
    async fetch(url:string,init:RequestInit){emails.push({url,init});return new Response(options.providerBody??(options.provider==='aliyun'?'{"RequestId":"request-1"}':'{}'),{status:options.providerStatus??200});},
    crypto:webcrypto,TextEncoder,Uint8Array,Request,Response,AbortSignal,URL,URLSearchParams,btoa,Intl,Date,console:{error(){}},setTimeout(callback:()=>void){callback();},
  });
  return {handler,results,emails,databaseCalls:()=>databaseCalls};
}
function request(value=secret,method='POST') { return new Request('https://function.example.com',{method,headers:{'x-cron-secret':value}}); }
test('worker rejects wrong secrets and methods before touching database or provider',async()=>{
  const w=await worker(); assert.equal((await w.handler(request('wrong'))).status,401);assert.equal((await w.handler(request(secret,'GET'))).status,405);assert.equal(w.databaseCalls(),0);assert.equal(w.emails.length,0);
});
test('worker sends immutable snapshot with idempotency key then finishes delivery',async()=>{
  const w=await worker();const response=await w.handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{claimed:1,sent:1,failed:0,cancelled:0});assert.equal(w.emails.length,1);assert.equal(w.emails[0].url,'https://api.resend.com/emails');assert.equal((w.emails[0].init.headers as Record<string,string>)['Idempotency-Key'],'renewal/delivery-1');
  const payload=JSON.parse(w.emails[0].init.body as string);assert.deepEqual(payload.to,['owner@example.com']);assert.match(payload.text,/Cancel in settings/);assert.equal(w.results[0].result,'sent');
});
test('disabled subscription is cancelled without an email request',async()=>{
  const w=await worker({active:false});await w.handler(request());assert.equal(w.emails.length,0);assert.equal(w.results[0].result,'cancelled');
});
test('provider failures and unconfirmed recipients get retriable failures, never success',async()=>{
  const w=await worker({providerStatus:429});assert.equal((await w.handler(request())).status,207);assert.equal(w.results[0].result,'failed');assert.equal(w.results[0].error_message,'Email provider HTTP 429');
  const unconfirmed=await worker({confirmed:false});await unconfirmed.handler(request());assert.equal(unconfirmed.emails.length,0);assert.equal(unconfirmed.results[0].result,'failed');
});

test('mainland worker signs Aliyun HTTPS POST and needs no Resend key', async () => {
  const w = await worker({provider:'aliyun', serviceName:'会员! + * 中文'.repeat(15)});
  assert.equal((await w.handler(request())).status,200);
  assert.equal(w.emails[0].url,'https://dm.aliyuncs.com/');
  const params = new URLSearchParams(w.emails[0].init.body as string);
  const signature = params.get('Signature'); params.delete('Signature');
  const encode = (s:string) => encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  const canonical = [...params].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${encode(k)}=${encode(v)}`).join('&');
  assert.equal(signature, createHmac('sha1','test-secret&').update(`POST&%2F&${encode(canonical)}`).digest('base64'));
  assert.equal(params.get('AccountName'),'reminder@example.com');
  assert.equal(params.get('ToAddress'),'owner@example.com');
  assert.ok([...(params.get('Subject')??'')].length<=100);
  assert.match(params.get('TextBody')??'',/Cancel in settings/);
  assert.equal(w.results[0].result,'sent');
});

test('Aliyun business rejection and unknown providers cannot report sent',async()=>{
  const rejected=await worker({provider:'aliyun',providerBody:'{"Code":"InvalidMailAddressStatus.Malformed"}'});
  assert.equal((await rejected.handler(request())).status,207);
  assert.equal(rejected.results[0].result,'failed');
  const unknown=await worker({provider:'unknown'});
  assert.equal((await unknown.handler(request())).status,500);
  assert.equal(unknown.databaseCalls(),0);
});
