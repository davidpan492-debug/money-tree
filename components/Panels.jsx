"use client";

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, Plug, RefreshCw, Repeat, Sparkles, Wand2 } from 'lucide-react';
import { AISummaryCard, AskPanel, VehicleExplainer } from './AIPanels';
import { CashCalendarCard } from './InsightPanels';
import { Drawer, LeaseVsBuyCard, NextCarCard, ToyotaOffersCard } from './ToyotaPanels';
import {
  BRANCHES, DEFAULT_OFFERS, EMPTY_SCENARIO, billRisk, evaluate, explainBranch, loanSummary, rankActions, vehicleDecision, vehicleOptions
} from '@/lib/finance';
import { eligibleOffers } from '@/lib/toyota';
import { getNessieCustomers, loadNessieProfile } from '@/lib/nessie';
import { demoProfile } from '@/lib/demoProfile';

const $ = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const pct = (n) => `${Math.round(n * 100)}%`;

export function badgeFor(score) {
  if (score >= 0.75) return { text: 'Thriving', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  if (score >= 0.6) return { text: 'Full canopy', cls: 'bg-teal-100 text-teal-800 border-teal-200' };
  if (score >= 0.35) return { text: 'Shedding', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  if (score > 0.02) return { text: 'Withering', cls: 'bg-purple-100 text-purple-800 border-purple-200' };
  return { text: 'Barren', cls: 'bg-rose-100 text-rose-800 border-rose-200' };
}

const STATUS = { good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700' };
const DOT = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500' };

const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-stone-200/90 shadow-sm p-5 ${className}`}>{children}</div>
);
const H = ({ children, sub }) => (
  <div className="mb-3">
    <h3 className="text-sm font-bold text-stone-900">{children}</h3>
    {sub && <p className="text-xs text-stone-500 mt-0.5">{sub}</p>}
  </div>
);

function Spark({ series, other, height = 56 }) {
  const all = [...series, ...(other || [])];
  const lo = Math.min(...all), hi = Math.max(...all);
  const pts = (s) => s.map((v, i) => `${(i / (s.length - 1)) * 300},${height - ((v - lo) / (hi - lo || 1)) * (height - 6) - 3}`).join(' ');
  return (
    <svg viewBox={`0 0 300 ${height}`} className="w-full" preserveAspectRatio="none">
      {other && <polyline points={pts(other)} fill="none" stroke="#a8a29e" strokeWidth="2" strokeDasharray="4 3" />}
      <polyline points={pts(series)} fill="none" stroke="#047857" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function ScoreBar({ before, after }) {
  return (
    <div className="relative h-2 rounded-full bg-stone-100 overflow-hidden">
      <div className="absolute inset-y-0 left-0 bg-stone-300" style={{ width: pct(before) }} />
      <div className={`absolute inset-y-0 left-0 ${after >= before ? 'bg-emerald-600' : 'bg-rose-500'} opacity-90`} style={{ width: pct(Math.min(before, after)) }} />
      {after > before && <div className="absolute inset-y-0 bg-emerald-400" style={{ left: pct(before), width: pct(after - before) }} />}
      {after < before && <div className="absolute inset-y-0 bg-rose-300" style={{ left: pct(after), width: pct(before - after) }} />}
    </div>
  );
}

// ---------------------------------------------------------------- Overview

export function OverviewPanel({ profile, metrics, onSelect, months = 12 }) {
  const i = metrics.indicators;
  const risk = billRisk(profile.checking, profile.bills);
  const stats = [
    { label: 'Monthly cash flow', value: $(i.cashflow), tone: i.cashflow >= 0 ? 'good' : 'bad' },
    { label: 'Emergency fund', value: `${i.emergencyMonths.toFixed(1)} mo`, tone: i.emergencyMonths >= 6 ? 'good' : i.emergencyMonths >= 3 ? 'warn' : 'bad' },
    { label: 'Debt-to-income', value: pct(i.dti), tone: i.dti <= 0.2 ? 'good' : i.dti <= 0.36 ? 'warn' : 'bad' },
    { label: 'Savings rate', value: pct(i.savingsRate), tone: i.savingsRate >= 0.1 ? 'good' : 'warn' }
  ];
  const series = useMemo(() => evaluate(profile, EMPTY_SCENARIO, 12), [profile]);
  return (
    <div className="space-y-4">
      <AISummaryCard key={profile.id || profile.name} profile={profile} months={months} />
      <Card>
        <H sub={`Benchmarks adjusted for ${profile.location.city} (cost index ${profile.location.colIndex}). Essentials target: ${pct(i.essentialTarget)} of take-home.`}>
          Financial health indicators
        </H>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-stone-200 bg-stone-50/60 p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-stone-500"><span className={`w-1.5 h-1.5 rounded-full ${DOT[s.tone]}`} />{s.label}</div>
              <div className={`text-lg font-bold font-mono ${STATUS[s.tone]}`}>{s.value}</div>
            </div>
          ))}
        </div>
      </Card>

      {metrics.effects.length > 0 && (
        <Card>
          <H sub="Where one weakness is spilling into other branches">Why the tree looks this way</H>
          <ul className="space-y-2">
            {metrics.effects.map((e, idx) => (
              <li key={idx} className="flex gap-2 text-xs text-stone-700">
                <button onClick={() => onSelect(e.from)} className="shrink-0 px-1.5 py-0.5 rounded bg-stone-100 hover:bg-stone-200 text-[10px] font-semibold uppercase tracking-wide text-stone-600">{e.from}</button>
                <ArrowRight className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-400" />
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <H sub="Dashed line is the 12-month path if nothing changes.">Liquid cash forecast</H>
        <Spark series={series.baseSeries} />
        <div className="flex justify-between text-[11px] text-stone-500 mt-1 font-mono">
          <span>Today {$(series.baseSeries[0])}</span><span>12 mo {$(series.baseSeries[12])}</span>
        </div>
        {risk && (
          <div className={`mt-3 flex gap-2 rounded-xl border p-3 text-xs ${risk.overdraft ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Upcoming bills leave checking at <b>{$(risk.balance)}</b> after <b>{risk.at.payee}</b> ({risk.at.due}). {risk.overdraft ? 'That would overdraw the account.' : 'That is below a $500 safety buffer.'}
            </span>
          </div>
        )}
      </Card>

      <CashCalendarCard profile={profile} />
    </div>
  );
}

