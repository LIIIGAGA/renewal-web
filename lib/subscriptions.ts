import { z } from 'zod';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import Papa from 'papaparse';

export const cycles = { weekly: '每周', monthly: '每月', quarterly: '每季度', yearly: '每年' } as const;
export const categories = ['AI', '视频', '音乐', '其他'] as const;
export type Category = typeof categories[number];
export const timezones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'UTC'];
export const subscriptionSchema = z.object({
  service_name: z.string().trim().min(1, '请填写服务名称').max(100),
  plan: z.string().trim().max(100),
  category: z.enum(categories).default('其他'),
  price: z.coerce.number().min(0).max(99999999.99).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, '金额最多两位小数'),
  currency: z.enum(['CNY', 'USD', 'GBP', 'EUR', 'HKD', 'JPY', 'AUD', 'CAD']),
  billing_cycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  next_billing_at: z.iso.datetime({ offset: true }).refine(v => new Date(v).getTime() >= Date.parse('2000-01-01') && new Date(v).getTime() <= Date.parse('2200-01-01'), '结算日期应在 2000–2200 年之间'),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, '无效时区'),
  billing_anchor_day: z.coerce.number().int().min(1).max(31),
  cancellation_method: z.string().trim().max(2000),
  cancellation_url: z.string().trim().max(2048).refine(v => !v || /^https?:\/\//i.test(v) && (() => { try { const u = new URL(v); return !u.username && !u.password; } catch { return false; } })(), '取消链接必须是有效的 http/https 地址'),
  notes: z.string().trim().max(2000),
  auto_renew: z.boolean(),
  reminder_enabled: z.boolean(),
  active: z.boolean(),
});
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;
export type Subscription = SubscriptionInput & { id: string; user_id?: string; updated_at: string };
export const blankSubscription = (): SubscriptionInput => ({ service_name: '', plan: '', category: '其他', price: 0, currency: 'CNY', billing_cycle: 'monthly', next_billing_at: new Date(Date.now() + 7 * 86400000).toISOString(), timezone: 'Asia/Shanghai', billing_anchor_day: 1, cancellation_method: '', cancellation_url: '', notes: '', auto_renew: true, reminder_enabled: true, active: true });
export function money(amount: number, currency: string) { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount); }
export function localInput(iso: string, timezone: string) { return formatInTimeZone(iso, timezone, "yyyy-MM-dd'T'HH:mm"); }
export function toUTC(local: string, timezone: string) {
  const result = fromZonedTime(local, timezone);
  if (!Number.isFinite(result.getTime()) || localInput(result.toISOString(), timezone) !== local) throw new Error('这个时间不存在（可能处于夏令时切换），请选择其他时间。');
  return result.toISOString();
}
export function dateLabel(s: Pick<SubscriptionInput, 'next_billing_at' | 'timezone'>) { return formatInTimeZone(s.next_billing_at, s.timezone, 'yyyy/MM/dd HH:mm'); }
export function daysUntil(iso: string, now = Date.now()) { return Math.ceil((new Date(iso).getTime() - now) / 86400000); }
export function annualCost(s: SubscriptionInput) { return s.price * ({ weekly: 52, monthly: 12, quarterly: 4, yearly: 1 }[s.billing_cycle]); }
export function spendByCurrency(list: SubscriptionInput[]) {
  const result: Record<string, { monthly: number; yearly: number }> = {};
  for (const s of list.filter(s => s.active)) {
    const r = result[s.currency] ??= { monthly: 0, yearly: 0 };
    r.yearly += annualCost(s); r.monthly += annualCost(s) / 12;
  }
  return result;
}
export function nextOccurrence(s: SubscriptionInput): string {
  const local = formatInTimeZone(s.next_billing_at, s.timezone, "yyyy-MM-dd'T'HH:mm:ss");
  const d = new Date(local + 'Z');
  if (s.billing_cycle === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else {
    const months = { monthly: 1, quarterly: 3, yearly: 12 }[s.billing_cycle];
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(s.billing_anchor_day, last));
  }
  return fromZonedTime(d.toISOString().slice(0, 19), s.timezone).toISOString();
}
export function rollForward(s: Subscription, now = Date.now()): Subscription {
  if (!s.active || !s.auto_renew) return s;
  let result = s;
  let guard = 0;
  while (new Date(result.next_billing_at).getTime() <= now && guard++ < 10000) result = { ...result, next_billing_at: nextOccurrence(result) };
  return result;
}
export function demoData(now = Date.now()): Subscription[] {
  const entries = [
    ['ChatGPT', 'Plus', 20, 'USD', 'monthly', 1, '设置 → 账户 → 管理订阅 → 取消订阅', 'https://chatgpt.com/'],
    ['Adobe Creative Cloud', '摄影计划', 88, 'CNY', 'monthly', 4, 'Adobe 账户 → 计划 → 管理计划。年约月付可能有提前终止费，请先查看条款。', 'https://account.adobe.com/plans'],
    ['Figma', 'Professional', 15, 'USD', 'monthly', 9, '进入团队设置 → Billing → 更改或取消计划', 'https://www.figma.com/'],
    ['Spotify', 'Premium Individual', 11.99, 'GBP', 'monthly', 12, '账户 → 管理计划 → 更改计划 → 取消 Premium', 'https://www.spotify.com/account/'],
    ['Notion', 'Plus', 96, 'USD', 'yearly', 36, '设置 → 账单 → 更改计划', 'https://www.notion.so/'],
  ] as const;
  return entries.map(([service_name, plan, price, currency, billing_cycle, days, cancellation_method, cancellation_url], i) => {
    const next_billing_at = new Date(now + days * 86400000).toISOString();
    return { id: `demo-${i}`, ...blankSubscription(), category: service_name==='ChatGPT' ? 'AI' : service_name==='Spotify' ? '音乐' : '其他', service_name, plan, price, currency, billing_cycle, next_billing_at, billing_anchor_day: Number(formatInTimeZone(next_billing_at, 'Asia/Shanghai', 'd')), cancellation_method, cancellation_url, notes: '示例数据，价格及取消步骤仅用于演示，请以自己的账单为准。', updated_at: new Date(now).toISOString() };
  });
}
export const exportFields = Object.keys(subscriptionSchema.shape) as (keyof SubscriptionInput)[];
export function exportJSON(list: Subscription[]) { return JSON.stringify({ version: 1, exported_at: new Date().toISOString(), subscriptions: list.map(s => subscriptionSchema.parse(s)) }, null, 2); }
export function exportCSV(list: Subscription[]) {
  return '\ufeff' + Papa.unparse(list.map(s => subscriptionSchema.parse(s)), { columns: exportFields, escapeFormulae: /^[=+\-@\t\r]/ });
}
export function parseImport(text: string, extension: string): SubscriptionInput[] {
  let rows: unknown[];
  if (extension.toLowerCase() === 'csv') {
    const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: 'greedy' });
    if (parsed.errors.length) throw new Error(`CSV 格式错误：${parsed.errors[0].message}`);
    rows = parsed.data.map(row => {
      const r: Record<string, unknown> = { ...row };
      // Papa protects spreadsheet formulas with a leading apostrophe on export.
      for (const k of ['service_name','plan','cancellation_method','cancellation_url','notes']) if (typeof r[k] === 'string' && /^'[=+\-@\t\r]/.test(r[k] as string)) r[k] = (r[k] as string).slice(1);
      for (const k of ['active', 'auto_renew', 'reminder_enabled']) {
        if (r[k] !== 'true' && r[k] !== 'false') throw new Error(`${k} 必须为 true 或 false`);
        r[k] = r[k] === 'true';
      }
      return r;
    });
  } else {
    const data = JSON.parse(text);
    if (Array.isArray(data)) rows = data;
    else if (data.version === 1 && Array.isArray(data.subscriptions)) rows = data.subscriptions;
    else throw new Error('JSON 必须为 version: 1 的导出文件或订阅数组');
  }
  if (!rows.length || rows.length > 500) throw new Error('每次导入 1–500 条记录');
  return rows.map((r, i) => { const parsed = subscriptionSchema.safeParse(r); if (!parsed.success) throw new Error(`第 ${i + 1} 条：${parsed.error.issues[0].message}`); return parsed.data; });
}
