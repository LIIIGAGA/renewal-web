import { mkdir, writeFile } from 'node:fs/promises';
import { demoData, exportCSV, exportJSON } from '../lib/subscriptions';
async function main() {
  await mkdir(new URL('../demo/',import.meta.url),{recursive:true});
  const data=demoData();
  await writeFile(new URL('../demo/subscriptions.json',import.meta.url),exportJSON(data));
  await writeFile(new URL('../demo/subscriptions.csv',import.meta.url),exportCSV(data));
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
