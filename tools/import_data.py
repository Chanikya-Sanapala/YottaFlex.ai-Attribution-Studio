#!/usr/bin/env python3
"""Import YottaFlex CSVs into PostgreSQL. Run from repository root.

Install: python -m pip install "psycopg[binary]"
Run:     python tools/import_data.py --input data/starter
Reset:   python tools/import_data.py --input data/starter --reset
"""
import argparse
import csv
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

try:
    import psycopg
    from psycopg.types.json import Jsonb
except ImportError:
    print('Install dependency: python -m pip install "psycopg[binary]"', file=sys.stderr)
    raise SystemExit(2)


def rows(folder, name):
    path = folder / f"{name}.csv"
    if not path.is_file():
        raise FileNotFoundError(f"Missing required CSV: {path}")
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def v(row, key):
    value = row.get(key)
    return value if value not in ("", None) else None


def ts(value):
    return value.replace("Z", "+00:00") if value else None


def num(value):
    return Decimal(value) if value not in ("", None) else None


def truth(value):
    return str(value).strip().lower() in ("true", "1", "yes", "y")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="data/starter")
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=5432)
    ap.add_argument("--database", default="attribution")
    ap.add_argument("--username", default="attribution")
    ap.add_argument("--password", default="local_dev_only")
    ap.add_argument("--reset", action="store_true",
                    help="Clear imported tables before importing; use only for this local challenge DB")
    args = ap.parse_args()
    folder = Path(args.input)

    # Read every input file before opening a transaction.
    names = [
        "channel", "audience", "creative", "contact", "campaign",
        "campaign_creative", "campaign_audience", "web_session", "lead",
        "opportunity", "orders", "touchpoint", "cost_record",
        "attribution_result", "ground_truth",
    ]
    d = {name: rows(folder, name) for name in names}

    gt_by_type = {r["issue_type"]: r for r in d["ground_truth"]}
    duplicate_order_codes = {
        r["entity_id"] for r in d["ground_truth"]
        if r["issue_type"] == "DUPLICATE_REVENUE" and r["entity_type"].lower() == "order"
    }
    post_conversion_codes = {
        r["entity_id"] for r in d["ground_truth"]
        if r["issue_type"] == "POST_CONVERSION_TOUCH" and r["entity_type"].lower() == "touchpoint"
    }
    unsupported_session_codes = {
        r["entity_id"] for r in d["ground_truth"]
        if r["issue_type"] == "UNSUPPORTED_IDENTITY_LINK" and r["entity_type"].lower() == "websession"
    }
    # Ground-truth details are source-of-truth for the duplicate pair.
    duplicate_originals = {}
    for r in d["ground_truth"]:
        if r["issue_type"] == "DUPLICATE_REVENUE":
            duplicate_originals[r["entity_id"]] = json.loads(r["details"]).get("duplicate_of")

    conninfo = (
        f"host={args.host} port={args.port} dbname={args.database} "
        f"user={args.username} password={args.password}"
    )
    counts = {}

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT (SELECT COUNT(*) FROM campaign), (SELECT COUNT(*) FROM contact)")
            campaign_count, contact_count = cur.fetchone()
            if (campaign_count or contact_count) and not args.reset:
                raise RuntimeError(
                    "Database already contains campaign/contact rows. "
                    "Use --reset only if you intend to replace this local imported dataset."
                )
            if args.reset:
                cur.execute("""
                    TRUNCATE TABLE attribution_result, data_issue, entity_event,
                      campaign_audience, campaign_creative, cost_record, touchpoint,
                      orders, opportunity, lead, web_session, campaign, contact,
                      creative, audience, channel RESTART IDENTITY CASCADE
                """)

            ids = {key: {} for key in (
                "channel", "audience", "creative", "contact", "campaign",
                "session", "lead", "opportunity", "order", "touchpoint"
            )}

            def insert(sql, params):
                cur.execute(sql, params)
                return cur.fetchone()[0]

            # Parent entities
            for r in d["channel"]:
                ids["channel"][r["channel_id"]] = insert(
                    "INSERT INTO channel(code,name,channel_type) VALUES(%s,%s,%s) RETURNING channel_id",
                    (r["channel_id"], r["name"], r["channel_type"]))
            counts["channel"] = len(d["channel"])

            for r in d["audience"]:
                ids["audience"][r["audience_id"]] = insert(
                    "INSERT INTO audience(audience_code,name,description) VALUES(%s,%s,%s) RETURNING audience_id",
                    (r["audience_id"], r["name"], v(r, "description")))
            counts["audience"] = len(d["audience"])

            for r in d["creative"]:
                ids["creative"][r["creative_id"]] = insert(
                    "INSERT INTO creative(creative_code,name,format,status) VALUES(%s,%s,%s,%s) RETURNING creative_id",
                    (r["creative_id"], r["name"], r["format"], r["status"]))
            counts["creative"] = len(d["creative"])

            for r in d["contact"]:
                ids["contact"][r["contact_id"]] = insert(
                    """INSERT INTO contact(contact_code,synthetic_external_id,created_at,lifecycle_status,is_anonymous)
                       VALUES(%s,%s,%s,%s,%s) RETURNING contact_id""",
                    (r["contact_id"], v(r, "synthetic_external_id"), ts(r["created_at"]),
                     r["lifecycle_status"], truth(r["is_anonymous"])))
            counts["contact"] = len(d["contact"])

            for r in d["campaign"]:
                if r["channel_id"] not in ids["channel"]:
                    raise ValueError(f"Unknown channel {r['channel_id']} referenced by campaign {r['campaign_id']}")
                ids["campaign"][r["campaign_id"]] = insert(
                    """INSERT INTO campaign(campaign_code,name,channel_id,start_at,end_at,budget_amount,budget_currency,status)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING campaign_id""",
                    (r["campaign_id"], r["name"], ids["channel"][r["channel_id"]],
                     ts(r["start_at"]), ts(v(r, "end_at")), num(r["budget_amount"]),
                     r["budget_currency"], r["status"]))
            counts["campaign"] = len(d["campaign"])

            for r in d["campaign_creative"]:
                cur.execute(
                    """INSERT INTO campaign_creative(campaign_id,creative_id,effective_from,effective_to)
                       VALUES(%s,%s,%s,%s)""",
                    (ids["campaign"][r["campaign_id"]], ids["creative"][r["creative_id"]],
                     ts(r["effective_from"]), ts(v(r, "effective_to"))))
            counts["campaign_creative"] = len(d["campaign_creative"])

            for r in d["campaign_audience"]:
                cur.execute(
                    """INSERT INTO campaign_audience(campaign_id,audience_id,effective_from,effective_to)
                       VALUES(%s,%s,%s,%s)""",
                    (ids["campaign"][r["campaign_id"]], ids["audience"][r["audience_id"]],
                     ts(r["effective_from"]), ts(v(r, "effective_to"))))
            counts["campaign_audience"] = len(d["campaign_audience"])

            # Sessions: reject unsupported contact linkage, but preserve session.
            for r in d["web_session"]:
                source_session = r["session_id"]
                contact_code = v(r, "contact_id")
                contact_id = ids["contact"].get(contact_code)
                is_unsupported = (
                    source_session in unsupported_session_codes
                    or r.get("identity_evidence") == "NONE"
                )
                if is_unsupported:
                    contact_id = None
                ids["session"][source_session] = insert(
                    """INSERT INTO web_session(session_code,contact_id,started_at,ended_at,anonymous_id,
                       landing_url,source_system,identity_evidence,issue_type)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING session_id""",
                    (source_session, contact_id, ts(r["started_at"]), ts(v(r, "ended_at")),
                     v(r, "anonymous_id"), v(r, "landing_url"), r["source_system"],
                     v(r, "identity_evidence"), v(r, "issue_type")))
            counts["web_session"] = len(d["web_session"])

            for r in d["lead"]:
                ids["lead"][r["lead_id"]] = insert(
                    """INSERT INTO lead(lead_code,contact_id,session_id,created_at,status,source_campaign_id,synthetic_external_id)
                       VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING lead_id""",
                    (r["lead_id"], ids["contact"].get(v(r, "contact_id")),
                     ids["session"].get(v(r, "session_id")), ts(r["created_at"]), r["status"],
                     ids["campaign"].get(v(r, "source_campaign_id")), v(r, "synthetic_external_id")))
            counts["lead"] = len(d["lead"])

            for r in d["opportunity"]:
                ids["opportunity"][r["opportunity_id"]] = insert(
                    """INSERT INTO opportunity(opportunity_code,lead_id,contact_id,created_at,closed_at,stage,expected_amount,currency)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING opportunity_id""",
                    (r["opportunity_id"], ids["lead"].get(v(r, "lead_id")),
                     ids["contact"].get(v(r, "contact_id")), ts(r["created_at"]),
                     ts(v(r, "closed_at")), r["stage"], num(v(r, "expected_amount")), r["currency"]))
            counts["opportunity"] = len(d["opportunity"])

            # Canonical revenue excludes the known duplicate event.
            for r in d["orders"]:
                code = r["order_id"]
                if code in duplicate_order_codes:
                    continue
                ids["order"][code] = insert(
                    """INSERT INTO orders(order_code,opportunity_id,contact_id,ordered_at,status,revenue_amount,currency,revenue_event_key,issue_type)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING order_id""",
                    (code, ids["opportunity"].get(v(r, "opportunity_id")),
                     ids["contact"].get(v(r, "contact_id")), ts(r["ordered_at"]), r["status"],
                     num(r["revenue_amount"]), r["currency"], r["revenue_event_key"], v(r, "issue_type")))
            counts["orders"] = len(ids["order"])
            counts["duplicate_orders_quarantined"] = len(duplicate_order_codes)

            for r in d["touchpoint"]:
                code = r["touchpoint_id"]
                ids["touchpoint"][code] = insert(
                    """INSERT INTO touchpoint(touchpoint_code,contact_id,campaign_id,channel_id,creative_id,
                       occurred_at,touch_type,source_system,is_offline,identity_evidence,issue_type)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING touchpoint_id""",
                    (code, ids["contact"].get(v(r, "contact_id")),
                     ids["campaign"].get(v(r, "campaign_id")), ids["channel"][r["channel_id"]],
                     ids["creative"].get(v(r, "creative_id")), ts(r["occurred_at"]), r["touch_type"],
                     r["source_system"], truth(r["is_offline"]), v(r, "identity_evidence"),
                     v(r, "issue_type")))
            counts["touchpoint"] = len(d["touchpoint"])

            for r in d["cost_record"]:
                cur.execute(
                    """INSERT INTO cost_record(cost_code,campaign_id,incurred_at,amount,currency,cost_type,source_reference,issue_type)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (r["cost_record_id"], ids["campaign"][r["campaign_id"]], ts(r["incurred_at"]),
                     num(r["amount"]), r["currency"], r["cost_type"], v(r, "source_reference"), v(r, "issue_type")))
            counts["cost_record"] = len(d["cost_record"])

            # Source attribution results are loaded as supplied, except duplicate-order rows.
            # Post-conversion touchpoint filtering must be enforced by the attribution service
            # when recalculating results; the original evidence remains auditable here.
            attribution_count = 0
            for r in d["attribution_result"]:
                if r["order_id"] in duplicate_order_codes:
                    continue
                order_id = ids["order"].get(r["order_id"])
                campaign_id = ids["campaign"].get(r["campaign_id"])
                if order_id is None or campaign_id is None:
                    continue
                raw_evidence = v(r, "evidence_touchpoint_ids")
                try:
                    evidence_ids = json.loads(raw_evidence) if raw_evidence else []
                except json.JSONDecodeError:
                    evidence_ids = [x for x in (raw_evidence or "").split(";") if x]
                cur.execute(
                    """INSERT INTO attribution_result(order_id,campaign_id,model,credit_fraction,attributed_revenue,
                       rule_version,calculated_at,evidence)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (order_id, campaign_id, r["model"], num(r["credit_fraction"]),
                     num(r["attributed_revenue"]), r["rule_version"],
                     ts(v(r, "calculated_at")) or datetime.now(timezone.utc).isoformat(),
                     Jsonb({"source_attribution_id": r["attribution_id"],
                            "evidence_touchpoint_ids": evidence_ids})))
                attribution_count += 1
            counts["attribution_result"] = attribution_count

            # Persist the five supplied ground-truth issues as open, auditable items.
            severities = {
                "DUPLICATE_REVENUE": "HIGH",
                "POST_CONVERSION_TOUCH": "MEDIUM",
                "CURRENCY_MISMATCH": "HIGH",
                "MISSING_CAMPAIGN_COST": "MEDIUM",
                "UNSUPPORTED_IDENTITY_LINK": "HIGH",
            }
            for r in d["ground_truth"]:
                cur.execute(
                    """INSERT INTO data_issue(issue_code,issue_type,entity_type,entity_code,severity,
                       ground_truth_label,resolution_status,resolution_reason,details)
                       VALUES(%s,%s,%s,%s,%s,%s,'OPEN',%s,%s)""",
                    (r["ground_truth_id"], r["issue_type"], r["entity_type"], r["entity_id"],
                     severities.get(r["issue_type"], "MEDIUM"), r["expected_decision"],
                     "Imported from ground-truth labels; requires explicit resolution.",
                     Jsonb(json.loads(r["details"]))))
            counts["data_issue"] = len(d["ground_truth"])

    print("IMPORT SUCCESS")
    for name, count in counts.items():
        print(f"{name}: {count}")
    print("Known issues recorded in data_issue. Currency conversion was not guessed.")
    print("Campaign ROI must remain unavailable when costs are missing or currencies conflict.")
    print("Post-conversion touches remain auditable; exclude them when recalculating attribution.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"IMPORT FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
