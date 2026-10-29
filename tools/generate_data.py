#!/usr/bin/env python3
"""Deterministic synthetic marketing attribution dataset generator.

Usage:
  python tools/generate_data.py --scale starter --out data/starter
  python tools/generate_data.py --scale full --out data/full
  python tools/generate_data.py --contacts 500 --campaigns 20 --touchpoints 2000 --opportunities 100 --out data/custom

All data is synthetic. Ground truth is exported separately and must not be used as model input.
"""
from __future__ import annotations
import argparse, csv, hashlib, json, random
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 20261022
BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
CURRENCIES = ["INR", "USD", "EUR"]
CHANNELS = [
    ("CH-EMAIL", "Email", "OWNED"), ("CH-PAID-SEARCH", "Paid Search", "PAID"),
    ("CH-SOCIAL", "Social Media", "PAID"), ("CH-ORGANIC", "Organic Search", "EARNED"),
    ("CH-DIRECT", "Direct", "OWNED"), ("CH-OFFLINE", "Offline Sales", "OFFLINE"),
    ("CH-REFERRAL", "Referral", "EARNED"), ("CH-DISPLAY", "Display Ads", "PAID")]


def stamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

def code(prefix: str, n: int, width: int = 6) -> str:
    return f"{prefix}{n:0{width}d}"

def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader(); writer.writerows(rows)

