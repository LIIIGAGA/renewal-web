'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ledgerOnly } from '@/lib/features';
import { blankSubscription, categories, cycles, localInput, subscriptionSchema, timezones, toUTC, type Category, type Subscription, type SubscriptionInput } from '@/lib/subscriptions';

export default function SubscriptionForm({ value, initialCategory='其他', onClose, onSave }: { value: Subscription | null; initialCategory?:Category; onClose: () => void; onSave: (input: SubscriptionInput, original: Subscription | null) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<SubscriptionInput>(value ? {...value,category:value.category??'其他'} : {...blankSubscription(),category:initialCategory});
  const [local, setLocal] = useState(localInput(draft.next_billing_at, draft.timezone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const change = <K extends keyof SubscriptionInput>(key: K, v: SubscriptionInput[K]) => setDraft(d => ({ ...d, [key]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const next_billing_at = toUTC(local, draft.timezone);
      const originalLocal = value ? localInput(value.next_billing_at, value.timezone) : '';
      const billing_anchor_day = value && originalLocal === local && value.timezone === draft.timezone ? value.billing_anchor_day : Number(local.slice(8, 10));
      const parsed = subscriptionSchema.safeParse({ ...draft, next_billing_at, billing_anchor_day, reminder_enabled: ledgerOnly ? false : draft.reminder_enabled });
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      await onSave(parsed.data, value); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请重试'); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="form-dialog" onCancel={e => { if(busy) e.preventDefault(); else onClose(); }} onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }} aria-labelledby="form-title">
    <form onSubmit={submit}>
      <div className="dialog-heading"><div><span className="eyebrow">// SUBSCRIPTION_RECORD</span><h2 id="form-title">{value ? '编辑订阅' : '添加订阅'}</h2></div><button disabled={busy} type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X /></button></div>
      <div className="form-grid">
        <label>服务名称<input required maxLength={100} value={draft.service_name} onChange={e => change('service_name', e.target.value)} placeholder="例如 ChatGPT" autoFocus /></label>
        <label>当前方案<input maxLength={100} value={draft.plan} onChange={e => change('plan', e.target.value)} placeholder="例如 Plus" /></label>
        <label className="full">分类<select aria-label="分类" value={draft.category} onChange={e=>change('category',e.target.value as Category)}>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <label>每期金额<input required type="number" min="0" max="99999999.99" step="0.01" value={draft.price} onChange={e => change('price', Number(e.target.value))} /></label>
        <label>币种<select value={draft.currency} onChange={e => change('currency', e.target.value as SubscriptionInput['currency'])}>{['CNY','USD','GBP','EUR','HKD','JPY','AUD','CAD'].map(c => <option key={c}>{c}</option>)}</select></label>
        <label>计费周期<select value={draft.billing_cycle} onChange={e => change('billing_cycle', e.target.value as SubscriptionInput['billing_cycle'])}>{Object.entries(cycles).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>下一次结算<input required type="datetime-local" value={local} onChange={e => setLocal(e.target.value)} /></label>
        <label className="full">结算时区<select value={draft.timezone} onChange={e => change('timezone', e.target.value)}>{[...new Set([...timezones, draft.timezone])].map(t => <option key={t}>{t}</option>)}</select><small>按这个时区保存和显示结算时间。</small></label>
        <label className="full">取消订阅的方式<textarea maxLength={2000} rows={3} value={draft.cancellation_method} onChange={e => change('cancellation_method', e.target.value)} placeholder="在哪里取消？需要联系客服或提前几天办理？" /></label>
        <label className="full">取消链接（可选）<input type="url" maxLength={2048} value={draft.cancellation_url} onChange={e => change('cancellation_url', e.target.value)} placeholder="https://…" /></label>
        <label className="full">备注<textarea maxLength={2000} rows={2} value={draft.notes} onChange={e => change('notes', e.target.value)} placeholder="支付方式、优惠到期、年约终止费等" /></label>
        <div className="full switch-list">
          <label className="switch-row"><span><strong>自动续费</strong><small>{ledgerOnly ? '记录平台是否自动续费，日期由你核对更新' : '结算时间过去后，自动推算下一期日期'}</small></span><input type="checkbox" role="switch" checked={draft.auto_renew} onChange={e => change('auto_renew', e.target.checked)} /></label>
          {!ledgerOnly && <label className="switch-row"><span><strong>续费前一天提醒</strong><small>发送到登录账户的邮箱，关闭网页也有效</small></span><input type="checkbox" role="switch" checked={draft.reminder_enabled} onChange={e => change('reminder_enabled', e.target.checked)} /></label>}
          <label className="switch-row"><span><strong>正在使用</strong><small>关闭后保留记录，移出支出统计</small></span><input type="checkbox" role="switch" checked={draft.active} onChange={e => change('active', e.target.checked)} /></label>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存订阅'}</button></footer>
    </form>
  </dialog>;
}
