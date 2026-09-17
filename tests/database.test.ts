import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
test('PostgreSQL migration: whitelist RLS, recurrence, delivery claims, immutable snapshot, retries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      grant usage on schema public, auth to authenticated, anon;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      insert into auth.users values ('${owner}'),('${stranger}');`);
    let migration = await readFile(new URL('../supabase/migrations/202609170001_initial.sql',import.meta.url),'utf8');
    // Supabase supplies pgcrypto/Realtime; PGlite has core gen_random_uuid but no replication publication.
    migration = migration.replace('create extension if not exists pgcrypto;','').split('-- Realtime is an enhancement;')[0];
    await db.exec(migration);
    await db.exec(`insert into public.allowed_users values ('${owner}');`);
    const insert = await db.query<{id:string}>(`insert into public.subscriptions
      (user_id,service_name,plan,price,currency,billing_cycle,next_billing_at,timezone,billing_anchor_day)
      values ($1,'SQL Test','Personal',20,'USD','monthly',now()+interval '23 hours','Asia/Shanghai',31) returning id`,[owner]);
    const id = insert.rows[0].id;

    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${stranger}',false);`);
    assert.equal((await db.query('select id from public.subscriptions')).rows.length,0,'other account must not read owner data');
    await assert.rejects(db.query(`insert into public.subscriptions (user_id,service_name,price,currency,billing_cycle,next_billing_at,billing_anchor_day) values ($1,'Forbidden',1,'USD','monthly',now()+interval '1 day',1)`,[stranger]),/row-level security/);
    await assert.rejects(db.query('select * from public.claim_due_reminders()'),/permission denied/);
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
    assert.equal((await db.query('select id from public.subscriptions')).rows.length,1,'owner can read');
    await assert.rejects(db.query('select email_payload from public.reminder_deliveries'),/permission denied/);
    await db.exec('reset role');

    const dates = await db.query<{feb:Date;mar:Date}>(`select
      public.next_billing_time('2027-01-31 02:00Z','monthly','Asia/Shanghai',31) as feb,
      public.next_billing_time('2027-02-28 02:00Z','monthly','Asia/Shanghai',31) as mar`);
    assert.equal(new Date(dates.rows[0].feb).toISOString(),'2027-02-28T02:00:00.000Z');
    assert.equal(new Date(dates.rows[0].mar).toISOString(),'2027-03-31T02:00:00.000Z');
    type Claim = {delivery_id:string;lease_token:string};
    const first = (await db.query<Claim>('select * from public.claim_due_reminders()')).rows;
    assert.equal(first.length,1);
    assert.equal((await db.query('select * from public.claim_due_reminders()')).rows.length,0,'lease prevents duplicate worker claims');
    const payload = {from:'test@example.com',to:['owner@example.com'],subject:'Original',text:'Snapshot'};
    await db.query('select public.prepare_reminder($1,$2,$3)',[first[0].delivery_id,first[0].lease_token,JSON.stringify(payload)]);
    await db.query("select public.finish_reminder($1,$2,'failed','Provider timeout')",[first[0].delivery_id,first[0].lease_token]);
    const retry = (await db.query<Claim>('select * from public.claim_due_reminders()')).rows[0];
    assert.equal(retry.delivery_id,first[0].delivery_id);
    const immutable = await db.query<{payload:typeof payload}>('select public.prepare_reminder($1,$2,$3) as payload',[retry.delivery_id,retry.lease_token,JSON.stringify({...payload,text:'Changed'})]);
    assert.deepEqual(immutable.rows[0].payload,payload,'same provider key keeps identical body');
    await db.query("select public.finish_reminder($1,$2,'sent',null)",[first[0].delivery_id,first[0].lease_token]);
    const stillSending = await db.query<{status:string}>('select status from public.reminder_deliveries where id=$1',[first[0].delivery_id]);
    assert.equal(stillSending.rows[0].status,'sending','stale lease cannot write completion');
    await db.query("select public.finish_reminder($1,$2,'sent',null)",[retry.delivery_id,retry.lease_token]);
    assert.equal((await db.query('select * from public.claim_due_reminders()')).rows.length,0,'sent delivery never gets resent');
    assert.equal((await db.query('select * from public.reminder_deliveries')).rows.length,1);

    await db.query('update public.subscriptions set next_billing_at=now()+interval \'22 hours\' where id=$1',[id]);
    const changed = (await db.query<Claim>('select * from public.claim_due_reminders()')).rows;
    assert.equal(changed.length,1,'new date produces a new reminder');
    await db.query('update public.subscriptions set reminder_enabled=false where id=$1',[id]);
    await db.query('select * from public.claim_due_reminders()');
    assert.equal((await db.query<{status:string}>('select status from public.reminder_deliveries where id=$1',[changed[0].delivery_id])).rows[0].status,'cancelled');
    await db.query('update public.subscriptions set reminder_enabled=true where id=$1',[id]);
    assert.equal((await db.query('select * from public.claim_due_reminders()')).rows.length,1,'reenabling reminder revives an unsent cancellation');

    await db.query('update public.subscriptions set next_billing_at=now()-interval \'2 months\' where id=$1',[id]);
    await db.query('select * from public.claim_due_reminders()');
    assert.equal((await db.query<{future:boolean}>('select next_billing_at>now() as future from public.subscriptions where id=$1',[id])).rows[0].future,true);
    await db.query('update public.subscriptions set auto_renew=false,next_billing_at=now()-interval \'1 day\' where id=$1',[id]);
    await db.query('select * from public.claim_due_reminders()');
    assert.equal((await db.query<{past:boolean}>('select next_billing_at<now() as past from public.subscriptions where id=$1',[id])).rows[0].past,true,'manual renew date is retained');
    await db.query('delete from public.allowed_users where user_id=$1',[owner]);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
    assert.equal((await db.query('select id from public.subscriptions')).rows.length,0,'revoking whitelist immediately revokes access');
  } finally { await db.close(); }
});
