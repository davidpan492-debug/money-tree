// MoneyTree financial engine: metrics -> branch health, cross-branch contagion,
// projections, what-if scenarios, Toyota vehicle decisions and coach ranking.

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const round = (n) => Math.round(n);

export const pmt = (principal, apr, n) => {
  const r = apr / 1200;
  return r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
};

export const BRANCHES = [
  { key: 'income', label: 'Income', blurb: 'Cash-flow stability & earnings' },
  { key: 'savings', label: 'Savings', blurb: 'Emergency reserves & liquidity' },
  { key: 'investments', label: 'Investments', blurb: 'Long-term compounding' },
  { key: 'spending', label: 'Spending', blurb: 'Budget, essentials & monthly cash flow' },
  { key: 'auto', label: 'Auto & Transport', blurb: 'Vehicle loan, running costs & equity' },
  { key: 'debt', label: 'Debt', blurb: 'Utilization, interest & payments' }
];

export function monthlyFlows(p) {
  const e = p.essentials;
  const v = p.vehicle;
  const essentials = e.housing + e.utilities + e.groceries + e.phone;
  const vehicle = v ? v.payment + v.insurance + v.fuel + v.maintenance : 0;
  const debtMins = p.debts.reduce((s, d) => s + d.minPayment, 0);
  const extraDebt = p.extraDebtPayment || 0;
  const allocated = p.savingsContribution + p.investments.monthlyContribution;
  const outflow = essentials + vehicle + debtMins + extraDebt + p.discretionary + allocated;
  return { essentials, vehicle, debtMins, extraDebt, allocated, outflow, leftover: p.netIncome - outflow };
}

export function computeMetrics(p) {
  const f = monthlyFlows(p);
  // Guards: a live profile with no deposits (net 0) or no vehicle value must not produce NaN scores.
  const net = Math.max(1, Number(p.netIncome) || 0);
  const v = p.vehicle;

  const essentialCost = Math.max(1, f.essentials + f.vehicle + f.debtMins);
  const essentialShare = essentialCost / net;
  // Cost-of-living adjustment: pricier cities tolerate a higher essentials share.
  const essentialTarget = clamp(0.6 * (1 + ((p.location.colIndex - 100) / 100) * 0.35), 0.4, 0.75);
  const emergencyMonths = (p.savings + 0.5 * p.checking) / essentialCost;
  const savingsRate = p.savingsContribution / net;
  const investRate = p.investments.monthlyContribution / net;
  const cashflowRate = f.leftover / net;

  const cards = p.debts.filter((d) => d.limit);
  const util = cards.length ? cards.reduce((s, d) => s + d.balance, 0) / cards.reduce((s, d) => s + d.limit, 0) : 0;
  const debtBal = p.debts.reduce((s, d) => s + d.balance, 0) + (v ? v.loanBalance : 0);
  const wApr = debtBal
    ? (p.debts.reduce((s, d) => s + d.balance * d.apr, 0) + (v ? v.loanBalance * v.apr : 0)) / debtBal / 100
    : 0;
  const dti = (f.debtMins + (v ? v.payment : 0)) / net;
  const transportShare = v ? f.vehicle / net : 0;
  const equityRatio = v ? (v.value > 0 ? (v.value - v.loanBalance) / v.value : v.loanBalance > 0 ? -1 : 1) : 1;

  let income = clamp(0.6 * p.incomeStability + 0.4 * clamp((net / essentialCost - 1) / 0.8));
  let savings = clamp(0.7 * clamp(emergencyMonths / 6) + 0.3 * clamp(savingsRate / 0.1));
  let investments = clamp(0.5 * clamp(investRate / 0.1) + 0.5 * clamp(p.investments.balance / (net * 12 * 1.5)));
  const cashflowSustain = clamp(0.5 + cashflowRate * 5);
  // Discretionary spending is scored directly: full marks at 10% of take-home or less, zero at 30% or more.
  // Without this term the Spending branch maxes out for anyone with healthy cash flow and a lean essentials
  // share, so cutting discretionary spending (or the slider for it) would show no change.
  const discretionaryShare = (Number(p.discretionary) || 0) / net;
  const discretionaryScore = 1 - clamp((discretionaryShare - 0.1) / 0.2);
  let spending = clamp(
    0.35 * (1 - clamp((essentialShare - essentialTarget) / 0.25)) + 0.35 * cashflowSustain + 0.3 * discretionaryScore
  );
  const auto = clamp(0.6 * (1 - clamp((transportShare - 0.1) / 0.2)) + 0.4 * clamp(equityRatio / 0.3));
  const debt = clamp(0.5 * (1 - clamp(dti / 0.36)) + 0.3 * (1 - clamp(util / 0.5)) + 0.2 * (1 - clamp(wApr / 0.25)));

  // Contagion: problems in one branch spread only where there is a real financial link.
  const effects = [];
  const drain = clamp(-cashflowRate * 3, 0, 0.25);
  if (drain > 0.02) {
    savings *= 1 - drain;
    investments *= 1 - drain * 0.8;
    effects.push({
      from: 'spending',
      to: 'savings',
      text: `You are $${Math.abs(round(f.leftover)).toLocaleString()}/mo over budget. That deficit is draining savings and investing capacity (-${round(drain * 100)}%).`
    });
  }
  if (debt < 0.45) {
    const hit = 0.1 * (1 - debt);
    spending *= 1 - hit;
    effects.push({
      from: 'debt',
      to: 'spending',
      text: `Debt payments and interest are squeezing the budget (-${round(hit * 100)}% on Spending).`
    });
  }
  if (transportShare > 0.15) {
    effects.push({
      from: 'auto',
      to: 'spending',
      text: `Vehicle costs take ${round(transportShare * 100)}% of take-home pay (15% is the healthy ceiling).`
    });
  }

  const roots = clamp(0.65 * clamp(emergencyMonths / 6) + 0.35 * p.incomeStability);
  let trunk =
    0.22 * cashflowSustain + 0.18 * debt + 0.18 * savings + 0.14 * income + 0.1 * spending + 0.08 * investments + 0.05 * auto + 0.05 * roots;
  if (Math.min(cashflowSustain, debt, income) < 0.25) trunk *= 0.9;

  return {
    scores: { income, savings, investments, spending, auto, debt, roots, trunk: clamp(trunk) },
    indicators: {
      essentialCost, essentialShare, essentialTarget, emergencyMonths, savingsRate, investRate,
      cashflow: f.leftover, cashflowRate, discretionaryShare, util, dti, transportShare, equityRatio, weightedApr: wApr, debtBal
    },
    effects,
    flows: f
  };
}

