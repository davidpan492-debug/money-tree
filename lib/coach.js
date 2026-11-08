// Client helpers for the OpenAI-powered coach (see app/api/coach/route.js).

export async function callCoach(payload) {
  const res = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store'
  });
  const data = await res.json().catch(() => null);
  if (res.status === 404 && !data?.error) {
    throw new Error('AI route not found (404). Put route.js at <your app folder>/api/coach/route.js, next to api/nessie/proxy, then restart the dev server.');
  }
  if (!res.ok) throw new Error(data?.error || `Coach request failed (${res.status})`);
  return data;
}

// Rule-based summary used when the AI is unavailable, so the demo never shows an empty card.
export function localSummary(ctx) {
  const entries = ['income', 'savings', 'investments', 'spending', 'auto', 'debt'].map((k) => [k, ctx.scores[k]]);
  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const worst = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
  const i = ctx.indicators;
  const flow = i.monthlyCashFlow >= 0
    ? `You have about $${i.monthlyCashFlow.toLocaleString()} left each month.`
    : `You are about $${Math.abs(i.monthlyCashFlow).toLocaleString()} over budget each month.`;
  const top = ctx.topCoachActions?.[0];
  return {
    summary: `Overall tree health is ${ctx.scores.trunk}. Your strongest branch is ${best[0]} (${best[1]}) and the weakest is ${worst[0]} (${worst[1]}). ${flow} Emergency savings cover ${i.emergencyFundMonths} months.`,
    topPriority: top ? top.title : 'Keep going: no single action stands out.'
  };
}
