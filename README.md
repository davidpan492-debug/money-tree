# MoneyTree

**A 360° financial health navigator that grows your money into a tree.**

MoneyTree combines a person's accounts, spending, debts and vehicle into one picture of their financial health, then lets them test decisions (pay down debt, cut spending, refinance or replace a car) and watch the tree respond. Every number comes from a deterministic engine. The AI explains and translates plain-English questions into scenarios, but it never calculates the results.

Built for HackUTD, targeting three tracks:

| Track | What we built for it |
|---|---|
| **PNC: 360° Financial Health Navigator** | Multi-indicator health score, dashboard, 30-day cash forecast, what-if simulator, AI coach |
| **Toyota Financial Services: The Smartest Next Move** | Keep / refinance / pay off early / trade-in recommendation, buy vs. lease, eligible Toyota offers, next-car plan |
| **Capital One: Best Use of Nessie** | Live profile from Nessie (accounts, deposits, bills, purchases, loans, merchants), subscription and anomaly detection, bill and cash planning |

---

## Contents

1. [Features](#features)
2. [How the tree works](#how-the-tree-works)
3. [The scoring model](#the-scoring-model)
4. [The Toyota vehicle engine](#the-toyota-vehicle-engine)
5. [AI coach](#ai-coach)
6. [Data: Nessie and demo customers](#data-nessie-and-demo-customers)
7. [Project structure](#project-structure)
8. [Getting started](#getting-started)
9. [Configuration](#configuration)
10. [Seeding Nessie](#seeding-nessie)
11. [Assumptions and limitations](#assumptions-and-limitations)
12. [Demo script](#demo-script)
13. [Troubleshooting](#troubleshooting)

---

## Features

**The tree.** Six branches (Income, Savings, Investments, Spending, Auto & Transport, Debt), roots (financial resilience) and a trunk (overall health). Branch size and color reflect the score. Click any part to see exactly why it looks the way it does.

**Six tabs**

| Tab | What it does |
|---|---|
| **Overview** | AI plain-English summary, key stats, projected balance, bills at risk, 30-day cash calendar |
| **Branch** | Score breakdown for the selected branch, with the indicator behind each number. For Auto, this tab also holds the full Toyota decision tools |
| **What-if** | Sliders for extra savings, investing and debt payments, discretionary cuts and housing changes, plus vehicle options. The tree updates live at a 12, 24 or 36-month horizon |
| **Coach** | Ranked next actions, plus "Ask your tree" (plain-English questions that become scenarios) |
| **Insights** | Subscription detection, unusual-spending detection, top merchants |
| **Data** | Nessie connection, customer picker, and a list of which fields are live and which are demo assumptions |

**Preview mode.** Any what-if change appears on the tree immediately, with change chips on each branch and a banner showing the cash-flow effect. "Back to today" and "Clear" undo it.

**Toyota tools (Auto branch)**

- Four-number vehicle summary: value, loan balance, equity, all-in monthly cost
- Next-car plan: "Your loan ends in N months. Here is the next-car plan."
- Vehicle options table (keep, refinance, pay off early, trade in) with a recommendation, expandable details and a preview-on-tree button
- Buy vs. lease toggle for the same replacement car
- "View Toyota Offers & Eligibility" drawer (six simulated programs)
- "Adjust Offer Assumptions (Advanced)" drawer
- "What would change this" insight showing where the recommendation flips

---

## How the tree works

```
profile ──► computeMetrics() ──► indicators ──► branch scores ──► contagion ──► trunk
   │
   └──► applyScenario() ──► project(N months) ──► computeMetrics() ──► "after" tree
                                  │
                         same projection with no change ──► "before" tree
```

- A **profile** is a plain object (income, balances, essentials, debts, vehicle, bills, purchases). It comes from Nessie or from a demo customer.
- `computeMetrics(profile)` turns it into indicators and scores from 0 to 1.
- `evaluate(profile, scenario, months)` applies a what-if, projects both the original and the changed profile forward, and returns both trees so the UI can show the difference "vs. doing nothing over the same period."
- The tree is drawn by `TreeCanvas`, which only receives scores, deltas and the selected part.

---

## The scoring model

All scores are clamped to 0–1. Formulas live in `src/lib/finance.js` (`computeMetrics`).

### Key indicators

| Indicator | Formula |
|---|---|
| Must-pay costs | housing + utilities + groceries + phone + vehicle (payment, insurance, fuel, maintenance) + minimum debt payments |
| Essentials share | must-pay costs ÷ take-home pay |
| Essentials target | `0.60 × (1 + (cost-of-living index − 100)/100 × 0.35)`, limited to 40%–75% |
| Emergency months | (savings + 0.5 × checking) ÷ must-pay costs |
| Monthly cash flow | take-home − (essentials + vehicle + debt minimums + extra debt payment + discretionary + savings and investing contributions) |
| Cash-flow rate | cash flow ÷ take-home |
| Discretionary share | discretionary spending ÷ take-home |
| Debt-to-income | (debt minimums + vehicle payment) ÷ take-home |
| Card utilization | card balances ÷ card limits |
| Weighted APR | balance-weighted APR across all debts including the vehicle loan |
| Transport share | vehicle costs ÷ take-home |
| Equity ratio | (vehicle value − loan) ÷ vehicle value |

### Branch scores

| Branch | Formula |
|---|---|
| **Income** | 0.6 × income stability + 0.4 × clamp((take-home ÷ must-pay − 1) ÷ 0.8) |
| **Savings** | 0.7 × clamp(emergency months ÷ 6) + 0.3 × clamp(savings rate ÷ 10%) |
| **Investments** | 0.5 × clamp(invest rate ÷ 10%) + 0.5 × clamp(balance ÷ (1.5 × annual take-home)) |
| **Spending** | 0.35 × essentials score + 0.35 × cash-flow sustainability + 0.30 × discretionary score |
| **Auto** | 0.6 × (1 − clamp((transport share − 10%) ÷ 20%)) + 0.4 × clamp(equity ratio ÷ 30%) |
| **Debt** | 0.5 × (1 − clamp(DTI ÷ 36%)) + 0.3 × (1 − clamp(utilization ÷ 50%)) + 0.2 × (1 − clamp(weighted APR ÷ 25%)) |
| **Roots** | 0.65 × clamp(emergency months ÷ 6) + 0.35 × income stability |

Where, for Spending:

- essentials score = `1 − clamp((essentials share − target) ÷ 25%)`
- cash-flow sustainability = `clamp(0.5 + cash-flow rate × 5)` (50 at break-even, 100 at +10% of income, 0 at −10%)
- discretionary score = `1 − clamp((discretionary share − 10%) ÷ 20%)` (full marks at 10% or less, zero at 30% or more)

The discretionary term exists so that cutting discretionary spending always moves the Spending branch, even for people whose cash flow and essentials are already at the cap.

### Contagion (cross-branch effects)

Problems spread only where there is a real financial link:

- **Cash deficit → Savings and Investments.** If cash flow is negative, Savings is multiplied by `1 − drain` and Investments by `1 − 0.8 × drain`, where `drain = clamp(−cash-flow rate × 3, 0, 0.25)`.
- **Weak Debt → Spending.** If the Debt score is below 0.45, Spending is reduced by `10% × (1 − debt)`.
- **Vehicle costs above 15% of take-home** are called out in the Spending explanation.

### Trunk

```
trunk = 0.22 × cash-flow sustainability + 0.18 × debt + 0.18 × savings + 0.14 × income
      + 0.10 × spending + 0.08 × investments + 0.05 × auto + 0.05 × roots
```

If cash flow, debt or income falls below 0.25, the trunk is multiplied by 0.9, so a collapse in one critical area drags down overall health instead of being averaged away.

### Projection

`project(profile, months)` steps month by month: contributions go to savings and investing, a surplus goes to checking, a deficit drains checking then savings, investments grow at 7%/yr, debts amortize at their APR (extra payments go to the highest-APR debt), the car loan amortizes and the car loses value at 10%/yr.

---

## The Toyota vehicle engine

Vehicle logic is in `src/lib/finance.js` (decisions) and `src/lib/toyota.js` (lease, next-car plan, offers).

### Keep / refinance / pay off early / trade in

For each option the engine builds the resulting vehicle and computes:

- **Monthly cost:** payment + insurance + fuel + maintenance
- **5-year net cost:** payments + running costs − (resale value − remaining loan) + starting equity
- **Tree impact:** change in the Auto branch and the trunk after the chosen horizon
- **Maintenance growth:** maintenance rises 15% of its base per year after the car's fourth year

The **recommendation** is the option with the lowest ranked cost. When monthly cash flow is negative, the rank also rewards monthly relief (24 months' worth), so a cash-strapped customer is steered toward lower payments. "What would change this" finds the refinance rate at which the winner flips, or names the runner-up and its gap.

### Buy vs. lease

Compares the same replacement car over the lease term (36 months) using:

- **Lease:** payment = (cap cost − residual) ÷ term + (cap cost + residual) × money factor, where money factor = APR ÷ 2400. Defaults: 5.5%, 60% residual, $650 acquisition fee, $395 disposition fee, 12,000 mi/yr allowance, $0.25 per extra mile. Equity can reduce the cap cost by up to 10% of the price.
- **Buy:** financed at the new-car rate, with resale value at the end of the term (15% first-year drop, then 10%/yr, reduced for high mileage).
- **Verdict:** buying, leasing or a close call (within $500). If buying would leave the monthly budget negative while leasing does not, leasing wins.

### Eligible offers (simulated)

| Offer | Rule of thumb |
|---|---|
| Refinance | Offer rate is at least 0.25 pt below current APR, loan-to-value ≤ 115%, at least 12 months left |
| Loyalty cash ($500) | Toyota owner within 12 months of loan payoff (shows when it opens) |
| New-car financing | Estimated Tier 1–2 and new payment ≤ 12% of take-home |
| Lease special | Estimated Tier 1–2 and lease payment ≤ 10% of take-home |
| GAP coverage | New loan would exceed the car's value after the first-year drop |
| Extra Care coverage | Car is 4+ years old with meaningful rising maintenance |

The "tier" is estimated from the Debt score (≥ 0.75 Tier 1, ≥ 0.55 Tier 2, otherwise Tier 3). It is **not a credit check**, and the UI says so.

### Next-car plan

For a car with a loan, the plan shows the payoff month and date, a suggested monthly car fund (aiming for about 10% of the new car's price, capped at half of spare cash), the decision window (payoff month to six months later), the old car's value and rising upkeep at that point, and a side-by-side of "keep it, no payment" vs. "trade into a new car." Paid-off cars get a 12-month plan, and a loan whose payment does not cover interest gets an explanation instead.

---

## AI coach

The coach is an OpenAI-powered API route called through `src/lib/coach.js` (`callCoach`). It has three modes:

| Mode | Purpose |
|---|---|
| `summary` | Plain-English health summary and top priority (Overview) |
| `vehicle` | Explains the vehicle recommendation (Auto branch) |
| `scenario` | Turns a question like "refinance my car and cut $200 of dining" into scenario levers |

**The AI never produces the numbers.** In scenario mode the model returns lever values, `sanitizeScenario()` validates them against allowed ranges and vehicle options, and `evaluate()` computes the results that are shown. If the AI is unavailable, the summary falls back to a rule-based version (`localSummary`) so the demo never shows an empty card.

---

## Data: Nessie and demo customers

### Demo customers

Two personas in `src/lib/demoProfile.js` make the Toyota recommendation visibly different:

| | Alex Rivera (Dallas) | Jordan Lee (Plano) |
|---|---|---|
| Take-home | $5,400/mo | $8,200/mo |
| Situation | Tight budget, SUV loan at 7.9% | Strong cash flow, Camry loan at 3.9% |
| Best vehicle move | Refinance | Keep (refinance is not a fit) |

### Live Nessie data

`loadNessieProfile()` in `src/lib/nessie.js` builds a profile from a Nessie customer:

| Profile field | Source |
|---|---|
| Checking / savings balances | Customer accounts |
| Take-home income and stability | Deposits (average and variance) |
| Spending categories (housing, groceries, utilities, phone, discretionary) | Purchases and withdrawals, categorized by merchant and description |
| Savings and investing contributions | Transfers |
| Upcoming bills | Bills |
| Credit card balances | Credit accounts |
| Student loans | Loans (`amount` = balance, `monthly_payment` = payment) |
| Car loan | Loan whose type or description looks like a vehicle |
| Vehicle name, year, estimated value | Parsed from the loan description, e.g. `2021 Toyota RAV4 XLE (est. value $23,500)` |
| Location and cost-of-living index | Customer address and a city lookup |

Nessie has no interest-rate, credit-limit, investment-balance or vehicle-value fields, so those stay demo assumptions. The **Data tab** lists each field as live or demo so nothing is hidden. If a customer has loan records but no car loan, the vehicle's loan is set to zero instead of inheriting the demo car's loan.

Browser requests go through a same-origin Next.js proxy (`/api/nessie/proxy`) so the API key is not exposed to CORS problems.

### Transaction analytics (Insights tab)

- **Subscriptions:** steady charges to the same merchant that repeat about monthly
- **Unusual spending:** purchases more than 2.5 standard deviations above the account's normal size (rent, car payments and transfers are excluded)
- **Top merchants:** total spend by merchant
- **30-day cash calendar:** day-by-day checking balance from paydays (assumed on the 1st and 15th), bills, subscriptions and everyday spending, flagging any dip below a safety buffer or below zero

---

## Project structure

```
src/
  components/
    App.jsx            Layout, tabs, scenario/preview state
    TreeCanvas.jsx     The tree drawing (scores, deltas, selection, pulse)
    Panels.jsx         Overview, Branch, What-if, Coach, Data panels
    ToyotaPanels.jsx   Next-car plan, buy vs. lease toggle, offers, drawers
    AIPanels.jsx       AI summary, vehicle explainer, "Ask your tree"
    InsightPanels.jsx  Cash calendar and Insights tab
    ui.jsx             Shared Card, heading and formatters
  lib/
    finance.js         Scoring, projection, scenarios, vehicle decisions, coach ranking
    toyota.js          Lease vs. buy, next-car plan, offer eligibility
    nessie.js          Nessie loader and transaction analytics
    demoProfile.js     Alex and Jordan demo customers
    coach.js           Client helper and rule-based fallback summary
app/
  api/
    coach/route.js     OpenAI-backed coach endpoint
    nessie/proxy/...   Same-origin proxy for Nessie requests
seed_nessie.py         Seeds Nessie with matching customers and transactions
```

Adjust the paths to match your repository. Imports use the `@/lib/...` alias.

---

## Getting started

**Requirements:** Node.js 18+, a Next.js (App Router) project with Tailwind CSS and `lucide-react`.

```bash
npm install
npm run dev
```

Open the app and it starts in **demo mode** with Alex. Use the Customer dropdown in the header to switch to Jordan. No keys are needed for demo mode, except the AI features, which need the coach route configured.

To use live data, open the **Data** tab, paste a Nessie API key and load a customer.

---

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `NESSIE_API_KEY` | Server | Default Nessie key used when the Data tab key box is blank |
| `NEXT_PUBLIC_NESSIE_KEY` | Browser | Optional pre-filled key (remember this is exposed to the client) |
| `NESSIE_BASE_URL` | Server | Override the Nessie base URL (default `https://prod-api.nessieisreal.com`) |
| OpenAI key | Server | Used by `app/api/coach/route.js`; use the variable name your route reads |

A key entered in the Data tab is remembered in that browser's `localStorage`.

---

## Seeding Nessie

`seed_nessie.py` creates matching customers, accounts, deposits, purchases, bills and loans so live mode tells the same story as the demo customers. Rows it creates are tagged in their description (the UI hides the tag) so the script can find and delete them later.

- Run it with `--clean` to remove previously tagged rows first. Use this after the schema changes, because older seeded customers lack the newer student-loan and car-payment rows.
- Loan `type` is not documented by Nessie, so the script tries several likely values until one is accepted and prints which it used.
- The script was tested against a mocked Nessie, not the live API. If every loan type is rejected, check the printed error.

---

## Assumptions and limitations

Being upfront about what is simulated:

- **Simulated:** all interest rates, credit limits, investment balances, Toyota offer terms, lease terms and the loyalty-cash amount.
- **Estimated, not checked:** the offer "tier" comes from the Debt score. There is no credit check.
- **Market model:** 7% annual investment return and 10%/yr vehicle depreciation (15% in a new car's first year) are fixed assumptions.
- **Paydays** in the cash calendar are assumed on the 1st and 15th.
- **Nessie workaround:** vehicle name, year and value are read from the loan description because Nessie has no fields for them.
- **Savings and investing count as outflow** in cash flow, so someone saving aggressively with nothing left over scores 50 on cash-flow sustainability.
- **Auto formula vs. label:** the Auto score gives full marks at 10% of income on transport costs and reaches zero at 30%, while the UI describes 15% as the healthy ceiling.
- This is a demo for educational purposes, not financial, legal or tax advice.



## Troubleshooting

| Problem | Fix |
|---|---|
| "AI route not found (404)" | Put `route.js` at `<app folder>/api/coach/route.js`, next to `api/nessie/proxy`, then restart the dev server |
| AI card shows "rule-based summary" | The AI call failed; check the OpenAI key on the server. The fallback is intentional |
| Nessie shows demo data after loading | Check the key and customer in the Data tab; the Data tab shows which fields were live |
| Cash calendar shows "Loading" briefly | It depends on today's date, so it renders only after the page mounts in the browser |
| A slider seems to do nothing | Scores cap at 100; very healthy profiles can hit the ceiling on a branch. The discretionary slider only goes up to what is actually spent |