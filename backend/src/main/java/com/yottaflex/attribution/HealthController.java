package com.yottaflex.attribution;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of(
            "status", "ok",
            "service", "attribution-api",
            "timestamp", Instant.now().toString()
        );
    }

    @GetMapping("/api/overview")
    public Map<String, Object> overview() {
        Map<String, Object> result = new LinkedHashMap<>();

        result.put("status", "ok");
        result.put("generatedAt", Instant.now().toString());

        result.put("campaigns", count("campaign"));
        result.put("contacts", count("contact"));
        result.put("orders", count("orders"));
        result.put("touchpoints", count("touchpoint"));
        result.put("attributionResults", count("attribution_result"));

        result.put(
            "openDataIssues",
            jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM data_issue WHERE resolution_status = 'OPEN'",
                Long.class
            )
        );

        result.put(
            "revenueByCurrency",
            jdbcTemplate.queryForList(
                """
                SELECT currency, ROUND(SUM(revenue_amount), 2) AS revenue
                FROM orders
                GROUP BY currency
                ORDER BY currency
                """
            )
        );

        result.put(
            "validSpendByCurrency",
            jdbcTemplate.queryForList(
                """
                SELECT currency, ROUND(SUM(amount), 2) AS spend
                FROM cost_record
                WHERE issue_type IS DISTINCT FROM 'CURRENCY_MISMATCH'
                GROUP BY currency
                ORDER BY currency
                """
            )
        );

        result.put(
            "dataIssuesByType",
            jdbcTemplate.queryForList(
                """
                SELECT issue_type, COUNT(*) AS issue_count
                FROM data_issue
                GROUP BY issue_type
                ORDER BY issue_type
                """
            )
        );

        List<String> rawModels = jdbcTemplate.queryForList(
            """
            SELECT DISTINCT model
            FROM attribution_result
            WHERE rule_version = 'v2-eligible-90d'
            ORDER BY model
            """,
            String.class
        );

        if (rawModels.isEmpty()) {
            rawModels = jdbcTemplate.queryForList(
                """
                SELECT DISTINCT model
                FROM attribution_result
                ORDER BY model
                """,
                String.class
            );
        }

        List<String> standardOrder = List.of(
            "FIRST_TOUCH", "LAST_TOUCH", "LINEAR", "TIME_DECAY", "POSITION_BASED"
        );
        List<String> models = new java.util.ArrayList<>(rawModels.isEmpty() ? standardOrder : rawModels);
        models.sort(java.util.Comparator.comparingInt(m -> {
            int idx = standardOrder.indexOf(m);
            return idx >= 0 ? idx : 999;
        }));

        result.put("attributionModels", models);

        result.put(
            "roiPolicy",
            "ROI is unavailable when campaign costs are missing or cannot be reliably converted."
        );

        return result;
    }

    private long count(String tableName) {
        // Table names are fixed constants supplied by this controller.
        return jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM " + tableName,
            Long.class
        );
    }
}