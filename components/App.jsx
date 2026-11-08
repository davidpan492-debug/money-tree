"use client";

import React, { useMemo, useState } from 'react';
import { Briefcase, Car, CreditCard, Database, Leaf, LineChart, Lightbulb, PiggyBank, Sprout, TrendingUp, Wand2, AlertTriangle, Eye } from 'lucide-react';
import TreeCanvas from './TreeCanvas';
import { BranchPanel, CoachPanel, DataPanel, OverviewPanel, SimulatorPanel, badgeFor } from './Panels';
import { InsightsPanel } from './InsightPanels';
import { BRANCHES, DEFAULT_OFFERS, EMPTY_SCENARIO, computeMetrics, describeScenario, evaluate } from '@/lib/finance';
import { demoProfile, personas } from '@/lib/demoProfile';
import { detectSubscriptions } from '@/lib/nessie';

const ICONS = { income: Briefcase, savings: PiggyBank, investments: TrendingUp, spending: CreditCard, auto: Car, debt: AlertTriangle };
const TABS = [
  { id: 'overview', label: 'Overview', icon: LineChart },
  { id: 'branch', label: 'Branch', icon: Leaf },
  { id: 'whatif', label: 'What-if', icon: Wand2 },
  { id: 'coach', label: 'Coach', icon: Sprout },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  { id: 'data', label: 'Data', icon: Database }
];

