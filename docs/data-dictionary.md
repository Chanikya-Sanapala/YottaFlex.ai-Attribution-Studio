# Initial Data Dictionary

This is a concise initial dictionary. Expand it to include every column, allowed values, units, uniqueness, and validation rules before final submission.

| Entity | Primary key | Important foreign keys | Notes |
|---|---|---|---|
| Campaign | `campaign_id` | `channel_id` | `campaign_code` uses `CMP-2026-000001`; budget uses explicit ISO currency. |
| Channel | `channel_id` | — | Unique channel code; type is PAID/OWNED/EARNED/OFFLINE. |
| Creative | `creative_id` | — | Creative format and lifecycle status are constrained. |
| Audience | `audience_id` | — | Campaign membership is represented through a bridge table. |
| Contact | `contact_id` | — | Synthetic contact only; avoid real personal data. |
| Touchpoint | `touchpoint_id` | contact, campaign, channel, creative | Contact may be unknown; temporal eligibility is checked during attribution. |
| WebSession | `session_id` | contact | Anonymous sessions can exist without a contact; identity evidence must be recorded. |
| Lead | `lead_id` | contact, session, source campaign | Status transitions should be audited. |
| Opportunity | `opportunity_id` | lead, contact | Won/lost opportunities require a close timestamp. |
| Order | `order_id` | opportunity, contact | `revenue_event_key` is unique to protect against duplicate revenue events. |
| CostRecord | `cost_record_id` | campaign | Amount and currency are stored together; currencies cannot be summed without conversion. |
| AttributionResult | `attribution_result_id` | order, campaign | Stores model, fractional credit, attributed revenue, rule version and evidence. |

## Bridge tables and audit tables
- `campaign_creative`: campaign-to-creative many-to-many relationship with effective dates.
- `campaign_audience`: campaign-to-audience many-to-many relationship with effective dates.
- `entity_event`: append-only state-change history.
- `data_issue`: explicit exception records and resolution status.

## Initial invariants
- All monetary amounts are non-negative and carry an ISO 4217 currency code.
- Campaign end time, session end time and opportunity close time cannot precede their start/create time.
- Won/lost opportunities require a close time.
- Attribution fractions are between 0 and 1; the sum per order/model/rule version must reconcile to 1 for fully attributed eligible orders.
- Attribution must exclude touchpoints after conversion and enforce the documented lookback window.
- Ground truth is held in a separate artifact and must not be used as an input feature by the detection logic.