// ---------------------------------------------------------------- Branch detail

const OFFER_FIELDS = [
  { key: 'refiApr', label: 'Refi APR %', step: 0.1, min: 0, max: 30, group: 'refi' },
  { key: 'refiTerm', label: 'Refi months', step: 6, min: 6, max: 96, group: 'refi' },
  { key: 'extraPay', label: 'Extra $/mo to loan', step: 25, min: 0, max: 1000, group: 'refi' },
  { key: 'newPrice', label: 'New car price $', step: 500, min: 5000, max: 120000, group: 'trade' },
  { key: 'newApr', label: 'New APR %', step: 0.1, min: 0, max: 30, group: 'trade' },
  { key: 'newTerm', label: 'New months', step: 6, min: 12, max: 96, group: 'trade' }
];

// The four numbers that matter, shown inside the Auto summary card.
function VehicleStats({ vehicle }) {
  const ls = loanSummary(vehicle);
  if (!ls) return null;
  const tiles = [
    ['Vehicle value', $(vehicle.value), 'text-stone-900'],
    ['Loan balance', $(vehicle.loanBalance), 'text-stone-900'],
    [ls.equity >= 0 ? 'Equity' : 'Negative equity', $(Math.abs(ls.equity)), ls.equity >= 0 ? 'text-emerald-700' : 'text-rose-700'],
    ['All-in monthly cost', $(ls.totalMonthly), 'text-stone-900']
  ];
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-[11px]" data-testid="vehicle-stats">
      {tiles.map(([label, value, cls]) => (
        <div key={label} className="rounded-lg bg-stone-50 border border-stone-200 p-2">
          <dt className="text-stone-500">{label}</dt>
          <dd className={`font-mono font-bold text-sm ${cls}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function VehiclePanel({ profile, months, onPreview, activeId, previewing, offers, onOffers, onOpenWhatIf }) {
  const [openId, setOpenId] = useState(null);
  const d = useMemo(() => vehicleDecision(profile, months), [profile, months]);
  const leaseOffer = useMemo(() => eligibleOffers(profile, d).find((x) => x.id === 'lease'), [profile, d]);
  if (!d.best) return <Card><H sub="Auto">No vehicle on this profile</H><p className="text-xs text-stone-500">Nothing to compare: no vehicle or loan was found.</p></Card>;
  const hasLoan = profile.vehicle.loanBalance > 0;
  const num = (f, raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onOffers({ [f.key]: Math.min(f.max, Math.max(f.min, n)) });
  };
  const COLS = 'grid grid-cols-[1.5fr_0.8fr_0.9fr_1.1fr] gap-2 items-center';
  return (
    <>
      <NextCarCard profile={profile} />
      <Card className="border-red-200/70">
        <H sub="Toyota Financial Services · The smartest next move">Vehicle decision</H>
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 mb-3 text-xs text-emerald-900 flex gap-2">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
          <span><b>Recommended: {d.best.label}.</b> {d.why}</span>
        </div>
        {d.flip && (
          <p className="text-[11px] text-stone-600 mb-3 -mt-1" data-testid="flip-insight"><b>What would change this:</b> {d.flip}</p>
        )}
        <VehicleExplainer profile={profile} months={months} />
        <div className="rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100" role="table" aria-label="Vehicle options">
          <div className={`${COLS} px-3 py-1.5 bg-stone-50 text-[10px] font-medium uppercase tracking-wide text-stone-500`} role="row">
            <span role="columnheader">Option</span>
            <span role="columnheader" className="text-right">Monthly</span>
            <span role="columnheader" className="text-right">5-yr cost</span>
            <span role="columnheader">Verdict</span>
          </div>
          {d.options.map((o) => {
            const isBest = o.id === d.best.id;
            const open = openId === o.id;
            const active = activeId === o.id;
            const showing = active && previewing;
            const previewLabel = showing ? 'Showing on tree' : active && o.id === 'keep' ? 'Current plan' : 'Preview on tree';
            return (
              <div key={o.id} data-testid={`option-${o.id}`} className={isBest ? 'bg-emerald-50/50' : ''} role="rowgroup">
                <button
                  type="button" onClick={() => setOpenId(open ? null : o.id)} aria-expanded={open}
                  className={`${COLS} w-full text-left px-3 py-2.5 hover:bg-stone-50/80 text-[11px]`} role="row"
                >
                  <span className="flex items-start gap-1.5 font-semibold text-stone-900 text-xs" role="cell">
                    <ChevronDown className={`w-3 h-3 mt-0.5 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    <span>{o.label}{showing && <span className="ml-1 text-[10px] font-medium text-emerald-700">· on tree</span>}</span>
                  </span>
                  <span className="text-right font-mono font-bold" role="cell">{$(o.monthly)}</span>
                  <span className="text-right font-mono font-bold" role="cell">{$(o.cost.netCost)}</span>
                  <span role="cell">
                    {isBest
                      ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Best</span>
                      : o.id === 'keep'
                        ? <span className="text-stone-400">Baseline</span>
                        : <span className={o.vsKeep >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{o.vsKeep >= 0 ? 'Saves' : 'Costs'} {$(Math.abs(o.vsKeep))}</span>}
                  </span>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1 bg-white text-[11px] space-y-2" data-testid={`option-${o.id}-details`}>
                    <div className="text-stone-500">{o.offer}</div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <div className="flex justify-between"><dt className="text-stone-500">Interest paid</dt><dd className="font-mono font-bold">{$(o.cost.interest)}</dd></div>
                      {o.payoffMonths != null && o.vehicle.loanBalance > 0 && <div className="flex justify-between"><dt className="text-stone-500">Debt-free in</dt><dd className="font-mono font-bold">{o.payoffMonths} mo</dd></div>}
                      {o.id !== 'keep' && <div className="flex justify-between"><dt className="text-stone-500">vs keeping (5 yrs)</dt><dd className={`font-mono font-bold ${o.vsKeep >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{o.vsKeep >= 0 ? '+' : '-'}{$(Math.abs(o.vsKeep))}</dd></div>}
                      <div className="flex justify-between"><dt className="text-stone-500">Auto branch</dt><dd className={`font-mono font-bold ${o.autoDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{o.autoDelta >= 0 ? '+' : ''}{Math.round(o.autoDelta * 100)} pts</dd></div>
                      <div className="flex justify-between"><dt className="text-stone-500">Overall tree</dt><dd className={`font-mono font-bold ${o.trunkDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{o.trunkDelta >= 0 ? '+' : ''}{Math.round(o.trunkDelta * 100)} pts</dd></div>
                    </dl>
                    <button
                      onClick={() => onPreview(o.id)} aria-pressed={active}
                      className={`text-[11px] px-2 py-1 rounded-lg border whitespace-nowrap ${active ? 'bg-stone-900 text-white border-stone-900' : 'bg-white border-stone-300 hover:bg-stone-50'}`}
                    >
                      {previewLabel}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={onOpenWhatIf} className="mt-3 w-full text-[11px] px-2 py-1.5 rounded-lg border border-stone-300 hover:bg-stone-50 flex items-center justify-center gap-1.5">
          <Wand2 className="w-3 h-3" /> Combine with other changes in What-if
        </button>
        <p className="text-[10px] text-stone-400 mt-3">Tap an option for details. Net cost = payments + insurance, fuel and maintenance − resale value, 5-year horizon. Offers are simulated.</p>
      </Card>
      <LeaseVsBuyCard profile={profile} leaseOffer={leaseOffer} />
      <ToyotaOffersCard profile={profile} decision={d} />
      <Drawer title="Adjust Offer Assumptions (Advanced)">
        <p className="text-[11px] text-stone-500 mb-2">Edit the simulated offers; every number above updates.</p>
        <div className="grid grid-cols-2 gap-2">
          {OFFER_FIELDS.filter((f) => hasLoan || f.group !== 'refi').map((f) => (
            <label key={f.key} className="block text-[11px] text-stone-500">
              {f.label}
              <input
                type="number" min={f.min} max={f.max} step={f.step} value={offers[f.key]} aria-label={f.label}
                onChange={(e) => num(f, e.target.value)}
                className="mt-0.5 w-full text-xs rounded-lg border border-stone-300 p-1.5 font-mono text-stone-800"
              />
            </label>
          ))}
        </div>
        <button onClick={() => onOffers(DEFAULT_OFFERS)} className="mt-3 text-[11px] px-2 py-1 rounded-lg border border-stone-300 hover:bg-stone-50">Reset offers</button>
      </Drawer>
    </>
  );
}

export function BranchPanel({ selected, profile, metrics, months, onPreviewVehicle, activeVehicleId, previewing, offers, onOffers, onOpenWhatIf }) {
  const meta = BRANCHES.find((b) => b.key === selected) || { key: selected, label: selected === 'roots' ? 'Roots' : 'Trunk', blurb: selected === 'roots' ? 'Financial resilience' : 'Overall sustainability' };
  const score = metrics.scores[selected] ?? 0;
  const badge = badgeFor(score);
  const rows = explainBranch(selected, profile, metrics);
  const related = metrics.effects.filter((e) => e.from === selected || e.to === selected);
  const isAuto = selected === 'auto' && Boolean(profile.vehicle);
  const rowsList = (
    <ul className={`${isAuto ? '' : 'mt-4 '}divide-y divide-stone-100`}>
      {rows.map((r) => (
        <li key={r.label} className="py-2.5 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-stone-800 flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${DOT[r.status]}`} />{r.label}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">{r.note}</div>
          </div>
          <div className={`text-sm font-mono font-bold whitespace-nowrap ${STATUS[r.status]}`}>{r.value}</div>
        </li>
      ))}
    </ul>
  );
  const relatedList = related.length > 0 && (
    <ul className="space-y-2 text-xs text-stone-700">{related.map((e, i) => <li key={i}>• {e.text}</li>)}</ul>
  );
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900">{meta.label}</h3>
            <p className="text-xs text-stone-500">{meta.blurb}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold font-mono">{Math.round(score * 100)}</div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
          </div>
        </div>
        {isAuto ? <VehicleStats vehicle={profile.vehicle} /> : rowsList}
      </Card>
      {isAuto ? (
        <Drawer title="Why the Auto score looks like this">
          {rowsList}
          {relatedList && <div className="mt-3 pt-3 border-t border-stone-100"><div className="text-xs font-bold text-stone-900 mb-2">Connected to other branches</div>{relatedList}</div>}
        </Drawer>
      ) : (
        related.length > 0 && (
          <Card>
            <H>Connected to other branches</H>
            {relatedList}
          </Card>
        )
      )}
      {selected === 'auto' && <VehiclePanel profile={profile} months={months} onPreview={onPreviewVehicle} activeId={activeVehicleId} previewing={previewing} offers={offers} onOffers={onOffers} onOpenWhatIf={onOpenWhatIf} />}
    </div>
  );
}

// ---------------------------------------------------------------- What-if

const SLIDERS = [
  { key: 'extraSavings', label: 'Extra monthly savings', min: 0, max: 500, step: 25 },
  { key: 'extraInvest', label: 'Extra monthly investing', min: 0, max: 500, step: 25 },
  { key: 'extraDebt', label: 'Extra payment to highest-APR debt', min: 0, max: 500, step: 25 },
  { key: 'cutDiscretionary', label: 'Cut discretionary spending', min: 0, max: 600, step: 25 },
  { key: 'housingDelta', label: 'Change in housing cost', min: -500, max: 800, step: 50 }
];

export function SimulatorPanel({ profile, scenario, setScenario, months, setMonths, preview, setPreview }) {
  const r = useMemo(() => evaluate(profile, scenario, months), [profile, scenario, months]);
  const opts = vehicleOptions(profile);
  const changed = JSON.stringify(scenario) !== JSON.stringify(EMPTY_SCENARIO);
  const set = (k, v) => setScenario({ ...scenario, [k]: v });
  const cashBefore = r.flowsBase.leftover, cashAfter = r.flowsAfter.leftover;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <H sub="Move the sliders to see how the tree responds">What-if simulator</H>
          <div className="flex rounded-lg border border-stone-200 overflow-hidden text-[11px]">
            {[12, 24, 36].map((m) => (
              <button key={m} onClick={() => setMonths(m)} className={`px-2.5 py-1 ${months === m ? 'bg-stone-900 text-white' : 'bg-white hover:bg-stone-50'}`}>{m} mo</button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {SLIDERS.map((s) => (
            <label key={s.key} className="block">
              <div className="flex justify-between text-xs"><span className="text-stone-700">{s.label}</span><span className="font-mono font-bold">{scenario[s.key] > 0 && s.key !== 'housingDelta' ? '+' : ''}{$(scenario[s.key])}/mo</span></div>
              <input type="range" min={s.min} max={s.key === 'cutDiscretionary' ? Math.max(s.step, Math.min(s.max, Math.floor((profile.discretionary || 0) / s.step) * s.step)) : s.max} step={s.step} value={scenario[s.key]} onChange={(e) => set(s.key, Number(e.target.value))} className="w-full accent-emerald-700" />
            </label>
          ))}
          {opts.length > 0 && (
            <label className="block">
              <span className="text-xs text-stone-700">Vehicle decision</span>
              <select value={scenario.vehicleId} onChange={(e) => set('vehicleId', e.target.value)} className="mt-1 w-full text-xs rounded-lg border border-stone-300 bg-white p-2">
                {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="flex items-center justify-between mt-4">
          <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-emerald-700" />
            Show result on the tree
          </label>
          <button disabled={!changed} onClick={() => setScenario(EMPTY_SCENARIO)} className="text-xs px-2.5 py-1 rounded-lg border border-stone-300 disabled:opacity-40 hover:bg-stone-50">Reset</button>
        </div>
      </Card>

      <Card>
        <H sub={`Grey = if nothing changes · colored = with your changes, ${months} months out`}>Branch impact</H>
        <ul className="space-y-3">
          {[...BRANCHES.map((b) => ({ key: b.key, label: b.label })), { key: 'roots', label: 'Roots' }, { key: 'trunk', label: 'Overall (trunk)' }].map((b) => {
            const before = r.base.scores[b.key], after = r.after.scores[b.key], d = Math.round((after - before) * 100);
            return (
              <li key={b.key}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-stone-700">{b.label}</span>
                  <span className={`font-mono ${d > 0 ? 'text-emerald-700' : d < 0 ? 'text-rose-700' : 'text-stone-400'}`}>{Math.round(before * 100)} → {Math.round(after * 100)} {d !== 0 && `(${d > 0 ? '+' : ''}${d})`}</span>
                </div>
                <ScoreBar before={before} after={after} />
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
            <div className="text-stone-500">Monthly cash flow</div>
            <div className="font-mono font-bold">{$(cashBefore)} → <span className={cashAfter >= cashBefore ? 'text-emerald-700' : 'text-rose-700'}>{$(cashAfter)}</span></div>
          </div>
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-3">
            <div className="text-stone-500">Liquid cash in {months} mo</div>
            <div className="font-mono font-bold">{$(r.baseSeries[months])} → <span className={r.afterSeries[months] >= r.baseSeries[months] ? 'text-emerald-700' : 'text-rose-700'}>{$(r.afterSeries[months])}</span></div>
          </div>
        </div>
        <div className="mt-3"><Spark series={r.afterSeries} other={r.baseSeries} /></div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Coach

export function CoachPanel({ profile, subscriptionTotal, months, onTry, onPreview }) {
  const actions = useMemo(() => rankActions(profile, subscriptionTotal, months), [profile, subscriptionTotal, months]);
  return (
    <div className="space-y-4">
      <AskPanel profile={profile} months={months} onPreview={onPreview} onOpenWhatIf={() => onTry(null)} />
      <Card>
        <H sub={`Every action is simulated ${months} months ahead on your profile and ranked by how much it strengthens the whole tree.`}>Financial coach</H>
        <ol className="space-y-3">
          {actions.map((a, idx) => (
            <li key={a.id} className="rounded-xl border border-stone-200 p-3">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 shrink-0 rounded-full bg-emerald-700 text-white text-xs font-bold flex items-center justify-center">{idx + 1}</div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-stone-900">{a.title}</div>
                  <div className="text-[11px] text-stone-500">{a.detail}</div>
                  <div className="flex gap-3 mt-1.5 text-[11px]">
                    <span className={a.deltaTrunk >= 0 ? 'text-emerald-700' : 'text-rose-700'}>Tree health {a.deltaTrunk >= 0 ? '+' : ''}{(a.deltaTrunk * 100).toFixed(1)} pts</span>
                    <span className={a.deltaCash >= 0 ? 'text-emerald-700' : 'text-rose-700'}>Cash flow {a.deltaCash >= 0 ? '+' : ''}{$(a.deltaCash)}/mo</span>
                  </div>
                </div>
                <button onClick={() => onTry(a.scenario)} className="text-[11px] px-2 py-1 rounded-lg border border-stone-300 hover:bg-stone-50 flex items-center gap-1"><Wand2 className="w-3 h-3" />Try it</button>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Data / Nessie

// The Nessie key is remembered in this browser (localStorage) so it survives tab switches and reloads.
// Falls back to an in-memory value if storage is unavailable (e.g. private mode).
const KEY_STORAGE = 'moneytree.nessieKey';
const ENV_KEY = process.env.NEXT_PUBLIC_NESSIE_KEY || '';
let memKey = ENV_KEY;
const keyListeners = new Set();
const subscribeKey = (cb) => {
  keyListeners.add(cb);
  window.addEventListener('storage', cb);
  return () => { keyListeners.delete(cb); window.removeEventListener('storage', cb); };
};
const readKey = () => {
  try { return localStorage.getItem(KEY_STORAGE) ?? memKey; } catch { return memKey; }
};
const writeKey = (value) => {
  memKey = value;
  try {
    if (value) localStorage.setItem(KEY_STORAGE, value);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* ignore */ }
  keyListeners.forEach((cb) => cb());
};

export function DataPanel({ source, base = demoProfile, current, onProfile, onSource, onReset }) {
  // Optional; blank falls back to the server's NESSIE_API_KEY.
  const key = useSyncExternalStore(subscribeKey, readKey, () => ENV_KEY);
  const [customers, setCustomers] = useState([]);
  const [selectedCustId, setSelectedCustId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(false);
  const connectRef = useRef(null);

  const handleFetchCustomers = async () => {
    setBusy(true);
    setErr('');
    try {
      const list = await getNessieCustomers(key);
      setCustomers(list);
      if (list.length > 0) {
        setSelectedCustId(list[0]._id);
      } else {
        setErr('Connected, but this key has no customers. Did you run your seeding script?');
      }
    } catch (e) {
      setErr(`Failed to fetch customers: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  // silent = background refresh: keep the current profile on screen and never flash the busy state.
  const connectCustomer = async (silent = false) => {
    if (!selectedCustId) return;
    if (!silent) { setBusy(true); setErr(''); }
    try {
      const loaded = await loadNessieProfile(key, base, selectedCustId);
      onProfile(loaded, { keepScenario: silent });
      onSource('nessie');
    } catch (e) {
      setErr(silent ? `Auto-refresh failed: ${e.message}` : `${e.message}. Staying on demo profile.`);
    } finally {
      if (!silent) setBusy(false);
    }
  };
  connectRef.current = connectCustomer;

  // Optional live mode: re-pull Nessie every 30 seconds so the tree visibly evolves as transactions arrive.
  useEffect(() => {
    if (!auto || source !== 'nessie' || !selectedCustId) return undefined;
    const id = setInterval(() => connectRef.current(true), 30000);
    return () => clearInterval(id);
  }, [auto, source, selectedCustId]);

  useEffect(() => { if (source !== 'nessie') setAuto(false); }, [source]);

  return (
    <div className="space-y-4">
      <Card>
        <H sub="Capital One Nessie Sandbox API">Judge Testing Panel</H>
        <div className="flex items-center gap-2 text-xs mb-3">
          <span className={`w-2 h-2 rounded-full ${source === 'nessie' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {source === 'nessie' ? 'Connected · live Nessie profile' : 'Demo profile (Not connected)'}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-stone-500 block mb-1">1. Enter Nessie API Key</label>
            <div className="flex gap-2">
              <input
                value={key}
                onChange={(e) => writeKey(e.target.value)}
                placeholder="Nessie API key (blank = server key)"
                className="flex-1 text-xs rounded-lg border border-stone-300 p-2 font-mono"
              />
              <button
                onClick={handleFetchCustomers}
                disabled={busy}
                className="text-xs px-3 py-2 rounded-lg bg-emerald-700 text-white disabled:opacity-40"
              >
                Load List
              </button>
            </div>
          </div>

          {customers.length > 0 && (
            <div>
              <label className="text-[11px] text-stone-500 block mb-1">2. Select Judge Test Profile</label>
              <select
                value={selectedCustId}
                onChange={(e) => setSelectedCustId(e.target.value)}
                className="w-full text-xs rounded-lg border border-stone-300 bg-white p-2 mb-2"
              >
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.first_name} {c.last_name} (ID: {c._id})
                  </option>
                ))}
              </select>
              <button
                onClick={() => connectCustomer(false)}
                disabled={busy}
                className="w-full text-xs px-3 py-2 rounded-lg bg-emerald-700 text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                <Plug className="w-3.5 h-3.5" /> {busy ? 'Loading Portfolio…' : source === 'nessie' ? 'Refresh data now' : 'Load Selected Portfolio'}
              </button>
              {source === 'nessie' && (
                <label className="mt-2 flex items-center gap-2 text-[11px] text-stone-600 cursor-pointer">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-emerald-700" />
                  <RefreshCw className="w-3 h-3" /> Auto-refresh every 30 seconds
                </label>
              )}
            </div>
          )}

          {source === 'nessie' && current?.liveFields && (
            <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-3 text-[11px] space-y-2" data-testid="data-provenance">
              <div>
                <div className="font-semibold text-emerald-800 mb-1">Live from Nessie</div>
                <div className="flex flex-wrap gap-1">{current.liveFields.map((f) => <span key={f} className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">{f}</span>)}</div>
              </div>
              <div>
                <div className="font-semibold text-amber-800 mb-1">Still demo assumptions (Nessie has no data for these)</div>
                <div className="flex flex-wrap gap-1">{current.demoFields.map((f) => <span key={f} className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">{f}</span>)}</div>
              </div>
              {current.loadedAt && <div className="text-stone-400">Last synced {new Date(current.loadedAt).toLocaleTimeString()}</div>}
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-stone-100">
            <button onClick={() => { setCustomers([]); setSelectedCustId(''); setErr(''); onReset(); }} className="w-full text-xs px-3 py-1.5 rounded-lg border border-stone-300 hover:bg-stone-50 flex items-center justify-center gap-1.5">
              <Repeat className="w-3.5 h-3.5" /> Revert to Demo Mode
            </button>
          </div>

          {err && <p className="text-[11px] text-rose-700">{err}</p>}
        </div>
      </Card>
    </div>
  );
}