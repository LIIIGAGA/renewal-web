'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { ArrowDownToLine, ArrowUpFromLine, Bell, CalendarDays, Check, ChevronRight, CreditCard, ExternalLink, LayoutDashboard, LogOut, Mail, Menu, MoreHorizontal, Plus, RefreshCw, Search, Settings, ShieldCheck, Trash2, Wallet, X } from 'lucide-react';
import { cloudConfigured, supabase } from '@/lib/supabase';
import { categories, cycles, dateLabel, daysUntil, demoData, exportCSV, exportJSON, money, parseImport, rollForward, spendByCurrency, type Category, type Subscription, type SubscriptionInput } from '@/lib/subscriptions';
import SubscriptionForm from './subscription-form';
import { ledgerOnly } from '@/lib/features';
import GitHubSync from './github-sync';
import { GitHubLedger, GitHubConflict, type GitHubConnection } from '@/lib/github-ledger';
import { publicPath } from '@/lib/paths';
import { clearDeviceConnection, readDeviceConnection, saveDeviceConnection } from '@/lib/github-device';

const DEMO_KEY = 'renewal-demo-v1';
type View = 'overview' | 'upcoming' | 'settings';
type ReminderLog = { id: string; status: string; billing_at: string; sent_at: string | null; attempts: number; last_error: string | null; subscription_id: string };
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

