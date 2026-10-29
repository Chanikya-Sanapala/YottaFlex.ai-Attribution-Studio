CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE channel (
  channel_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  channel_type VARCHAR(30) NOT NULL CHECK (channel_type IN ('PAID','OWNED','EARNED','OFFLINE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audience (
  audience_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audience_code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE creative (
  creative_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creative_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  format VARCHAR(30) NOT NULL CHECK (format IN ('IMAGE','VIDEO','TEXT','EMAIL','LANDING_PAGE','CALL_SCRIPT','OTHER')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','RETIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contact (
  contact_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_code VARCHAR(40) NOT NULL UNIQUE,
  synthetic_external_id VARCHAR(80) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'PROSPECT' CHECK (lifecycle_status IN ('PROSPECT','LEAD','CUSTOMER','INACTIVE')),
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE campaign (
  campaign_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_code VARCHAR(24) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  channel_id BIGINT NOT NULL REFERENCES channel(channel_id),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  budget_amount NUMERIC(18,2) NOT NULL CHECK (budget_amount >= 0),
  budget_currency CHAR(3) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at >= start_at)
);

CREATE TABLE campaign_creative (
  campaign_id BIGINT NOT NULL REFERENCES campaign(campaign_id),
  creative_id BIGINT NOT NULL REFERENCES creative(creative_id),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  PRIMARY KEY (campaign_id, creative_id, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE campaign_audience (
  campaign_id BIGINT NOT NULL REFERENCES campaign(campaign_id),
  audience_id BIGINT NOT NULL REFERENCES audience(audience_id),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  PRIMARY KEY (campaign_id, audience_id, effective_from),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE touchpoint (
  touchpoint_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  touchpoint_code VARCHAR(80) NOT NULL UNIQUE,
  contact_id BIGINT REFERENCES contact(contact_id),
  campaign_id BIGINT REFERENCES campaign(campaign_id),
  channel_id BIGINT NOT NULL REFERENCES channel(channel_id),
  creative_id BIGINT REFERENCES creative(creative_id),
  occurred_at TIMESTAMPTZ NOT NULL,
  touch_type VARCHAR(30) NOT NULL CHECK (touch_type IN ('IMPRESSION','CLICK','EMAIL_OPEN','EMAIL_CLICK','FORM_SUBMIT','CALL','EVENT','DIRECT','OTHER')),
  source_system VARCHAR(60) NOT NULL,
  is_offline BOOLEAN NOT NULL DEFAULT FALSE,
  identity_evidence VARCHAR(40) CHECK (identity_evidence IN ('AUTHENTICATED','FORM_SUBMISSION','FIRST_PARTY_COOKIE','CRM_MATCH','NONE','OTHER')),
  issue_type VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE web_session (
  session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_code VARCHAR(24) NOT NULL UNIQUE,
  contact_id BIGINT REFERENCES contact(contact_id),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  anonymous_id VARCHAR(100),
  landing_url TEXT,
  source_system VARCHAR(60) NOT NULL DEFAULT 'SYNTHETIC',
  identity_evidence VARCHAR(40) CHECK (identity_evidence IN ('AUTHENTICATED','FORM_SUBMISSION','FIRST_PARTY_COOKIE','CRM_MATCH','NONE','OTHER')),
  issue_type VARCHAR(60),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE TABLE lead (
  lead_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_code VARCHAR(24) NOT NULL UNIQUE,
  contact_id BIGINT REFERENCES contact(contact_id),
  session_id BIGINT REFERENCES web_session(session_id),
  created_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('NEW','QUALIFIED','DISQUALIFIED','CONVERTED')),
  source_campaign_id BIGINT REFERENCES campaign(campaign_id),
  synthetic_external_id VARCHAR(80) UNIQUE
);

CREATE TABLE opportunity (
  opportunity_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  opportunity_code VARCHAR(24) NOT NULL UNIQUE,
  lead_id BIGINT REFERENCES lead(lead_id),
  contact_id BIGINT REFERENCES contact(contact_id),
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  stage VARCHAR(20) NOT NULL CHECK (stage IN ('OPEN','QUALIFICATION','PROPOSAL','WON','LOST')),
  expected_amount NUMERIC(18,2) CHECK (expected_amount >= 0),
  currency CHAR(3) NOT NULL,
  CHECK (closed_at IS NULL OR closed_at >= created_at),
  CHECK ((stage IN ('WON','LOST') AND closed_at IS NOT NULL) OR stage NOT IN ('WON','LOST'))
);

CREATE TABLE orders (
  order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_code VARCHAR(30) NOT NULL UNIQUE,
  opportunity_id BIGINT REFERENCES opportunity(opportunity_id),
  contact_id BIGINT REFERENCES contact(contact_id),
  ordered_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING','PAID','REFUNDED','CANCELLED')),
  revenue_amount NUMERIC(18,2) NOT NULL CHECK (revenue_amount >= 0),
  currency CHAR(3) NOT NULL,
  revenue_event_key VARCHAR(100) NOT NULL UNIQUE,
  issue_type VARCHAR(60)
);

CREATE TABLE cost_record (
  cost_record_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cost_code VARCHAR(30) NOT NULL UNIQUE,
  campaign_id BIGINT NOT NULL REFERENCES campaign(campaign_id),
  incurred_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  currency CHAR(3) NOT NULL,
  cost_type VARCHAR(30) NOT NULL CHECK (cost_type IN ('MEDIA','PRODUCTION','AGENCY','TOOLS','OTHER')),
  source_reference VARCHAR(100),
  issue_type VARCHAR(60)
);

CREATE TABLE attribution_result (
  attribution_result_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(order_id),
  campaign_id BIGINT NOT NULL REFERENCES campaign(campaign_id),
  model VARCHAR(20) NOT NULL CHECK (model IN ('FIRST_TOUCH','LAST_TOUCH','LINEAR','TIME_DECAY','POSITION_BASED')),
  credit_fraction NUMERIC(12,10) NOT NULL CHECK (credit_fraction >= 0 AND credit_fraction <= 1),
  attributed_revenue NUMERIC(18,2) NOT NULL CHECK (attributed_revenue >= 0),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rule_version VARCHAR(40) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (order_id, campaign_id, model, rule_version)
);

CREATE TABLE entity_event (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_code VARCHAR(80) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_state JSONB,
  new_state JSONB,
  reason TEXT
);

CREATE TABLE data_issue (
  issue_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_code VARCHAR(40) NOT NULL UNIQUE,
  issue_type VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_code VARCHAR(80) NOT NULL,
  severity VARCHAR(12) NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH','CRITICAL')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ground_truth_label VARCHAR(80),
  resolution_status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN','INVESTIGATING','RESOLVED','ACCEPTED')),
  resolution_reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_touchpoint_contact_time ON touchpoint(contact_id, occurred_at);
CREATE INDEX idx_touchpoint_campaign_time ON touchpoint(campaign_id, occurred_at);
CREATE INDEX idx_session_contact_time ON web_session(contact_id, started_at);
CREATE INDEX idx_lead_contact_created ON lead(contact_id, created_at);
CREATE INDEX idx_opportunity_contact_created ON opportunity(contact_id, created_at);
CREATE INDEX idx_orders_opportunity_time ON orders(opportunity_id, ordered_at);
CREATE INDEX idx_cost_campaign_time ON cost_record(campaign_id, incurred_at);
CREATE INDEX idx_attribution_model_campaign ON attribution_result(model, campaign_id);
CREATE INDEX idx_data_issue_status_type ON data_issue(resolution_status, issue_type);