export function explainBranch(key, p, m) {
  const i = m.indicators;
  const $ = (n) => `${n < 0 ? '-' : ''}$${Math.abs(round(n)).toLocaleString()}`;
  const pct = (n) => `${round(n * 100)}%`;
  const lvl = (v, good, warn, higher = true) =>
    higher ? (v >= good ? 'good' : v >= warn ? 'warn' : 'bad') : v <= good ? 'good' : v <= warn ? 'warn' : 'bad';
  const row = (label, value, status, note) => ({ label, value, status, note });
  const v = p.vehicle;
  switch (key) {
    case 'income':
      return [
        row('Net monthly income', $(p.netIncome), 'good', 'After tax'),
        row('Income stability', pct(p.incomeStability), lvl(p.incomeStability, 0.85, 0.65), 'Consistency of deposits over 6 months'),
        row('Income ÷ must-pay costs', `${(p.netIncome / i.essentialCost).toFixed(2)}×`, lvl(p.netIncome / i.essentialCost, 1.5, 1.2), 'How comfortably income covers essentials, vehicle and minimum debt payments')
      ];
    case 'savings':
      return [
        row('Emergency fund', `${i.emergencyMonths.toFixed(1)} mo`, lvl(i.emergencyMonths, 6, 3), 'Months of must-pay costs covered (goal: 6)'),
        row('Savings balance', $(p.savings), 'good', `Checking: ${$(p.checking)}`),
        row('Monthly savings rate', pct(i.savingsRate), lvl(i.savingsRate, 0.1, 0.05), 'Share of take-home pay moved to savings (goal: 10%)')
      ];
    case 'investments':
      return [
        row('Portfolio balance', $(p.investments.balance), 'good', 'Retirement + brokerage'),
        row('Monthly contribution', $(p.investments.monthlyContribution), lvl(i.investRate, 0.1, 0.05), `${pct(i.investRate)} of take-home pay (goal: 10%)`)
      ];
    case 'spending':
      return [
        row('Monthly cash flow', $(i.cashflow), lvl(i.cashflow, 100, -1), 'Take-home minus everything allocated'),
        row('Essentials share', pct(i.essentialShare), lvl(i.essentialShare, i.essentialTarget, i.essentialTarget + 0.1, false), `Cost-of-living adjusted target for ${p.location.city}: ${pct(i.essentialTarget)}`),
        row('Discretionary', `${$(p.discretionary)} (${pct(i.discretionaryShare)})`, lvl(i.discretionaryShare, 0.15, 0.25, false), 'Dining, shopping, subscriptions, entertainment as a share of take-home (goal: under 15%; full score at 10%)')
      ];
    case 'auto': {
      if (!v) return [row('Vehicle', 'None', 'good', 'No vehicle costs tracked')];
      const ls = loanSummary(v);
      const payoff = v.loanBalance <= 0 ? 'Loan paid off'
        : ls.neverPaid ? 'Payment does not cover the interest'
        : `Paid off in ${ls.monthsToPayoff} mo (${ls.payoffDate}), ${$(ls.interestRemaining)} interest left`;
      return [
        row('Vehicle', v.name, 'good', `Worth ${$(v.value)}`),
        row('Loan balance', $(v.loanBalance), lvl(i.equityRatio, 0.2, 0, true), `${v.apr}% APR`),
        row('Monthly payment', $(v.payment), ls.neverPaid ? 'bad' : 'good', payoff),
        row('Loan-to-value', pct(ls.ltv), lvl(ls.ltv, 0.8, 1, false), 'Loan ÷ vehicle value. Above 100% means you owe more than it is worth'),
        row('Equity', pct(i.equityRatio), lvl(i.equityRatio, 0.25, 0.05), 'Value minus loan, as share of value'),
        row('Running costs', `${$(ls.runningCosts)}/mo`, 'good', `Insurance ${$(v.insurance)} · fuel ${$(v.fuel)} · maintenance ${$(v.maintenance)}`),
        row('Transport cost share', pct(i.transportShare), lvl(i.transportShare, 0.15, 0.2, false), 'Payment + insurance + fuel + maintenance vs take-home (ceiling: 15%)')
      ];
    }
    case 'debt':
      return [
        row('Debt-to-income', pct(i.dti), lvl(i.dti, 0.2, 0.36, false), 'Monthly debt payments incl. vehicle ÷ take-home (ceiling: 36%)'),
        row('Card utilization', pct(i.util), lvl(i.util, 0.3, 0.5, false), 'Balances ÷ limits (goal: under 30%)'),
        row('Weighted APR', `${(i.weightedApr * 100).toFixed(1)}%`, lvl(i.weightedApr, 0.08, 0.15, false), 'Average interest rate across all debt')
      ];
    case 'roots':
      return [
        row('Emergency fund', `${i.emergencyMonths.toFixed(1)} mo`, lvl(i.emergencyMonths, 6, 3), 'Resilience to a shock'),
        row('Income stability', pct(p.incomeStability), lvl(p.incomeStability, 0.85, 0.65), 'Predictability of earnings')
      ];
    case 'trunk':
      return [
        row('Cash-flow sustainability', pct(clamp(0.5 + i.cashflowRate * 5)), 'warn', 'Weighted 22%'),
        row('Debt · Savings', `${pct(m.scores.debt)} · ${pct(m.scores.savings)}`, 'warn', 'Weighted 18% each'),
        row('Income', pct(m.scores.income), 'warn', 'Weighted 14%'),
        row('Spending · Investments · Auto · Roots', `${pct(m.scores.spending)} · ${pct(m.scores.investments)} · ${pct(m.scores.auto)} · ${pct(m.scores.roots)}`, 'warn', 'Weighted 10 / 8 / 5 / 5%. Not a plain average: a collapse in cash flow, debt or income drags the whole trunk down.')
      ];
    default:
      return [];
  }
}

