import { z } from 'zod';
import { subscriptionSchema, type Subscription } from './subscriptions';

export type GitHubConnection = { owner: string; repo: string; token: string };
export type GitHubSnapshot = { sha: string | null; subscriptions: Subscription[] };
const record = subscriptionSchema.extend({ id: z.uuid(), updated_at: z.iso.datetime({offset:true}) });
const document = z.object({ format:z.literal('renewal-ledger'), version:z.literal(1), subscriptions:z.array(record).max(1000) });
const FILE = 'ledger/subscriptions.json';
const LIMIT = 900 * 1024; // Contents API supplies base64 only for files below 1 MiB.
export class GitHubConflict extends Error { constructor() { super('另一台设备已修改台账，请刷新后重新打开记录。'); } }
function encode(text: string) { return btoa(Array.from(new TextEncoder().encode(text), b => String.fromCharCode(b)).join('')); }
function decode(text: string) { return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0))); }
export class GitHubLedger {
  private endpoint: string;
  private connection: GitHubConnection;
  private request: typeof fetch;
  constructor(connection: GitHubConnection, request: typeof fetch = (input, init) => fetch(input, init)) {
    this.connection=connection;this.request=request;
    if(!/^[A-Za-z0-9-]+$/.test(connection.owner) || !/^[A-Za-z0-9_.-]+$/.test(connection.repo) || !connection.token.trim()) throw new Error('请填写正确的 GitHub 用户名、仓库名称和访问令牌。');
    this.endpoint=`https://api.github.com/repos/${encodeURIComponent(connection.owner)}/${encodeURIComponent(connection.repo)}`;
  }
  private async call(path:string, init:RequestInit={}) {
    try { return await this.request(`${this.endpoint}${path}`,{...init,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.connection.token}`,'X-GitHub-Api-Version':'2026-03-10',...(init.body?{'Content-Type':'application/json'}:{}),...init.headers}}); }
    catch { throw new Error('无法连接 GitHub，台账未上传。请检查网络后刷新重试。'); }
  }
  private error(status:number) {
    return new Error(status===401?'令牌失效，请重新连接。':status===403?'访问被拒绝或请求超限，请检查令牌权限，稍后重试。':status===404?'仓库不存在或令牌没有访问权限。':`GitHub 请求失败（${status}），请重试。`);
  }
  async read():Promise<GitHubSnapshot> {
    const response=await this.call(`/contents/${FILE}`);
    if(response.status===404) {
      // A file 404 can also mean an inaccessible repo. Never treat that as an empty writable ledger.
      const repository=await this.call('');
      if(!repository.ok) throw this.error(repository.status);
      const metadata=await repository.json();
      if(metadata.private!==true) throw new Error('台账只能连接私有仓库，请使用独立的私有数据仓库。');
      return {sha:null,subscriptions:[]};
    }
    if(!response.ok) throw this.error(response.status);
    // Check visibility on every read, including an existing file or visibility changed after connection.
    const repository=await this.call('');
    if(!repository.ok) throw this.error(repository.status);
    if((await repository.json()).private!==true) throw new Error('数据仓库不是私有仓库，已停止同步。');
    const file=await response.json();
    if(file.type!=='file'||file.encoding!=='base64'||typeof file.sha!=='string'||typeof file.content!=='string'||file.size>LIMIT) throw new Error('台账文件格式不受支持或超过大小限制。');
    const parsed=document.safeParse(JSON.parse(decode(file.content)));
    if(!parsed.success || new Set(parsed.data?.subscriptions.map(s=>s.id)).size!==parsed.data?.subscriptions.length) throw new Error('云端台账格式有误，请从备份恢复，不会覆盖该文件。');
    return {sha:file.sha,subscriptions:parsed.data.subscriptions};
  }
  async write(subscriptions:Subscription[], expectedSHA:string|null):Promise<string> {
    const validated=document.parse({format:'renewal-ledger',version:1,subscriptions});
    const text=JSON.stringify(validated,null,2);
    if(new TextEncoder().encode(text).length>LIMIT) throw new Error('台账超过 900 KB，请减少备注或记录数量。');
    // Recheck visibility just before a write. Avoid sending new notes if repository was made public.
    const metadata=await this.call('');
    if(!metadata.ok) throw this.error(metadata.status);
    if((await metadata.json()).private!==true) throw new Error('台账只能写入私有仓库。');
    const response=await this.call(`/contents/${FILE}`,{method:'PUT',body:JSON.stringify({message:'Update personal subscription ledger',content:encode(text),...(expectedSHA?{sha:expectedSHA}:{})})});
    if(response.status===409 || response.status===422) throw new GitHubConflict();
    if(!response.ok) throw this.error(response.status);
    const result=await response.json();
    if(typeof result.content?.sha!=='string') throw new Error('GitHub 未返回保存版本，请刷新核对结果。');
    return result.content.sha;
  }
}
