import { nessieBase, nessieFetch } from '@/lib/nessie';

// Only Nessie read endpoints the app actually uses.
const ALLOWED = /^\/(customers(\/[\w-]+(\/accounts)?)?|accounts\/[\w-]+\/(purchases|bills|deposits))$/;

export async function GET(request) {
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!ALLOWED.test(path)) return Response.json({ error: 'Path not allowed' }, { status: 400 });

  const key = request.headers.get('x-nessie-key') || process.env.NESSIE_API_KEY;
  if (!key) return Response.json({ error: 'No Nessie API key provided' }, { status: 401 });

  try {
    const res = await nessieFetch(nessieBase(), path, key);
    const body = res.ok ? res.body : { error: typeof res.body === 'string' ? res.body : res.body?.message || 'Nessie request failed' };
    return Response.json(body, { status: res.status });
  } catch (e) {
    return Response.json({ error: `Could not reach Nessie at ${nessieBase()}: ${e.message}` }, { status: 502 });
  }
}