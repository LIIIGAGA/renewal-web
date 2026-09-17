import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
let handler;
// No HTTP listener: service credentials and the scheduler stay inside the private container.
globalThis.Deno = {
  env: { get: name => process.env[name] },
  serve: callback => { handler = callback; },
};
await import('./generated/reminders.mjs');
if (!handler || !process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) throw new Error('Worker configuration missing');
async function tick() {
  const response = await handler(new Request('http://localhost/reminders', {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET },
  }));
  const summary = await response.text();
  console.log(new Date().toISOString(), 'Reminder poll', response.status, summary);
  if (response.status === 200) await writeFile(process.env.WORKER_HEALTH_FILE ?? '/tmp/renewal-worker-health', String(Date.now()));
  return response.status === 200;
}
if (process.argv.includes('--once')) process.exitCode = await tick() ? 0 : 1;
else while (true) { await tick(); await delay(15 * 60 * 1000); }
