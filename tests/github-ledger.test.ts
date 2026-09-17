import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubLedger, GitHubConflict } from '../lib/github-ledger';
import { blankSubscription, type Subscription } from '../lib/subscriptions';
const entry:Subscription={...blankSubscription(),service_name:'中文会员 🎵',notes:'备注\n第二行',id:'11111111-1111-4111-8111-111111111111',updated_at:new Date().toISOString()};
function mock(responses:{status?:number;body:unknown}[]) {
  const calls:{url:string;init:RequestInit}[]=[];
  const request:typeof fetch=async(input,init)=>{calls.push({url:String(input),init:init??{}});const next=responses.shift();assert.ok(next,'Unexpected API request');return Response.json(next.body,{status:next.status??200});};
  return {client:new GitHubLedger({owner:'Owner',repo:'renewal-data',token:'fake-token'},request),calls};
}
function file(rows:unknown[]=[entry]) {return {type:'file',size:1000,encoding:'base64',sha:'old-sha',content:Buffer.from(JSON.stringify({format:'renewal-ledger',version:1,subscriptions:rows})).toString('base64')};}
test('GitHub UTF-8 ledger retains IDs, checks privacy and writes expected revision',async()=>{
  const m=mock([{body:file()},{body:{private:true}},{body:{private:true}},{body:{content:{sha:'new-sha'}}}]);
  const snapshot=await m.client.read();assert.deepEqual(snapshot.subscriptions,[entry]);
  assert.equal(await m.client.write(snapshot.subscriptions,snapshot.sha),'new-sha');
  const body=JSON.parse(m.calls[3].init.body as string);assert.equal(body.sha,'old-sha');
  const document=JSON.parse(Buffer.from(body.content,'base64').toString('utf8'));assert.equal(document.subscriptions[0].notes,entry.notes);
  assert.ok(!JSON.stringify(document).includes('fake-token'));
  assert.equal((m.calls[3].init.headers as Record<string,string>).Authorization,'Bearer fake-token');
});
test('missing file is empty only when a private repo is accessible; never writes on connect',async()=>{
  const fresh=mock([{status:404,body:{}},{body:{private:true}}]);assert.deepEqual(await fresh.client.read(),{sha:null,subscriptions:[]});assert.ok(fresh.calls.every(c=>!c.init.method));
  const denied=mock([{status:404,body:{}},{status:404,body:{}}]);await assert.rejects(denied.client.read(),/权限/);
  const publicRepo=mock([{body:file()},{body:{private:false}}]);await assert.rejects(publicRepo.client.read(),/私有/);
});
test('GitHub conflicting revision and changed visibility cannot overwrite a ledger',async()=>{
  const stale=mock([{body:{private:true}},{status:409,body:{}}]);await assert.rejects(stale.client.write([entry],'stale'),GitHubConflict);
  const publicRepo=mock([{body:{private:false}}]);await assert.rejects(publicRepo.client.write([entry],'old-sha'),/私有/);assert.equal(publicRepo.calls.length,1);
});
test('GitHub malformed records and duplicate IDs are rejected',async()=>{
  const unsafe=mock([{body:file([{...entry,cancellation_url:'javascript:alert(1)'}])},{body:{private:true}}]);await assert.rejects(unsafe.client.read(),/格式/);
  const duplicates=mock([{body:file([entry,entry])},{body:{private:true}}]);await assert.rejects(duplicates.client.read(),/格式/);
});

test('old private ledger gains Other without changing IDs; category saves with the original SHA',async()=>{
  const {category,...legacy}=entry;
  const m=mock([{body:file([legacy])},{body:{private:true}},{body:{private:true}},{body:{content:{sha:'new-sha'}}}]);
  const snapshot=await m.client.read();assert.equal(snapshot.subscriptions[0].category,'其他');assert.equal(snapshot.subscriptions[0].id,entry.id);
  snapshot.subscriptions[0].category='AI';await m.client.write(snapshot.subscriptions,snapshot.sha);
  const body=JSON.parse(m.calls[3].init.body as string);assert.equal(body.sha,'old-sha');
  assert.equal(JSON.parse(Buffer.from(body.content,'base64').toString('utf8')).subscriptions[0].category,'AI');
});
