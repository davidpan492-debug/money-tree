// Toyota-specific decision helpers that sit on top of the MoneyTree engine (finance.js):
//   leaseVsBuy      - same replacement car, leased vs financed, over the lease term
//   nextCarPlan     - what happens when the current loan ends and how to prepare for it
//   eligibleOffers  - rule-based eligibility for (simulated) Toyota Financial programs
// All offer terms are simulated assumptions. Eligibility is estimated from the profile, not a credit check.

import { DEFAULT_OFFERS, computeMetrics, loanSummary, maintenanceFactor, monthlyFlows, pmt } from './finance';

const round = (n) => Math.round(n);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Simulated lease program. Money factor = APR / 2400, the way real lease quotes work.
export const LEASE_DEFAULTS = {
  term: 36,
  apr: 5.5,
  residualPct: 0.6,
  acqFee: 650,
  dispFee: 395,
  allowance: 12000,
  overagePerMile: 0.25
};

const mergedOffers = (p) => ({ ...DEFAULT_OFFERS, ...(p.offers || {}) });

// Resale value of a new car after `months` (same curve the engine uses: 15% first year, then 10%/yr).
const newCarValue = (price, months) => price * 0.85 * Math.pow(0.9, Math.max(0, months / 12 - 1));

// ---------------------------------------------------------------- Lease vs buy

export function leaseVsBuy(p, { milesPerYear = 12000, lease = {} } = {}) {
  const v = p.vehicle;
  const o = mergedOffers(p);
  const L = { ...LEASE_DEFAULTS, ...lease };
  const price = o.newPrice;
  const ins = o.newInsurance ?? 205, fuel = o.newFuel ?? 125, maint = o.newMaintenance ?? 35;
  const runMonthly = ins + fuel + maint;

  // Equity in the current car goes into the new deal; negative equity is rolled into it.
  const tradeIn = v ? (o.tradeInValue ?? v.value) : 0;
  const applied = v ? tradeIn - v.loanBalance : 0;
  const cashIn = Math.max(0, applied);

  // Buy: finance the rest at the new-car rate, keep the car, count its resale value at the end of the term.
  const financed = Math.max(0, price - applied);
  const buyPay = financed > 0 ? pmt(financed, o.newApr, o.newTerm) : 0;
  let bal = financed;
  for (let i = 0; i < L.term; i++) {
    if (bal <= 0) break;
    bal = bal + (bal * o.newApr) / 1200 - Math.min(buyPay, bal + (bal * o.newApr) / 1200);
  }
  // Extra miles lower resale value (about 1% per 1,000 miles/yr over 12,000, per year of the term).
  const mileHaircut = 1 - clamp(0.01 * Math.max(0, (milesPerYear - 12000) / 1000) * (L.term / 12), 0, 0.3);
  const resale = newCarValue(price, L.term) * mileHaircut;
  const buyTotal = cashIn + buyPay * L.term + runMonthly * L.term - (resale - bal);

  // Lease: depreciation + rent charge, plus fees and any over-mileage at the end.
  // A lease only takes a modest cap-cost reduction (up to 10% of the price); extra equity stays with you
  // as cash. Negative equity is rolled into the lease.
  const capRed = applied < 0 ? applied : Math.min(applied, 0.1 * price);
  const cap = price - capRed;
  const residual = price * L.residualPct;
  const mf = L.apr / 2400;
  const leasePay = Math.max(0, (cap - residual) / L.term + (cap + residual) * mf);
  const excessMiles = Math.max(0, (milesPerYear - L.allowance) * (L.term / 12));
  const excessCost = excessMiles * L.overagePerMile;
  const leaseTotal = Math.max(0, capRed) + L.acqFee + leasePay * L.term + L.dispFee + excessCost + runMonthly * L.term;

  // Monthly cash flow if each option replaced the current car.
  const flows = monthlyFlows(p);
  const currentCar = v ? v.payment + v.insurance + v.fuel + v.maintenance : 0;
  const cashAfterBuy = flows.leftover + currentCar - (buyPay + runMonthly);
  const cashAfterLease = flows.leftover + currentCar - (leasePay + runMonthly);

  const diff = leaseTotal - buyTotal; // positive = buying is cheaper over the term
  let winner, why;
  if (cashAfterBuy < 0 && cashAfterLease >= 0) {
    winner = 'lease';
    why = `Buying would put your monthly budget about $${Math.abs(round(cashAfterBuy)).toLocaleString()} short, while leasing keeps you in the black.`;
  } else if (Math.abs(diff) < 500) {
    winner = 'close';
    why = `The ${L.term}-month costs are within $${Math.abs(round(diff)).toLocaleString()} of each other, so choose on preference: owning long term versus a new car every few years.`;
  } else if (diff > 0) {
    winner = 'buy';
    why = `Buying costs about $${round(diff).toLocaleString()} less over ${L.term} months, and you still own a car worth about $${round(resale - bal).toLocaleString()} in equity at the end.`;
  } else {
    winner = 'lease';
    why = `Leasing costs about $${Math.abs(round(diff)).toLocaleString()} less over ${L.term} months, mostly because you skip depreciation and the loan.`;
  }

  return {
    term: L.term, milesPerYear, allowance: L.allowance, price, winner, why, diff,
    buy: { monthly: round(buyPay), upfront: round(cashIn), total: round(buyTotal), resale: round(resale), balanceAtEnd: round(bal), equityAtEnd: round(resale - bal), cashAfter: round(cashAfterBuy) },
    lease: { monthly: round(leasePay), upfront: round(Math.max(0, capRed) + L.acqFee), total: round(leaseTotal), excessMiles: round(excessMiles), excessCost: round(excessCost), fees: L.acqFee + L.dispFee, residual: round(residual), cashAfter: round(cashAfterLease) },
    running: round(runMonthly),
    assumptions: `Lease: ${L.apr}% (money factor ${mf.toFixed(5)}), ${Math.round(L.residualPct * 100)}% residual, ${L.allowance.toLocaleString()} mi/yr, $${L.acqFee} + $${L.dispFee} fees. Buy: ${o.newApr}% for ${o.newTerm} months.`
  };
}