// ---- Projection ----------------------------------------------------------

export function project(p, months = 12) {
  const s = structuredClone(p);
  const series = [s.savings + s.checking];
  for (let i = 0; i < months; i++) {
    const f = monthlyFlows(s);
    s.savings += s.savingsContribution;
    if (f.leftover >= 0) s.checking += f.leftover;
    else {
      const fromChk = Math.min(s.checking, -f.leftover);
      s.checking -= fromChk;
      s.savings = Math.max(0, s.savings - (-f.leftover - fromChk));
    }
    s.investments.balance = s.investments.balance * (1 + 0.07 / 12) + s.investments.monthlyContribution;

    const target = s.debts.filter((d) => d.balance > 0).sort((a, b) => b.apr - a.apr)[0];
    s.debts.forEach((d) => {
      if (d.balance <= 0) return;
      const pay = d.minPayment + (d === target ? s.extraDebtPayment || 0 : 0);
      d.balance = d.balance * (1 + d.apr / 1200) - pay;
      if (d.balance <= 0) { d.balance = 0; d.minPayment = 0; }
    });
    if (!s.debts.some((d) => d.balance > 0)) s.extraDebtPayment = 0;

    if (s.vehicle) {
      const v = s.vehicle;
      if (v.loanBalance > 0) {
        v.loanBalance = v.loanBalance * (1 + v.apr / 1200) - v.payment;
        if (v.loanBalance <= 0) { v.loanBalance = 0; v.payment = 0; }
      }
      v.value *= Math.pow(0.9, 1 / 12);
    }
    series.push(s.savings + s.checking);
  }
  return { end: s, series };
}

// ---- Toyota vehicle decisions -------------------------------------------

const depreciate = (veh, months) =>
  veh.value * (veh.isNew ? 0.85 * Math.pow(0.9, Math.max(0, months / 12 - 1)) : Math.pow(0.9, months / 12));

export const maintenanceFactor = (ageYears) => 1 + 0.15 * Math.max(0, ageYears - 4);

