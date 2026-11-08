import { CANDIDATE_BASES, nessieBase, nessieFetch } from '@/lib/nessie';

export async function GET(request) {
  const key = new URL(request.url).searchParams.get('key') || process.env.NESSIE_API_KEY;
  if (!key) {
    return Response.json({ ok: false, error: 'No key. Set NESSIE_API_KEY in .env.local or call /api/nessie/test?key=YOUR_KEY' }, { status: 400 });
  }

  const bases = [...new Set([nessieBase(), ...CANDIDATE_BASES])];
  const results = [];
  for (const base of bases) {
    try {
      const r = await nessieFetch(base, '/customers', key);
      results.push({
        base, status: r.status, ok: r.ok && Array.isArray(r.body),
        customers: Array.isArray(r.body) ? r.body.length : null,
        sample: Array.isArray(r.body) ? r.body.slice(0, 3).map((c) => ({ id: c._id, name: `${c.first_name} ${c.last_name}` })) : undefined,
        error: r.ok ? undefined : typeof r.body === 'string' ? r.body.slice(0, 200) : r.body?.message
      });
    } catch (e) {
      results.push({ base, ok: false, error: e.message });
    }
  }
  const working = results.find((r) => r.ok);
  return Response.json({
    ok: Boolean(working),
    configuredBase: nessieBase(),
    hint: !working ? 'No host answered with a customer list. Check the key, and that you seeded customers.'
      : working.base !== nessieBase() ? `Set NESSIE_BASE_URL=${working.base} in .env.local` : 'Connection is good.',
    results
  }, { status: working ? 200 : 502 });
}