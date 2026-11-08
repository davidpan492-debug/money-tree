"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Repeat, Store, TrendingDown } from 'lucide-react';
import { cashCalendar } from '@/lib/finance';
import { detectAnomalies, detectSubscriptions, spendingByMerchant } from '@/lib/nessie';
import { $, Card, H } from './ui';

const shortDate = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ---------------------------------------------------------------- Cash calendar (Overview)

// The calendar depends on today's date, so it only renders after the page has mounted in the browser.
// (Calling new Date() while Next.js prerenders a Client Component would freeze the build-time date.)
export function CashCalendarCard({ profile }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return (
      <Card>
        <H sub="Loading today's schedule…"><span className="inline-flex items-center gap-1.5"><CalendarClock className="w-4 h-4" />30-day cash calendar</span></H>
        <div className="h-24 rounded-xl bg-stone-100 animate-pulse" />
      </Card>
    );
  }
  return <CashCalendarContent profile={profile} />;
}

function CashCalendarContent({ profile }) {
  const subs = useMemo(() => detectSubscriptions(profile.purchases || []), [profile.purchases]);
  const cal = useMemo(() => cashCalendar(profile, subs, 30), [profile, subs]);
  const W = 300, Hh = 80;
  const bals = cal.days.map((d) => d.balance);
  const lo = Math.min(...bals, cal.buffer, 0), hi = Math.max(...bals, cal.buffer);
  const x = (i) => (i / (cal.days.length - 1)) * W;
  const y = (v) => Hh - ((v - lo) / (hi - lo || 1)) * (Hh - 8) - 4;
  const line = cal.days.map((d, i) => `${x(i)},${y(d.balance)}`).join(' ');
  const upcoming = cal.days.flatMap((d) => d.events.map((e) => ({ ...e, date: d.date }))).filter((e) => e.amount < 0).slice(0, 6);
  const breach = cal.firstBreach;

  return (
    <Card>
      <H sub="Checking balance day by day: paydays, bills, subscriptions and everyday spending (paydays assumed on the 1st and 15th)">
        <span className="inline-flex items-center gap-1.5"><CalendarClock className="w-4 h-4" />30-day cash calendar</span>
      </H>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Projected checking balance for the next 30 days">
        <line x1="0" x2={W} y1={y(cal.buffer)} y2={y(cal.buffer)} stroke="#d97706" strokeWidth="1" strokeDasharray="4 3" />
        {lo < 0 && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="#be123c" strokeWidth="1" />}
        <polyline points={line} fill="none" stroke="#047857" strokeWidth="2.5" strokeLinejoin="round" />
        {cal.days.map((d, i) => d.balance < cal.buffer && <circle key={d.date} cx={x(i)} cy={y(d.balance)} r="3" fill="#be123c" />)}
      </svg>
      <div className="flex justify-between text-[11px] text-stone-500 mt-1 font-mono">
        <span>Today {$(cal.days[0].balance)}</span>
        <span>Low {$(cal.min.balance)} on {shortDate(cal.min.date)}</span>
        <span>Day 30 {$(cal.days[cal.days.length - 1].balance)}</span>
      </div>
      <div className="text-[10px] text-stone-400 mt-0.5">Dashed line = {$(cal.buffer)} safety buffer</div>

      {breach ? (
        <div className={`mt-3 flex gap-2 rounded-xl border p-3 text-xs ${cal.overdraft ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Checking is projected to drop to <b>{$(breach.balance)}</b> on <b>{shortDate(breach.date)}</b>
            {breach.events.length > 0 && <> ({breach.events.map((e) => e.label).join(', ')})</>}.
            {cal.overdraft ? ' It goes below zero within 30 days.' : ' That is under the buffer.'}
          </span>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          No cash crunch in the next 30 days. The lowest point is {$(cal.min.balance)} on {shortDate(cal.min.date)}.
        </div>
      )}

      {upcoming.length > 0 && (
        <ul className="mt-3 divide-y divide-stone-100 text-[11px]">
          {upcoming.map((e, i) => (
            <li key={i} className="py-1.5 flex justify-between gap-2">
              <span className="text-stone-600">{shortDate(e.date)} · {e.label}</span>
              <span className="font-mono text-stone-800">{$(e.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Insights tab (Nessie transaction analytics)

export function InsightsPanel({ profile, onTry }) {
  const purchases = profile.purchases || [];
  const subs = useMemo(() => detectSubscriptions(purchases), [purchases]);
  const anomalies = useMemo(() => detectAnomalies(purchases), [purchases]);
  const merchants = useMemo(() => spendingByMerchant(purchases, 6), [purchases]);
  const subTotal = subs.reduce((s, x) => s + x.monthly, 0);
  const maxM = Math.max(...merchants.map((m) => m.total), 1);

  return (
    <div className="space-y-4">
      <Card>
        <H sub="Found by looking for steady charges that repeat about every month">
          <span className="inline-flex items-center gap-1.5"><Repeat className="w-4 h-4" />Recurring subscriptions</span>
        </H>
        {subs.length === 0 ? (
          <p className="text-xs text-stone-500">No recurring monthly charges detected in this transaction history.</p>
        ) : (
          <>
            <ul className="divide-y divide-stone-100">
              {subs.map((s) => (
                <li key={s.name} className="py-2 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-stone-800">{s.name}</div>
                    <div className="text-[11px] text-stone-500">{s.count} charges · {$(s.monthly * 12)}/yr</div>
                  </div>
                  <div className="font-mono font-bold text-stone-800">{$(s.monthly)}/mo</div>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-stone-50 border border-stone-200 p-3 text-xs">
              <span className="text-stone-600">Total <b className="font-mono">{$(subTotal)}/mo</b> ({$(subTotal * 12)}/yr)</span>
              <button
                onClick={() => onTry({ extraSavings: 0, extraInvest: 0, extraDebt: 0, cutDiscretionary: Math.min(600, Math.round(subTotal / 25) * 25), housingDelta: 0, vehicleId: 'keep' })}
                className="text-[11px] px-2 py-1 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 flex items-center gap-1"
              >
                <TrendingDown className="w-3 h-3" />See the tree if I cancel them
              </button>
            </div>
          </>
        )}
      </Card>

      <Card>
        <H sub="Purchases far above this account's normal size (more than 2.5 standard deviations)">
          <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Unusual spending</span>
        </H>
        {anomalies.length === 0 ? (
          <p className="text-xs text-stone-500">Nothing unusual. Every purchase is within the normal range.</p>
        ) : (
          <ul className="space-y-2">
            {anomalies.slice(0, 5).map((a, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <span><b>{a.description}</b>{a.purchase_date && <> · {shortDate(String(a.purchase_date).slice(0, 10))}</>}</span>
                <span className="font-mono font-bold">{$(a.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <H sub="Where the money went across the whole transaction history">
          <span className="inline-flex items-center gap-1.5"><Store className="w-4 h-4" />Top merchants</span>
        </H>
        <ul className="space-y-2.5">
          {merchants.map((m) => (
            <li key={m.name}>
              <div className="flex justify-between text-xs mb-1"><span className="text-stone-700">{m.name}</span><span className="font-mono">{$(m.total)}</span></div>
              <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-emerald-600" style={{ width: `${Math.round((m.total / maxM) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