export function ownershipCost(veh, startEquity, H = 60) {
  let bal = veh.loanBalance, paid = 0, interest = 0;
  for (let i = 0; i < H; i++) {
    if (bal > 0) {
      const int = (bal * veh.apr) / 1200;
      const pay = Math.min(veh.payment, bal + int);
      bal = bal + int - pay; paid += pay; interest += int;
    }
  }
  // Maintenance rises as the car ages past its warranty years (~15%/yr of the base after year 4).
  const age = veh.ageYears ?? 5;
  let run = 0;
  for (let i = 0; i < H; i++) run += veh.insurance + veh.fuel + veh.maintenance * maintenanceFactor(age + i / 12);
  const endValue = depreciate(veh, H);
  return { paid, interest, run, endEquity: endValue - bal, netCost: paid + run - (endValue - bal) + startEquity };
}

// Editable assumptions behind the simulated Toyota Financial offers (kept on profile.offers).
export const DEFAULT_OFFERS = { refiApr: 5.4, refiTerm: 48, newPrice: 31500, newApr: 4.9, newTerm: 60, extraPay: 150 };

export function vehicleOptions(p) {
  const v = p.vehicle;
  if (!v) return [];
  const o = { ...DEFAULT_OFFERS, ...(p.offers || {}) };
  // Optional AI/what-if overrides: what the current car sells for, cash put down, and the new car's running costs.
  const tradeIn = o.tradeInValue ?? v.value;
  const down = clamp(o.downPayment || 0, 0, Math.max(0, (p.savings || 0) + (p.checking || 0)));
  const customCar = o.newPrice !== DEFAULT_OFFERS.newPrice;
  const financed = Math.max(0, o.newPrice - (tradeIn - v.loanBalance) - down);
  const options = [{ id: 'keep', label: 'Keep & pay down', offer: 'No new financing', vehicle: v }];
  if (v.loanBalance > 0) {
    options.push({
      id: 'refi', label: 'Refinance with Toyota Financial',
      offer: `Simulated offer: ${o.refiApr}% APR, ${o.refiTerm} months`,
      vehicle: { ...v, apr: o.refiApr, payment: round(pmt(v.loanBalance, o.refiApr, o.refiTerm)), monthsLeft: o.refiTerm }
    });
  }
  if (v.loanBalance > 0) {
    options.push({
      id: 'accelerate', label: 'Keep & pay it off early',
      offer: `Add $${round(o.extraPay)}/mo to the current payment`,
      vehicle: { ...v, payment: v.payment + o.extraPay }
    });
  }
  options.push({
    id: 'trade', label: customCar ? `Trade in for a $${round(o.newPrice).toLocaleString()} car` : 'Trade in for a 2026 Camry Hybrid',
    offer: `Simulated offer: ${o.newApr}% APR, ${o.newTerm} months`,
    vehicle: {
      name: customCar ? `Replacement car ($${round(o.newPrice).toLocaleString()})` : '2026 Toyota Camry Hybrid', isNew: true, ageYears: 0, value: o.newPrice, loanBalance: financed, apr: o.newApr,
      payment: round(pmt(financed, o.newApr, o.newTerm)), monthsLeft: o.newTerm, insurance: o.newInsurance ?? 205, fuel: o.newFuel ?? 125, maintenance: o.newMaintenance ?? 35
    }
  });
  return options;
}

// Payoff timeline and cost breakdown for one vehicle.
export function loanSummary(v) {
  if (!v) return null;
  const runningCosts = v.insurance + v.fuel + v.maintenance;
  const neverPaid = v.loanBalance > 0 && v.payment <= (v.loanBalance * v.apr) / 1200;
  let bal = v.loanBalance, months = 0, interest = 0;
  if (bal > 0 && !neverPaid) {
    while (bal > 0.005 && months < 600) {
      const int = (bal * v.apr) / 1200;
      interest += int;
      bal = bal + int - Math.min(v.payment, bal + int);
      months++;
    }
  }
  let payoffDate = null;
  if (!neverPaid) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    payoffDate = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  // "Best time to act": months until loan-to-value drops to 80% (the usual threshold for better refinance terms).
  let ltv80Months = null;
  if (v.value > 0 && v.loanBalance > 0 && !neverPaid) {
    let b = v.loanBalance, val = v.value;
    for (let m = 0; m <= 120; m++) {
      if (b / val <= 0.8) { ltv80Months = m; break; }
      b = Math.max(0, b + (b * v.apr) / 1200 - v.payment);
      val *= Math.pow(0.9, 1 / 12);
    }
  }
  return {
    ltv80Months,
    runningCosts, totalMonthly: runningCosts + v.payment, neverPaid,
    ltv: v.value > 0 ? v.loanBalance / v.value : 0, underwater: v.loanBalance > v.value, equity: v.value - v.loanBalance,
    monthsToPayoff: neverPaid ? null : months, interestRemaining: interest, payoffDate
  };
}

