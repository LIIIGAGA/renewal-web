import { createClient } from 'npm:@supabase/supabase-js@2';

type Claim = { delivery_id: string; subscription_id: string; user_id: string; billing_at: string; lease_token: string };
async function equalSecret(a: string, b: string) {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [x,y] = await Promise.all([hash(a),hash(b)]); let diff = 0; for(let i=0;i<x.length;i++) diff |= x[i]^y[i]; return diff === 0;
}
function env(name: string) { const value = Deno.env.get(name); if(!value) throw new Error(`Missing ${name}`); return value; }
function percentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
async function sendEmail(payload: { from: string; to: string[]; subject: string; text: string }, deliveryId: string) {
  const provider = Deno.env.get('EMAIL_PROVIDER') ?? 'resend';
  if (provider === 'aliyun') {
    const params: Record<string, string> = {
      AccessKeyId: env('ALIYUN_ACCESS_KEY_ID'), Action: 'SingleSendMail', Version: '2015-11-23',
      Format: 'JSON', RegionId: 'cn-hangzhou', SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      AccountName: env('ALIYUN_DM_ACCOUNT'), AddressType: '1', ReplyToAddress: 'false',
      ToAddress: payload.to.join(','), Subject: [...payload.subject].slice(0, 100).join(''),
      TextBody: payload.text, FromAlias: 'Renewal',
    };
    const canonical = Object.keys(params).sort().map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(`${env('ALIYUN_ACCESS_KEY_SECRET')}&`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`POST&%2F&${percentEncode(canonical)}`)));
    params.Signature = btoa(String.fromCharCode(...signature));
    const response = await fetch('https://dm.aliyuncs.com/', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
    });
    if (!response.ok) throw new Error(`Email provider HTTP ${response.status}`);
    const result = await response.json();
    if (result.Code || !result.RequestId) throw new Error('Aliyun email request rejected');
    // This API has no idempotency key. Ambiguous timeouts may produce a duplicate on retry.
  } else if (provider === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `renewal/${deliveryId}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Email provider HTTP ${response.status}`);
  } else throw new Error('Unsupported email provider');
}
Deno.serve(async request => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected || expected.length < 32) return new Response('Reminder worker not configured', { status: 503 });
  if (!await equalSecret(request.headers.get('x-cron-secret') ?? '', expected)) return new Response('Unauthorized', { status: 401 });
  try {
    const provider = Deno.env.get('EMAIL_PROVIDER') ?? 'resend';
    if (provider === 'resend') env('RESEND_API_KEY');
    else if (provider === 'aliyun') { env('ALIYUN_ACCESS_KEY_ID'); env('ALIYUN_ACCESS_KEY_SECRET'); env('ALIYUN_DM_ACCOUNT'); }
    else throw new Error('Unsupported email provider');
    const from = env('REMINDER_FROM'); const appURL = env('APP_URL');
    if (new URL(appURL).protocol !== 'https:' && !appURL.startsWith('http://localhost')) throw new Error('APP_URL must use HTTPS');
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('claim_due_reminders', { batch_size: 10 });
    if(error) throw error;
    const counts = { claimed: data?.length ?? 0, sent: 0, failed: 0, cancelled: 0 };
    for (const item of (data ?? []) as Claim[]) {
      let outcome: 'sent' | 'failed' | 'cancelled' = 'failed'; let failure: string | null = null;
      try {
        // Recheck immediately before delivery in case the owner edited/disabled a claimed subscription.
        const [{ data: s, error: sError }, { data: access, error: accessError }, { data: owner, error: ownerError }] = await Promise.all([
          db.from('subscriptions').select('*').eq('id',item.subscription_id).maybeSingle(),
          db.from('allowed_users').select('user_id').eq('user_id',item.user_id).maybeSingle(),
          db.auth.admin.getUserById(item.user_id),
        ]);
        if(sError || accessError || ownerError) throw new Error('Account or subscription lookup failed');
        if(!s || !access || !s.active || !s.reminder_enabled || new Date(s.next_billing_at).getTime() !== new Date(item.billing_at).getTime() || new Date(item.billing_at).getTime() <= Date.now()) outcome = 'cancelled';
        else {
          if(!owner.user?.email || !owner.user.email_confirmed_at) throw new Error('Recipient email is not confirmed');
          const time = new Intl.DateTimeFormat('zh-CN', { dateStyle:'full',timeStyle:'short',timeZone:s.timezone }).format(new Date(s.next_billing_at));
          const price = new Intl.NumberFormat('zh-CN',{ style:'currency',currency:s.currency }).format(s.price);
          const text = [
            `你的 ${s.service_name} 将在一天内到达结算时间。`,
            `方案：${s.plan || '未填写'}`, `每期金额：${price}`, `计划结算：${time}（${s.timezone}）`,
            `自动续费：${s.auto_renew ? '已开启' : '未开启；请自行核对是否续订'}`,
            '', `取消方式：${s.cancellation_method || '尚未填写，请到服务商账户查看。'}`,
            s.cancellation_url ? `取消页面：${s.cancellation_url}` : '', s.notes ? `备注：${s.notes}` : '',
            '', `打开台账：${appURL}`, '此日期来自你的台账，实际扣费请以服务商账单为准。',
          ].filter(Boolean).join('\n');
          const prepared = await db.rpc('prepare_reminder', { delivery:item.delivery_id, token:item.lease_token,
            payload:{ from, to:[owner.user.email], subject:`续费提醒：${s.service_name.replace(/[\r\n]/g,' ')} · ${price}`, text } });
          if(prepared.error || !prepared.data) throw new Error('Email snapshot could not be saved');
          await sendEmail(prepared.data, item.delivery_id);
          outcome = 'sent';
        }
      } catch(e) { failure = e instanceof Error ? e.message : 'Delivery failed'; }
      const finished = await db.rpc('finish_reminder', { delivery:item.delivery_id, token:item.lease_token, result:outcome, error_message:failure });
      if(finished.error) { console.error('Reminder status write failed',item.delivery_id); counts.failed++; }
      else counts[outcome]++;
      // Keep the personal worker below common provider rate limits.
      await new Promise(resolve => setTimeout(resolve,600));
    }
    return Response.json(counts, { status: counts.failed ? 207 : 200 });
  } catch { console.error('Reminder job failed; verify server configuration and database migration'); return new Response('Reminder job failed', { status: 500 }); }
});
