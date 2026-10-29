
import csv
import json
import sys
from collections import Counter
from pathlib import Path

def read_csv(folder, name):
    path = folder / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(f"Missing file: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

def main():
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "data/starter")
    tables = {
        name: read_csv(folder, name)
        for name in [
            "channel", "audience", "creative", "contact", "campaign",
            "campaign_creative", "campaign_audience", "touchpoint",
            "web_session", "lead", "opportunity", "orders", "cost_record",
            "attribution_result", "ground_truth"
        ]
    }

    errors = []
    warnings = []

    # 1. Primary key uniqueness
    primary_keys = {
        "channel": "channel_id",
        "audience": "audience_id",
        "creative": "creative_id",
        "contact": "contact_id",
        "campaign": "campaign_id",
        "touchpoint": "touchpoint_id",
        "web_session": "session_id",
        "lead": "lead_id",
        "opportunity": "opportunity_id",
        "orders": "order_id",
        "cost_record": "cost_record_id",
        "attribution_result": "attribution_id",
    }

    for table, key in primary_keys.items():
        rows = tables[table]
        if not rows or key not in rows[0]:
            errors.append(f"{table}: missing rows or primary-key column '{key}'")
            continue
        values = [row[key] for row in rows]
        duplicates = [v for v, n in Counter(values).items() if not v or n > 1]
        if duplicates:
            errors.append(
                f"{table}: {len(duplicates)} blank or duplicate values in {key}"
            )

    # 2. Foreign-key checks. Confirm column names against the data dictionary.
    foreign_keys = [
        ("campaign", "channel_id", "channel", "channel_id"),
        ("touchpoint", "contact_id", "contact", "contact_id"),
        ("touchpoint", "campaign_id", "campaign", "campaign_id"),
        ("touchpoint", "channel_id", "channel", "channel_id"),
        ("web_session", "contact_id", "contact", "contact_id"),
        ("lead", "contact_id", "contact", "contact_id"),
        ("opportunity", "lead_id", "lead", "lead_id"),
        ("orders", "opportunity_id", "opportunity", "opportunity_id"),
        ("cost_record", "campaign_id", "campaign", "campaign_id"),
        ("campaign_creative", "campaign_id", "campaign", "campaign_id"),
        ("campaign_creative", "creative_id", "creative", "creative_id"),
        ("campaign_audience", "campaign_id", "campaign", "campaign_id"),
        ("campaign_audience", "audience_id", "audience", "audience_id"),
    ]

    for child, fk, parent, pk in foreign_keys:
        parent_ids = {row.get(pk, "") for row in tables[parent]}
        broken = [
            row for row in tables[child]
            if row.get(fk, "") and row[fk] not in parent_ids
        ]
        if broken:
            errors.append(
                f"{child}.{fk}: {len(broken)} references do not exist in "
                f"{parent}.{pk}"
            )

    # 3. Required source fields
    for table in ["campaign", "contact", "touchpoint", "opportunity"]:
        for index, row in enumerate(tables[table], start=2):
            if not any(value.strip() for value in row.values() if value):
                warnings.append(f"{table}: empty record near CSV row {index}")

    # 4. Ground-truth coverage
    labels = Counter(
        row.get("issue_type", row.get("ground_truth_label", "UNKNOWN"))
        for row in tables["ground_truth"]
    )
    required_labels = {
        "DUPLICATE_REVENUE",
        "POST_CONVERSION_TOUCH",
        "CURRENCY_MISMATCH",
        "MISSING_CAMPAIGN_COST",
        "UNSUPPORTED_IDENTITY_LINK",
    }

    # Find which column contains the anomaly label.
    observed = set()
    for row in tables["ground_truth"]:
        for value in row.values():
            if value in required_labels:
                observed.add(value)

    missing = required_labels - observed
    if missing:
        errors.append("Ground-truth labels missing: " + ", ".join(sorted(missing)))

    result = {
        "dataset": str(folder),
        "row_counts": {name: len(rows) for name, rows in tables.items()},
        "ground_truth_labels": dict(labels),
        "error_count": len(errors),
        "warning_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "status": "PASS" if not errors else "FAIL",
    }

    print(json.dumps(result, indent=2))
    output = folder / "validation_report.json"
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\nReport saved to: {output}")

    return 0 if not errors else 1

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FileNotFoundError, OSError) as exc:
        print(f"Could not validate dataset: {exc}", file=sys.stderr)
        raise SystemExit(2)
