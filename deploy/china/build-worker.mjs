import ts from 'typescript';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
// Bundle the same tested handler for Node; all runtime dependencies are installed in the image.
const source = await readFile('supabase/functions/send-reminders/index.ts', 'utf8');
const result = ts.transpileModule(source.replace('npm:@supabase/supabase-js@2', '@supabase/supabase-js'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
await mkdir('deploy/china/generated', { recursive: true });
await writeFile('deploy/china/generated/reminders.mjs', result.outputText);
