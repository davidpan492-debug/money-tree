// Capital One Nessie integration and transaction analytics.
// Browser requests go through the same-origin Next.js proxy.
// Server requests go directly to Nessie.

export const DEFAULT_BASE = 'https://prod-api.nessieisreal.com';

export const CANDIDATE_BASES = [
  DEFAULT_BASE,
  'https://api.nessieisreal.com',
  'http://api.nessieisreal.com'
];

export const nessieBase = () =>
  ((typeof process !== 'undefined' && process.env?.NESSIE_BASE_URL) ||
    DEFAULT_BASE).replace(/\/+$/, '');

// Seeded rows carry a tag in their description so the seed script can find them again; hide it in the UI.
const clean = (text) => String(text || '').replace(/\s*\[HACKUTD-SEED\]/gi, '').trim();

// Rough cost-of-living index (100 = national average) for cities Nessie addresses may name.
const COL_INDEX = { dallas: 102, plano: 100, austin: 120, houston: 96, 'san antonio': 91, 'fort worth': 98 };

export async function nessieFetch(base, path, key) {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

async function get(path, key) {
  const viaProxy = typeof window !== 'undefined';

  const response = viaProxy
    ? await fetch(`/api/nessie/proxy?path=${encodeURIComponent(path)}`, {
        headers: key ? { 'x-nessie-key': key } : {},
        cache: 'no-store'
      }).then(async (r) => ({
        ok: r.ok,
        status: r.status,
        body: await r.json().catch(() => null)
      }))
    : await nessieFetch(nessieBase(), path, key);

  if (!response.ok) {
    const detail =
      response.body?.message ||
      response.body?.error ||
      '';

    throw new Error(
      `Nessie ${response.status} on ${path}${detail ? `: ${detail}` : ''}`
    );
  }

  return response.body;
}

export async function getNessieCustomers(key) {
  const customers = await get('/customers', key);
  return Array.isArray(customers) ? customers : [];
}

// Per-month totals (oldest first). Transactions without dates count as one month.
function monthlyTotals(transactions) {
  const months = {};

  for (const transaction of transactions) {
    const date = transaction.purchase_date || transaction.transaction_date;
    const month = date ? String(date).slice(0, 7) : 'undated';
    months[month] = (months[month] || 0) + Math.abs(Number(transaction.amount) || 0);
  }

  return Object.keys(months).sort().map((month) => months[month]);
}

// Convert an array of transactions into an average monthly amount.
function monthlyAverage(transactions) {
  if (!transactions.length) return 0;
  let totals = monthlyTotals(transactions);
  // The newest month is usually only partly complete, so leave it out once there is enough history.
  if (totals.length >= 3) totals = totals.slice(0, -1);
  return totals.reduce((sum, amount) => sum + amount, 0) / totals.length;
}

// Income stability (0..1) from how much monthly deposit totals vary.
// The newest month is dropped when there is enough history because it is usually only partly complete.
// Returns null when there is not enough history to say anything.
function incomeStabilityFrom(deposits) {
  let totals = monthlyTotals(deposits);
  if (totals.length >= 4) totals = totals.slice(0, -1);
  if (totals.length < 3) return null;
  const mean = totals.reduce((s, x) => s + x, 0) / totals.length;
  if (mean <= 0) return null;
  const sd = Math.sqrt(totals.reduce((s, x) => s + (x - mean) ** 2, 0) / totals.length);
  return Math.max(0.3, Math.min(0.98, 1 - (sd / mean) * 1.5));
}

// Which financial category a transaction belongs to (description + merchant category keywords).
// Restaurants, dining and coffee are discretionary, not essentials. Transfers to savings and
// investing are money moved, not money spent, so they get their own buckets.
export function categoryOf(transaction) {
  const text = `${clean(transaction.description)} ${transaction.category || ''}`.toLowerCase();

  if (/transfer to savings|savings transfer|emergency fund/.test(text)) return 'savingsTransfer';
  if (/invest|brokerage|401k|roth|\bira\b/.test(text)) return 'investing';
  if (/student loan|loan payment/.test(text)) return 'studentLoan';
  if (/rent|housing|mortgage|apartment|landlord/.test(text)) return 'housing';
  if (/restaurant|dining|cafe|coffee|bar\b|fast food|takeout|delivery/.test(text)) return 'discretionary';
  if (/grocery|groceries|supermarket/.test(text)) return 'groceries';
  if (/utility|utilities|electric|water|internet|gas & electric/.test(text)) return 'utilities';
  if (/phone|wireless|mobile/.test(text)) return 'phone';
  if (/insurance/.test(text)) return 'insurance';
  if (/fuel|gasoline|gas station/.test(text)) return 'fuel';
  if (/car payment|auto payment|vehicle payment/.test(text)) return 'carPayment';
  return 'discretionary';
}

// Convert transactions into average monthly amounts per financial category.
function categorizeSpending(transactions, baseProfile) {
  const categories = {
    housing: [], groceries: [], utilities: [], phone: [], insurance: [], fuel: [],
    carPayment: [], discretionary: [], savingsTransfer: [], investing: [], studentLoan: []
  };

  for (const transaction of transactions) {
    const amount = Math.abs(Number(transaction.amount) || 0);
    if (!amount) continue;
    categories[categoryOf(transaction)].push({ ...transaction, amount });
  }

  const monthly = {};

  for (const [category, transactionsForCategory] of Object.entries(categories)) {
    monthly[category] = monthlyAverage(transactionsForCategory);
  }

  // If there is no vehicle in the profile, vehicle expenses still
  // affect the spending score through discretionary spending.
  if (!baseProfile.vehicle) {
    monthly.discretionary +=
      monthly.insurance +
      monthly.fuel +
      monthly.carPayment;
  }

  return monthly;
}

export async function loadNessieProfile(key, baseProfile, customerId) {
  // Get the selected customer.
  const customers = customerId
    ? [await get(`/customers/${customerId}`, key)]
    : await get('/customers', key);

  const customer = Array.isArray(customers) ? customers[0] : customers;

  if (!customer) {
    throw new Error('No Nessie customers found for this key');
  }

  // Get all accounts belonging to the customer.
  const accounts = await get(`/customers/${customer._id}/accounts`, key);

  if (!Array.isArray(accounts)) {
    throw new Error('Nessie returned an invalid accounts response');
  }

  // Real Nessie purchases usually carry a merchant_id instead of a readable description,
  // so resolve ids to names and categories once.
  const merchantList = await get('/merchants', key).catch(() => []);
  const merchants = {};
  if (Array.isArray(merchantList)) {
    merchantList.forEach((m) => {
      if (m?._id) {
        merchants[m._id] = {
          name: m.name || '',
          category: Array.isArray(m.category) ? m.category.join(' ') : String(m.category || '')
        };
      }
    });
  }
  const merchantName = (id) => merchants[id]?.name || '';
  const merchantCategory = (id) => merchants[id]?.category || '';

  const byType = (type) =>
    accounts.filter((account) =>
      (account.type || '').toLowerCase().includes(type)
    );

  const sumBalances = (list) =>
    list.reduce(
      (sum, account) => sum + (Number(account.balance) || 0),
      0
    );

  const purchases = [];
  const bills = [];
  const deposits = [];
  const withdrawals = [];
  const loans = [];

  // Retrieve transactions for every account.
  for (const account of accounts) {
    const [accountPurchases, accountBills, accountDeposits, accountWithdrawals, accountLoans] =
      await Promise.all([
        get(`/accounts/${account._id}/purchases`, key).catch(() => []),
        get(`/accounts/${account._id}/bills`, key).catch(() => []),
        get(`/accounts/${account._id}/deposits`, key).catch(() => []),
        get(`/accounts/${account._id}/withdrawals`, key).catch(() => []),
        get(`/accounts/${account._id}/loans`, key).catch(() => [])
      ]);

    if (Array.isArray(accountPurchases)) {
      purchases.push(
        ...accountPurchases.map((purchase) => ({
          description: clean(
            merchantName(purchase.merchant_id) ||
            purchase.description ||
            purchase.merchant_id ||
            'Purchase'
          ),
          category: merchantCategory(purchase.merchant_id),
          amount: Math.abs(Number(purchase.amount) || 0),
          purchase_date:
            purchase.purchase_date ||
            purchase.transaction_date ||
            ''
        }))
      );
    }

    if (Array.isArray(accountWithdrawals)) {
      withdrawals.push(
        ...accountWithdrawals.map((withdrawal) => ({
          description: clean(withdrawal.description) || 'Withdrawal',
          amount: Math.abs(Number(withdrawal.amount) || 0),
          purchase_date:
            withdrawal.transaction_date ||
            withdrawal.withdrawal_date ||
            ''
        }))
      );
    }

    if (Array.isArray(accountBills)) {
      bills.push(
        ...accountBills.map((bill) => ({
          payee: bill.payee || bill.nickname || 'Bill',
          amount: Number(bill.payment_amount) || 0,
          due: String(bill.upcoming_payment_date || bill.payment_date || '').slice(0, 10),
          status: String(bill.status || '').toLowerCase()
        }))
      );
    }

    if (Array.isArray(accountDeposits)) {
      deposits.push(...accountDeposits);
    }

    if (Array.isArray(accountLoans)) {
      loans.push(...accountLoans);
    }
  }

  // Combine purchases and withdrawals into one spending history.
  const allTransactions = [...purchases, ...withdrawals];

  // Categorize transactions so the financial engine can use them.
  const spending = categorizeSpending(allTransactions, baseProfile);

  // The Insights tab looks at everyday spending: leave out rent, the car payment and money moved to
  // savings/investing, otherwise they show up as "unusual" purchases and top merchants.
  const FIXED = ['housing', 'carPayment', 'studentLoan', 'savingsTransfer', 'investing'];
  const everyday = allTransactions.filter((t) => !FIXED.includes(categoryOf(t)));

  const hasAllocations = spending.savingsTransfer > 0 || spending.investing > 0;

  // Location comes from the customer's address.
  const address = customer.address || {};
  const city = address.city ? `${address.city}${address.state ? `, ${address.state}` : ''}` : '';
  const colIndex = COL_INDEX[String(address.city || '').toLowerCase()];

  const depositRows = deposits.map((deposit) => ({
    amount: deposit.amount,
    transaction_date:
      deposit.transaction_date ||
      deposit.deposit_date ||
      ''
  }));

  // Calculate average monthly income from deposits, and how steady it is.
  const monthlyIncome = monthlyAverage(depositRows);
  const derivedStability = incomeStabilityFrom(depositRows);

  // Build credit card debt information.
  const cardDebts = byType('credit').map((account) => ({
    id: account._id,
    name: account.nickname || 'Credit card',
    balance: Number(account.balance) || 0,
    apr: 22.9,
    limit: Math.max(5000, (Number(account.balance) || 0) * 2),
    minPayment: Math.max(
      25,
      Math.round((Number(account.balance) || 0) * 0.02)
    ),
    type: 'card'
  }));

  const checkingAccounts = byType('check');
  const savingsAccounts = byType('sav');

  // Update the vehicle fields only if the profile has a vehicle.
  let vehicle = baseProfile.vehicle
    ? {
        ...baseProfile.vehicle,
        insurance: spending.insurance || baseProfile.vehicle.insurance,
        fuel: spending.fuel || baseProfile.vehicle.fuel,
        payment: spending.carPayment || baseProfile.vehicle.payment
      }
    : baseProfile.vehicle;

  // ---- Loan records. `amount` is the outstanding balance and `monthly_payment` the payment.
  // Student loans become debts; an auto loan becomes the vehicle loan. Nessie has no interest-rate,
  // vehicle-value or model-year fields, so rates stay demo assumptions and the car's name, year and
  // estimated value are read from the loan description, e.g. "2021 Toyota RAV4 XLE (est. value $23,500)".
  const loanText = (l) => `${l.type || ''} ${l.description || ''}`;
  const usableLoans = loans.filter((l) => !/denied|reject|cancel/i.test(String(l.status || '')) && Number(l.amount) > 0);
  const studentLoans = usableLoans.filter((l) => /student/i.test(loanText(l)));
  const autoLoan = usableLoans.find((l) =>
    !/student/i.test(loanText(l)) &&
    (/auto/i.test(l.type || '') || /car|auto|vehicle|toyota|honda|ford|camry|rav4|corolla/i.test(l.description || '')));

  const monthsToPayOff = (balance, apr, payment) => {
    if (!(payment > 0)) return 0;
    const r = apr / 1200;
    if (r === 0) return Math.ceil(balance / payment);
    const x = 1 - (r * balance) / payment;
    return x > 0 ? Math.ceil(-Math.log(x) / Math.log(1 + r)) : 600;
  };

  let vehicleValueLive = false;
  if (autoLoan && baseProfile.vehicle) {
    const desc = clean(autoLoan.description);
    const year = Number((desc.match(/\b(?:19|20)\d{2}\b/) || [])[0]);
    const valueMatch = desc.match(/value\s*\$?([\d,]+)/i);
    vehicleValueLive = Boolean(valueMatch);
    const balance = Number(autoLoan.amount) || 0;
    const payment = Number(autoLoan.monthly_payment) || vehicle.payment;
    vehicle = {
      ...vehicle,
      name: desc.replace(/\s*\(.*?\)\s*/g, ' ').trim() || vehicle.name,
      loanBalance: balance,
      payment,
      ageYears: year ? Math.max(0, new Date().getFullYear() - year) : vehicle.ageYears,
      value: valueMatch ? Number(valueMatch[1].replace(/,/g, '')) : vehicle.value,
      monthsLeft: monthsToPayOff(balance, vehicle.apr, payment)
    };
  }

  // Loan records exist but none is a car loan: Nessie is the source of truth, so the person has no
  // car loan. Don't let the demo persona's loan balance and payment leak through.
  const noCarLoan = Boolean(baseProfile.vehicle) && usableLoans.length > 0 && !autoLoan;
  if (noCarLoan) {
    vehicle = { ...vehicle, loanBalance: 0, payment: 0, monthsLeft: 0 };
  }

  const demoStudentApr = (baseProfile.debts || []).find((d) => d.type !== 'card')?.apr ?? 5.5;
  const studentDebts = studentLoans.map((l) => ({
    id: l._id,
    name: clean(l.description).split(' - ')[0] || 'Student loan',
    balance: Number(l.amount) || 0,
    apr: demoStudentApr,
    minPayment: Number(l.monthly_payment) || 0,
    type: 'loan'
  }));

  // Be explicit about which numbers came from Nessie and which are still demo assumptions.
  const liveFields = [];
  const demoFields = [];
  const mark = (isLive, label) => (isLive ? liveFields : demoFields).push(label);
  mark(Boolean(customer.first_name || customer.last_name), 'Name');
  mark(checkingAccounts.length > 0, 'Checking balance');
  mark(savingsAccounts.length > 0, 'Savings balance');
  mark(monthlyIncome > 0, 'Monthly income (from deposits)');
  mark(derivedStability != null, 'Income stability (deposit variance)');
  mark(cardDebts.length > 0, 'Credit card balances');
  mark(Boolean(spending.housing), 'Housing cost');
  mark(Boolean(spending.groceries), 'Groceries');
  mark(Boolean(spending.utilities), 'Utilities');
  mark(Boolean(spending.phone), 'Phone');
  mark(Boolean(spending.discretionary), 'Discretionary spending');
  mark(bills.some((b) => b.due), 'Upcoming bills');
  mark(allTransactions.length > 0, 'Transaction history');
  mark(hasAllocations, 'Savings & investing contributions (from transfers)');
  mark(Boolean(city), 'Location (from address)');
  mark(colIndex != null, 'Cost-of-living index (city lookup)');
  mark(Boolean(spending.insurance || spending.fuel || spending.carPayment), 'Vehicle running costs');
  mark(Boolean(autoLoan) || noCarLoan, 'Vehicle loan balance & payment (from loans)');
  mark(vehicleValueLive, 'Vehicle value (from loan description)');
  // Only list student loans as live when some exist; with loan data but none of them, there is nothing to show.
  if (studentLoans.length > 0) mark(true, 'Student loans (from loans)');
  else if (usableLoans.length === 0) mark(false, 'Student loans');
  demoFields.push('Investment balance', 'Loan & credit card interest rates', 'Credit card limits');

  return {
    ...baseProfile,
    id: 'nessie',
    persona: 'Live Capital One Nessie customer',

    name:
      `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
      baseProfile.name,

    checking: checkingAccounts.length
      ? sumBalances(checkingAccounts)
      : baseProfile.checking,

    savings: savingsAccounts.length
      ? sumBalances(savingsAccounts)
      : baseProfile.savings,

    netIncome: monthlyIncome > 0
      ? Math.round(monthlyIncome)
      : baseProfile.netIncome,

    incomeStability: derivedStability != null
      ? derivedStability
      : baseProfile.incomeStability,

    debts: [
      ...cardDebts,
      ...studentDebts,
      // With no loan records at all, keep the demo loans; otherwise Nessie is the source of truth.
      ...(usableLoans.length === 0 ? (baseProfile.debts || []).filter((debt) => debt.type !== 'card') : [])
    ],

    essentials: {
      ...baseProfile.essentials,
      housing: spending.housing || baseProfile.essentials.housing,
      groceries: spending.groceries || baseProfile.essentials.groceries,
      utilities: spending.utilities || baseProfile.essentials.utilities,
      phone: spending.phone || baseProfile.essentials.phone
    },

    vehicle,

    // If Nessie shows any transfers to savings or investing, it is the source for both (no investing = $0).
    savingsContribution: hasAllocations
      ? Math.round(spending.savingsTransfer)
      : baseProfile.savingsContribution,

    investments: hasAllocations
      ? { ...baseProfile.investments, monthlyContribution: Math.round(spending.investing) }
      : baseProfile.investments,

    location: city
      ? { city, colIndex: colIndex ?? baseProfile.location.colIndex }
      : baseProfile.location,

    discretionary:
      spending.discretionary || baseProfile.discretionary,

    purchases: allTransactions.length
      ? everyday
      : baseProfile.purchases,

    bills: bills.some((bill) => bill.due)
      ? bills.filter((bill) => bill.due && bill.status !== 'cancelled' && bill.status !== 'completed')
      : baseProfile.bills,

    liveFields,
    demoFields,
    loadedAt: new Date().toISOString()
  };
}

// Detect recurring monthly subscriptions.
export function detectSubscriptions(purchases) {
  const groups = {};

  purchases.forEach((purchase) => {
    const key = (purchase.description || '').toLowerCase().trim();

    if (!key) return;

    // Steady monthly bills (insurance, utilities, phone...) are not subscriptions you can cancel.
    if (categoryOf(purchase) !== 'discretionary') return;

    (groups[key] ||= []).push(purchase);
  });

  const subscriptions = [];

  Object.values(groups).forEach((list) => {
    if (list.length < 2) return;

    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.purchase_date) - new Date(b.purchase_date)
    );

    const amounts = sorted.map((purchase) => purchase.amount);

    const average =
      amounts.reduce((sum, amount) => sum + amount, 0) /
      amounts.length;

    const steady = amounts.every(
      (amount) =>
        average > 0 &&
        Math.abs(amount - average) / average < 0.05
    );

    const gaps = sorted.slice(1).map(
      (purchase, index) =>
        (new Date(purchase.purchase_date) -
          new Date(sorted[index].purchase_date)) /
        86400000
    );

    const monthly =
      gaps.length > 0 &&
      gaps.every((gap) => gap >= 25 && gap <= 35);

    if (steady && monthly) {
      subscriptions.push({
        name: sorted[0].description,
        monthly: average,
        count: sorted.length,
        lastDate: sorted[sorted.length - 1].purchase_date
      });
    }
  });

  return subscriptions.sort((a, b) => b.monthly - a.monthly);
}

// Detect unusually large purchases.
export function detectAnomalies(purchases) {
  if (purchases.length < 8) return [];

  const amounts = purchases.map((purchase) => purchase.amount);

  const mean =
    amounts.reduce((sum, amount) => sum + amount, 0) /
    amounts.length;

  const standardDeviation = Math.sqrt(
    amounts.reduce(
      (sum, amount) => sum + (amount - mean) ** 2,
      0
    ) / amounts.length
  );

  return purchases
    .filter(
      (purchase) =>
        purchase.amount > mean + 2.5 * standardDeviation
    )
    .sort((a, b) => b.amount - a.amount);
}

// Calculate total spending by transaction description.
export function spendingByMerchant(purchases, top = 5) {
  const totals = {};

  purchases.forEach((purchase) => {
    const name = purchase.description || 'Unknown';

    totals[name] =
      (totals[name] || 0) + (Number(purchase.amount) || 0);
  });

  return Object.entries(totals)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, top);
}