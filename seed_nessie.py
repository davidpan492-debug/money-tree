"""
Seed three demo customers into Capital One Nessie with enough history that MoneyTree can read
(almost) everything live: ~5 months of paychecks (income + income stability), rent / groceries /
utilities / phone / insurance / fuel / car payment (essentials), subscriptions + dining + shopping
(discretionary + insights), monthly transfers to savings and investing, a credit card account,
upcoming bills, and an address.

Usage:
  python seed_nessie.py --dry-run     # print the plan + monthly summary, no network, no key needed
  python seed_nessie.py               # seed (uses the built-in demo key, or NESSIE_API_KEY if set)
  python seed_nessie.py --clean       # first delete rows this script tagged earlier, then re-seed

Safe to re-run: rows are matched on (description, date) so nothing is created twice.
"""
import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

BASE_URL = "https://prod-api.nessieisreal.com"
# Hackathon demo key so judges can run this without setup. An NESSIE_API_KEY environment variable overrides it.
DEFAULT_API_KEY = "7ab6cffeaf4b5244b47e55cdbea4d30f"
TAG = "[HACKUTD-SEED]"   # nessie.js strips this from descriptions before showing them
MONTHS = 5               # months of history (the newest, partial month is ignored for averages)
TODAY_D = date.today()
TODAY = TODAY_D.isoformat()

# --------------------------------------------------------------------------- customer definitions
# (description, day-of-month, amount). Descriptions are written so nessie.js's keyword
# categoriser files them correctly (rent->housing, grocery, electric/water/internet->utilities,
# wireless->phone, insurance, fuel, car payment). Everything else counts as discretionary.
CUSTOMERS = [
    {
        "first_name": "Alex", "last_name": "Johnson", "street_number": "100",
        "income": 8500, "income_wobble": [1, 1, 1, 1, 1],
        "savings": 25000, "checking_target": 4200,
        "card": {"nickname": "Visa Rewards", "balance": 900},
        "fixed": [
            ("Rent", 1, 2200), ("Oncor Electric", 12, 140), ("Spectrum Internet", 14, 70),
            ("Dallas Water Utilities", 20, 40), ("Verizon Wireless", 18, 95),
            ("State Farm Auto Insurance", 8, 180), ("Car payment - Toyota Financial", 5, 512),
            ("Student loan payment - Nelnet", 7, 180),
        ],
        "groceries": ("HEB Grocery", 900), "fuel": ("Shell Fuel", 250),
        "dining": [("Torchy's Tacos", 5, 48), ("Uber Eats", 13, 62), ("Starbucks Coffee", 21, 24)],
        "shopping": [("Target", 16, 140), ("Amazon", 22, 95)],
        "subs": [("Netflix", 9, 15.49), ("Spotify", 11, 11.99), ("Gym membership", 3, 45),
                 ("Adobe Creative Cloud", 25, 22.99)],
        "car_payment": None, "savings_transfer": 700, "invest": 600,
        "one_off": ("Best Buy", 899, 11),
        "bills": [("Landlord", 2200, 3), ("Toyota Financial", 512, 6), ("Nelnet Student Loan", 180, 8),
                  ("Oncor Electric", 140, 9), ("State Farm", 180, 13), ("Verizon", 95, 17)],
        "credit_score": 740,
        # amount = outstanding balance. Nessie has no vehicle-value/APR fields, so the car's name, year and
        # estimated value ride in the description ("(est. value $X)") and nessie.js parses them.
        "loans": [("auto", "2021 Toyota RAV4 XLE (est. value $23,500)", 19800, 512),
                  ("student", "Student loan - Nelnet", 11000, 180)],
    },
    {
        "first_name": "Sarah", "last_name": "Miller", "street_number": "200",
        "income": 9000, "income_wobble": [1, 1, 1.03, 1, 1],
        "savings": 2000, "checking_target": 1800,
        "card": {"nickname": "Chase Sapphire", "balance": 6400},
        "fixed": [
            ("Rent", 1, 2800), ("Oncor Electric", 12, 160), ("Spectrum Internet", 14, 80),
            ("Dallas Water Utilities", 20, 60), ("Verizon Wireless", 18, 120),
            ("State Farm Auto Insurance", 8, 350), ("Car payment - Toyota Financial", 5, 850),
        ],
        "groceries": ("Central Market Grocery", 1200), "fuel": ("Chevron Fuel", 300),
        "dining": [("Pappadeaux", 5, 360), ("DoorDash", 13, 340), ("Starbucks Coffee", 21, 300)],
        "shopping": [("Nordstrom", 10, 900), ("Amazon", 22, 500)],
        "subs": [("Netflix", 9, 15.49), ("Hulu", 17, 17.99), ("Peloton App", 12, 44),
                 ("Gym membership", 3, 120), ("Spotify", 11, 11.99)],
        "car_payment": None, "savings_transfer": 100, "invest": 0,
        "one_off": ("Apple Store", 1299, 9),
        "bills": [("Landlord", 2800, 2), ("Toyota Financial", 850, 4), ("Verizon", 120, 10),
                  ("State Farm", 350, 12), ("Chase Card", 140, 15)],
        "credit_score": 690,
        "loans": [("auto", "2022 Toyota Camry SE (est. value $26,500)", 31000, 850)],
    },
    {
        "first_name": "Michael", "last_name": "Chen", "street_number": "300",
        "income": 4000, "income_wobble": [1.0, 0.82, 1.15, 0.9, 1.05],   # gig income -> lower stability
        "savings": 18000, "checking_target": 2600,
        "card": {"nickname": "Discover It", "balance": 350},
        "fixed": [
            ("Rent", 1, 1100), ("Oncor Electric", 12, 90), ("Spectrum Internet", 14, 60),
            ("Dallas Water Utilities", 20, 50), ("Verizon Wireless", 18, 55),
            ("State Farm Auto Insurance", 8, 150), ("Car payment - Toyota Financial", 5, 280),
            ("Student loan payment - Nelnet", 7, 120),
        ],
        "groceries": ("Aldi Grocery", 550), "fuel": ("Shell Fuel", 150),
        "dining": [("Chipotle", 7, 45), ("Whataburger", 16, 30), ("Starbucks Coffee", 24, 25)],
        "shopping": [("Amazon", 17, 120)],
        "subs": [("Netflix", 9, 15.49), ("Spotify", 11, 11.99)],
        "car_payment": None, "savings_transfer": 300, "invest": 150,
        "one_off": None,
        "bills": [("Landlord", 1100, 5), ("Toyota Financial", 280, 6), ("Nelnet Student Loan", 120, 8),
                  ("State Farm", 150, 9), ("Verizon", 55, 11)],
        "credit_score": 710,
        "loans": [("auto", "2018 Toyota Corolla LE (est. value $14,500)", 6200, 280),
                  ("student", "Student loan - Nelnet", 9000, 120)],
    },
]