def generate(args):
    rng = random.Random(args.seed)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    n_campaigns, n_contacts, n_touches, n_opps = args.campaigns, args.contacts, args.touchpoints, args.opportunities
    # 1. Master data first.
    channels = [{"channel_id": x[0], "name": x[1], "channel_type": x[2]} for x in CHANNELS]
    audiences = [{"audience_id": code("AUD-", i, 4), "name": name, "description": desc}
                 for i, (name, desc) in enumerate([("New Prospects", "No previous purchase"), ("Returning Visitors", "Previously visited website"), ("Small Business", "Small business audience"), ("Enterprise", "Enterprise decision makers"), ("Existing Customers", "Existing customers")], 1)]
    creatives = [{"creative_id": code("CRT-", i, 5), "name": f"Creative {i:02d}", "format": fmt, "status": "ACTIVE"}
                 for i, fmt in enumerate(["IMAGE", "VIDEO", "TEXT", "EMAIL", "LANDING_PAGE", "CALL_SCRIPT", "OTHER", "IMAGE", "VIDEO", "TEXT"], 1)]
    contacts = []
    for i in range(1, n_contacts + 1):
        contacts.append({"contact_id": code("CON-", i), "synthetic_external_id": code("EXT-", i),
                         "created_at": stamp(BASE + timedelta(days=rng.randint(0, 240))),
                         "lifecycle_status": rng.choices(["PROSPECT", "LEAD", "CUSTOMER", "INACTIVE"], [55, 20, 20, 5])[0],
                         "is_anonymous": "false"})
    campaigns = []
    for i in range(1, n_campaigns + 1):
        start = BASE + timedelta(days=rng.randint(0, 180))
        end = start + timedelta(days=rng.randint(14, 120))
        ch = rng.choice(channels)
        campaigns.append({"campaign_id": f"CMP-2026-{i:06d}", "name": f"{ch['name']} Campaign {i:04d}",
                          "channel_id": ch["channel_id"], "start_at": stamp(start), "end_at": stamp(end),
                          "budget_amount": f"{rng.randint(5000, 250000):.2f}", "budget_currency": "INR",
                          "status": rng.choices(["ACTIVE", "COMPLETED", "PAUSED"], [35, 55, 10])[0]})
    # Bridge relationships: effective-dated many-to-many links.
    campaign_creatives = []
    campaign_audiences = []
    for c in campaigns:
        for cr in rng.sample(creatives, k=rng.randint(1, min(3, len(creatives)))):
            campaign_creatives.append({"campaign_id": c["campaign_id"], "creative_id": cr["creative_id"], "effective_from": c["start_at"], "effective_to": c["end_at"]})
        for au in rng.sample(audiences, k=rng.randint(1, min(2, len(audiences)))):
            campaign_audiences.append({"campaign_id": c["campaign_id"], "audience_id": au["audience_id"], "effective_from": c["start_at"], "effective_to": c["end_at"]})
    campaign_by_id = {x["campaign_id"]: x for x in campaigns}
    contact_by_id = {x["contact_id"]: x for x in contacts}
    channel_by_id = {x["channel_id"]: x for x in channels}
    creative_by_id = {x["creative_id"]: x for x in creatives}

    # 2. Dependent events. First create conversion anchors for opportunities/orders, then touches.
    leads, opportunities, orders = [], [], []
    n_leads = max(n_opps, int(n_contacts * 0.22))
    lead_contact_ids = [rng.choice(contacts)["contact_id"] for _ in range(n_leads)] if contacts else []
    lead_by_id = {}
    for i in range(1, n_leads + 1):
        contact_id = lead_contact_ids[i-1]
        created = BASE + timedelta(days=rng.randint(5, 330))
        sess_num = i if i <= max(n_opps, 1) else rng.randint(1, max(n_opps, 1))
        lead = {"lead_id": f"LEAD-2026-{i:06d}", "contact_id": contact_id,
                "session_id": f"SES-2026-{sess_num:06d}" if n_opps else "",
                "created_at": stamp(created), "status": rng.choices(["NEW", "QUALIFIED", "DISQUALIFIED", "CONVERTED"], [20, 35, 10, 35])[0],
                "source_campaign_id": rng.choice(campaigns)["campaign_id"] if campaigns else "", "synthetic_external_id": f"LEAD-EXT-{i:06d}"}
        leads.append(lead); lead_by_id[lead["lead_id"]] = lead
    opportunity_contact_ids = []
    for i in range(1, n_opps + 1):
        lead = leads[(i - 1) % len(leads)] if leads else None
        contact_id = lead["contact_id"] if lead else ""
        created = BASE + timedelta(days=rng.randint(20, 320))
        stage = rng.choices(["OPEN", "QUALIFICATION", "PROPOSAL", "WON", "LOST"], [15, 15, 15, 40, 15])[0]
        closed = created + timedelta(days=rng.randint(2, 90)) if stage in ("WON", "LOST") else None
        opp = {"opportunity_id": f"OPP-2026-{i:06d}", "lead_id": lead["lead_id"] if lead else "", "contact_id": contact_id,
               "created_at": stamp(created), "closed_at": stamp(closed) if closed else "", "stage": stage,
               "expected_amount": f"{rng.randint(10000, 500000):.2f}", "currency": "INR"}
        opportunities.append(opp); opportunity_contact_ids.append(contact_id)
        if stage == "WON":
            revenue = round(rng.uniform(8000, 350000), 2)
            orders.append({"order_id": f"ORD-2026-{len(orders)+1:06d}", "opportunity_id": opp["opportunity_id"], "contact_id": contact_id,
                           "ordered_at": stamp(closed), "status": "PAID", "revenue_amount": f"{revenue:.2f}", "currency": "INR",
                           "revenue_event_key": f"REV-EVENT-{len(orders)+1:06d}", "issue_type": ""})

    # Create sessions for each lead session reference; more sessions can be anonymous.
    sessions = []
    session_count = max(n_opps, int(n_contacts * 0.35), 1)
    for i in range(1, session_count + 1):
        start = BASE + timedelta(days=rng.randint(0, 350), minutes=rng.randint(0, 1439))
        is_anon = rng.random() < 0.12
        contact_id = "" if is_anon else rng.choice(contacts)["contact_id"]
        sessions.append({"session_id": f"SES-2026-{i:06d}", "contact_id": contact_id, "started_at": stamp(start),
                         "ended_at": stamp(start + timedelta(minutes=rng.randint(1, 90))),
                         "anonymous_id": code("ANON-", i) if is_anon else "", "landing_url": f"https://example.test/page/{rng.randint(1, 40)}",
                         "source_system": "SYNTHETIC", "identity_evidence": "NONE" if is_anon else rng.choice(["FIRST_PARTY_COOKIE", "FORM_SUBMISSION", "AUTHENTICATED"]), "issue_type": ""})
    # Ensure every lead session reference exists (for small custom sizes too).
    valid_session_codes = {s["session_id"] for s in sessions}
    for lead in leads:
        if lead["session_id"] and lead["session_id"] not in valid_session_codes:
            lead["session_id"] = ""

    # Generate valid touchpoints with timestamps; one contact may have multiple campaigns.
    touchpoints = []
    for i in range(1, n_touches + 1):
        contact = rng.choice(contacts) if contacts else None
        campaign = rng.choice(campaigns) if campaigns else None
        channel = channel_by_id[campaign["channel_id"]] if campaign else rng.choice(channels)
        event_time = BASE + timedelta(days=rng.randint(0, 360), minutes=rng.randint(0, 1439))
        is_offline = channel["channel_type"] == "OFFLINE"
        touchpoints.append({"touchpoint_id": f"TOUCH-{contact['contact_id'] if contact else 'UNKNOWN'}-{i:06d}",
                            "contact_id": contact["contact_id"] if contact else "", "campaign_id": campaign["campaign_id"] if campaign else "",
                            "channel_id": channel["channel_id"], "creative_id": rng.choice(creatives)["creative_id"] if creatives else "",
                            "occurred_at": stamp(event_time), "touch_type": "CALL" if is_offline else rng.choice(["IMPRESSION", "CLICK", "EMAIL_OPEN", "EMAIL_CLICK", "FORM_SUBMIT", "OTHER"]),
                            "source_system": "SYNTHETIC", "is_offline": str(is_offline).lower(),
                            "identity_evidence": rng.choice(["AUTHENTICATED", "FORM_SUBMISSION", "FIRST_PARTY_COOKIE", "CRM_MATCH"]), "issue_type": ""})

    # Cost records derive from campaign budgets with realistic under/over-budget variation.
    costs = []
    for i, c in enumerate(campaigns, 1):
        if rng.random() < 0.04:  # deliberately omitted campaign cost edge case
            continue
        budget = float(c["budget_amount"])
        amount = round(budget * rng.uniform(0.55, 1.15), 2)
        costs.append({"cost_record_id": f"COST-2026-{len(costs)+1:06d}", "campaign_id": c["campaign_id"],
                      "incurred_at": c["end_at"], "amount": f"{amount:.2f}", "currency": "INR",
                      "cost_type": rng.choice(["MEDIA", "PRODUCTION", "AGENCY", "TOOLS"]), "source_reference": f"SYNTH-COST-{i:06d}", "issue_type": ""})

    # 3. Explicitly inject five labelled anomalies without corrupting unrelated records.
    ground_truth = []
    def label(issue_type, entity_type, entity_id, expected, details):
        ground_truth.append({"ground_truth_id": f"GT-{len(ground_truth)+1:05d}", "issue_type": issue_type,
                             "entity_type": entity_type, "entity_id": entity_id, "expected_decision": expected,
                             "details": json.dumps(details, sort_keys=True)})
    if orders:
        dup = dict(orders[0]); dup["order_id"] = f"ORD-2026-{len(orders)+1:06d}"; dup["issue_type"] = "DUPLICATE_REVENUE"
        # Keep same revenue_event_key to make duplication discoverable; export can contain the deliberate duplicate key.
        orders.append(dup); label("DUPLICATE_REVENUE", "Order", dup["order_id"], "COUNT_REVENUE_ONCE", {"duplicate_of": orders[0]["order_id"], "revenue_event_key": dup["revenue_event_key"]})
    if touchpoints:
        # Pick a touchpoint and move it beyond a known paid order's conversion date where possible.
        paid_orders = [o for o in orders if o["status"] == "PAID"]
        if paid_orders:
            t = touchpoints[-1]; o = paid_orders[0]
            t["contact_id"] = o["contact_id"]; t["occurred_at"] = stamp(datetime.fromisoformat(o["ordered_at"].replace("Z", "+00:00")) + timedelta(days=3)); t["issue_type"] = "POST_CONVERSION_TOUCH"
            label("POST_CONVERSION_TOUCH", "Touchpoint", t["touchpoint_id"], "EXCLUDE_FROM_ATTRIBUTION", {"conversion_order_id": o["order_id"], "touchpoint_at": t["occurred_at"], "conversion_at": o["ordered_at"]})
    if costs:
        c = dict(costs[0]); c["cost_record_id"] = f"COST-2026-{len(costs)+1:06d}"; c["currency"] = "USD"; c["issue_type"] = "CURRENCY_MISMATCH"
        costs.append(c); label("CURRENCY_MISMATCH", "CostRecord", c["cost_record_id"], "CONVERT_OR_QUARANTINE", {"campaign_id": c["campaign_id"], "currency": "USD", "reporting_currency": "INR"})
    # Missing cost case is represented by a campaign with no cost rows; if all happened to have costs, remove one deterministically.
    cost_campaigns = {c["campaign_id"] for c in costs if c["issue_type"] != "CURRENCY_MISMATCH"}
    missing_candidates = [c for c in campaigns if c["campaign_id"] not in cost_campaigns]
    if not missing_candidates and campaigns:
        target = campaigns[-1]["campaign_id"]
        costs = [c for c in costs if c["campaign_id"] != target]
        missing_candidates = [campaign_by_id[target]]
    if missing_candidates:
        c = missing_candidates[0]; label("MISSING_CAMPAIGN_COST", "Campaign", c["campaign_id"], "ROI_UNAVAILABLE", {"campaign_id": c["campaign_id"]})
    anon_sessions = [s for s in sessions if not s["contact_id"]]
    if anon_sessions:
        s = anon_sessions[0]; s["contact_id"] = rng.choice(contacts)["contact_id"]; s["identity_evidence"] = "NONE"; s["issue_type"] = "UNSUPPORTED_IDENTITY_LINK"
        label("UNSUPPORTED_IDENTITY_LINK", "WebSession", s["session_id"], "REJECT_OR_QUARANTINE_LINK", {"identity_evidence": "NONE", "contact_id": s["contact_id"]})

    # Attribution results are derived from eligible touchpoints and paid orders, not random labels.
    attribution = []
    touch_by_contact = {}
    for t in touchpoints:
        if t["contact_id"] and t["campaign_id"]:
            touch_by_contact.setdefault(t["contact_id"], []).append(t)
    for order in orders:
        if order["status"] != "PAID" or order.get("issue_type") == "DUPLICATE_REVENUE":
            continue
        converted = datetime.fromisoformat(order["ordered_at"].replace("Z", "+00:00"))
        journey = []
        for t in touch_by_contact.get(order["contact_id"], []):
            tt = datetime.fromisoformat(t["occurred_at"].replace("Z", "+00:00"))
            if tt <= converted and converted - tt <= timedelta(days=90) and t.get("issue_type") != "POST_CONVERSION_TOUCH":
                journey.append((tt, t))
        journey.sort(key=lambda x: (x[0], x[1]["touchpoint_id"]))
        if not journey:
            continue
        models = {"FIRST_TOUCH": {journey[0][1]["campaign_id"]: 1.0}, "LAST_TOUCH": {journey[-1][1]["campaign_id"]: 1.0}}
        unique_campaigns = list(dict.fromkeys(t["campaign_id"] for _, t in journey))
        models["LINEAR"] = {cid: 1.0 / len(unique_campaigns) for cid in unique_campaigns}
        for model, credits in models.items():
            for campaign_id, fraction in credits.items():
                attribution.append({"attribution_id": f"ATR-{len(attribution)+1:08d}", "order_id": order["order_id"], "campaign_id": campaign_id,
                                   "model": model, "credit_fraction": f"{fraction:.10f}",
                                   "attributed_revenue": f"{float(order['revenue_amount']) * fraction:.2f}",
                                   "rule_version": "v1-lookback-90d", "calculated_at": stamp(datetime(2026, 10, 22, tzinfo=timezone.utc)),
                                   "evidence_touchpoint_ids": json.dumps([t["touchpoint_id"] for _, t in journey])})

    tables = {
        "channel": channels, "audience": audiences, "creative": creatives, "contact": contacts,
        "campaign": campaigns, "campaign_creative": campaign_creatives, "campaign_audience": campaign_audiences,
        "touchpoint": touchpoints, "web_session": sessions, "lead": leads, "opportunity": opportunities,
        "orders": orders, "cost_record": costs, "attribution_result": attribution,
        "ground_truth": ground_truth
    }
    for name, rows in tables.items(): write_csv(out / f"{name}.csv", rows)
    counts = {name: len(rows) for name, rows in tables.items()}
    checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.glob("*.csv"))}
    summary = {"seed": args.seed, "scale": args.scale, "parameters": {"campaigns": n_campaigns, "contacts": n_contacts, "touchpoints": n_touches, "opportunities": n_opps},
               "row_counts": counts, "checksums_sha256": checksums, "generated_at_fixed": "2026-10-22T00:00:00Z",
               "notes": ["All records are synthetic.", "ground_truth.csv must remain separate from input features.", "This generator deliberately injects labelled anomalies."]}
    (out / "validation_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (out / "source_manifest.json").write_text(json.dumps({"provenance": "Synthetic data generated locally; no external personal data used.", "seed": args.seed, "generator": "tools/generate_data.py", "retrieval_date": None, "license": "Not applicable; generated synthetic records"}, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(out), "row_counts": counts, "ground_truth_labels": dict(Counter(x["issue_type"] for x in ground_truth))}, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--scale", choices=["starter", "full", "custom"], default="starter")
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--campaigns", type=int)
    p.add_argument("--contacts", type=int)
    p.add_argument("--touchpoints", type=int)
    p.add_argument("--opportunities", type=int)
    p.add_argument("--out", default="data/generated")
    a = p.parse_args()
    presets = {"starter": (25, 1000, 4000, 200), "full": (500, 50000, 200000, 10000), "custom": (25, 1000, 4000, 200)}
    defaults = presets[a.scale]
    a.campaigns = a.campaigns or defaults[0]; a.contacts = a.contacts or defaults[1]
    a.touchpoints = a.touchpoints or defaults[2]; a.opportunities = a.opportunities or defaults[3]
    for name in ("campaigns", "contacts", "touchpoints", "opportunities"):
        if getattr(a, name) < 1: p.error(f"--{name} must be >= 1")
    generate(a)

if __name__ == "__main__": main()