export function vehicleDecision(p, months = 12, _deep = false) {
  const opts = vehicleOptions(p);
  if (!opts.length) return { options: [], best: null };
  const startEquity = p.vehicle.value - p.vehicle.loanBalance;
  const base = computeMetrics(project(p, months).end);
  const baseMonthly = monthlyFlows(p).vehicle;
  const stress = computeMetrics(p).indicators.cashflow < 0;
  const options = opts.map((o) => {
    const cost = ownershipCost(o.vehicle, startEquity, 60);
    const applied = { ...p, vehicle: o.vehicle };
    const after = computeMetrics(project(applied, months).end);
    const monthly = o.vehicle.payment + o.vehicle.insurance + o.vehicle.fuel + o.vehicle.maintenance;
    const rank = cost.netCost - (stress ? 24 * (baseMonthly - monthly) : 0);
    return {
      ...o, cost, monthly, relief: baseMonthly - monthly, rank,
      autoDelta: after.scores.auto - base.scores.auto,
      trunkDelta: after.scores.trunk - base.scores.trunk
    };
  });
  const keep = options.find((o) => o.id === 'keep');
  options.forEach((o) => {
    o.vsKeep = keep.cost.netCost - o.cost.netCost; // positive = cheaper than keeping over 5 years
    o.payoffMonths = loanSummary(o.vehicle).monthsToPayoff;
  });
  const best = [...options].sort((a, b) => a.rank - b.rank)[0];
  const why = best.id === 'keep'
    ? 'Your current loan is already competitive; changing vehicles would cost more over 5 years.'
    : `Over 5 years this saves about $${Math.abs(round(keep.cost.netCost - best.cost.netCost)).toLocaleString()} versus keeping the car` +
      (best.relief > 0 ? ` and frees $${round(best.relief)}/mo${stress ? ', which closes part of your monthly deficit' : ''}.` : '.');
  const sorted = [...options].sort((a, b) => a.rank - b.rank);
  const runnerUp = sorted[1] || null;
  const flip = _deep ? null : flipInsight(p, months, best, runnerUp);
  return { options, best, why, runnerUp, flip };
}

// "What would flip this recommendation": the offer rate where the answer changes, or how close the runner-up is.
function flipInsight(p, months, best, runnerUp) {
  const base = { ...DEFAULT_OFFERS, ...(p.offers || {}) };
  const winnerWith = (patch) => vehicleDecision({ ...p, offers: { ...base, ...patch } }, months, true).best.id;
  const hasRefi = p.vehicle.loanBalance > 0;
  if (best.id === 'refi') {
    for (let apr = base.refiApr; apr <= 20; apr += 0.1) {
      if (winnerWith({ refiApr: apr }) !== 'refi') return `This flips to ${winnerWith({ refiApr: apr })} if the refinance APR rises above about ${apr.toFixed(1)}% (offer is ${base.refiApr}%).`;
    }
    return 'Refinancing stays the best option across every refinance rate we tested.';
  }
  if (best.id === 'keep' && hasRefi) {
    for (let apr = base.refiApr; apr >= 0; apr -= 0.1) {
      if (winnerWith({ refiApr: apr }) === 'refi') return `This flips to refinancing if Toyota Financial offers about ${apr.toFixed(1)}% APR or lower (simulated offer is ${base.refiApr}%).`;
    }
    return 'Keeping stays best even at a 0% refinance rate.';
  }
  if (runnerUp) {
    const gap = Math.abs(round(runnerUp.rank - best.rank));
    return `${runnerUp.label} is the runner-up, only about $${gap.toLocaleString()} behind over 5 years. A lower rate or higher trade-in value could flip the answer.`;
  }
  return null;
}

// ---- Scenarios -----------------------------------------------------------

export const EMPTY_SCENARIO = {
  extraSavings: 0, extraInvest: 0, extraDebt: 0, cutDiscretionary: 0, housingDelta: 0, vehicleId: 'keep',
  // Extra levers so the AI coach can express more open-ended requests (all neutral by default).
  incomeDelta: 0,        // change in monthly take-home (raise, side job, job loss)
  essentialsDelta: 0,    // change to groceries + utilities + phone combined
  lumpToDebt: 0,         // one-time payment from checking to the highest-APR debt
  lumpToSavings: 0,      // one-time move from checking to savings
  lumpToInvest: 0,       // one-time move from checking to investments
  oneTimeExpense: 0,     // one-time spend (house down payment, trip, emergency); comes out of savings, then checking
  offerOverrides: {}     // custom vehicle terms: refiApr, refiTerm, newPrice, newApr, newTerm, extraPay,
                         // tradeInValue, downPayment, newInsurance, newFuel, newMaintenance
};

const mergedOffers = (p, sc) => ({ ...DEFAULT_OFFERS, ...(p.offers || {}), ...(sc.offerOverrides || {}) });

