#!/usr/bin/env python3
"""Business-rule validation for the YottaFlex synthetic attribution dataset.

Usage: python tools/validate_business_rules.py data/starter
The script treats the five ground-truth anomalies as intentional fixtures and
checks whether they are identifiable and whether attribution evidence violates
basic chronological, identity, revenue-deduplication, or referential rules.
"""
import argparse
import csv
import json
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path

FILES = {
    "channel": "channel.csv",
    "audience": "audience.csv",
    "creative": "creative.csv",
    "contact": "contact.csv",
    "campaign": "campaign.csv",
    "campaign_audience": "campaign_audience.csv",
    "campaign_creative": "campaign_creative.csv",
    "touchpoint": "touchpoint.csv",
    "web_session": "web_session.csv",
    "lead": "lead.csv",
    "opportunity": "opportunity.csv",
    "orders": "orders.csv",
    "cost_record": "cost_record.csv",
    "attribution_result": "attribution_result.csv",
    "ground_truth": "ground_truth.csv",
}


def load_csv(folder: Path, filename: str):
    path = folder / filename
    if not path.exists():
        raise FileNotFoundError(f"Required file not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", help="Dataset folder, e.g. data/starter")
    args = parser.parse_args()
    folder = Path(args.dataset)
    data = {key: load_csv(folder, filename) for key, filename in FILES.items()}
    errors, warnings, findings = [], [], []

    def error(message): errors.append(message)
    def warning(message): warnings.append(message)
    def finding(message): findings.append(message)

    # Build primary-key lookup sets and check uniqueness.
    pk_fields = {
        "channel": "channel_id", "audience": "audience_id", "creative": "creative_id",
        "contact": "contact_id", "campaign": "campaign_id", "touchpoint": "touchpoint_id",
        "web_session": "session_id", "lead": "lead_id", "opportunity": "opportunity_id",
        "orders": "order_id", "cost_record": "cost_record_id",
        "attribution_result": "attribution_id",
    }
    ids = {}
    for table, field in pk_fields.items():
        values = [r.get(field, "") for r in data[table]]
        if any(not v for v in values): error(f"{table}: blank {field}")
        duplicates = [v for v, count in Counter(values).items() if v and count > 1]
        if duplicates: error(f"{table}: duplicate {field} values: {duplicates[:5]}")
        ids[table] = set(values)

    # Foreign-key checks.
    fk_checks = [
        ("campaign", "channel_id", "channel"),
        ("campaign_audience", "campaign_id", "campaign"),
        ("campaign_audience", "audience_id", "audience"),
        ("campaign_creative", "campaign_id", "campaign"),
        ("campaign_creative", "creative_id", "creative"),
        ("touchpoint", "contact_id", "contact"),
        ("touchpoint", "campaign_id", "campaign"),
        ("touchpoint", "channel_id", "channel"),
        ("touchpoint", "creative_id", "creative"),
        ("web_session", "contact_id", "contact"),
        ("lead", "contact_id", "contact"),
        ("lead", "session_id", "web_session"),
        ("lead", "source_campaign_id", "campaign"),
        ("opportunity", "lead_id", "lead"),
        ("opportunity", "contact_id", "contact"),
        ("orders", "opportunity_id", "opportunity"),
        ("orders", "contact_id", "contact"),
        ("cost_record", "campaign_id", "campaign"),
        ("attribution_result", "order_id", "orders"),
        ("attribution_result", "campaign_id", "campaign"),
    ]
    for table, field, parent in fk_checks:
        for row in data[table]:
            value = row.get(field, "")
            if value and value not in ids[parent]:
                error(f"{table}: {field}={value} does not exist in {parent}")

    # Index source rows.
    orders_by_id = {r["order_id"]: r for r in data["orders"]}
    touches_by_id = {r["touchpoint_id"]: r for r in data["touchpoint"]}
    sessions_by_id = {r["session_id"]: r for r in data["web_session"]}
    campaigns_by_id = {r["campaign_id"]: r for r in data["campaign"]}
    costs_by_campaign = defaultdict(list)
    for row in data["cost_record"]: costs_by_campaign[row["campaign_id"]].append(row)

    # Ground truth must contain the required five issue types.
    truth_by_type = defaultdict(list)
    for row in data["ground_truth"]: truth_by_type[row.get("issue_type", "")].append(row)
    required = {"DUPLICATE_REVENUE", "POST_CONVERSION_TOUCH", "CURRENCY_MISMATCH",
                "MISSING_CAMPAIGN_COST", "UNSUPPORTED_IDENTITY_LINK"}
    missing = sorted(required - set(truth_by_type))
    if missing: error(f"ground_truth missing required issue types: {missing}")
    else: finding("All five required ground-truth anomaly types are present.")

    # Duplicate revenue: repeated event keys must be detected and must not be
    # independently attributed as separate paid conversions.
    event_groups = defaultdict(list)
    for order in data["orders"]:
        if order.get("revenue_event_key"):
            event_groups[order["revenue_event_key"]].append(order)
    duplicate_orders = set()
    for event_key, rows in event_groups.items():
        if len(rows) > 1:
            canonical = sorted(rows, key=lambda r: r["order_id"])[0]
            for row in rows:
                if row["order_id"] != canonical["order_id"]:
                    duplicate_orders.add(row["order_id"])
            finding(f"Duplicate revenue event {event_key}: orders {[r['order_id'] for r in rows]}; count once.")
    if not duplicate_orders:
        warning("No repeated revenue_event_key found; verify duplicate-revenue fixture was loaded.")

    # Cost/currency anomaly detection.
    for row in data["cost_record"]:
        campaign = campaigns_by_id.get(row.get("campaign_id"))
        if campaign and row.get("currency") and campaign.get("budget_currency") and row["currency"] != campaign["budget_currency"]:
            if row.get("issue_type") == "CURRENCY_MISMATCH":
                finding(f"Currency mismatch flagged for {row['cost_record_id']}: {row['currency']} vs campaign {campaign['budget_currency']}; quarantine/convert before ROI.")
            else:
                error(f"Unflagged currency mismatch on cost record {row.get('cost_record_id')}")
    for gt in truth_by_type.get("MISSING_CAMPAIGN_COST", []):
        campaign_id = gt.get("entity_id")
        if campaign_id not in campaigns_by_id: error(f"Missing-cost fixture references unknown campaign {campaign_id}")
        elif costs_by_campaign.get(campaign_id):
            warning(f"Ground-truth missing-cost campaign {campaign_id} has cost records; verify whether they are excluded/quarantined.")
        else:
            finding(f"Campaign {campaign_id} has no cost records; ROI should be unavailable, not zero.")

    # Unsupported session identity links should be visibly flagged and must not
    # be used as attribution evidence via leads.
    for gt in truth_by_type.get("UNSUPPORTED_IDENTITY_LINK", []):
        session_id = gt.get("entity_id")
        session = sessions_by_id.get(session_id)
        if not session:
            error(f"Unsupported-identity fixture references unknown session {session_id}")
            continue
        if session.get("identity_evidence", "").upper() == "NONE" and session.get("contact_id"):
            if session.get("issue_type") == "UNSUPPORTED_IDENTITY_LINK":
                finding(f"Session {session_id} has a contact link without identity evidence; quarantine/reject the link.")
            else:
                error(f"Session {session_id} has unsupported identity link but is not flagged.")

    # Attribution integrity: evidence IDs parse, exist, belong to the same
    # contact, and occur no later than the conversion timestamp.
    for result in data["attribution_result"]:
        order = orders_by_id.get(result.get("order_id"))
        if not order: continue
        try:
            evidence = json.loads(result.get("evidence_touchpoint_ids") or "[]")
            if not isinstance(evidence, list): raise ValueError("evidence is not a list")
        except (json.JSONDecodeError, ValueError) as exc:
            error(f"Attribution {result.get('attribution_id')}: invalid evidence_touchpoint_ids ({exc})")
            continue
        ordered_at = parse_time(order.get("ordered_at"))
        for touch_id in evidence:
            touch = touches_by_id.get(touch_id)
            if not touch:
                error(f"Attribution {result.get('attribution_id')}: evidence touchpoint {touch_id} not found")
                continue
            if touch.get("contact_id") != order.get("contact_id"):
                error(f"Attribution {result.get('attribution_id')}: evidence {touch_id} belongs to a different contact")
            touch_at = parse_time(touch.get("occurred_at"))
            if ordered_at and touch_at and touch_at > ordered_at:
                error(f"Attribution {result.get('attribution_id')}: post-conversion touchpoint {touch_id} used as evidence")
            if touch.get("issue_type") == "POST_CONVERSION_TOUCH":
                error(f"Attribution {result.get('attribution_id')}: flagged post-conversion touchpoint {touch_id} used as evidence")

        try:
            credit = float(result.get("credit_fraction", ""))
            revenue = float(result.get("attributed_revenue", ""))
            if credit < 0 or credit > 1.0000001: error(f"Attribution {result.get('attribution_id')}: credit_fraction outside [0,1]")
            if revenue < 0: error(f"Attribution {result.get('attribution_id')}: negative attributed_revenue")
        except ValueError:
            error(f"Attribution {result.get('attribution_id')}: invalid credit/revenue number")

    # For each order/model, credit fractions should sum to 1 (within tolerance).
    credits = defaultdict(float)
    for row in data["attribution_result"]:
        try: credits[(row["order_id"], row["model"])] += float(row["credit_fraction"])
        except (ValueError, KeyError): pass
    for (order_id, model), total in credits.items():
        if abs(total - 1.0) > 1e-5:
            error(f"Attribution credits for order={order_id}, model={model} sum to {total:.8f}, not 1.0")

    # The duplicate order must not contribute an additional attribution revenue.
    for order_id in sorted(duplicate_orders):
        rows = [r for r in data["attribution_result"] if r.get("order_id") == order_id]
        if rows:
            error(f"Duplicate order {order_id} has {len(rows)} attribution rows; exclude it from revenue/ROI or explicitly deduplicate by revenue_event_key.")

    model_counts = Counter(r.get("model", "") for r in data["attribution_result"])
    report = {
        "dataset": str(folder),
        "row_counts": {key: len(rows) for key, rows in data.items()},
        "attribution_model_counts": dict(model_counts),
        "ground_truth_issue_counts": dict(Counter(r.get("issue_type", "") for r in data["ground_truth"])),
        "error_count": len(errors), "warning_count": len(warnings),
        "errors": errors, "warnings": warnings, "findings": findings,
        "status": "FAIL" if errors else "PASS_WITH_WARNINGS" if warnings else "PASS",
    }
    output = folder / "business_validation_report.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"\nReport saved to: {output}")
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