// ---------------------------------------------------------------- Next-car plan

export function nextCarPlan(p) {
  const v = p.vehicle;
  if (!v) return null;
  const o = mergedOffers(p);
  const ls = loanSummary(v);
  const hasLoan = v.loanBalance > 0;
  if (hasLoan && ls.neverPaid) return { status: 'stuck', name: v.name, payment: v.payment };

  const months = hasLoan ? ls.monthsToPayoff : 0;
  const horizon = months > 0 ? months : 12; // already paid off: plan the next 12 months
  const age = v.ageYears ?? 5;
  const valueThen = round(v.value * Math.pow(0.9, horizon / 12));
  const ageThen = age + horizon / 12;
  const flows = monthlyFlows(p);

  // Suggested car fund: aim for an extra 10% of the new price by then, capped at half of today's spare cash.
  const targetExtra = 0.1 * o.newPrice;
  const affordable = Math.max(0, flows.leftover * 0.5);
  const fund = round(Math.min(Math.ceil(targetExtra / horizon / 25) * 25, Math.floor(affordable / 25) * 25));
  const saved = fund * horizon;
  const financedThen = Math.max(0, o.newPrice - valueThen - saved);
  const newPayment = financedThen > 0 ? round(pmt(financedThen, o.newApr, o.newTerm)) : 0;

  // What it costs to keep the old car going after payoff: maintenance keeps climbing with age.
  const maintNow = v.maintenance * maintenanceFactor(age);
  const maintThen = v.maintenance * maintenanceFactor(ageThen);
  const maintIn2y = v.maintenance * maintenanceFactor(ageThen + 2);
  const keepMonthlyThen = v.insurance + v.fuel + maintThen;
  const newRunning = (o.newInsurance ?? 205) + (o.newFuel ?? 125) + (o.newMaintenance ?? 35);

  const status = !hasLoan ? 'paidoff' : months <= 12 ? 'soon' : 'later';
  return {
    status, name: v.name, months, payoffDate: hasLoan ? ls.payoffDate : null,
    freedPayment: round(v.payment), valueThen, ageThen: Math.round(ageThen * 10) / 10,
    fund, saved: round(saved), fundCapped: fund * horizon < targetExtra,
    newPrice: o.newPrice, newPayment, newApr: o.newApr, newTerm: o.newTerm,
    keepMonthlyThen: round(keepMonthlyThen), newMonthlyAllIn: newPayment + newRunning,
    maintNow: round(maintNow), maintThen: round(maintThen), maintIn2y: round(maintIn2y),
    // The window to decide: when the loan ends, plus six months.
    windowStart: months, windowEnd: months + 6
  };
}

