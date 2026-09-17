import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const execute = promisify(execFile);
test('Node scheduler runs the bundled handler without a public HTTP server or foreign API', async () => {
  const root = fileURLToPath(new URL('../',import.meta.url));
  const temporary = await mkdtemp(join(tmpdir(),'renewal-worker-'));
  try {
    await execute(process.execPath,['deploy/china/build-worker.mjs'],{cwd:root});
    const bootstrap = join(temporary,'mock.mjs');
    await writeFile(bootstrap,`globalThis.fetch=async(input)=>{
      const url=String(input);
      if(url!=='http://api-gw:8000/rest/v1/rpc/claim_due_reminders')throw new Error('Unexpected external request');
      return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});
    };`);
    const health = join(temporary,'health');
    const environment = { ...process.env, EMAIL_PROVIDER:'aliyun', CRON_SECRET:'a'.repeat(64),
      SUPABASE_URL:'http://api-gw:8000', SUPABASE_SERVICE_ROLE_KEY:'test-service-role',
      APP_URL:'https://renewal.example.cn', REMINDER_FROM:'Renewal <reminder@example.com>',
      ALIYUN_ACCESS_KEY_ID:'test-id', ALIYUN_ACCESS_KEY_SECRET:'test-secret',
      ALIYUN_DM_ACCOUNT:'reminder@example.com', WORKER_HEALTH_FILE:health };
    const result = await execute(process.execPath,['--import',pathToFileURL(bootstrap).href,'deploy/china/worker.mjs','--once'],{cwd:root,env:environment});
    assert.match(result.stdout,/Reminder poll 200/);
    assert.ok(Date.now()-Number(await readFile(health,'utf8'))<10000);
    await assert.rejects(execute(process.execPath,['--import',pathToFileURL(bootstrap).href,'deploy/china/worker.mjs','--once'],{cwd:root,env:{...environment,EMAIL_PROVIDER:'unknown'}}));
  } finally { await rm(temporary,{recursive:true,force:true}); }
});
