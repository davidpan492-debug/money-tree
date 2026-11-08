// Demo profiles shaped like what we get from Nessie, plus the fields Nessie doesn't provide
// (housing, vehicle, location, income stability). Used until a Nessie key is connected.
// Two personas so the Toyota recommendation visibly changes between customers.

const iso = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

function buildPurchases({ subs, grocery, dining, oneOff }) {
  const purchases = [];
  [8, 38, 68].forEach((ago, m) => {
    subs.forEach(([d, amount], i) => purchases.push({ description: d, amount, purchase_date: iso(-(ago + i)) }));
    grocery.items.forEach((a, i) => purchases.push({ description: grocery.name, amount: a + m * 3, purchase_date: iso(-(ago + 2 + i * 6)) }));
    dining.items.forEach((a, i) => purchases.push({ description: dining.names[i], amount: +(a + m * 9.35 + i * 3.1).toFixed(2), purchase_date: iso(-(ago + 4 + i * 5)) }));
  });
  if (oneOff) purchases.push({ description: oneOff[0], amount: oneOff[1], purchase_date: iso(-11) });
  return purchases;
}

// ---- Persona 1: Alex, tight monthly budget, older SUV with a pricey loan -> relief-focused answer.
export const demoProfile = {
  id: 'alex',
  persona: 'Alex: tight budget, high-APR SUV loan',
  name: 'Alex Rivera',
  location: { city: 'Dallas, TX', colIndex: 102 },
  householdSize: 1,
  netIncome: 5400,
  incomeStability: 0.9,
  checking: 3200,
  savings: 9800,
  savingsContribution: 300,
  discretionary: 1100,
  essentials: { housing: 1650, utilities: 220, groceries: 480, phone: 140 },
  investments: { balance: 42000, monthlyContribution: 450 },
  debts: [
    { id: 'visa', name: 'Visa Rewards', balance: 4200, apr: 24.9, limit: 9000, minPayment: 120, type: 'card' },
    { id: 'student', name: 'Student loan', balance: 11000, apr: 5.5, minPayment: 180, type: 'loan' }
  ],
  vehicle: {
    name: '2021 Toyota RAV4 XLE', value: 23500, loanBalance: 19800, apr: 7.9, ageYears: 5,
    payment: 512, monthsLeft: 46, insurance: 165, fuel: 190, maintenance: 60
  },
  extraDebtPayment: 0,
  bills: [
    { payee: 'Landlord', amount: 1650, due: iso(3) },
    { payee: 'Toyota Financial', amount: 512, due: iso(6) },
    { payee: 'Atmos Energy', amount: 95, due: iso(9) },
    { payee: 'Visa', amount: 120, due: iso(12) },
    { payee: 'Auto insurance', amount: 165, due: iso(13) },
    { payee: 'Vehicle registration', amount: 380, due: iso(14) }
  ],
  purchases: buildPurchases({
    subs: [['Netflix', 15.49], ['Spotify', 11.99], ['Gym membership', 45], ['Adobe Creative Cloud', 22.99], ['Hulu', 17.99], ['iCloud', 2.99]],
    grocery: { name: 'HEB Grocery', items: [62.4, 88.15, 71.9, 94.3] },
    dining: { names: ["Torchy's Tacos", 'Uber Eats', 'Starbucks'], items: [38.2, 54.7, 29.9] },
    oneOff: ['Best Buy', 899]
  })
};

// ---- Persona 2: Jordan, healthy cash flow, cheap loan on a Camry with equity -> different answer.
export const jordanProfile = {
  id: 'jordan',
  persona: 'Jordan: strong cash flow, low-rate Camry loan',
  name: 'Jordan Lee',
  location: { city: 'Plano, TX', colIndex: 100 },
  householdSize: 2,
  netIncome: 8200,
  incomeStability: 0.95,
  checking: 6800,
  savings: 28000,
  savingsContribution: 600,
  discretionary: 1300,
  essentials: { housing: 1900, utilities: 240, groceries: 560, phone: 120 },
  investments: { balance: 95000, monthlyContribution: 1000 },
  debts: [
    { id: 'amex', name: 'Amex Blue', balance: 1200, apr: 21.9, limit: 15000, minPayment: 40, type: 'card' }
  ],
  vehicle: {
    name: '2020 Toyota Camry SE', value: 21500, loanBalance: 7400, apr: 3.9, ageYears: 6,
    payment: 485, monthsLeft: 17, insurance: 150, fuel: 150, maintenance: 55
  },
  extraDebtPayment: 0,
  bills: [
    { payee: 'Landlord', amount: 1900, due: iso(2) },
    { payee: 'Toyota Financial', amount: 485, due: iso(7) },
    { payee: 'Oncor Electric', amount: 110, due: iso(10) },
    { payee: 'Amex', amount: 40, due: iso(12) },
    { payee: 'Auto insurance', amount: 150, due: iso(13) }
  ],
  purchases: buildPurchases({
    subs: [['Netflix', 15.49], ['Spotify', 11.99], ['Peloton App', 24], ['YouTube Premium', 13.99]],
    grocery: { name: 'Central Market', items: [96.4, 112.15, 88.9, 104.3] },
    dining: { names: ['Pappadeaux', 'DoorDash', 'Starbucks'], items: [64.2, 48.7, 22.9] },
    oneOff: ['Apple Store', 1299]
  })
};

export const personas = { alex: demoProfile, jordan: jordanProfile };