// Short human-readable list of what a scenario changes (used in the preview banner).
export function describeScenario(p, raw) {
  const sc = { ...EMPTY_SCENARIO, ...raw };
  const out = [];
  if (sc.vehicleId === 'none') out.push('Sell the car, go car-free');
  else if (sc.vehicleId && sc.vehicleId !== 'keep') {
    const o = vehicleOptions({ ...p, offers: mergedOffers(p, sc) }).find((x) => x.id === sc.vehicleId);
    if (o) {
      const ov = sc.offerOverrides || {};
      const extra = [];
      if (ov.tradeInValue != null) extra.push(`sold/traded for $${round(ov.tradeInValue).toLocaleString()}`);
      if (ov.downPayment) extra.push(`$${round(ov.downPayment).toLocaleString()} cash down`);
      out.push(`${o.label} (${[o.offer.replace('Simulated offer: ', ''), ...extra].join(', ')})`);
    }
  }
  const m = (n) => `$${Math.abs(round(n)).toLocaleString()}`;
  if (sc.incomeDelta) out.push(`${sc.incomeDelta > 0 ? '+' : '-'}${m(sc.incomeDelta)}/mo income`);
  if (sc.extraSavings) out.push(`+${m(sc.extraSavings)}/mo savings`);
  if (sc.extraInvest) out.push(`+${m(sc.extraInvest)}/mo investing`);
  if (sc.extraDebt) out.push(`+${m(sc.extraDebt)}/mo to debt`);
  if (sc.cutDiscretionary) out.push(`-${m(sc.cutDiscretionary)}/mo discretionary`);
  if (sc.housingDelta) out.push(`${sc.housingDelta > 0 ? '+' : '-'}${m(sc.housingDelta)}/mo housing`);
  if (sc.essentialsDelta) out.push(`${sc.essentialsDelta > 0 ? '+' : '-'}${m(sc.essentialsDelta)}/mo other essentials`);
  if (sc.lumpToDebt) out.push(`${m(sc.lumpToDebt)} one-time to debt`);
  if (sc.lumpToSavings) out.push(`${m(sc.lumpToSavings)} one-time to savings`);
  if (sc.lumpToInvest) out.push(`${m(sc.lumpToInvest)} one-time to investing`);
  if (sc.oneTimeExpense) out.push(`${m(sc.oneTimeExpense)} one-time expense`);
  return out;
}

export function applyScenario(p, raw) {
  const sc = { ...EMPTY_SCENARIO, ...raw };
  const s = structuredClone(p);
  s.netIncome = Math.max(0, s.netIncome + sc.incomeDelta);
  s.savingsContribution += sc.extraSavings;
  s.investments.monthlyContribution += sc.extraInvest;
  s.extraDebtPayment = (s.extraDebtPayment || 0) + sc.extraDebt;
  s.discretionary = Math.max(0, s.discretionary - sc.cutDiscretionary);
  s.essentials.housing = Math.max(0, s.essentials.housing + sc.housingDelta);

  if (sc.essentialsDelta) {
    const e = s.essentials;
    const total = e.groceries + e.utilities + e.phone;
    const f = total > 0 ? Math.max(0, (total + sc.essentialsDelta) / total) : 1;
    e.groceries *= f; e.utilities *= f; e.phone *= f;
  }

  // One-time moves come out of checking (capped at what is there).
  const take = (amt) => { const a = Math.min(Math.max(0, amt), s.checking); s.checking -= a; return a; };
  s.savings += take(sc.lumpToSavings);
  s.investments.balance += take(sc.lumpToInvest);
  let lump = take(sc.lumpToDebt);
  [...s.debts].filter((d) => d.balance > 0).sort((a, b) => b.apr - a.apr).forEach((d) => {
    const pay = Math.min(lump, d.balance);
    d.balance -= pay; lump -= pay;
    if (d.balance <= 0) { d.balance = 0; d.minPayment = 0; }
  });
  s.checking += lump; // anything that did not fit against debt goes back to checking

  // Cash leaving the picture for a purchase: savings first, then checking (never below zero).
  const spend = (amt) => {
    let left = Math.max(0, amt);
    const fromSav = Math.min(left, s.savings); s.savings -= fromSav; left -= fromSav;
    const fromChk = Math.min(left, s.checking); s.checking -= fromChk;
  };
  spend(sc.oneTimeExpense);

  if (sc.vehicleId === 'none' && s.vehicle) {
    // Sell the car: equity goes to savings (or a shortfall comes out of checking).
    const equity = (sc.offerOverrides?.tradeInValue ?? s.vehicle.value) - s.vehicle.loanBalance;
    if (equity >= 0) s.savings += equity; else s.checking = Math.max(0, s.checking + equity);
    s.vehicle = null;
  } else if (sc.vehicleId && sc.vehicleId !== 'keep') {
    const o = vehicleOptions({ ...p, offers: mergedOffers(p, sc) }).find((x) => x.id === sc.vehicleId);
    if (o) {
      s.vehicle = structuredClone(o.vehicle);
      if (sc.vehicleId === 'trade') spend(sc.offerOverrides?.downPayment || 0);
    }
  }
  return s;
}

