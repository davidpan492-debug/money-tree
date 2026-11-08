"use client";

import React, { useMemo, useState } from 'react';
import { BadgeCheck, ChevronDown, Clock, Flag, Lock, Scale } from 'lucide-react';
import { eligibleOffers, leaseVsBuy, nextCarPlan } from '@/lib/toyota';
import { $, Card, H } from './ui';

// ---------------------------------------------------------------- Collapsible drawer

export function Drawer({ title, badge, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-stone-200/90 shadow-sm">
      <button
        type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-5 py-3.5 text-left"
      >
        <span className="text-sm font-bold text-stone-900">{title}</span>
        <span className="flex items-center gap-2">
          {badge && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">{badge}</span>}
          <ChevronDown className={`w-4 h-4 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Next-car plan ("your loan ends in N months")

export function NextCarCard({ profile }) {
  const plan = useMemo(() => nextCarPlan(profile), [profile]);
  if (!plan) return null;

  if (plan.status === 'stuck') {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <H sub={plan.name}><span className="inline-flex items-center gap-1.5"><Flag className="w-4 h-4 text-amber-700" />Next-car plan</span></H>
        <p className="text-xs text-amber-900">Your {$(plan.payment)}/mo payment does not cover the loan&apos;s interest, so there is no payoff date yet. Raising the payment or refinancing comes first; a next-car plan follows once the balance starts to fall.</p>
      </Card>
    );
  }

  const headline = plan.status === 'paidoff'
    ? 'Your car is paid off. Here is how to plan the next one.'
    : `Your loan ends in ${plan.months} months (${plan.payoffDate}). Here is the next-car plan.`;
  const horizon = plan.months > 0 ? plan.months : 12;

  return (
    <Card className="border-red-200/70 bg-gradient-to-br from-red-50/50 to-white">
      <H sub={plan.name}><span className="inline-flex items-center gap-1.5"><Flag className="w-4 h-4 text-red-700" />Next-car plan</span></H>
      <p className="text-sm font-semibold text-stone-900 mb-3" data-testid="next-car-headline">{headline}</p>
      <ol className="space-y-2 text-xs text-stone-700">
        <li className="rounded-xl border border-stone-200 bg-white p-3">
          <div className="font-semibold text-stone-900">{plan.fund > 0 ? `1. Start a ${$(plan.fund)}/mo car fund now` : '1. Build room in your budget first'}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            {plan.fund > 0
              ? `${$(plan.saved)} saved by ${plan.status === 'paidoff' ? 'next year' : 'payoff'}${plan.fundCapped ? ' (as much as your spare cash allows)' : ' (about 10% of the new car\u2019s price)'}.`
              : 'There is no spare cash to set aside yet. Trimming spending or finishing the loan first will open room for a fund.'}
          </div>
        </li>
        <li className="rounded-xl border border-stone-200 bg-white p-3">
          <div className="font-semibold text-stone-900">2. Decide in months {plan.windowStart}–{plan.windowEnd}{plan.windowStart === 0 ? ' (now)' : ''}</div>
          <div className="text-[11px] text-stone-500 mt-0.5">
            Your car will be about {plan.ageThen} years old and worth about {$(plan.valueThen)}. Upkeep rises from about {$(plan.maintNow)}/mo today to {$(plan.maintThen)}/mo, and about {$(plan.maintIn2y)}/mo two years later.
          </div>
        </li>
        <li className="rounded-xl border border-stone-200 bg-white p-3">
          <div className="font-semibold text-stone-900">3. Compare your two paths</div>
          <div className="grid grid-cols-2 gap-2 mt-1.5 text-[11px]">
            <div className="rounded-lg bg-stone-50 border border-stone-200 p-2">
              <div className="text-stone-500">Keep it, no payment</div>
              <div className="font-mono font-bold text-sm">{$(plan.keepMonthlyThen)}/mo</div>
              <div className="text-stone-400">insurance, fuel, upkeep</div>
            </div>
            <div className="rounded-lg bg-stone-50 border border-stone-200 p-2">
              <div className="text-stone-500">Trade into a {$(plan.newPrice)} car</div>
              <div className="font-mono font-bold text-sm">{$(plan.newMonthlyAllIn)}/mo</div>
              <div className="text-stone-400">{$(plan.newPayment)} payment + running costs</div>
            </div>
          </div>
        </li>
      </ol>
      {plan.status !== 'paidoff' && (
        <p className="text-[11px] text-stone-600 mt-3">
          When the loan ends, your {$(plan.freedPayment)}/mo payment is free. Putting even part of it into the next car keeps your tree&apos;s Auto branch healthy through the switch.
        </p>
      )}
      <p className="text-[10px] text-stone-400 mt-2">Assumes the trade-in is worth {$(plan.valueThen)} after {horizon} months (10% a year) and the new car is financed at {plan.newApr}% for {plan.newTerm} months. Simulated.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- Buy vs lease (toggle)

const MILES = [8000, 12000, 15000, 18000];

export function LeaseVsBuyCard({ profile, leaseOffer }) {
  const [mode, setMode] = useState('buy');
  const [miles, setMiles] = useState(12000);
  const r = useMemo(() => leaseVsBuy(profile, { milesPerYear: miles }), [profile, miles]);
  const side = r[mode];
  const better = r.winner === 'close' ? null : r.winner;
  const tiles = [
    ['Monthly payment', $(side.monthly)],
    [mode === 'buy' ? 'Equity put in' : 'Due at signing', $(side.upfront)],
    [`${r.term}-month total cost`, $(side.total)],
    ['Budget left per month', $(side.cashAfter)]
  ];
  const end = mode === 'buy' ? `Own it, worth about ${$(r.buy.resale)}` : 'Hand back the keys';
  return (
    <Card className="border-red-200/70">
      <H sub={`The same ${$(r.price)} car, ${r.term} months`}>
        <span className="inline-flex items-center gap-1.5"><Scale className="w-4 h-4 text-red-700" />Buy or lease?</span>
      </H>
      <div className="grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-xs font-medium" role="tablist" aria-label="Buy or lease">
        {['buy', 'lease'].map((m) => (
          <button
            key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} data-testid={`toggle-${m}`}
            className={`py-1.5 rounded-lg transition flex items-center justify-center gap-1.5 ${mode === m ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500 hover:text-stone-700'}`}
          >
            {m === 'buy' ? 'Buy' : 'Lease'}
            {better === m && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Better value</span>}
          </button>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-2 mt-3 text-[11px]" data-testid={`lease-buy-${mode}`}>
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-stone-50 border border-stone-200 p-2">
            <dt className="text-stone-500">{label}</dt>
            <dd className={`font-mono font-bold text-sm ${label.startsWith('Budget') && side.cashAfter < 0 ? 'text-rose-700' : 'text-stone-900'}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-stone-600">
        <span>At the end: <b>{end}</b></span>
        {mode === 'lease' && (
          <label className="flex items-center gap-1 text-stone-500 whitespace-nowrap">
            mi/yr
            <select value={miles} onChange={(e) => setMiles(Number(e.target.value))} aria-label="Miles per year" className="rounded-md border border-stone-300 bg-white px-1 py-0.5 text-[11px]">
              {MILES.map((m) => <option key={m} value={m}>{m.toLocaleString()}</option>)}
            </select>
          </label>
        )}
      </div>
      {mode === 'lease' && r.lease.excessMiles > 0 && (
        <p className="text-[11px] text-rose-700 mt-1">About {$(r.lease.excessCost)} in over-mileage charges at {miles.toLocaleString()} mi/yr.</p>
      )}
      <p className="text-[11px] text-stone-600 mt-2" data-testid="lease-verdict">{r.why}</p>
      {leaseOffer && leaseOffer.status === 'no' && r.winner === 'lease' && (
        <p className="text-[11px] text-amber-800 mt-1">Heads up: you may not qualify for the lease special ({leaseOffer.reason.replace(/\.$/, '')}).</p>
      )}
      <p className="text-[10px] text-stone-400 mt-2">{r.assumptions} Running costs ({$(r.running)}/mo) are the same for both. Simulated.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- Eligible Toyota offers

const STATUS = {
  yes: { label: 'You qualify', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', Icon: BadgeCheck },
  soon: { label: 'Coming up', cls: 'bg-amber-100 text-amber-800 border-amber-200', Icon: Clock },
  no: { label: 'Not a fit', cls: 'bg-stone-100 text-stone-600 border-stone-200', Icon: Lock }
};

export function ToyotaOffersCard({ profile, decision }) {
  const offers = useMemo(() => eligibleOffers(profile, decision), [profile, decision]);
  if (!offers.length) return null;
  const qualifying = offers.filter((o) => o.status === 'yes').length;
  return (
    <Drawer title="View Toyota Offers & Eligibility" badge={`${qualifying} of ${offers.length} fit`}>
      <ul className="space-y-2">
        {offers.map((o) => {
          const s = STATUS[o.status];
          return (
            <li key={o.id} data-testid={`offer-${o.id}`} className={`rounded-xl border p-3 ${o.status === 'yes' ? 'border-emerald-200 bg-emerald-50/40' : 'border-stone-200'} ${o.status === 'no' ? 'opacity-80' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-stone-900">{o.title}</div>
                  <div className="text-[11px] text-stone-500">{o.terms}</div>
                </div>
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${s.cls}`}><s.Icon className="w-3 h-3" />{s.label}</span>
              </div>
              <p className="text-[11px] text-stone-600 mt-1.5">{o.reason}</p>
              {o.benefit && <p className="text-[11px] font-semibold text-emerald-800 mt-1">{o.benefit}</p>}
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-stone-400 mt-3">Programs and rates are simulated. Eligibility is estimated from your income, debt health and vehicle, not a credit check; a real Toyota Financial offer would confirm it.</p>
    </Drawer>
  );
}