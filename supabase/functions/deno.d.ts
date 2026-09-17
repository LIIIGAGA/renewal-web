// Local TypeScript verification only; Supabase's runtime provides Deno.
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void };