export function evaluate(p, sc, months = 12) {
  const applied = applyScenario(p, sc);
  const b = project(p, months);
  const a = project(applied, months);
  return {
    base: computeMetrics(b.end), after: computeMetrics(a.end),
    baseSeries: b.series, afterSeries: a.series,
    flowsBase: monthlyFlows(p), flowsAfter: monthlyFlows(applied)
  };
}

export function rankActions(p, subscriptionTotal = 0, months = 12) {
  const hasCard = p.debts.some((d) => d.balance > 0);
  const refi = vehicleOptions(p).find((o) => o.id === 'refi');
  const cands = [
    subscriptionTotal > 0 && { id: 'subs', title: 'Cancel unused subscriptions', detail: `Frees about $${round(subscriptionTotal)}/mo`, sc: { cutDiscretionary: subscriptionTotal } },
    { id: 'trim', title: 'Trim discretionary spending by $150', detail: 'Dining out, shopping, entertainment', sc: { cutDiscretionary: 150 } },
    hasCard && { id: 'card', title: 'Redirect $150/mo from spending to your highest-APR debt', detail: 'Interest is the most expensive leak in the tree', sc: { extraDebt: 150, cutDiscretionary: 150 } },
    refi && { id: 'refi', title: 'Refinance your Toyota loan', detail: refi.offer, sc: { vehicleId: 'refi' } },
    { id: 'ef', title: 'Redirect $100/mo from spending to emergency savings', detail: 'Deepens the roots', sc: { extraSavings: 100, cutDiscretionary: 100 } },
    { id: 'inv', title: 'Redirect $100/mo from spending to investing', detail: 'Compounds over time', sc: { extraInvest: 100, cutDiscretionary: 100 } }
  ].filter(Boolean);
  return cands
    .map((c) => {
      const sc = { ...EMPTY_SCENARIO, ...c.sc };
      const r = evaluate(p, sc, months);
      return { ...c, scenario: sc, deltaTrunk: r.after.scores.trunk - r.base.scores.trunk, deltaCash: r.flowsAfter.leftover - r.flowsBase.leftover };
    })
    .sort((a, b) => b.deltaTrunk - a.deltaTrunk);
}

// ---- Bills ---------------------------------------------------------------

// ---- Cash calendar (PNC: anticipate upcoming obligations) -----------------

const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

// Day-by-day checking balance: paydays (1st & 15th), scheduled bills, detected subscriptions,
// savings/investing transfers and everyday spending. Flags the days it dips under the buffer.
export function cashCalendar(p, subs = [], days = 30, buffer = 500) {
  const subTotal = subs.reduce((s, x) => s + x.monthly, 0);
  const daily = (p.essentials.groceries + p.essentials.phone + Math.max(0, p.discretionary - subTotal)) / 30;
  const events = {};
  const add = (date, label, amount) => { (events[date] ||= []).push({ label, amount }); };

  for (let d = 0; d < days; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const dom = Number(dt.toISOString().slice(8, 10));
    const date = dt.toISOString().slice(0, 10);
    if (dom === 1 || dom === 15) add(date, 'Paycheck', p.netIncome / 2);
    if (dom === 1) add(date, 'Savings & investing transfers', -(p.savingsContribution + p.investments.monthlyContribution));
  }
  const today = isoDay(0), last = isoDay(days - 1);
  (p.bills || []).forEach((b) => { if (b.due && b.due >= today && b.due <= last) add(b.due, b.payee, -b.amount); });
  subs.forEach((s) => {
    if (!s.lastDate) return;
    const next = new Date(s.lastDate);
    if (Number.isNaN(next.getTime())) return;
    for (let k = 0; k < 4; k++) {
      next.setDate(next.getDate() + 30);
      const date = next.toISOString().slice(0, 10);
      if (date >= today && date <= last) add(date, `${s.name} (subscription)`, -s.monthly);
    }
  });

  let bal = p.checking;
  const out = [];
  for (let d = 0; d < days; d++) {
    const date = isoDay(d);
    const ev = events[date] || [];
    ev.forEach((e) => { bal += e.amount; });
    bal -= daily;
    out.push({ date, balance: bal, events: ev });
  }
  const min = out.reduce((a, b) => (b.balance < a.balance ? b : a), out[0]);
  const firstBreach = out.find((x) => x.balance < buffer) || null;
  return { days: out, min, firstBreach, overdraft: out.some((x) => x.balance < 0), buffer };
}

// ---- Scenario validation (AI output is never trusted blindly) --------------

