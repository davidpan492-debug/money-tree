"use client";

import React, { useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, Wand2 } from 'lucide-react';
import { EMPTY_SCENARIO, coachContext, describeScenario, evaluate, sanitizeScenario } from '@/lib/finance';
import { detectSubscriptions } from '@/lib/nessie';
import { callCoach, localSummary } from '@/lib/coach';
import { $, Card, H } from './ui';

const subTotalOf = (profile) => detectSubscriptions(profile.purchases || []).reduce((s, x) => s + x.monthly, 0);

// ---------------------------------------------------------------- Overview: plain-English health summary

export function AISummaryCard({ profile, months }) {
  const [state, setState] = useState({ status: 'idle', data: null, note: '' });

  const run = async () => {
    setState({ status: 'loading', data: null, note: '' });
    const ctx = coachContext(profile, subTotalOf(profile), months);
    try {
      const data = await callCoach({ mode: 'summary', context: ctx });
      setState({ status: 'done', data, note: '' });
    } catch (e) {
      setState({ status: 'done', data: localSummary(ctx), note: `AI unavailable (${e.message}). Showing the rule-based summary instead.` });
    }
  };

  return (
    <Card className="border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 to-white">
      <H sub="Written by AI from your tree's real numbers">
        <span className="inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-emerald-700" />Your financial health, in plain English</span>
      </H>
      {state.status === 'idle' && (
        <button onClick={run} className="text-xs px-3 py-2 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />Explain my tree
        </button>
      )}
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-stone-500"><Loader2 className="w-4 h-4 animate-spin" />Reading your tree…</div>
      )}
      {state.status === 'done' && state.data && (
        <div className="space-y-2">
          <p className="text-sm text-stone-800 leading-relaxed">{state.data.summary}</p>
          {state.data.topPriority && (
            <p className="text-xs text-emerald-900 bg-emerald-100/70 border border-emerald-200 rounded-lg p-2"><b>Next step:</b> {state.data.topPriority}</p>
          )}
          {state.note && <p className="text-[11px] text-amber-700">{state.note}</p>}
          <button onClick={run} className="text-[11px] underline text-stone-500">Refresh</button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Vehicle: AI explanation of the recommendation

export function VehicleExplainer({ profile, months }) {
  const [state, setState] = useState({ status: 'idle', text: '', err: '' });
  const run = async () => {
    setState({ status: 'loading', text: '', err: '' });
    try {
      const ctx = coachContext(profile, subTotalOf(profile), months);
      const data = await callCoach({ mode: 'vehicle', context: ctx });
      setState({ status: 'done', text: data.explanation, err: '' });
    } catch (e) {
      setState({ status: 'idle', text: '', err: e.message });
    }
  };
  return (
    <div className="mb-3">
      {state.status !== 'done' && (
        <button onClick={run} disabled={state.status === 'loading'} className="text-[11px] px-2 py-1 rounded-lg border border-stone-300 hover:bg-stone-50 disabled:opacity-50 flex items-center gap-1.5">
          {state.status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Explain this for me
        </button>
      )}
      {state.status === 'done' && <p className="text-xs text-stone-700 leading-relaxed rounded-xl border border-stone-200 bg-stone-50 p-3">{state.text}</p>}
      {state.err && <p className="text-[11px] text-rose-700 mt-1">{state.err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Coach tab: "Ask your tree"

const EXAMPLES = [
  'Refinance my car and cut $200 of discretionary spending',
  'What if I put an extra $200 a month toward my credit card?',
  'Could I afford to save $300 more and invest $100 more each month?'
];

export function AskPanel({ profile, months, onPreview, onOpenWhatIf }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [out, setOut] = useState(null);

  const ask = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setQ(question);
    setBusy(true);
    setErr('');
    try {
      const ctx = coachContext(profile, subTotalOf(profile), months);
      const data = await callCoach({ mode: 'scenario', question, context: ctx });
      const scenario = sanitizeScenario(data.scenario, ctx.allowedVehicleIds);
      const changed = JSON.stringify(scenario) !== JSON.stringify(EMPTY_SCENARIO);
      let numbers = null;
      if (changed) {
        // The numbers come from the engine, not the model.
        const r = evaluate(profile, scenario, months);
        numbers = {
          tree: (r.after.scores.trunk - r.base.scores.trunk) * 100,
          cash: r.flowsAfter.leftover - r.flowsBase.leftover,
          changes: describeScenario(profile, scenario)
        };
        onPreview(scenario);
      }
      setOut({ reply: data.reply, understood: data.understood, changed, numbers, scenario });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-emerald-200/80">
      <H sub="Ask in plain English. The AI picks the levers, the engine calculates the result, and the tree on the left changes.">
        <span className="inline-flex items-center gap-1.5"><MessageCircle className="w-4 h-4 text-emerald-700" />Ask your tree</span>
      </H>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={300}
          placeholder="What if I trade in my car and cut dining by $200?"
          aria-label="Ask a what-if question"
          className="flex-1 text-xs rounded-lg border border-stone-300 p-2"
        />
        <button type="submit" disabled={busy || !q.trim()} className="text-xs px-3 py-2 rounded-lg bg-emerald-700 text-white disabled:opacity-40 flex items-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Ask
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => ask(ex)} disabled={busy} className="text-[11px] px-2 py-1 rounded-full border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 text-left disabled:opacity-50">{ex}</button>
        ))}
      </div>

      {err && <p className="mt-3 text-[11px] text-rose-700">{err}</p>}

      {out && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-stone-800 rounded-xl bg-stone-50 border border-stone-200 p-3">{out.reply}</p>
          {out.changed && out.numbers && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-[11px] space-y-1">
              <div className="text-stone-600">{out.numbers.changes.join(' · ')}</div>
              <div className="flex gap-4">
                <span className={out.numbers.tree >= 0 ? 'text-emerald-700' : 'text-rose-700'}>Tree health {out.numbers.tree >= 0 ? '+' : ''}{out.numbers.tree.toFixed(1)} pts after {months} mo</span>
                <span className={out.numbers.cash >= 0 ? 'text-emerald-700' : 'text-rose-700'}>Cash flow {out.numbers.cash >= 0 ? '+' : ''}{$(out.numbers.cash)}/mo</span>
              </div>
              <button onClick={onOpenWhatIf} className="mt-1 text-[11px] px-2 py-1 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 flex items-center gap-1"><Wand2 className="w-3 h-3" />Fine-tune in What-if</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
