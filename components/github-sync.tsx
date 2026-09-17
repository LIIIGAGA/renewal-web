'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { GitHubConnection } from '@/lib/github-ledger';
type Props = {
  connected:string|null; busy:boolean; error:string; remember:boolean; saved:boolean;
  onConnect:(connection:GitHubConnection)=>Promise<void>; onDisconnect:()=>void;
  onRemember:(value:boolean)=>void; onClear:()=>void;
};
export default function GitHubSync({connected,busy,error,remember,saved,onConnect,onDisconnect,onRemember,onClear}:Props) {
  const [owner,setOwner]=useState(''); const [repo,setRepo]=useState(''); const [token,setToken]=useState('');
  useEffect(()=>{try{const stored=JSON.parse(localStorage.getItem('renewal-github-repo')??'null');if(stored){setOwner(stored.owner??'');setRepo(stored.repo??'');}}catch{}},[]);
  return <section className="settings-card full"><div className="aside-heading"><RefreshCw size={21}/><h2>GitHub 同步</h2></div>
    {connected ? <><p>已连接私有仓库：{connected}</p><p>修改成功后自动上传。另一设备切回网页或点击刷新，读取最新台账。</p><button className="button secondary" disabled={busy} onClick={onDisconnect}>断开同步</button></> : <p>在电脑和手机连接同一个私有数据仓库。新仓库第一次连接为空台账；已有本地记录可先导出 JSON，再连接并导入。</p>}
    <form className="github-form" onSubmit={async e=>{e.preventDefault();try{await onConnect({owner:owner.trim(),repo:repo.trim(),token:token.trim()});setToken('');}catch{ /* Parent shows a sanitized error. */ }}}>
      <label>GitHub 用户名<input required autoCapitalize="none" autoCorrect="off" value={owner} onChange={e=>setOwner(e.target.value)} placeholder="LIIIGAGA"/></label>
      <label>私有数据仓库<input required autoCapitalize="none" autoCorrect="off" value={repo} onChange={e=>setRepo(e.target.value)} placeholder="renewal-data"/></label>
      <label className="full">访问令牌<input required type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} placeholder={connected?'输入新令牌以更新连接':'只授权这个数据仓库的 fine-grained token'}/></label>
      <div className="full"><label className="remember-token"><input type="checkbox" aria-label="在此设备记住令牌" checked={remember} onChange={e=>onRemember(e.target.checked)}/>在此设备记住令牌</label><p className="small-note">仅在个人设备上使用，令牌将保存在此浏览器中</p><p role="status">{saved?'此浏览器已记住令牌':'此浏览器未保存令牌'}</p>{saved&&<button type="button" className="button secondary" onClick={onClear}>清除已保存令牌</button>}</div>
      {error&&<p role="alert" className="error full">{error}</p>}
      <div className="full"><button className="button primary" disabled={busy}>{busy?'正在连接…':connected?'更新连接令牌':'连接私有仓库'}</button></div>
    </form>
    <p className="small-note">不勾选时令牌只在页面内存中。记住令牌使用浏览器 localStorage 明文保存；同一网站的脚本、浏览器扩展或能访问此设备的人可能读取它。电脑与手机需分别设置。取消勾选或清除不会中断当前连接；断开同步也会清除已保存令牌。仅授权独立私有数据仓库的 Contents 读写权限。</p>
  </section>;
}