# --------------------------------------------------------------------------- plan (pure, no network)
def month_start(months_back):
    y, m = TODAY_D.year, TODAY_D.month - months_back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def on(months_back, day):
    """The date `day` of the month `months_back` ago, or None if it is still in the future."""
    d = month_start(months_back).replace(day=min(day, 28))
    return d if d <= TODAY_D else None


def build_plan(p):
    deposits, withdrawals = [], []

    def w(d, desc, amount):
        if d and amount:
            withdrawals.append((d, desc, round(amount, 2)))

    for m in range(MONTHS - 1, -1, -1):  # oldest month first
        net = p["income"] * p["income_wobble"][m % len(p["income_wobble"])]
        for day in (1, 15):               # semi-monthly paychecks (matches the app's cash calendar)
            d = on(m, day)
            if d:
                deposits.append((d, "Paycheck", round(net / 2, 2)))

        for desc, day, amt in p["fixed"]:
            w(on(m, day), desc, amt)

        name, total = p["groceries"]
        for i, day in enumerate((3, 10, 17, 24)):
            w(on(m, day), name, total / 4 * (0.92 + 0.05 * ((i + m) % 3)))
        name, total = p["fuel"]
        for i, day in enumerate((6, 15, 25)):
            w(on(m, day), name, total / 3 * (0.94 + 0.04 * ((i + m) % 3)))

        for i, (desc, day, amt) in enumerate(p["dining"] + p["shopping"]):
            w(on(m, day), desc, amt * (0.9 + 0.07 * ((i + m) % 3)))
        for desc, day, amt in p["subs"]:           # steady amounts, same day each month
            w(on(m, day), desc, amt)

        if p["savings_transfer"]:
            w(on(m, 2), "Transfer to savings", p["savings_transfer"])
        if p["invest"]:
            w(on(m, 2), "Investment contribution", p["invest"])

    if p["one_off"]:
        desc, amt, days_ago = p["one_off"]
        w(TODAY_D - timedelta(days=days_ago), desc, amt)

    bills = [(payee, amt, (TODAY_D + timedelta(days=offset)).isoformat()) for payee, amt, offset in p["bills"]]
    return deposits, withdrawals, bills