export default function App() {
  const [personaId, setPersonaId] = useState('alex');
  const [baseProfile, setProfile] = useState(demoProfile);
  const [offers, setOffers] = useState(DEFAULT_OFFERS);
  const [source, setSource] = useState('demo');
  const [tab, setTab] = useState('overview');
  const [selected, setSelected] = useState(null);
  const [scenario, setScenario] = useState(EMPTY_SCENARIO);
  const [preview, setPreview] = useState(false);
  const [months, setMonths] = useState(12);

  // The profile plus the editable vehicle-offer assumptions; everything downstream uses this.
  const profile = useMemo(() => ({ ...baseProfile, offers }), [baseProfile, offers]);
  const metrics = useMemo(() => computeMetrics(profile), [profile]);
  const subTotal = useMemo(() => detectSubscriptions(profile.purchases).reduce((s, x) => s + x.monthly, 0), [profile.purchases]);
  const scenarioActive = JSON.stringify(scenario) !== JSON.stringify(EMPTY_SCENARIO);
  const result = useMemo(() => (preview && scenarioActive ? evaluate(profile, scenario, months) : null), [preview, scenarioActive, profile, scenario, months]);
  const projected = result ? result.after : null;
  const shown = projected ? projected.scores : metrics.scores;
  // Change per part vs doing nothing over the same period (what the chips on the tree show).
  const deltas = useMemo(() => {
    if (!result) return null;
    const out = {};
    Object.keys(result.after.scores).forEach((k) => { out[k] = result.after.scores[k] - result.base.scores[k]; });
    return out;
  }, [result]);
  const changes = describeScenario(profile, scenario);
  // Only focus (and dim everything else) while the Branch tab is open.
  const focus = tab === 'branch' ? selected : null;
  const pulse = preview && scenario.vehicleId !== 'keep' ? 'auto' : null;

  const pick = (key) => { setSelected(key); setTab('branch'); };
  // Any what-if change shows on the tree straight away; resetting everything turns the preview off.
  const changeScenario = (sc) => { setScenario(sc); setPreview(JSON.stringify(sc) !== JSON.stringify(EMPTY_SCENARIO)); };
  // sc = null just opens the What-if tab with whatever is already set.
  const tryScenario = (sc) => { if (sc) { setScenario(sc); setPreview(true); } setTab('whatif'); };
  // Show a scenario on the tree without leaving the current tab (used by "Ask your tree").
  const previewScenario = (sc) => { setScenario(sc); setPreview(true); };
  const previewVehicle = (id) => {
    const sc = { ...scenario, vehicleId: id };
    setScenario(sc);
    setPreview(JSON.stringify(sc) !== JSON.stringify(EMPTY_SCENARIO));
  };
  const clearScenario = () => { setScenario(EMPTY_SCENARIO); setPreview(false); };
  // Background refreshes keep the person's current what-if scenario.
  const loadProfile = (p, opts = {}) => { setProfile(p); if (!opts.keepScenario) clearScenario(); };
  const revertToDemo = () => { setProfile(personas[personaId]); setSource('demo'); setOffers(DEFAULT_OFFERS); clearScenario(); };
  // Switch between demo customers so the Toyota recommendation visibly changes.
  const switchPersona = (id) => { setPersonaId(id); setProfile(personas[id]); setOffers(DEFAULT_OFFERS); clearScenario(); };
  const cashDelta = result ? result.flowsAfter.leftover - result.flowsBase.leftover : 0;

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-stone-800 flex flex-col">
      <header className="border-b border-stone-200/80 bg-white/80 backdrop-blur-md sticky top-0 z-20 px-4 sm:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-700 text-white flex items-center justify-center shadow-sm"><Leaf className="w-5 h-5" /></div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-stone-900">MoneyTree</h1>
              <p className="text-xs text-stone-500">{profile.name} · {profile.location.city}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {source === 'demo' && (
              <label className="flex items-center gap-1.5">
                <span className="text-stone-500 hidden sm:inline">Customer</span>
                <select
                  value={personaId}
                  onChange={(e) => switchPersona(e.target.value)}
                  aria-label="Demo customer"
                  className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs"
                >
                  {Object.entries(personas).map(([id, p]) => <option key={id} value={id}>{p.persona}</option>)}
                </select>
              </label>
            )}
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-stone-100 border border-stone-200">
              <span className={`w-2 h-2 rounded-full ${source === 'nessie' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {source === 'nessie' ? 'Capital One Nessie · live' : 'Demo data'}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white border border-stone-200 font-semibold">
              Tree health <span className="font-mono">{Math.round(shown.trunk * 100)}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sticky on desktop so the tree stays in view while the right-hand panels scroll. */}
        <section className="lg:col-span-7 xl:col-span-7 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto bg-[#F3EFE6] rounded-2xl border border-stone-200/90 shadow-sm overflow-hidden">
          {projected && (
            <div className="px-5 py-2 bg-emerald-700 text-white text-xs flex items-center gap-2">
              <Eye className="w-4 h-4 shrink-0" />
              <span data-testid="preview-banner">
                Previewing {months} months out: {changes.join(' · ')}
                {cashDelta !== 0 && <> · cash flow {cashDelta > 0 ? '+' : '-'}${Math.abs(Math.round(cashDelta)).toLocaleString()}/mo</>}
              </span>
              <button onClick={() => setPreview(false)} className="ml-auto underline whitespace-nowrap">Back to today</button>
              <button onClick={clearScenario} className="underline whitespace-nowrap">Clear</button>
            </div>
          )}
          <div className="px-5 py-3 bg-white/60 border-b border-stone-200/60 flex flex-wrap gap-2">
            {[...BRANCHES, { key: 'roots', label: 'Roots' }, { key: 'trunk', label: 'Trunk' }].map((b) => {
              const Icon = ICONS[b.key];
              const badge = badgeFor(shown[b.key]);
              const active = focus === b.key;
              return (
                <button
                  key={b.key}
                  onClick={() => pick(b.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition ${active ? 'bg-stone-900 text-white border-stone-900' : 'bg-white hover:bg-stone-50 border-stone-200 text-stone-700'}`}
                >
                  {Icon && <Icon className="w-3 h-3" />}
                  {b.label}
                  <span className={`font-mono ${active ? 'text-stone-200' : 'text-stone-500'}`}>{Math.round(shown[b.key] * 100)}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${badge.cls.includes('emerald') || badge.cls.includes('teal') ? 'bg-emerald-500' : badge.cls.includes('amber') ? 'bg-amber-500' : 'bg-rose-500'}`} />
                </button>
              );
            })}
          </div>
          <div className="relative w-full aspect-[16/14] flex items-center justify-center p-2 sm:p-4">
            <TreeCanvas scores={shown} selected={focus} onSelect={pick} deltas={deltas} pulse={pulse} />
          </div>
          <p className="px-5 pb-3 text-[11px] text-stone-500">Click a branch, the trunk or the roots to see exactly why it looks the way it does.</p>
        </section>

        <aside className="lg:col-span-5 xl:col-span-5 flex flex-col gap-4">
          <nav className="flex rounded-xl bg-white border border-stone-200 p-1 shadow-sm">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => { if (t.id === 'branch' && !selected) setSelected('trunk'); setTab(t.id); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition ${tab === t.id ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
                >
                  <Icon className="w-3.5 h-3.5" /><span className="hidden sm:inline">{t.label}</span>
                </button>
              );
            })}
          </nav>

          {tab === 'overview' && <OverviewPanel profile={profile} metrics={metrics} onSelect={pick} months={months} />}
          {tab === 'branch' && (
            <BranchPanel
              selected={selected || 'trunk'} profile={profile} metrics={metrics} months={months}
              onPreviewVehicle={previewVehicle} activeVehicleId={scenario.vehicleId} previewing={Boolean(projected)}
              offers={offers} onOffers={(o) => setOffers({ ...offers, ...o })} onOpenWhatIf={() => setTab('whatif')}
            />
          )}
          {tab === 'whatif' && (
            <SimulatorPanel profile={profile} scenario={scenario} setScenario={changeScenario} months={months} setMonths={setMonths} preview={preview} setPreview={setPreview} />
          )}
          {tab === 'coach' && <CoachPanel profile={profile} subscriptionTotal={subTotal} months={months} onTry={tryScenario} onPreview={previewScenario} />}
          {tab === 'insights' && <InsightsPanel profile={profile} onTry={tryScenario} />}
          {/* Always mounted (just hidden) so the key, customer list and selection survive tab switches. */}
          <div hidden={tab !== 'data'}>
            <DataPanel
              source={source} base={personas[personaId]} current={profile}
              onProfile={loadProfile} onSource={setSource} onReset={revertToDemo}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
