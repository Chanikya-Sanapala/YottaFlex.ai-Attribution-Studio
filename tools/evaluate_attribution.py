#!/usr/bin/env python3
"""Rule/integrity evaluation for attribution CSVs; not a statistical accuracy benchmark."""
import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

FILES = [
    "orders.csv",
    "touchpoint.csv",
    "attribution_result.csv",
    "ground_truth.csv",
    "cost_record.csv",
    "campaign.csv",
    "web_session.csv",
]


def load(root, name):
    with (root / name).open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def dt(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None
    except (ValueError, TypeError, AttributeError):
        return None


def num(value):
    try:
        return float(value) if value not in (None, "") else None
    except (ValueError, TypeError):
        return None


def evidence(value):
    try:
        value = json.loads(value or "[]")
        return value if isinstance(value, list) and all(isinstance(x, str) for x in value) else None
    except (json.JSONDecodeError, TypeError):
        return None


def parse_json_object(value):
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    root = args.dataset

    missing_files = [name for name in FILES if not (root / name).is_file()]
    if missing_files:
        parser.error(f"Missing required dataset files in {root}: {', '.join(missing_files)}")

    data = {name: load(root, name) for name in FILES}
    orders, touches, results, truth, costs, campaigns, sessions = (data[name] for name in FILES)

    order_by_id = {row["order_id"]: row for row in orders if row.get("order_id")}
    touch_by_id = {row["touchpoint_id"]: row for row in touches if row.get("touchpoint_id")}
    campaign_by_id = {row["campaign_id"]: row for row in campaigns if row.get("campaign_id")}
    session_by_id = {row["session_id"]: row for row in sessions if row.get("session_id")}
    cost_by_id = {row["cost_record_id"]: row for row in costs if row.get("cost_record_id")}

    errors, warnings = [], []
    model_rows = Counter()
    model_orders = defaultdict(set)
    model_revenue = Counter()
    credit_sums, group_rows = defaultdict(float), Counter()
    integrity = Counter()

    for result in results:
        attribution_id = result.get("attribution_id") or "UNKNOWN_ATTRIBUTION"
        order_id = result.get("order_id")
        model = result.get("model", "UNKNOWN")
        rule_version = result.get("rule_version", "UNKNOWN")
        model_rows[model] += 1

        order = order_by_id.get(order_id)
        if not order:
            errors.append(f"{attribution_id}: missing order {order_id}")
            integrity["missing_orders"] += 1
            continue

        group_key = (order_id, model, rule_version)
        credit = num(result.get("credit_fraction"))
        attributed_revenue = num(result.get("attributed_revenue"))
        order_revenue = num(order.get("revenue_amount"))
        group_rows[group_key] += 1

        if credit is None or not 0 <= credit <= 1.0000001:
            integrity["invalid_credit_fraction_rows"] += 1
            errors.append(f"{attribution_id}: credit fraction missing/outside [0,1]")
        else:
            credit_sums[group_key] += credit

        if attributed_revenue is None or attributed_revenue < 0:
            integrity["invalid_attributed_revenue_rows"] += 1
            errors.append(f"{attribution_id}: attributed revenue missing/negative")
        else:
            model_revenue[model] += attributed_revenue
            model_orders[model].add(order_id)
            if credit is not None and order_revenue is not None:
                expected_revenue = order_revenue * credit
                tolerance = max(0.02, abs(expected_revenue) * 1e-6)
                if abs(attributed_revenue - expected_revenue) > tolerance:
                    integrity["attributed_revenue_credit_mismatches"] += 1
                    errors.append(
                        f"{attribution_id}: attributed revenue does not equal order revenue × credit"
                    )

        evidence_ids = evidence(result.get("evidence_touchpoint_ids"))
        if evidence_ids is None:
            integrity["invalid_evidence_json_rows"] += 1
            errors.append(
                f"{attribution_id}: evidence_touchpoint_ids is not a JSON list of string IDs"
            )
            continue

        order_time = dt(order.get("ordered_at"))
        evidence_campaign_ids = set()
        for touchpoint_id in evidence_ids:
            touch = touch_by_id.get(touchpoint_id)
            if not touch:
                integrity["missing_evidence_touchpoints"] += 1
                errors.append(f"{attribution_id}: missing evidence touchpoint {touchpoint_id}")
                continue

            touch_campaign_id = touch.get("campaign_id")
            if touch_campaign_id:
                evidence_campaign_ids.add(touch_campaign_id)

            if touch.get("contact_id") != order.get("contact_id"):
                integrity["wrong_contact_evidence"] += 1
                errors.append(
                    f"{attribution_id}: evidence touchpoint {touchpoint_id} belongs to another contact"
                )

            touch_time = dt(touch.get("occurred_at"))
            if order_time and touch_time and touch_time > order_time:
                integrity["post_conversion_evidence_references"] += 1
                errors.append(
                    f"{attribution_id}: evidence touchpoint {touchpoint_id} occurs after conversion"
                )

            if touch.get("issue_type") == "POST_CONVERSION_TOUCH":
                integrity["flagged_post_conversion_evidence_references"] += 1
                errors.append(
                    f"{attribution_id}: flagged post-conversion touchpoint {touchpoint_id} used as evidence"
                )

        # Evidence can contain touchpoints from several campaigns in a multi-touch journey.
        # Validate once per attribution row that its credited campaign is represented among
        # the evidence campaigns; do not require every evidence touchpoint to share that campaign.
        result_campaign_id = result.get("campaign_id")
        if evidence_ids and result_campaign_id not in evidence_campaign_ids:
            integrity["evidence_campaign_mismatches"] += 1
            errors.append(
                f"{attribution_id}: result campaign {result_campaign_id} is absent from its evidence campaigns"
            )

    unreconciled_groups = []
    for (order_id, model, rule_version), total_credit in credit_sums.items():
        if abs(total_credit - 1.0) > 1e-5:
            unreconciled_groups.append(
                {
                    "order_id": order_id,
                    "model": model,
                    "rule_version": rule_version,
                    "credit_sum": round(total_credit, 8),
                    "rows": group_rows[(order_id, model, rule_version)],
                }
            )
    if unreconciled_groups:
        errors.append(f"{len(unreconciled_groups)} order/model/rule groups do not sum to 1.0")

    truth_by_type = defaultdict(list)
    for row in truth:
        truth_by_type[row.get("issue_type", "UNKNOWN")].append(row)

    required_types = {
        "DUPLICATE_REVENUE",
        "POST_CONVERSION_TOUCH",
        "CURRENCY_MISMATCH",
        "MISSING_CAMPAIGN_COST",
        "UNSUPPORTED_IDENTITY_LINK",
    }
    missing_types = sorted(required_types - set(truth_by_type))
    if missing_types:
        errors.append(f"Missing required ground-truth types: {missing_types}")

    event_orders = defaultdict(list)
    for order in orders:
        event_key = order.get("revenue_event_key")
        if event_key:
            event_orders[event_key].append(order.get("order_id"))
    duplicate_revenue_groups = [
        {"revenue_event_key": key, "order_ids": ids}
        for key, ids in event_orders.items()
        if len(ids) > 1
    ]

    post_conversion_fixtures = []
    for fixture in truth_by_type.get("POST_CONVERSION_TOUCH", []):
        touchpoint_id = fixture.get("entity_id")
        touch = touch_by_id.get(touchpoint_id)
        details = parse_json_object(fixture.get("details"))
        conversion_order = order_by_id.get(details.get("conversion_order_id"))
        touch_time = dt(touch.get("occurred_at")) if touch else None
        conversion_time = dt(conversion_order.get("ordered_at")) if conversion_order else None
        occurs_after_conversion = bool(
            touch_time and conversion_time and touch_time > conversion_time
        )
        evidence_reference_ids = [
            row.get("attribution_id")
            for row in results
            if touchpoint_id in (evidence(row.get("evidence_touchpoint_ids")) or [])
        ]
        excluded_correctly = bool(touch and occurs_after_conversion and not evidence_reference_ids)
        post_conversion_fixtures.append(
            {
                "touchpoint_id": touchpoint_id,
                "found": bool(touch),
                "after_conversion": occurs_after_conversion,
                "evidence_reference_count": len(evidence_reference_ids),
                "excluded_correctly": excluded_correctly,
            }
        )
        if not touch:
            warnings.append(f"Post-conversion ground-truth fixture touchpoint not found: {touchpoint_id}")
        elif not occurs_after_conversion:
            warnings.append(
                f"Post-conversion fixture timestamp could not be confirmed for {touchpoint_id}"
            )
        elif evidence_reference_ids:
            errors.append(
                f"Post-conversion fixture {touchpoint_id} appears in {len(evidence_reference_ids)} attribution evidence rows"
            )

    # Campaign CSV uses budget_currency (not currency). Compare cost currency against it.
    currency_mismatches = []
    for cost in costs:
        campaign = campaign_by_id.get(cost.get("campaign_id"))
        campaign_currency = (campaign or {}).get("budget_currency")
        cost_currency = cost.get("currency")
        if campaign_currency and cost_currency and cost_currency != campaign_currency:
            currency_mismatches.append(
                {
                    "cost_record_id": cost.get("cost_record_id"),
                    "campaign_id": cost.get("campaign_id"),
                    "cost_currency": cost_currency,
                    "campaign_currency": campaign_currency,
                    "issue_type": cost.get("issue_type"),
                }
            )

    currency_fixture_checks = []
    for fixture in truth_by_type.get("CURRENCY_MISMATCH", []):
        cost_id = fixture.get("entity_id")
        cost = cost_by_id.get(cost_id)
        details = parse_json_object(fixture.get("details"))
        campaign_id = (cost or {}).get("campaign_id") or details.get("campaign_id")
        campaign = campaign_by_id.get(campaign_id)
        cost_currency = (cost or {}).get("currency") or details.get("currency")
        campaign_currency = (campaign or {}).get("budget_currency")
        reporting_currency = details.get("reporting_currency")
        campaign_currency_mismatch = bool(
            cost_currency and campaign_currency and cost_currency != campaign_currency
        )
        reporting_currency_mismatch = bool(
            cost_currency and reporting_currency and cost_currency != reporting_currency
        )
        fixture_ok = bool(
            cost
            and campaign
            and (cost.get("issue_type") == "CURRENCY_MISMATCH")
            and (campaign_currency_mismatch or reporting_currency_mismatch)
        )
        currency_fixture_checks.append(
            {
                "cost_record_id": cost_id,
                "found": bool(cost),
                "campaign_id": campaign_id,
                "cost_currency": cost_currency,
                "campaign_budget_currency": campaign_currency,
                "reporting_currency": reporting_currency,
                "campaign_currency_mismatch": campaign_currency_mismatch,
                "reporting_currency_mismatch": reporting_currency_mismatch,
                "flagged": bool(cost and cost.get("issue_type") == "CURRENCY_MISMATCH"),
                "expected_decision": fixture.get("expected_decision"),
                "validated": fixture_ok,
            }
        )
        if not cost:
            errors.append(f"Currency-mismatch ground-truth cost record not found: {cost_id}")
        elif not campaign:
            errors.append(f"Currency-mismatch campaign not found for cost record {cost_id}: {campaign_id}")
        elif not fixture_ok:
            errors.append(
                f"Currency-mismatch fixture {cost_id} is not flagged or does not differ from campaign/reporting currency"
            )

    campaigns_with_cost = {cost.get("campaign_id") for cost in costs}
    campaigns_without_cost_records = [
        campaign.get("campaign_id")
        for campaign in campaigns
        if campaign.get("campaign_id") not in campaigns_with_cost
    ]

    missing_cost_fixtures = []
    for fixture in truth_by_type.get("MISSING_CAMPAIGN_COST", []):
        campaign_id = fixture.get("entity_id")
        has_cost = any(cost.get("campaign_id") == campaign_id for cost in costs)
        fixture_ok = campaign_id in campaign_by_id and not has_cost
        missing_cost_fixtures.append(
            {"campaign_id": campaign_id, "found": campaign_id in campaign_by_id,
             "has_cost_records": has_cost, "missing_cost_confirmed": fixture_ok}
        )
        if not fixture_ok:
            warnings.append(
                f"Missing-cost fixture {campaign_id} could not be confirmed as a campaign without cost records"
            )

    unsupported_identity_fixtures = []
    for fixture in truth_by_type.get("UNSUPPORTED_IDENTITY_LINK", []):
        session_id = fixture.get("entity_id")
        session = session_by_id.get(session_id)
        fixture_result = {
            "session_id": session_id,
            "found": bool(session),
            "identity_evidence": (session or {}).get("identity_evidence"),
            "contact_link_present": bool((session or {}).get("contact_id")),
            "flagged": (session or {}).get("issue_type") == "UNSUPPORTED_IDENTITY_LINK",
        }
        unsupported_identity_fixtures.append(fixture_result)
        if not session:
            errors.append(f"Unsupported-identity ground-truth session not found: {session_id}")
        elif not fixture_result["flagged"]:
            errors.append(f"Unsupported-identity fixture {session_id} is not flagged")

    dated_orders = sorted(
        ((dt(order.get("ordered_at")), order) for order in orders if dt(order.get("ordered_at"))),
        key=lambda item: item[0],
    )
    cutoff_index = int(len(dated_orders) * 0.8)
    chronological_coverage = {
        "method": "timestamp-sorted 80/20 inventory split",
        "cutoff_timestamp": dated_orders[cutoff_index][0].isoformat()
        if cutoff_index < len(dated_orders) else None,
        "earlier_period_orders": cutoff_index,
        "later_period_orders": len(dated_orders) - cutoff_index,
        "limitation": "Descriptive only; no holdout model scoring or predictive accuracy is claimed.",
    }

    models = {
        model: {
            "attribution_rows": model_rows[model],
            "attributed_orders": len(model_orders[model]),
            "sum_attributed_revenue": round(model_revenue[model], 2),
            "unreconciled_groups": sum(1 for item in unreconciled_groups if item["model"] == model),
        }
        for model in sorted(model_rows)
    }

    report = {
        "dataset": str(root),
        "status": "PASS" if not errors else "FAIL",
        "scope": "Rule/integrity evaluation, not causal or statistical accuracy evaluation.",
        "row_counts": {name.removesuffix(".csv"): len(rows) for name, rows in data.items()},
        "models": models,
        "integrity": dict(integrity),
        "unreconciled_groups": unreconciled_groups,
        "anomaly_checks": {
            "required_ground_truth_types_present": not missing_types,
            "missing_ground_truth_types": missing_types,
            "duplicate_revenue_event_groups": duplicate_revenue_groups,
            "post_conversion_fixtures": post_conversion_fixtures,
            "currency_mismatch_cost_records": currency_mismatches,
            "currency_mismatch_fixture_checks": currency_fixture_checks,
            "campaigns_without_cost_records": campaigns_without_cost_records,
            "missing_cost_fixtures": missing_cost_fixtures,
            "unsupported_identity_fixtures": unsupported_identity_fixtures,
        },
        "chronological_coverage": chronological_coverage,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors[:200],
        "warnings": warnings,
    }

    output_path = args.out or root / "evaluation_report.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(
        {
            "status": report["status"],
            "output": str(output_path),
            "models": models,
            "integrity": dict(integrity),
            "anomaly_checks": report["anomaly_checks"],
            "chronological_coverage": chronological_coverage,
            "error_count": len(errors),
            "warning_count": len(warnings),
            "first_errors": errors[:20],
        },
        indent=2,
    ))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