const SCENARIO_LIMITS = {
  extraSavings: [0, 2000, 25], extraInvest: [0, 2000, 25], extraDebt: [0, 2000, 25],
  cutDiscretionary: [0, 1500, 25], housingDelta: [-1500, 2000, 50],
  incomeDelta: [-5000, 5000, 50], essentialsDelta: [-500, 500, 25],
  lumpToDebt: [0, 50000, 100], lumpToSavings: [0, 50000, 100], lumpToInvest: [0, 50000, 100],
  oneTimeExpense: [0, 200000, 100]
};
const OFFER_LIMITS = {
  refiApr: [0, 25, 0.1], refiTerm: [12, 84, 1], newPrice: [1000, 120000, 250],
  newApr: [0, 25, 0.1], newTerm: [12, 84, 1], extraPay: [0, 1500, 25],
  tradeInValue: [0, 80000, 100], downPayment: [0, 120000, 100],
  newInsurance: [0, 600, 5], newFuel: [0, 600, 5], newMaintenance: [0, 400, 5]
};

export function sanitizeScenario(raw, allowedVehicleIds = ['keep']) {
  const out = { ...EMPTY_SCENARIO, offerOverrides: {} };
  Object.entries(SCENARIO_LIMITS).forEach(([k, [lo, hi, step]]) => {
    const n = Number(raw?.[k]);
    if (Number.isFinite(n)) out[k] = clamp(Math.round(n / step) * step, lo, hi);
  });
  Object.entries(OFFER_LIMITS).forEach(([k, [lo, hi, step]]) => {
    const n = Number(raw?.offerOverrides?.[k]);
    if (Number.isFinite(n)) out.offerOverrides[k] = +clamp(Math.round(n / step) * step, lo, hi).toFixed(2);
  });
  const canSell = allowedVehicleIds.length > 0;
  out.vehicleId = allowedVehicleIds.includes(raw?.vehicleId) || (canSell && raw?.vehicleId === 'none') ? raw.vehicleId : 'keep';
  return out;
}

// ---- Grounding context for the AI coach ------------------------------------

export function coachContext(p, subTotal = 0, months = 12) {
  const m = computeMetrics(p);
  const i = m.indicators;
  const dec = p.vehicle ? vehicleDecision(p, months) : null;
  const risk = billRisk(p.checking, p.bills || []);
  const pts = (x) => round(x * 100);
  return {
    person: { name: p.name, city: p.location.city, monthlyTakeHome: round(p.netIncome) },
    scores: Object.fromEntries(Object.entries(m.scores).map(([k, v]) => [k, pts(v)])),
    indicators: {
      monthlyCashFlow: round(i.cashflow), emergencyFundMonths: +i.emergencyMonths.toFixed(1),
      debtToIncomePct: pts(i.dti), cardUtilizationPct: pts(i.util), savingsRatePct: pts(i.savingsRate),
      essentialsSharePct: pts(i.essentialShare), essentialsTargetPct: pts(i.essentialTarget),
      transportSharePct: pts(i.transportShare), weightedAprPct: +(i.weightedApr * 100).toFixed(1)
    },
    contagion: m.effects.map((e) => `${e.from} -> ${e.to}: ${e.text}`),
    subscriptionsPerMonth: round(subTotal),
    billRisk: risk ? { payee: risk.at.payee, due: risk.at.due, checkingAfter: round(risk.balance), overdraft: risk.overdraft } : null,
    vehicle: p.vehicle ? {
      name: p.vehicle.name, value: round(p.vehicle.value), loanBalance: round(p.vehicle.loanBalance),
      apr: p.vehicle.apr, payment: round(p.vehicle.payment)
    } : null,
    vehicleDecision: dec && dec.best ? {
      recommended: { id: dec.best.id, label: dec.best.label }, why: dec.why, whatWouldFlipIt: dec.flip,
      options: dec.options.map((o) => ({
        id: o.id, label: o.label, offer: o.offer, monthlyCost: round(o.monthly), fiveYearNetCost: round(o.cost.netCost),
        savesVsKeeping5yr: round(o.vsKeep), payoffMonths: o.payoffMonths, autoBranchDeltaPts: pts(o.autoDelta), treeDeltaPts: pts(o.trunkDelta)
      }))
    } : null,
    topCoachActions: rankActions(p, subTotal, months).slice(0, 4).map((a) => ({
      title: a.title, treeHealthDeltaPts: +(a.deltaTrunk * 100).toFixed(1), cashFlowDeltaPerMonth: round(a.deltaCash)
    })),
    allowedVehicleIds: vehicleOptions(p).map((o) => o.id),
    horizonMonths: months
  };
}

export function billRisk(checking, bills, buffer = 500) {
  const sorted = [...bills].sort((a, b) => a.due.localeCompare(b.due));
  let running = checking;
  for (const b of sorted) {
    running -= b.amount;
    if (running < buffer) return { at: b, balance: running, overdraft: running < 0 };
  }
  return null;
}