def summarize(p, deposits, withdrawals):
    months = {}
    for d, _, a in withdrawals:
        months.setdefault(d.strftime("%Y-%m"), 0)
        months[d.strftime("%Y-%m")] += a
    inc = {}
    for d, _, a in deposits:
        inc.setdefault(d.strftime("%Y-%m"), 0)
        inc[d.strftime("%Y-%m")] += a
    keys = sorted(months)[:-1] or sorted(months)   # skip the partial newest month
    avg_out = sum(months[k] for k in keys) / len(keys)
    avg_in = sum(inc[k] for k in keys) / len(keys)
    return avg_in, avg_out


# --------------------------------------------------------------------------- Nessie API
def make_api(api_key):
    import certifi
    context = ssl.create_default_context(cafile=certifi.where())

    def request(method, endpoint, payload=None):
        url = BASE_URL + endpoint + "?" + urllib.parse.urlencode({"key": api_key})
        data, headers = None, {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20, context=context) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"Nessie error {error.code} on {method} {endpoint}: {error.read().decode('utf-8')}")

    return request


def get_id(result):
    created = result.get("objectCreated", result)
    object_id = created.get("_id")
    if not object_id:
        raise RuntimeError(f"Could not find created ID: {result}")
    return object_id


def seed(api, clean):
    def get(endpoint):
        return api("GET", endpoint)

    def post(endpoint, payload):
        return api("POST", endpoint, payload)

    def as_list(x):
        return x if isinstance(x, list) else []

    for p in CUSTOMERS:
        name = f"{p['first_name']} {p['last_name']}"
        print(f"\nProcessing {name}...")
        deposits, withdrawals, bills = build_plan(p)

        # --- customer (with address, which MoneyTree reads for location)
        customer = next((c for c in as_list(get("/customers"))
                         if c.get("first_name", "").lower() == p["first_name"].lower()
                         and c.get("last_name", "").lower() == p["last_name"].lower()), None)
        if customer:
            customer_id = customer["_id"]
            print("  Using existing customer:", customer_id)
        else:
            customer_id = get_id(post("/customers", {
                "first_name": p["first_name"], "last_name": p["last_name"],
                "address": {"street_number": p["street_number"], "street_name": "Main St",
                            "city": "Dallas", "state": "TX", "zip": "75201"},
            }))
            print("  Customer created:", customer_id)

        accounts = as_list(get(f"/customers/{customer_id}/accounts"))

        def find_account(account_type):
            return next((a for a in accounts if a.get("type", "").lower() == account_type.lower()), None)

        # --- checking: start balance chosen so it should END near checking_target once the
        #     seeded deposits/withdrawals are applied (only used when the account is created now).
        net_flow = sum(a for _, _, a in deposits) - sum(a for _, _, a in withdrawals)
        checking = find_account("Checking")
        if checking:
            checking_id = checking["_id"]
            print("  Using existing checking account:", checking_id)
        else:
            start = max(0, round(p["checking_target"] - net_flow, 2))
            checking_id = get_id(post(f"/customers/{customer_id}/accounts", {
                "type": "Checking", "nickname": "Primary Checking", "rewards": 0, "balance": start}))
            print(f"  Checking created (starting balance ${start:,.0f})")

        savings = find_account("Savings")
        if savings:
            print("  Using existing savings account:", savings["_id"])
        else:
            post(f"/customers/{customer_id}/accounts", {
                "type": "Savings", "nickname": "Emergency Savings", "rewards": 0, "balance": p["savings"]})
            print("  Savings created")

        if p["card"]:
            if find_account("Credit Card"):
                print("  Using existing credit card account")
            else:
                post(f"/customers/{customer_id}/accounts", {
                    "type": "Credit Card", "nickname": p["card"]["nickname"], "rewards": 0,
                    "balance": p["card"]["balance"]})
                print(f"  Credit card created (balance ${p['card']['balance']:,})")

        # --- optional cleanup of rows this script created before
        if clean:
            removed = 0
            for ttype in ("deposits", "withdrawals"):
                for t in as_list(get(f"/accounts/{checking_id}/{ttype}")):
                    if TAG in (t.get("description") or ""):
                        api("DELETE", f"/{ttype}/{t['_id']}")
                        removed += 1
            for b in as_list(get(f"/accounts/{checking_id}/bills")):
                if TAG in (b.get("nickname") or ""):
                    api("DELETE", f"/bills/{b['_id']}")
                    removed += 1
            for l in as_list(get(f"/accounts/{checking_id}/loans")):
                if TAG in (l.get("description") or ""):
                    api("DELETE", f"/loans/{l['_id']}")
                    removed += 1
            print(f"  Cleaned {removed} earlier seeded rows")

        # --- deposits + withdrawals (matched on description + date so re-runs add nothing twice)
        def create_all(ttype, rows):
            existing = {(t.get("description"), str(t.get("transaction_date", ""))[:10])
                        for t in as_list(get(f"/accounts/{checking_id}/{ttype}"))}
            created = 0
            for d, desc, amount in rows:
                description = f"{desc} {TAG}"
                if (description, d.isoformat()) in existing:
                    continue
                post(f"/accounts/{checking_id}/{ttype}", {
                    "medium": "balance", "transaction_date": d.isoformat(), "amount": amount,
                    "description": description, "status": "completed"})
                created += 1
            print(f"  {ttype}: {created} created, {len(rows) - created} already there")

        create_all("deposits", deposits)
        create_all("withdrawals", withdrawals)

        # --- upcoming bills
        existing_bills = {(b.get("payee"), str(b.get("payment_date") or b.get("upcoming_payment_date") or "")[:10])
                          for b in as_list(get(f"/accounts/{checking_id}/bills"))}
        made = 0
        for payee, amount, due in bills:
            if (payee, due) in existing_bills:
                continue
            post(f"/accounts/{checking_id}/bills", {
                # Nessie rejects creation_date / upcoming_payment_date on create; it works those out itself.
                "status": "pending", "payee": payee, "nickname": f"{payee} {TAG}",
                "payment_date": due, "recurring_date": int(due[8:10]), "payment_amount": amount})
            made += 1
        print(f"  bills: {made} created")

        # --- loans (amount = outstanding balance). The loan `type` enum is not documented, so each kind
        #     tries a few likely values; nessie.js tells student vs auto apart using the description too.
        TYPE_TRIES = {"auto": ["auto", "personal"], "student": ["student", "personal", "small business", "auto"]}
        existing_loans = {l.get("description") for l in as_list(get(f"/accounts/{checking_id}/loans"))}
        for kind, desc, amount, payment in p["loans"]:
            description = f"{desc} {TAG}"
            if description in existing_loans:
                print(f"  loan already there: {desc}")
                continue
            last_error = None
            for loan_type in TYPE_TRIES.get(kind, [kind]):
                try:
                    post(f"/accounts/{checking_id}/loans", {
                        "type": loan_type, "status": "approved", "credit_score": p["credit_score"],
                        "monthly_payment": payment, "amount": amount, "description": description})
                    print(f"  loan created: {desc} (type '{loan_type}')")
                    last_error = None
                    break
                except RuntimeError as error:
                    last_error = error
            if last_error:
                raise last_error
        print(f"  {name} completed!")

    print("\n================================")
    print("ALL THREE CUSTOMERS PROCESSED!")
    print("================================")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="print the plan, no network")
    parser.add_argument("--clean", action="store_true", help="delete earlier seeded rows first")
    args = parser.parse_args()

    if args.dry_run:
        out = {}
        for p in CUSTOMERS:
            deposits, withdrawals, bills = build_plan(p)
            avg_in, avg_out = summarize(p, deposits, withdrawals)
            print(f"{p['first_name']} {p['last_name']}: {len(deposits)} deposits, {len(withdrawals)} withdrawals, "
                  f"{len(bills)} bills | avg in ${avg_in:,.0f}/mo, avg out ${avg_out:,.0f}/mo, "
                  f"leftover ${avg_in - avg_out:,.0f}/mo")
            out[p["first_name"]] = {
                "deposits": [{"transaction_date": d.isoformat(), "description": f"{n} {TAG}", "amount": a} for d, n, a in deposits],
                "withdrawals": [{"transaction_date": d.isoformat(), "description": f"{n} {TAG}", "amount": a} for d, n, a in withdrawals],
                "bills": [{"payee": pa, "payment_amount": a, "upcoming_payment_date": du} for pa, a, du in bills],
                "loans": [{"type": t, "description": f"{d} {TAG}", "amount": a, "monthly_payment": mp, "status": "approved"}
                          for t, d, a, mp in p["loans"]],
            }
        if os.environ.get("DUMP_PLAN"):
            json.dump(out, open(os.environ["DUMP_PLAN"], "w"))
        return

    api_key = os.environ.get("NESSIE_API_KEY") or DEFAULT_API_KEY
    seed(make_api(api_key), args.clean)


if __name__ == "__main__":
    main()