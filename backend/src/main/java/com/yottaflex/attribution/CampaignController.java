
package com.yottaflex.attribution;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/campaigns")
public class CampaignController {

    private static final Set<String> SUPPORTED_MODELS = Set.of(
        "FIRST_TOUCH",
        "LAST_TOUCH",
        "LINEAR",
        "TIME_DECAY",
        "POSITION_BASED"
    );

    private final JdbcOperations jdbc;
    public CampaignController(JdbcOperations jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public Map<String, Object> getCampaigns(
        @RequestParam(defaultValue = "LINEAR") String model
    ) {
        String selectedModel = model.trim().toUpperCase(Locale.ROOT);

        if (!SUPPORTED_MODELS.contains(selectedModel)) {
            throw new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                "Unsupported model. Choose FIRST_TOUCH, LAST_TOUCH, LINEAR, TIME_DECAY, or POSITION_BASED."
            );
        }

        List<Map<String, Object>> campaigns = jdbc.queryForList("""
            SELECT
                c.campaign_id,
                c.campaign_code,
                c.name AS campaign_name,
                c.status,
                c.start_at,
                c.end_at,
                c.budget_amount,
                TRIM(c.budget_currency) AS budget_currency,
                ch.name AS channel_name,
                ch.channel_type
            FROM campaign c
            JOIN channel ch ON ch.channel_id = c.channel_id
            ORDER BY c.campaign_code
            """);

        List<Map<String, Object>> results = new ArrayList<>();

        for (Map<String, Object> campaign : campaigns) {
            long campaignId =
                ((Number) campaign.get("campaign_id")).longValue();

            String campaignCode =
                campaign.get("campaign_code").toString();

            // Actual spend grouped by currency. Exclude the known
            // currency-mismatch record from usable spend.
            List<Map<String, Object>> spend = jdbc.queryForList("""
                SELECT
                    TRIM(currency) AS currency,
                    SUM(amount) AS spend
                FROM cost_record
                WHERE campaign_id = ?
                  AND issue_type IS DISTINCT FROM 'CURRENCY_MISMATCH'
                GROUP BY TRIM(currency)
                ORDER BY TRIM(currency)
                """, campaignId);

            // Preserve the fact that quarantined or mismatched costs exist.
            Long currencyIssueCount = jdbc.queryForObject("""
                SELECT COUNT(*)
                FROM cost_record
                WHERE campaign_id = ?
                  AND issue_type = 'CURRENCY_MISMATCH'
                """, Long.class, campaignId);

            // Aggregate only the selected model. Revenue remains separated
            // by currency; different currencies are never added together.
            List<Map<String, Object>> revenue = jdbc.queryForList("""
                SELECT
                    TRIM(o.currency) AS currency,
                    SUM(ar.attributed_revenue) AS attributed_revenue,
                    COUNT(DISTINCT ar.order_id) AS attributed_orders
                FROM attribution_result ar
                JOIN orders o ON o.order_id = ar.order_id
                WHERE ar.campaign_id = ?
                  AND ar.model = ?
                  AND ar.rule_version = 'v2-eligible-90d'
                GROUP BY TRIM(o.currency)
                ORDER BY TRIM(o.currency)
                """, campaignId, selectedModel);

            Long missingCostIssueCount = jdbc.queryForObject("""
                SELECT COUNT(*)
                FROM data_issue
                WHERE issue_type = 'MISSING_CAMPAIGN_COST'
                  AND entity_type = 'Campaign'
                  AND entity_code = ?
                """, Long.class, campaignCode);

            boolean hasCurrencyIssue = currencyIssueCount != null
                && currencyIssueCount > 0;

            boolean missingCost = missingCostIssueCount != null
                && missingCostIssueCount > 0;

            boolean hasSpend = !spend.isEmpty();
            boolean hasRevenue = !revenue.isEmpty();

            String roiStatus;
            BigDecimal roiPercent = null;

            if (missingCost) {
                roiStatus = "UNAVAILABLE_MISSING_COST";
            } else if (hasCurrencyIssue) {
                roiStatus = "UNAVAILABLE_CURRENCY_MISMATCH";
            } else if (!hasSpend) {
                roiStatus = "UNAVAILABLE_NO_COST_DATA";
            } else if (!hasRevenue) {
                roiStatus = "UNAVAILABLE_NO_ATTRIBUTED_REVENUE";
            } else if (spend.size() != 1 || revenue.size() != 1) {
                roiStatus = "UNAVAILABLE_MULTIPLE_CURRENCIES";
            } else {
                String spendCurrency =
                    spend.get(0).get("currency").toString();

                String revenueCurrency =
                    revenue.get(0).get("currency").toString();

                BigDecimal spendAmount =
                    (BigDecimal) spend.get(0).get("spend");

                BigDecimal revenueAmount =
                    (BigDecimal) revenue.get(0).get("attributed_revenue");

                if (!spendCurrency.equals(revenueCurrency)) {
                    roiStatus = "UNAVAILABLE_CURRENCY_MISMATCH";
                } else if (spendAmount.compareTo(BigDecimal.ZERO) <= 0) {
                    roiStatus = "UNAVAILABLE_ZERO_SPEND";
                } else {
                    roiPercent = revenueAmount
                        .subtract(spendAmount)
                        .multiply(BigDecimal.valueOf(100))
                        .divide(spendAmount, 2, RoundingMode.HALF_UP);

                    roiStatus = "AVAILABLE";
                }
            }

            campaign.remove("campaign_id");

            Map<String, Object> item = new LinkedHashMap<>(campaign);
            item.put("actualSpendByCurrency", spend);
            item.put("attributedRevenueByCurrency", revenue);
            item.put("attributionModel", selectedModel);
            item.put("roiStatus", roiStatus);
            item.put("roiPercent", roiPercent);
            item.put("currencyMismatchCostRecords", currencyIssueCount);
            item.put("missingCostIssueCount", missingCostIssueCount);

            results.add(item);
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("status", "ok");
        response.put("model", selectedModel);
        response.put("count", results.size());
        response.put(
            "dataNote",
            "Uses attribution results from rule version v2-eligible-90d; orders without eligible touches remain unattributed."
        );
        response.put("campaigns", results);

        return response;
    }
}