function Brand() { return <div className="brand"><span className="brand-icon"><RefreshCw size={20} /></span><span>RENEWAL<span className="brand-dot">_</span></span></div>; }
function ServiceIcon({ name }: { name: string }) {
  const key = name.toLowerCase();
  return <span className="service-icon" aria-hidden="true">{key.includes('adobe') ? 'A' : key.includes('spotify') ? 'S' : key.includes('figma') ? 'F' : key.includes('chatgpt') ? 'G' : name.slice(0,1).toUpperCase()}</span>;
}
function Download({ list, format }: { list: Subscription[]; format: 'json' | 'csv' }) {
  return <button className="button secondary" onClick={() => {
    const blob = new Blob([format === 'json' ? exportJSON(list) : exportCSV(list)], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `renewal-${new Date().toISOString().slice(0,10)}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }}><ArrowDownToLine size={17} />导出 {format.toUpperCase()}</button>;
}

export default function Dashboard() {
  const [demo, setDemo] = useState(!cloudConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [list, setList] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<View>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState<Category|'all'>('all');
  const [editing, setEditing] = useState<Subscription | null | undefined>(undefined);
  const [detail, setDetail] = useState<Subscription | null>(null);
  const [remove, setRemove] = useState<Subscription | null>(null);
  const [mutating, setMutating] = useState(false);
  const [importing, setImporting] = useState<SubscriptionInput[] | null>(null);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [menu, setMenu] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const authUserId = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [github, setGithub] = useState<{client:GitHubLedger;name:string}|null>(null);
  const githubSHA = useRef<string|null>(null);
  const githubRows = useRef<Subscription[]>([]);
  const githubWriting = useRef(false);
  const githubCurrent = useRef<GitHubLedger|null>(null);
  const [rememberToken,setRememberToken] = useState(false);
  const [tokenSaved,setTokenSaved] = useState(false);
  const [githubConnecting,setGithubConnecting] = useState(false);
  const [githubConnectError,setGithubConnectError] = useState('');
  const rememberCurrent = useRef(false);
  const activeConnection = useRef<GitHubConnection|null>(null);
  const connectionAttempt = useRef(0);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!ledgerOnly || autoStarted.current) return;
    autoStarted.current=true;
    try {
      const saved=readDeviceConnection();
      if(saved) { rememberCurrent.current=true;setRememberToken(true);setTokenSaved(true);void connectGitHub(saved,true).catch(()=>{}); }
    } catch { setGithubConnectError('无法读取此设备的令牌，请检查浏览器存储设置。'); }
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(publicPath('/sw.js')).catch(() => {});
    const onInstall = (e: Event) => { e.preventDefault(); setInstall(e as InstallPrompt); };
    window.addEventListener('beforeinstallprompt', onInstall);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => { clearInterval(timer); window.removeEventListener('beforeinstallprompt', onInstall); };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => { if (alive) { if(error) setAuthError(error.message); authUserId.current=data.session?.user.id ?? null; setUser(data.session?.user ?? null); setLoading(false); } });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id ?? null;
      if (id !== authUserId.current || event === 'SIGNED_OUT') {
        authUserId.current=id; generation.current++; setUser(session?.user ?? null); setAuthorized(false); setList([]); setLogs([]); setDetail(null); setEditing(undefined); setRemove(null); setImporting(null);
      }
      if (event === 'PASSWORD_RECOVERY') { setRecovery(true); setDemo(false); }
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
  const refresh = useCallback(async () => {
    if(githubWriting.current) return;
    const ticket = ++generation.current;
    if(github) {
      setLoading(true);
      try {
        const snapshot=await github.client.read();
        if(generation.current===ticket && githubCurrent.current===github.client) {githubSHA.current=snapshot.sha;githubRows.current=snapshot.subscriptions;setList(snapshot.subscriptions);setSyncError('');}
      } catch(e) {if(generation.current===ticket)setSyncError(e instanceof Error?e.message:'GitHub 同步失败');}
      finally {if(generation.current===ticket)setLoading(false);}
      return;
    }
    if (demo) {
      try {
        const saved = localStorage.getItem(DEMO_KEY);
        const data = saved ? (JSON.parse(saved) as Subscription[]).map(s=>({...s,category:s.category??'其他'})) : demoData();
        const rolled = ledgerOnly ? data : data.map(s => rollForward(s)); setList(rolled); localStorage.setItem(DEMO_KEY, JSON.stringify(rolled)); setSyncError('');
      } catch { setList(demoData()); setSyncError('示例数据无法保存，请检查浏览器存储设置。'); }
      setLoading(false); return;
    }
    if (!user || !supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      const access = await supabase.from('allowed_users').select('user_id').eq('user_id', user.id).maybeSingle();
      if (access.error) throw access.error;
      if (!access.data) {
        if(generation.current===ticket) { setAuthorized(false); setList([]); setLogs([]); setDetail(null); setEditing(undefined); }
        throw new Error('此账户尚未获得访问权限，请按部署说明将账户加入 allowed_users。');
      }
      const result = await supabase.from('subscriptions').select('*').order('next_billing_at');
      if (result.error) throw result.error;
      const logResult = ledgerOnly ? {data:[], error:null} : await supabase.from('reminder_deliveries').select('id,status,billing_at,sent_at,attempts,last_error,subscription_id').order('billing_at', { ascending: false }).limit(20);
      if (logResult.error) throw logResult.error;
      if (generation.current === ticket) { setAuthorized(true); setList((result.data as Subscription[]).map(s=>({...s,category:s.category??'其他'}))); setLogs(logResult.data); setSyncError(''); }
    } catch (e) { if (generation.current === ticket) setSyncError(e instanceof Error ? e.message : '同步失败，请重试'); }
    finally { if (generation.current === ticket) setLoading(false); }
  }, [demo, user, github]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if(github) {
      const update=()=>{if(document.visibilityState==='visible')void refresh();};
      window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
      const timer=setInterval(update,60000);
      return ()=>{window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);clearInterval(timer);};
    }
    if(demo || !user || !supabase) return;
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    const timer = setInterval(focus, 60000);
    const channel = supabase.channel(`subscriptions-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${user.id}` }, focus).subscribe();
    return () => { window.removeEventListener('focus', focus); clearInterval(timer); void supabase!.removeChannel(channel); };
  }, [demo, user, refresh, github]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); }, [notice]);

  function storeDemo(next: Subscription[]) { localStorage.setItem(DEMO_KEY, JSON.stringify(next)); setList(next); }
  async function connectGitHub(connection:GitHubConnection,automatic=false) {
    if(githubWriting.current) throw new Error('正在保存，请稍后再连接。');
    const attempt=++connectionAttempt.current;
    setGithubConnecting(true);setGithubConnectError('');
    try {
      const client=new GitHubLedger(connection);
      const snapshot=await client.read();
      if(attempt!==connectionAttempt.current) return;
      generation.current++;githubCurrent.current=client;githubSHA.current=snapshot.sha;githubRows.current=snapshot.subscriptions;activeConnection.current=connection;
      setDemo(true);setGithub({client,name:`${connection.owner}/${connection.repo}`});setList(snapshot.subscriptions);
      setEditing(undefined);setDetail(null);setRemove(null);setImporting(null);setSyncError('');setNotice('已连接 GitHub 私有台账');
      try {
        localStorage.setItem('renewal-github-repo',JSON.stringify({owner:connection.owner,repo:connection.repo}));
        if(rememberCurrent.current) {saveDeviceConnection(connection);setTokenSaved(true);}
      } catch {setGithubConnectError('已连接，但无法保存到此浏览器；请检查存储权限后重试。');}
    } catch(e) {
      if(attempt===connectionAttempt.current) {
        const raw=e instanceof Error?e.message:'连接失败';
        const message=connection.token?raw.replaceAll(connection.token,'[已隐藏]'):raw;
        setGithubConnectError(message);
        if(automatic) setSyncError(`自动连接失败：${message} 已有记录未删除，请到设置重试或更新令牌。`);
      }
      throw new Error('GitHub 连接失败');
    } finally {if(attempt===connectionAttempt.current)setGithubConnecting(false);}
  }
  function clearSavedToken() {
    try {clearDeviceConnection();rememberCurrent.current=false;setRememberToken(false);setTokenSaved(false);}
    catch {setGithubConnectError('无法清除浏览器保存的令牌，请检查存储权限。');}
  }
  function changeRememberToken(value:boolean) {
    if(!value) {clearSavedToken();return;}
    rememberCurrent.current=true;setRememberToken(true);
    if(activeConnection.current) {
      try {saveDeviceConnection(activeConnection.current);setTokenSaved(true);}
      catch {setGithubConnectError('无法保存令牌，请检查浏览器存储权限。');}
    }
  }
  function disconnectGitHub() {
    if(githubWriting.current) {setNotice('正在保存，请稍后再断开。');return;}
    connectionAttempt.current++;setGithubConnecting(false);activeConnection.current=null;clearSavedToken();
    generation.current++;githubCurrent.current=null;githubSHA.current=null;setGithub(null);setSyncError('');setList([]);
    setNotice('同步已断开，回到本地台账');
  }
  async function persistGitHub(next:Subscription[], original?:Subscription) {
    if(!github || githubWriting.current) throw new Error('正在同步，请稍后重试。');
    if(original && githubRows.current.find(s=>s.id===original.id)?.updated_at!==original.updated_at) throw new GitHubConflict();
    githubWriting.current=true;generation.current++;
    try {
      const sha=await github.client.write(next,githubSHA.current);
      githubSHA.current=sha;githubRows.current=next;setList(next);setSyncError('');
    } catch(e) {
      githubWriting.current=false;
      await refresh();
      throw e;
    } finally {githubWriting.current=false;}
  }
  async function save(input: SubscriptionInput, original: Subscription | null) {
    if(github) {
      const entry:Subscription={...input,id:original?.id??crypto.randomUUID(),updated_at:new Date().toISOString()};
      await persistGitHub(original?githubRows.current.map(s=>s.id===original.id?entry:s):[...githubRows.current,entry],original??undefined);
    } else if (demo) {
      const entry: Subscription = { ...input, id: original?.id ?? crypto.randomUUID(), updated_at: new Date().toISOString() };
      storeDemo(original ? list.map(s => s.id === original.id ? entry : s) : [...list, entry]);
    } else {
      if (!supabase || !user || !authorized) throw new Error('请先登录');
      const result = original ? await supabase.from('subscriptions').update(input).eq('id', original.id).eq('updated_at', original.updated_at).select('id') : await supabase.from('subscriptions').insert({ ...input, user_id: user.id }).select('id');
      if (result.error) throw new Error(result.error.message);
      if (!result.data?.length) { await refresh(); throw new Error('这条订阅已在另一台设备修改，请关闭后重新打开。'); }
      await refresh();
    }
    setNotice('订阅已保存');
  }
  async function deleteEntry() {
    if (!remove) return; setMutating(true);
    try {
      if(github) await persistGitHub(githubRows.current.filter(s=>s.id!==remove.id),remove);
      else if (demo) storeDemo(list.filter(s => s.id !== remove.id));
      else {
        const r = await supabase!.from('subscriptions').delete().eq('id', remove.id).eq('updated_at', remove.updated_at).select('id');
        if (r.error) throw r.error; if(!r.data?.length) throw new Error('订阅已在其他设备修改，请刷新后重试。'); await refresh();
      }
      setRemove(null); setDetail(null); setNotice('订阅记录已删除');
    } catch(e) { setNotice(e instanceof Error ? e.message : '删除失败'); } finally { setMutating(false); }
  }
  async function readImport(file?: File) {
    if (!file) return;
    try { if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB'); setImporting(parseImport(await file.text(), file.name.split('.').pop() ?? 'json').map(s => ledgerOnly ? {...s, reminder_enabled:false} : s)); }
    catch(e) { setNotice(e instanceof Error ? e.message : '无法读取文件'); }
    finally { if(importRef.current) importRef.current.value = ''; }
  }
  async function confirmImport() {
    if(!importing) return; setMutating(true);
    try {
      if(github) await persistGitHub([...githubRows.current,...importing.map(s=>({...s,id:crypto.randomUUID(),updated_at:new Date().toISOString()}))]);
      else if (demo) storeDemo([...list, ...importing.map(s => ({ ...s, id: crypto.randomUUID(), updated_at: new Date().toISOString() }))]);
      else { const r = await supabase!.from('subscriptions').insert(importing.map(s => ({ ...s, user_id: user!.id }))); if(r.error) throw r.error; await refresh(); }
      setNotice(`已导入 ${importing.length} 条订阅`); setImporting(null);
    } catch(e) { setNotice(e instanceof Error ? e.message : '导入失败'); } finally { setMutating(false); }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      if(recovery) { const r = await supabase!.auth.updateUser({ password }); if(r.error) throw r.error; setRecovery(false); setPassword(''); setNotice('密码已更新'); }
      else { const r = await supabase!.auth.signInWithPassword({ email, password }); if(r.error) throw r.error; setPassword(''); }
    } catch(e) { setAuthError(e instanceof Error ? e.message : '登录失败'); } finally { setAuthBusy(false); }
  }
  async function resetPassword() {
    if(!email) { setAuthError('请先输入登录邮箱'); return; } setAuthBusy(true);
    const r = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setAuthBusy(false); setAuthError(r.error?.message ?? '如果邮箱存在，重置密码邮件会发送到你的邮箱。');
  }
  async function logout() { const r = await supabase!.auth.signOut(); if(r.error) setNotice(r.error.message); else { setDemo(false); setRecovery(false); setUser(null); setList([]); setAuthorized(false); } }

  const active = list.filter(s => s.active);
  const upcoming = active.filter(s => new Date(s.next_billing_at).getTime() > now && daysUntil(s.next_billing_at, now) <= 7).sort((a,b) => a.next_billing_at.localeCompare(b.next_billing_at));
  const sorted = list.filter(s => (categoryFilter === 'all' || (s.category ?? '其他') === categoryFilter) && (filter === 'all' || (filter === 'active' ? s.active : !s.active)) && `${s.service_name} ${s.plan}`.toLowerCase().includes(query.toLowerCase()) && (view !== 'upcoming' || s.active && new Date(s.next_billing_at).getTime() > now && daysUntil(s.next_billing_at, now) <= 30)).sort((a,b) => new Date(a.next_billing_at).getTime() - new Date(b.next_billing_at).getTime());
  const spends = spendByCurrency(list);
  const currencies = Object.keys(spends).sort();
  const [currency, setCurrency] = useState('USD');
  const currentCurrency = currencies.includes(currency) ? currency : currencies[0] ?? 'CNY';
  const currentSpend = spends[currentCurrency] ?? { monthly: 0, yearly: 0 };
  const canEdit = !githubConnecting && (github ? !loading && !syncError : demo || authorized);

  if((!demo && !user) || recovery) return <main className="login-screen"><div className="login-art"><Brand /><div><span className="eyebrow">// PERSONAL_SUBSCRIPTION_ARCHIVE</span><h1>订阅再多，<br />也能心里有数。</h1><p>记住每一次续费，<br />把时间留给真正想做的事。</p></div><span>[ RENEWAL // PERSONAL WORKSPACE ]</span></div><section className="login-panel"><Brand /><form onSubmit={login}><span className="eyebrow">// ACCESS — PERSONAL_01</span><h2>{recovery ? '设置新密码' : '欢迎回来'}</h2><p>{recovery ? '更新后即可继续管理你的订阅。' : '登录你的个人订阅台账。'}</p>{!recovery && <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>}<label>{recovery ? '新密码' : '密码'}<input type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={recovery ? 12 : 1} required value={password} onChange={e => setPassword(e.target.value)} /></label>{authError && <p className="error" role="alert">{authError}</p>}<button className="button primary" disabled={authBusy || loading}>{authBusy ? '请稍候…' : recovery ? '更新密码' : '登录'}</button>{!recovery && <button type="button" className="text-button" disabled={authBusy} onClick={resetPassword}>忘记密码？</button>}</form>{!recovery && <button className="button secondary demo-entry" onClick={() => { setDemo(true); setLoading(true); }}>先体验示例台账 <ChevronRight size={17} /></button>}<p className="login-foot"><ShieldCheck size={16} />个人账户专用，无公开注册</p></section></main>;

  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'open' : ''}`}><Brand /><button className="icon-button mobile-close" onClick={() => setMenu(false)} aria-label="关闭菜单"><X /></button><span className="nav-label">ARCHIVE // PERSONAL_01</span><nav>{([['overview', LayoutDashboard, '订阅总览'], ['upcoming', CalendarDays, '即将续费'], ['settings', Settings, '设置与数据']] as const).map(([v, Icon, label]) => <button key={v} className={view === v ? 'selected' : ''} onClick={() => { setView(v); setMenu(false); }}><span className="nav-index" aria-hidden="true">{v === 'overview' ? '01' : v === 'upcoming' ? '02' : '03'}</span><Icon size={19} />{label}{v === 'upcoming' && upcoming.length > 0 && <span className="nav-count">{upcoming.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className={`reminder-note ${ledgerOnly ? 'ledger-note' : ''}`}><Bell size={19} /><strong>{ledgerOnly ? '订阅随时查' : '让续费不再突然'}</strong><p>{ledgerOnly ? <>记录价格与续费日期，<br />前往对应平台管理。</> : <>提前一天收到邮件，<br />留出决定是否续订的时间。</>}</p></div><div className="profile"><span className="avatar">{demo ? 'D' : (user?.email?.[0] ?? 'M').toUpperCase()}</span><div><strong>{github ? 'GitHub 工作空间' : demo ? '本地工作空间' : '个人工作空间'}</strong><small>{github ? github.name : demo ? '仅保存在当前浏览器' : user?.email}</small></div>{user && !demo && <button className="icon-button" aria-label="退出登录" onClick={logout}><LogOut size={17} /></button>}</div></div></aside>
    {menu && <button className="menu-overlay" aria-label="关闭导航" onClick={() => setMenu(false)} />}
    <div className="main-wrap"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开菜单" onClick={() => setMenu(true)}><Menu size={21} /></button><span>SUBSCRIPTION // ARCHIVE</span><ChevronRight size={14} /><strong>{view === 'overview' ? '订阅总览' : view === 'upcoming' ? '即将续费' : '设置与数据'}</strong></div><div className="topbar-actions"><span className="sync-label">{loading ? '同步中…' : syncError ? '同步失败' : github ? 'GitHub 已同步' : demo ? '本地模式' : '云端已同步'}</span><button className="icon-button" onClick={() => void refresh()} disabled={loading} aria-label="刷新订阅"><RefreshCw size={17} className={loading ? 'spin' : ''} /></button><span className="avatar small">{demo ? 'D' : 'M'}</span></div></header>
    <main className="workspace">
      {demo && !github && <div className="demo-banner"><span>本地台账 · 数据只保存在这台设备，尚未连接同步服务。</span>{cloudConfigured ? <button onClick={() => { setDemo(false); setList([]); }}>登录云端账户 <ChevronRight size={15}/></button> : <button onClick={() => setView('settings')}>查看启用说明 <ChevronRight size={15}/></button>}</div>}
      {github && <div className="demo-banner"><span>GitHub 私有台账 · 修改后自动上传，切回网页读取最新记录。</span><button onClick={() => setView('settings')}>同步设置 <ChevronRight size={15}/></button></div>}
      {syncError && <div className="error sync-error" role="alert">{syncError}<button className="text-button" onClick={() => void refresh()}>重新同步</button></div>}
      <div className="page-heading"><div><span className="eyebrow">{view === 'settings' ? '// FILE_003 — WORKSPACE SETTINGS' : view === 'upcoming' ? '// FILE_002 — RENEWAL SCHEDULE' : '// FILE_001 — SUBSCRIPTION INDEX'}</span><h1>{view === 'overview' ? '每一份订阅，都有数。' : view === 'upcoming' ? '下一次续费，提前知道。' : '把台账留在自己手里。'}</h1><p>{view === 'settings' ? (ledgerOnly ? '管理数据备份、设备同步和安装方式。' : '管理数据备份、查看提醒记录和安装方式。') : '方案、花费和续费时间，一处掌握。'}</p></div>{view !== 'settings' && <button className="button primary" disabled={!canEdit} onClick={() => setEditing(null)}><Plus size={19} />添加订阅</button>}</div>
      {view !== 'settings' ? <>
        <section className="stats-grid" aria-label="订阅支出概览"><article className="stat-card main-stat"><div className="stat-top"><span>每月折算支出</span><Wallet size={19} /></div><div className="stat-value">{money(currentSpend.monthly,currentCurrency)}</div><div className="stat-bottom"><span>按当前方案折算</span><select aria-label="统计币种" value={currentCurrency} onChange={e => setCurrency(e.target.value)}>{(currencies.length ? currencies : ['CNY']).map(c => <option key={c}>{c}</option>)}</select></div></article><article className="stat-card"><div className="stat-top"><span>年度折算支出</span><CreditCard size={19} /></div><div className="stat-value">{money(currentSpend.yearly,currentCurrency)}</div><span className="stat-caption">{currentCurrency} · 不包含汇率换算</span></article><article className="stat-card"><div className="stat-top"><span>正在使用</span><LayoutDashboard size={19} /></div><div className="stat-value">{active.length}<span> 项</span></div><span className="stat-caption">{active.filter(s => s.auto_renew).length} 项自动续费</span></article><article className="stat-card"><div className="stat-top"><span>7 天内续费</span><CalendarDays size={19} /></div><div className="stat-value">{upcoming.length}<span> 项</span></div><span className="stat-caption">{upcoming[0] ? `${upcoming[0].service_name} · ${daysUntil(upcoming[0].next_billing_at,now)} 天内` : '这周暂无续费'}</span></article></section>
        <div className="dashboard-columns"><section className="subscriptions-panel"><div className="panel-heading"><div><h2>{view === 'upcoming' ? '未来 30 天' : '我的订阅'}<span className="count-tag">{sorted.length}</span></h2><p>按下一次结算时间排序</p></div><div className="data-actions"><button className="icon-button" disabled={!canEdit} aria-label="导入订阅" onClick={() => importRef.current?.click()}><ArrowUpFromLine size={18} /></button><button className="icon-button" aria-label="导出 JSON" onClick={() => { const a = document.createElement('a'); const u = URL.createObjectURL(new Blob([exportJSON(list)], { type: 'application/json' })); a.href=u; a.download='renewal-backup.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000); }}><ArrowDownToLine size={18} /></button></div></div><div className="table-controls"><div className="segmented" aria-label="订阅状态">{[['active','使用中'],['inactive','已停用'],['all','全部']].map(([k,v]) => <button key={k} className={filter === k ? 'selected' : ''} onClick={() => setFilter(k)} aria-pressed={filter === k}>{v}</button>)}</div><label className="search-box"><Search size={17}/><input aria-label="搜索订阅" placeholder="搜索订阅…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><div className="category-filters" role="group" aria-label="分类筛选">{(['all',...categories] as const).map(c=><button key={c} className={categoryFilter===c?'selected':''} aria-pressed={categoryFilter===c} onClick={()=>setCategoryFilter(c)}>{c==='all'?'全部分类':c}</button>)}</div>
          <div className="subscription-table"><div className="table-header"><span>服务 / 方案</span><span>分类</span><span>每期费用</span><span>下一次结算</span><span>续费</span><span /></div>{loading && !list.length ? <div className="empty-state">正在载入你的订阅…</div> : sorted.length ? sorted.map(s => { const days = daysUntil(s.next_billing_at,now); return <div key={s.id} className="subscription-row"><button className="service-cell" onClick={() => setDetail(s)}><ServiceIcon name={s.service_name}/><span><strong>{s.service_name}</strong><small>{s.plan || '未填写方案'}</small></span></button><div className="category-cell"><span className="category-badge" data-category={s.category??'其他'}>{s.category??'其他'}</span></div><div className="price-cell"><strong>{money(s.price,s.currency)}</strong><small>{cycles[s.billing_cycle]}</small></div><div className="date-cell"><strong>{dateLabel(s).slice(0,10)}</strong><small className={days <= 3 && s.active ? 'soon-text' : ''}>{!s.active ? '已停用' : days <= 0 ? '日期已过，请核对' : days === 1 ? '24 小时内结算' : `${days} 天后`} · {dateLabel(s).slice(11)}</small></div><div className="renew-cell"><span className={`badge ${s.auto_renew && s.active ? 'blue' : ''}`}>{s.auto_renew ? '自动' : '手动'}</span>{!ledgerOnly && s.reminder_enabled && s.active && <Bell size={14} aria-label="已设置提醒" />}</div><button className="icon-button row-more" onClick={() => setDetail(s)} aria-label={`查看 ${s.service_name}`}><MoreHorizontal size={20}/></button></div>; }) : <div className="empty-state"><CreditCard size={28}/><h3>{query ? '没有匹配的订阅' : categoryFilter!=='all' ? '这个分类暂无订阅' : '这里还没有订阅'}</h3><p>{query ? '试试其他服务名称或分类。' : categoryFilter!=='all' ? `添加一份${categoryFilter}订阅，或切换到全部分类。` : '添加一份订阅，开始记录下一次续费。'}</p>{!query && <button className="button secondary" disabled={!canEdit} onClick={() => setEditing(null)}><Plus size={16}/>添加订阅</button>}</div>}</div><div className="table-footer"><ShieldCheck size={15}/><span>台账不会操作或取消你的服务账户。删除记录不会取消实际订阅。</span></div>
        </section><aside className="insights-column"><section className="upcoming-panel"><div className="aside-heading"><span className="icon-tile"><CalendarDays size={19}/></span><h2>最近要续费</h2></div>{upcoming.length ? upcoming.slice(0,3).map(s => <button key={s.id} className="upcoming-item" onClick={() => setDetail(s)}><div className="timeline-marker"/><div><span className="upcoming-date">{dateLabel(s).slice(5,10)} <span>· {daysUntil(s.next_billing_at,now)} 天内</span></span><strong>{s.service_name}</strong><span>{money(s.price,s.currency)} / {cycles[s.billing_cycle].replace('每','')}</span></div><ChevronRight size={16}/></button>) : <p className="aside-empty">未来 7 天没有结算。<br/>可以放心专注于手头的事。</p>}<button className="text-button aside-link" onClick={() => { setView('upcoming'); setFilter('active'); }}>查看未来 30 天 <ChevronRight size={16}/></button></section><section className="reminder-panel"><div className="aside-heading"><Bell size={19}/><h2>{ledgerOnly ? '操作由你决定' : '提前一天，给你提醒'}</h2></div><p>{ledgerOnly ? <>查看结算日期和取消方式，<br/>再前往对应平台操作。</> : <>有时间检查方案、取消续费，<br/>或继续享受你喜欢的服务。</>}</p><div className="reminder-status"><ShieldCheck size={16}/><span>{ledgerOnly ? '只记录，不操作服务账户' : demo ? '示例模式，未发送邮件' : `${active.filter(s => s.reminder_enabled).length} 项已设置邮件提醒`}</span></div><button className="text-button" onClick={() => setView('settings')}>{ledgerOnly ? '查看数据设置' : '查看提醒设置'} <ChevronRight size={16}/></button></section><p className="small-note">周付按 52 次 / 年折算。统计为预算估算，不代表已扣款或真实使用情况。</p></aside></div>
      </> : <div className="settings-grid">{ledgerOnly && <GitHubSync connected={github?.name??null} busy={githubConnecting} error={githubConnectError} remember={rememberToken} saved={tokenSaved} onConnect={connectGitHub} onDisconnect={disconnectGitHub} onRemember={changeRememberToken} onClear={clearSavedToken}/>}<section className="settings-card"><div className="aside-heading"><ArrowDownToLine size={21}/><h2>导入与备份</h2></div><p>JSON 保留全部字段，适合备份恢复；CSV 可用 Excel 打开。导入会新增记录，不会覆盖已有数据。</p><div className="button-group"><Download list={list} format="json"/><Download list={list} format="csv"/><button className="button secondary" disabled={!canEdit} onClick={() => importRef.current?.click()}><ArrowUpFromLine size={17}/>导入文件</button></div></section>{ledgerOnly ? <section className="settings-card"><div className="aside-heading"><RefreshCw size={21}/><h2>设备同步</h2></div><p>{github ? `同步仓库：${github.name}` : demo ? '目前只保存在这个浏览器。连接 GitHub 同步后，电脑和手机访问同一份台账。' : `当前账户：${user?.email}`}</p><ul className="plain-list"><li>在另一设备编辑后，切回网页或点击右上角刷新。</li><li>修改发生冲突时，会提示重新打开记录。</li><li>退订、付款和套餐变更由你到对应平台完成。</li></ul><p className="small-note">定期导出 JSON 留存备份。GitHub 模式只在页面打开时同步。勾选「在此设备记住令牌」可在下次打开时自动连接。</p></section> : <section className="settings-card"><div className="aside-heading"><Mail size={21}/><h2>邮件提醒</h2></div><p>{demo ? '示例模式不会发送邮件。启用云端后，提醒会发送到你的登录邮箱。' : `收件邮箱：${user?.email}`}</p><ul className="plain-list"><li>每项订阅可单独开启或关闭提醒。</li><li>结算前 24 小时安排发送，定时任务每 15 分钟检查。</li><li>关闭网页不会影响云端任务。邮件可能受服务延迟或垃圾邮件过滤影响。</li></ul><p className="small-note">需要先完成服务器定时任务和邮件服务配置。提醒开关本身不能证明云端配置已生效，请检查下面的发送记录。</p></section>}<section className="settings-card"><div className="aside-heading"><LayoutDashboard size={21}/><h2>装到手机与电脑</h2></div><p>iPhone：Safari 分享菜单 → 添加到主屏幕。Android 或电脑：Chrome / Edge 菜单 → 安装应用。</p>{install && <button className="button primary" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>安装 Renewal</button>}<p className="small-note">同一账户在不同设备登录即可同步。离线时显示连接提示；不保存云端订阅的离线副本。</p></section><section className="settings-card"><div className="aside-heading"><ShieldCheck size={21}/><h2>账户与数据</h2></div><p>{github ? '台账保存在你的私有数据仓库。本地导出文件不包含访问令牌。' : demo ? '当前为本地模式，修改只保存在本浏览器。在上方连接私有仓库即可启用 GitHub 同步。' : '专为个人使用设计。数据库按账户隔离，且只允许你指定的个人账户访问。'}</p>{github ? <button className="button secondary" onClick={disconnectGitHub}>断开 GitHub 同步</button> : demo ? <button className="button secondary" onClick={() => { storeDemo(demoData()); setNotice('示例数据已恢复'); }}>恢复示例数据</button> : <button className="button secondary" onClick={logout}><LogOut size={17}/>退出登录</button>}</section>{!ledgerOnly && <section className="settings-card full"><div className="aside-heading"><Bell size={21}/><h2>最近的提醒记录</h2></div>{logs.length ? <div className="log-list">{logs.map(l => <div key={l.id}><strong>{list.find(s=>s.id===l.subscription_id)?.service_name ?? '订阅记录'}</strong><span>{new Date(l.billing_at).toLocaleString('zh-CN')}</span><span className={`badge ${l.status === 'sent' ? 'blue' : ''}`}>{({sent:'已发送',pending:'待发送',sending:'发送中',failed:'失败，将重试',cancelled:'已取消'} as Record<string,string>)[l.status] ?? l.status}</span>{l.last_error && <small>发信失败，请检查云端函数日志。</small>}</div>)}</div> : <p>尚无提醒记录。完成配置后，用接近 24 小时后续费的测试订阅验证一次发信。</p>}</section>}</div>}
      <input ref={importRef} type="file" accept=".json,.csv" hidden onChange={e => void readImport(e.target.files?.[0])}/>
      <footer className="workspace-footer"><Brand /><span>给每一次续费，留一点余地。</span>{process.env.NEXT_PUBLIC_ICP_NUMBER && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{process.env.NEXT_PUBLIC_ICP_NUMBER}</a>}</footer>
    </main></div>
    {notice && <div className="toast" role="status"><Check size={17}/>{notice}<button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={16}/></button></div>}
    {editing !== undefined && <SubscriptionForm value={editing} initialCategory={categoryFilter==='all'?'其他':categoryFilter} onClose={() => setEditing(undefined)} onSave={save}/>}
    {detail && <Modal title={detail.service_name} onClose={() => setDetail(null)}><div className="detail-intro"><ServiceIcon name={detail.service_name}/><div><strong>{detail.plan || '未填写方案'}</strong><span>{money(detail.price,detail.currency)} · {cycles[detail.billing_cycle]}</span></div></div><dl className="detail-list"><dt>分类</dt><dd>{detail.category??'其他'}</dd><dt>下一次结算</dt><dd>{dateLabel(detail)}<small>{detail.timezone}</small></dd><dt>自动续费</dt><dd>{detail.auto_renew ? '已开启' : '未开启'}</dd>{!ledgerOnly && <><dt>邮件提醒</dt><dd>{detail.reminder_enabled ? '结算前 24 小时' : '已关闭'}{demo && <small>示例模式不发送</small>}</dd></>}<dt>状态</dt><dd>{detail.active ? '正在使用' : '已停用'}</dd></dl><h3>取消订阅方式</h3><p className="preserve-lines">{detail.cancellation_method || '还没有填写取消方式，建议补充。'}</p>{detail.cancellation_url && <a className="button secondary" href={detail.cancellation_url} target="_blank" rel="noopener noreferrer">打开取消页面 <ExternalLink size={16}/></a>}{detail.notes && <><h3>备注</h3><p className="preserve-lines">{detail.notes}</p></>}<p className="small-note">台账日期是按规则推算的计划日期，请以服务商实际账单为准。</p><div className="dialog-actions spread"><button className="button danger" disabled={!canEdit} onClick={() => { setRemove(detail); setDetail(null); }}><Trash2 size={16}/>删除记录</button><button className="button primary" disabled={!canEdit} onClick={() => { setEditing(detail); setDetail(null); }}>编辑订阅</button></div></Modal>}
    {remove && <Modal title="删除这条订阅记录？" onClose={() => { if(!mutating) setRemove(null); }}><p>将从台账删除「{remove.service_name}」及其提醒记录。此操作不会取消服务商的实际订阅。</p><div className="dialog-actions"><button className="button secondary" disabled={mutating} onClick={() => setRemove(null)}>保留</button><button className="button danger" disabled={mutating} onClick={deleteEntry}>{mutating ? '删除中…' : '删除记录'}</button></div></Modal>}
    {importing && <Modal title={`导入 ${importing.length} 条订阅？`} onClose={() => { if(!mutating) setImporting(null); }}><p>这些记录将添加到当前台账。已有订阅会保留，重复导入会产生重复记录。</p><ul className="plain-list">{importing.slice(0,5).map((s,i)=><li key={i}>{s.service_name} · {money(s.price,s.currency)}</li>)}</ul>{importing.length>5 && <p>以及其他 {importing.length-5} 条</p>}<div className="dialog-actions"><button className="button secondary" disabled={mutating} onClick={()=>setImporting(null)}>取消</button><button className="button primary" disabled={mutating} onClick={confirmImport}>{mutating ? '正在导入…' : '确认导入'}</button></div></Modal>}
  </div>;
}
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="detail-dialog" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e=>{if(e.target===e.currentTarget)onClose();}} aria-labelledby="detail-title"><div className="dialog-heading"><h2 id="detail-title">{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X/></button></div>{children}</dialog>;
}

