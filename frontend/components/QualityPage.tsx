'use client';

import React from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  UploadCloud,
  FileCheck,
  AlertTriangle,
  Scale,
  Clock,
  Fingerprint,
} from 'lucide-react';
import {
  OverviewData,
  AttributionModel,
  NavigationPage,
} from '../types/attribution';
import {
  formatNumber,
  ISSUE_REGISTRY,
  MODEL_DETAILS,
  titleCase,
} from '../utils/formatters';

interface QualityPageProps {
  overview: OverviewData | null;
  selectedModel: AttributionModel;
  onNavigate: (page: NavigationPage) => void;
  onRefresh: () => void;
  loading: boolean;
}

export function QualityPage({
  overview,
  selectedModel,
  onNavigate,
  onRefresh,
  loading,
}: QualityPageProps) {
  const issues = overview?.openDataIssues ?? 0;
  const categoriesCount = overview?.dataIssuesByType?.length ?? 5;

  const categoryIcons: Record<string, React.ElementType> = {
    CURRENCY_MISMATCH: Scale,
    MISSING_CAMPAIGN_COST: AlertTriangle,
    DUPLICATE_REVENUE: FileCheck,
    POST_CONVERSION_TOUCH: Clock,
    UNSUPPORTED_IDENTITY_LINK: Fingerprint,
  };

  return (
    <div className="content-wrapper">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-group">
          <span className="page-eyebrow">Enterprise Governance & Safeguards</span>
          <h1 className="page-title">Data Quality & Audit</h1>
          <p className="page-description">
            Continuous verification of ingestion anomalies, cross-currency quarantine,
            order deduplication, and touchpoint causality rules.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            className="action-btn action-btn-secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw
              size={13}
              className={loading ? 'spin-animation' : ''}
            />
            <span>Refresh Checks</span>
          </button>
          <button
            className="action-btn action-btn-primary"
            onClick={() => onNavigate('imports')}
          >
            <UploadCloud size={14} />
            <span>Go to Data Import</span>
          </button>
        </div>
      </div>

      {/* High-level Exception Summary Counters */}
      <section className="kpi-grid" aria-label="Quality Summary">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Total Open Exceptions</span>
            <div className="kpi-icon-pill amber">
              <ShieldAlert size={16} />
            </div>
          </div>
          <div className="kpi-value tabular-nums" style={{ color: 'var(--amber-700)' }}>
            {overview ? formatNumber(issues) : '—'}
          </div>
          <div className="kpi-footer">
            <span className="kpi-status-tag warning">Audit review required</span>
            <span>Quarantined</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Active Issue Categories</span>
            <div className="kpi-icon-pill">
              <AlertTriangle size={16} />
            </div>
          </div>
          <div className="kpi-value tabular-nums">
            {overview ? formatNumber(categoriesCount) : '5'}
          </div>
          <div className="kpi-footer">
            <span>Known anomaly types</span>
            <span>100% covered</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Active Rule Specification</span>
            <div className="kpi-icon-pill teal">
              <ShieldCheck size={16} />
            </div>
          </div>
          <div className="kpi-value mono" style={{ fontSize: '18px' }}>
            v2-eligible-90d
          </div>
          <div className="kpi-footer">
            <span>Lookback: 90 days</span>
            <span>Verified causality</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Attribution Model In Focus</span>
            <div className="kpi-icon-pill teal">
              <Scale size={16} />
            </div>
          </div>
          <div className="kpi-value" style={{ fontSize: '18px' }}>
            {MODEL_DETAILS[selectedModel].name}
          </div>
          <div className="kpi-footer">
            <span>{MODEL_DETAILS[selectedModel].tagline}</span>
          </div>
        </div>
      </section>

      {/* Detailed Issue Cards */}
      <div className="analytics-card">
        <div className="card-header-row">
          <div className="card-title-group">
            <h2 className="card-title">Categorized Ingestion Exceptions (5 Verified Classes)</h2>
            <p className="card-subtitle">
              Each class implements deterministic containment safeguards rather than
              ad-hoc visual masking.
            </p>
          </div>
        </div>

        <div className="issues-grid">
          {overview?.dataIssuesByType?.map((issue) => {
            const meta = ISSUE_REGISTRY[issue.issue_type] || {
              title: titleCase(issue.issue_type),
              severity: 'medium' as const,
              category: 'Pipeline Issue',
              summary: 'Requires review under attribution rules.',
              safeguardAction: 'Quarantined from calculations.',
              impact: 'Maintains dataset integrity.',
            };

            const Icon = categoryIcons[issue.issue_type] || ShieldAlert;

            return (
              <div className="issue-item-card" key={issue.issue_type}>
                <div className="issue-item-top">
                  <div className="issue-badge-title">
                    <Icon size={16} style={{ color: 'var(--teal-700)' }} />
                    <span>{meta.title}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="issue-item-count tabular-nums">
                      {issue.issue_count} {issue.issue_count === 1 ? 'case' : 'cases'}
                    </span>
                    <span className={`severity-pill ${meta.severity}`}>
                      {meta.severity}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {meta.category}
                </div>

                <p className="issue-item-desc">{meta.summary}</p>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    marginTop: '4px',
                  }}
                >
                  <div className="issue-item-action">
                    <strong>Safeguard:</strong> {meta.safeguardAction}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      padding: '2px 4px',
                    }}
                  >
                    <strong>Financial Impact:</strong> {meta.impact}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ROI Safeguard Policy Statement */}
      <div className="safeguard-policy-callout">
        <ShieldCheck size={22} />
        <div className="safeguard-content">
          <h4>Enterprise ROI Safeguard Governance Policy</h4>
          <p>
            {overview?.roiPolicy ||
              'ROI is unavailable when campaign costs are missing or cannot be reliably converted.'}
            <br />
            Attribution Studio adheres strictly to financial data integrity standards:
            if cost data is absent, or if marketing costs were recorded in an
            unreconciled foreign currency (e.g. USD) against an INR revenue stream without
            a daily spot FX rate, the platform explicitly classifies ROI as{' '}
            <strong className="mono">UNAVAILABLE</strong> rather than computing
            inaccurate, misleading numbers.
          </p>
        </div>
      </div>
    </div>
  );
}