// ---------------------------------------------------------------- Eligible offers

const tierOf = (debtScore) =>
  debtScore >= 0.75 ? { id: 1, label: 'Tier 1' } : debtScore >= 0.55 ? { id: 2, label: 'Tier 2' } : { id: 3, label: 'Tier 3' };

// decision = the result of vehicleDecision(p) so the offers reuse the same numbers shown above them.
export function eligibleOffers(p, decision) {
  const v = p.vehicle;
  if (!v) return [];
  const o = mergedOffers(p);
  const m = computeMetrics(p);
  const tier = tierOf(m.scores.debt);
  const net = Math.max(1, p.netIncome || 0);
  const ls = loanSummary(v);
  const isToyota = /toyota/i.test(v.name || '');
  const plan = nextCarPlan(p);
  const refi = decision?.options?.find((x) => x.id === 'refi');
  const trade = decision?.options?.find((x) => x.id === 'trade');
  const lease = leaseVsBuy(p);
  const out = [];

  // 1. Refinance
  if (v.loanBalance > 0) {
    const checks = [];
    if (!(o.refiApr < v.apr - 0.25)) checks.push(`your ${v.apr}% rate is already at or below the ${o.refiApr}% offer`);
    if (ls.ltv > 1.15) checks.push('you owe too much relative to the car\u2019s value (over 115%)');
    if (!ls.neverPaid && ls.monthsToPayoff < 12) checks.push('less than a year is left on the loan');
    out.push({
      id: 'refi', title: 'Toyota Financial refinance', terms: `${o.refiApr}% APR, ${o.refiTerm} months`,
      status: checks.length ? 'no' : 'yes',
      reason: checks.length ? `Not a fit: ${checks.join('; ')}.` : `Your ${v.apr}% loan is above the offer rate and your loan-to-value is ${Math.round(ls.ltv * 100)}%.`,
      benefit: !checks.length && refi && refi.vsKeep > 0 ? `Saves about $${round(refi.vsKeep).toLocaleString()} over 5 years` : null,
      sort: !checks.length && refi ? refi.vsKeep : -1
    });
  }

  // 2. Loyalty cash toward the next Toyota (opens within a year of payoff)
  if (isToyota) {
    const left = plan.status === 'stuck' ? null : plan.months;
    const open = left != null && left <= 12;
    out.push({
      id: 'loyalty', title: 'Toyota loyalty cash', terms: '$500 toward your next Toyota',
      status: open ? 'yes' : 'soon',
      reason: left == null
        ? 'Opens once your payment covers the interest and a payoff date exists.'
        : left === 0
          ? 'You own your Toyota outright, so you qualify now.'
          : open
            ? `Your loan ends in ${left} months, inside the 12-month window.`
            : `Opens in about ${left - 12} months, when you are within a year of paying off.`,
      benefit: open ? '$500 off your next Toyota' : null,
      sort: open ? 500 : -2,
      opensIn: left != null && !open ? left - 12 : null
    });
  }

  // 3. Low-rate new-vehicle financing
  if (trade) {
    const share = trade.vehicle.payment / net;
    const ok = tier.id <= 2 && share <= 0.12;
    out.push({
      id: 'newrate', title: 'New-car financing', terms: `${o.newApr}% APR, ${o.newTerm} months`,
      status: ok ? 'yes' : 'no',
      reason: ok
        ? `Estimated ${tier.label} and the new payment would be ${Math.round(share * 100)}% of your income (limit 12%).`
        : tier.id > 2
          ? `Estimated ${tier.label} from your debt health; this rate needs Tier 1 or 2.`
          : `The new payment would be ${Math.round(share * 100)}% of your income (limit 12%).`,
      benefit: ok ? `About $${trade.vehicle.payment.toLocaleString()}/mo on a $${round(o.newPrice).toLocaleString()} car` : null,
      sort: ok ? 100 : -1
    });
  }

  // 4. Lease special
  {
    const share = lease.lease.monthly / net;
    const ok = tier.id <= 2 && share <= 0.1;
    out.push({
      id: 'lease', title: 'Toyota lease special', terms: `${lease.term} months, ${lease.allowance.toLocaleString()} mi/yr`,
      status: ok ? 'yes' : 'no',
      reason: ok
        ? `Lease payment of $${lease.lease.monthly.toLocaleString()} is ${Math.round(share * 100)}% of your income (limit 10%).`
        : tier.id > 2
          ? `Estimated ${tier.label}; lease specials need Tier 1 or 2.`
          : `A $${lease.lease.monthly.toLocaleString()} lease would be ${Math.round(share * 100)}% of your income (limit 10%).`,
      benefit: ok ? `$${lease.lease.monthly.toLocaleString()}/mo, $${Math.abs(lease.buy.monthly - lease.lease.monthly).toLocaleString()} ${lease.buy.monthly >= lease.lease.monthly ? 'less' : 'more'} than financing` : null,
      sort: ok ? 50 : -1
    });
  }

  // 5. GAP coverage on a new loan that starts underwater
  if (trade && trade.vehicle.loanBalance > 0) {
    const ltvNew = trade.vehicle.loanBalance / (trade.vehicle.value * 0.85);
    const need = ltvNew > 1;
    out.push({
      id: 'gap', title: 'Toyota GAP coverage', terms: 'Covers what you owe beyond the car\u2019s value',
      status: need ? 'yes' : 'no',
      reason: need
        ? `On a new loan you would owe about ${Math.round(ltvNew * 100)}% of the car\u2019s value after the first-year drop.`
        : `A new loan would start at ${Math.round(ltvNew * 100)}% of the car\u2019s value, so GAP adds little.`,
      benefit: need ? 'Protects you if the car is totaled early' : null,
      sort: need ? 20 : -1
    });
  }

  // 6. Extended coverage for an aging car
  {
    const age = v.ageYears ?? 5;
    let extra = 0;
    for (let i = 0; i < 24; i++) extra += v.maintenance * (maintenanceFactor(age + i / 12) - 1);
    const need = age >= 4 && extra >= 100;
    out.push({
      id: 'extracare', title: 'Toyota Extra Care coverage', terms: 'Repair coverage beyond the factory warranty',
      status: need ? 'yes' : 'no',
      reason: need
        ? `At ${age} years old, maintenance is rising: about $${round(extra).toLocaleString()} extra expected over the next 24 months.`
        : `At ${age} years old, the extra upkeep expected over 24 months is small.`,
      benefit: need ? 'Cuts the risk of a surprise repair bill' : null,
      sort: need ? 10 : -1
    });
  }

  const rank = { yes: 0, soon: 1, no: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.sort - a.sort);
}
