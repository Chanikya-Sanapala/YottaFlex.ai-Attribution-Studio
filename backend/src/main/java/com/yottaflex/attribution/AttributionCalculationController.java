package com.yottaflex.attribution;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Recalculates attribution under a new, versioned rule set.
 *
 * Imported v1-lookback-90d rows are preserved. This endpoint only replaces
 * rows for the requested v2 rule version, making repeated runs idempotent.
 */
@RestController
@RequestMapping("/api/attribution")
public class AttributionCalculationController {

    private static final String RULE_VERSION = "v2-eligible-90d";
    private static final int LOOKBACK_DAYS = 90;
    private static final double TIME_DECAY_HALF_LIFE_DAYS = 7.0;
    private static final Set<String> MODELS = Set.of(
        "FIRST_TOUCH", "LAST_TOUCH", "LINEAR", "TIME_DECAY", "POSITION_BASED"
    );
    private static final Set<String> ACCEPTED_IDENTITY_EVIDENCE = Set.of(
        "AUTHENTICATED", "FORM_SUBMISSION", "FIRST_PARTY_COOKIE", "CRM_MATCH"
    );

    private final JdbcTemplate jdbc;

    public AttributionCalculationController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostMapping("/recalculate")
    @Transactional
    public Map<String, Object> recalculate(
        @RequestParam(defaultValue = "all") String model
    ) {
        String requested = model.trim().toUpperCase(Locale.ROOT);
        if (!requested.equals("ALL") && !MODELS.contains(requested)) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Unsupported model. Choose FIRST_TOUCH, LAST_TOUCH, LINEAR, TIME_DECAY, POSITION_BASED, or ALL."
            );
        }

        List<String> models = requested.equals("ALL")
            ? List.of("FIRST_TOUCH", "LAST_TOUCH", "LINEAR", "TIME_DECAY", "POSITION_BASED")
            : List.of(requested);

        List<OrderTouch> rows = jdbc.query("""
            SELECT
                o.order_id,
                o.order_code,
                o.ordered_at,
                o.revenue_amount,
                TRIM(o.currency) AS currency,
                o.revenue_event_key,
                t.touchpoint_id,
                t.touchpoint_code,
                t.campaign_id,
                t.occurred_at,
                t.identity_evidence,
                t.issue_type AS touch_issue_type
            FROM orders o
            LEFT JOIN touchpoint t
              ON t.contact_id = o.contact_id
             AND t.campaign_id IS NOT NULL
             AND t.occurred_at <= o.ordered_at
             AND t.occurred_at >= o.ordered_at - (? * INTERVAL '1 day')
             AND t.identity_evidence IN ('AUTHENTICATED', 'FORM_SUBMISSION', 'FIRST_PARTY_COOKIE', 'CRM_MATCH')
             AND t.issue_type IS DISTINCT FROM 'POST_CONVERSION_TOUCH'
            WHERE o.status = 'PAID'
              AND o.contact_id IS NOT NULL
            ORDER BY o.order_id, t.occurred_at, t.touchpoint_id
            """, orderTouchMapper(), LOOKBACK_DAYS);

        Map<Long, OrderData> orders = new LinkedHashMap<>();
        for (OrderTouch row : rows) {
            OrderData order = orders.computeIfAbsent(row.orderId, ignored ->
                new OrderData(
                    row.orderId, row.orderCode, row.orderedAt,
                    row.revenueAmount, row.currency, row.revenueEventKey
                )
            );
            if (row.touchpointId != null) {
                order.touches.add(new Touch(
                    row.touchpointId, row.touchpointCode, row.campaignId,
                    row.touchpointAt, row.identityEvidence, row.touchIssueType
                ));
            }
        }

        // Revenue event keys are unique in the schema. Keep an explicit guard
        // here as well, so a future import/schema change cannot double-count.
        Map<String, Long> firstOrderForRevenueEvent = new LinkedHashMap<>();
        List<OrderData> deduplicatedOrders = new ArrayList<>();
        int duplicateOrdersSkipped = 0;
        for (OrderData order : orders.values()) {
            Long existing = firstOrderForRevenueEvent.putIfAbsent(
                order.revenueEventKey, order.orderId
            );
            if (existing == null) {
                deduplicatedOrders.add(order);
            } else {
                duplicateOrdersSkipped++;
            }
        }

        int insertedRows = 0;
        int ordersWithEligibleTouches = 0;
        int ordersWithoutEligibleTouches = 0;
        int excludedUnsupportedIdentityCount = jdbc.queryForObject("""
            SELECT COUNT(*)
            FROM touchpoint t
            JOIN orders o ON o.contact_id = t.contact_id
            WHERE o.status = 'PAID'
              AND t.campaign_id IS NOT NULL
              AND t.occurred_at <= o.ordered_at
              AND t.occurred_at >= o.ordered_at - (? * INTERVAL '1 day')
              AND (t.identity_evidence IS NULL OR t.identity_evidence NOT IN
                   ('AUTHENTICATED', 'FORM_SUBMISSION', 'FIRST_PARTY_COOKIE', 'CRM_MATCH'))
            """, Integer.class, LOOKBACK_DAYS);

        for (String selectedModel : models) {
            // Only replace this endpoint's version; imported v1 rows remain.
            jdbc.update(
                "DELETE FROM attribution_result WHERE model = ? AND rule_version = ?",
                selectedModel, RULE_VERSION
            );

            for (OrderData order : deduplicatedOrders) {
                List<Touch> touches = order.touches.stream()
                    .sorted(Comparator.comparing((Touch t) -> t.occurredAt)
                        .thenComparingLong(t -> t.touchpointId))
                    .toList();

                if (touches.isEmpty()) {
                    if (selectedModel.equals(models.get(0))) {
                        ordersWithoutEligibleTouches++;
                    }
                    continue;
                }
                if (selectedModel.equals(models.get(0))) {
                    ordersWithEligibleTouches++;
                }

                Map<Long, BigDecimal> campaignCredits = calculateCredits(
                    touches, selectedModel, order.orderedAt
                );

                BigDecimal totalCredit = campaignCredits.values().stream()
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
                if (totalCredit.compareTo(BigDecimal.ZERO) <= 0) {
                    continue;
                }

                // Normalize after rounding so the persisted fractions sum to 1.
                Map<Long, BigDecimal> normalized = normalizeCredits(campaignCredits);
                BigDecimal sum = normalized.values().stream()
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
                if (sum.compareTo(BigDecimal.ONE) != 0 && !normalized.isEmpty()) {
                    Long lastCampaign = new ArrayList<>(normalized.keySet())
                        .get(normalized.size() - 1);
                    normalized.put(
                        lastCampaign,
                        normalized.get(lastCampaign).add(BigDecimal.ONE.subtract(sum))
                    );
                }

                for (Map.Entry<Long, BigDecimal> entry : normalized.entrySet()) {
                    BigDecimal fraction = entry.getValue();
                    BigDecimal attributedRevenue = order.revenueAmount
                        .multiply(fraction)
                        .setScale(2, RoundingMode.HALF_UP);

                    Map<String, Object> evidence = new LinkedHashMap<>();
                    evidence.put("eligibleTouchpointCount", touches.size());
                    evidence.put("lookbackDays", LOOKBACK_DAYS);
                    evidence.put("identityEvidenceAccepted", ACCEPTED_IDENTITY_EVIDENCE);
                    evidence.put("timeDecayHalfLifeDays", TIME_DECAY_HALF_LIFE_DAYS);
                    evidence.put("revenueEventKey", order.revenueEventKey);
                    evidence.put("eligibleTouchpoints", touches.stream()
                        .map(t -> t.touchpointCode).toList());

                    jdbc.update("""
                        INSERT INTO attribution_result
                            (order_id, campaign_id, model, credit_fraction,
                             attributed_revenue, calculated_at, rule_version, evidence)
                        VALUES (?, ?, ?, ?, ?, NOW(), ?, CAST(? AS jsonb))
                        """,
                        order.orderId,
                        entry.getKey(),
                        selectedModel,
                        fraction,
                        attributedRevenue,
                        RULE_VERSION,
                        toJson(evidence)
                    );
                    insertedRows++;
                }
            }
        }

        List<Map<String, Object>> validation = jdbc.queryForList("""
            SELECT model,
                   COUNT(*) AS result_rows,
                   COUNT(DISTINCT order_id) AS attributed_orders,
                   COUNT(*) FILTER (
                     WHERE ABS(credit_fraction) > 1 OR credit_fraction < 0
                   ) AS invalid_fraction_rows
            FROM attribution_result
            WHERE rule_version = ?
            GROUP BY model
            ORDER BY model
            """, RULE_VERSION);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "ok");
        response.put("ruleVersion", RULE_VERSION);
        response.put("modelsProcessed", models);
        response.put("paidOrdersEvaluated", deduplicatedOrders.size());
        response.put("ordersWithEligibleTouches", ordersWithEligibleTouches);
        response.put("ordersWithoutEligibleTouches", ordersWithoutEligibleTouches);
        response.put("unsupportedIdentityTouchOrderPairsExcluded", excludedUnsupportedIdentityCount);
        response.put("duplicateRevenueEventsSkipped", duplicateOrdersSkipped);
        response.put("insertedAttributionRows", insertedRows);
        response.put("validationByModel", validation);
        response.put("note", "Imported v1-lookback-90d rows are preserved. v2 uses eligible touchpoints only.");
        return response;
    }

    private Map<Long, BigDecimal> calculateCredits(
        List<Touch> touches, String model, Instant conversionAt
    ) {
        Map<Long, BigDecimal> credits = new TreeMap<>();
        int n = touches.size();

        if (model.equals("FIRST_TOUCH")) {
            credits.put(touches.get(0).campaignId, BigDecimal.ONE);
        } else if (model.equals("LAST_TOUCH")) {
            credits.put(touches.get(n - 1).campaignId, BigDecimal.ONE);
        } else if (model.equals("LINEAR")) {
            BigDecimal share = BigDecimal.ONE.divide(
                BigDecimal.valueOf(n), 10, RoundingMode.HALF_UP
            );
            for (Touch touch : touches) {
                credits.merge(touch.campaignId, share, BigDecimal::add);
            }
        } else if (model.equals("POSITION_BASED")) {
            if (n == 1) {
                credits.put(touches.get(0).campaignId, BigDecimal.ONE);
            } else if (n == 2) {
                credits.merge(touches.get(0).campaignId, new BigDecimal("0.5"), BigDecimal::add);
                credits.merge(touches.get(1).campaignId, new BigDecimal("0.5"), BigDecimal::add);
            } else {
                credits.merge(touches.get(0).campaignId, new BigDecimal("0.4"), BigDecimal::add);
                credits.merge(touches.get(n - 1).campaignId, new BigDecimal("0.4"), BigDecimal::add);
                BigDecimal middleShare = new BigDecimal("0.2")
                    .divide(BigDecimal.valueOf(n - 2), 10, RoundingMode.HALF_UP);
                for (int i = 1; i < n - 1; i++) {
                    credits.merge(touches.get(i).campaignId, middleShare, BigDecimal::add);
                }
            }
        } else if (model.equals("TIME_DECAY")) {
            List<Double> weights = new ArrayList<>();
            double total = 0.0;
            for (Touch touch : touches) {
                double ageDays = Math.max(
                    0.0, Duration.between(touch.occurredAt, conversionAt).toSeconds() / 86400.0
                );
                double weight = Math.pow(2.0, -ageDays / TIME_DECAY_HALF_LIFE_DAYS);
                weights.add(weight);
                total += weight;
            }
            for (int i = 0; i < touches.size(); i++) {
                BigDecimal share = BigDecimal.valueOf(weights.get(i) / total)
                    .setScale(10, RoundingMode.HALF_UP);
                credits.merge(touches.get(i).campaignId, share, BigDecimal::add);
            }
        }
        return credits;
    }

    private Map<Long, BigDecimal> normalizeCredits(Map<Long, BigDecimal> credits) {
        BigDecimal total = credits.values().stream()
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        Map<Long, BigDecimal> normalized = new LinkedHashMap<>();
        if (total.signum() == 0) {
            return normalized;
        }
        for (Map.Entry<Long, BigDecimal> entry : credits.entrySet()) {
            normalized.put(
                entry.getKey(),
                entry.getValue().divide(total, 10, RoundingMode.HALF_UP)
            );
        }
        return normalized;
    }

    private RowMapper<OrderTouch> orderTouchMapper() {
        return (ResultSet rs, int rowNum) -> new OrderTouch(
            rs.getLong("order_id"),
            rs.getString("order_code"),
            instant(rs, "ordered_at"),
            rs.getBigDecimal("revenue_amount"),
            rs.getString("currency").trim(),
            rs.getString("revenue_event_key"),
            nullableLong(rs, "touchpoint_id"),
            rs.getString("touchpoint_code"),
            nullableLong(rs, "campaign_id"),
            instantNullable(rs, "occurred_at"),
            rs.getString("identity_evidence"),
            rs.getString("touch_issue_type")
        );
    }

    private Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp timestamp = rs.getTimestamp(column);
        return timestamp == null ? null : timestamp.toInstant();
    }

    private Instant instantNullable(ResultSet rs, String column) throws SQLException {
        return instant(rs, column);
    }

    private Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private String toJson(Map<String, Object> values) {
        // Small local JSON serializer avoids adding another dependency.
        StringBuilder out = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            if (!first) out.append(',');
            first = false;
            out.append('"').append(escape(entry.getKey())).append("\":");
            Object value = entry.getValue();
            if (value instanceof Number || value instanceof Boolean) {
                out.append(value);
            } else if (value instanceof List<?> list) {
                out.append('[');
                for (int i = 0; i < list.size(); i++) {
                    if (i > 0) out.append(',');
                    out.append('"').append(escape(String.valueOf(list.get(i)))).append('"');
                }
                out.append(']');
            } else {
                out.append('"').append(escape(String.valueOf(value))).append('"');
            }
        }
        return out.append('}').toString();
    }

    private String escape(String value) {
        return value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    private static final class OrderData {
        final long orderId;
        final String orderCode;
        final Instant orderedAt;
        final BigDecimal revenueAmount;
        final String currency;
        final String revenueEventKey;
        final List<Touch> touches = new ArrayList<>();

        OrderData(long orderId, String orderCode, Instant orderedAt,
                  BigDecimal revenueAmount, String currency, String revenueEventKey) {
            this.orderId = orderId;
            this.orderCode = orderCode;
            this.orderedAt = orderedAt;
            this.revenueAmount = revenueAmount;
            this.currency = currency;
            this.revenueEventKey = revenueEventKey;
        }
    }

    private static final class Touch {
        final long touchpointId;
        final String touchpointCode;
        final long campaignId;
        final Instant occurredAt;
        final String identityEvidence;
        final String issueType;

        Touch(long touchpointId, String touchpointCode, long campaignId,
              Instant occurredAt, String identityEvidence, String issueType) {
            this.touchpointId = touchpointId;
            this.touchpointCode = touchpointCode;
            this.campaignId = campaignId;
            this.occurredAt = occurredAt;
            this.identityEvidence = identityEvidence;
            this.issueType = issueType;
        }
    }

    private static final class OrderTouch {
        final long orderId;
        final String orderCode;
        final Instant orderedAt;
        final BigDecimal revenueAmount;
        final String currency;
        final String revenueEventKey;
        final Long touchpointId;
        final String touchpointCode;
        final Long campaignId;
        final Instant touchpointAt;
        final String identityEvidence;
        final String touchIssueType;

        OrderTouch(long orderId, String orderCode, Instant orderedAt,
                   BigDecimal revenueAmount, String currency, String revenueEventKey,
                   Long touchpointId, String touchpointCode, Long campaignId,
                   Instant touchpointAt, String identityEvidence, String touchIssueType) {
            this.orderId = orderId;
            this.orderCode = orderCode;
            this.orderedAt = orderedAt;
            this.revenueAmount = revenueAmount;
            this.currency = currency;
            this.revenueEventKey = revenueEventKey;
            this.touchpointId = touchpointId;
            this.touchpointCode = touchpointCode;
            this.campaignId = campaignId;
            this.touchpointAt = touchpointAt;
            this.identityEvidence = identityEvidence;
            this.touchIssueType = touchIssueType;
        }
    }
}
