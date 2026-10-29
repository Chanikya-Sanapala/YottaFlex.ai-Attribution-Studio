'use client';

import React from 'react';
import {
  CircleDollarSign,
  TrendingUp,
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
  Users,
  Compass,
  CheckCircle2,
  GitCommit,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  OverviewData,
  CampaignData,
  AttributionModel,
  SUPPORTED_MODELS,
  NavigationPage,
} from '../types/attribution';
import {
  formatINR,
  formatNumber,
  MODEL_DETAILS,
  ISSUE_REGISTRY,
  titleCase,
} from '../utils/formatters';

interface OverviewPageProps {
  overview: OverviewData | null;
  campaigns: CampaignData[];
  selectedModel: AttributionModel;
  onSelectModel: (model: AttributionModel) => void;
  onNavigate: (page: NavigationPage) => void;
  loading: boolean;
}

export function OverviewPage({
  overview,
  campaigns,
  selectedModel,
  onSelectModel,
  onNavigate,
  loading,
}: OverviewPageProps) {
  const inrRevenue =
    overview?.revenueByCurrency?.find((r) => r.currency === 'INR')?.revenue ?? 0;
  const inrSpend =
    overview?.validSpendByCurrency?.find((s) => s.currency === 'INR')?.spend ?? 0;
  const openIssues = overview?.openDataIssues ?? 0;
  const totalCampaigns = campaigns.length;
  const roiAvailableCount = campaigns.filter((c) => c.roiStatus === 'AVAILABLE').length;
  const roiUnavailableCount = totalCampaigns - roiAvailableCount;

  // Top 8 campaigns sorted by attributed revenue
  const chartData = [...campaigns]
    .sort((a, b) => {
      const revA =
        a.attributedRevenueByCurrency?.find((x) => x.currency === 'INR')
          ?.attributed_revenue ?? 0;
      const revB =
        b.attributedRevenueByCurrency?.find((x) => x.currency === 'INR')
          ?.attributed_revenue ?? 0;
      return revB - revA;
    })
    .slice(0, 8)
    .map((c) => {
      const spend =
        c.actualSpendByCurrency?.find((x) => x.currency === 'INR')?.spend ?? 0;
      const revenue =
        c.attributedRevenueByCurrency?.find((x) => x.currency === 'INR')
          ?.attributed_revenue ?? 0;
      return {
        name: c.campaign_name.replace(' Campaign ', ' ').replace('Campaign ', ''),
        code: c.campaign_code,
        channel: c.channel_name,
        spend,
        revenue,
      };
    });

  const activeModelDetail = MODEL_DETAILS[selectedModel];

  return (
    <div className="content-wrapper">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-group">
          <span className="page-eyebrow">Enterprise Attribution Analytics</span>
          <h1 className="page-title">Marketing Overview</h1>
          <p className="page-description">
            Evaluate multi-touch conversion attribution, reconcile verified marketing
            spend against orders, and audit attribution model sensitivity.
          </p>
        </div>
      </div>

      {/* KPI 4-Card Grid */}
      <section className="kpi-grid" aria-label="Key Performance Indicators">
        {/* KPI 1: Attributed Revenue */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Reconciled Total Revenue</span>
            <div className="kpi-icon-pill teal">
              <CircleDollarSign size={16} />
            </div>
          </div>
          <div className="kpi-value tabular-nums">
            {overview ? formatINR(inrRevenue) : '—'}
          </div>
          <div className="kpi-footer">
            <span className="kpi-status-tag positive">
              <ArrowUpRight size={13} /> Paid orders reconciled
            </span>
            <span>INR Currency</span>
          </div>
        </div>

        {/* KPI 2: Valid Marketing Spend */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Valid Marketing Spend</span>
            <div className="kpi-icon-pill">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="kpi-value tabular-nums">
            {overview ? formatINR(inrSpend) : '—'}
          </div>
          <div className="kpi-footer">
            <span>Currency-safe records</span>
            <span title="Excludes 1 quarantined cross-currency cost record">
              1 quarantined excluded
            </span>
          </div>
        </div>

        {/* KPI 3: Total Campaigns */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Active Campaigns</span>
            <div className="kpi-icon-pill">
              <Activity size={16} />
            </div>
          </div>
          <div className="kpi-value tabular-nums">
            {overview ? formatNumber(totalCampaigns) : '—'}
          </div>
          <div className="kpi-footer">
            <span className="kpi-status-tag positive">
              {roiAvailableCount} with valid ROI
            </span>
            <span>{activeModelDetail.name}</span>
          </div>
        </div>

        {/* KPI 4: Open Data Issues */}
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Open Data Issues</span>
            <div className="kpi-icon-pill amber">
              <AlertTriangle size={16} />
            </div>
          </div>
          <div className="kpi-value tabular-nums">
            {overview ? formatNumber(openIssues) : '—'}
          </div>
          <div className="kpi-footer">
            <span className={`kpi-status-tag ${openIssues > 0 ? 'warning' : 'positive'}`}>
              {openIssues > 0 ? 'Audit Action Required' : 'All Checks Clear'}
            </span>
            <span>5 categories</span>
          </div>
        </div>
      </section>

      {/* Secondary Metrics Counter Strip */}
      <section className="metrics-strip" aria-label="Pipeline Entity Counts">
        <div className="strip-item">
          <Users size={18} className="strip-icon" />
          <div className="strip-copy">
            <span className="strip-label">Contacts</span>
            <span className="strip-value tabular-nums">
              {overview ? formatNumber(overview.contacts) : '—'}
            </span>
          </div>
        </div>

        <div className="strip-item">
          <Compass size={18} className="strip-icon" />
          <div className="strip-copy">
            <span className="strip-label">Touchpoints</span>
            <span className="strip-value tabular-nums">
              {overview ? formatNumber(overview.touchpoints) : '—'}
            </span>
          </div>
        </div>

        <div className="strip-item">
          <CheckCircle2 size={18} className="strip-icon" />
          <div className="strip-copy">
            <span className="strip-label">Paid Orders</span>
            <span className="strip-value tabular-nums">
              {overview ? formatNumber(overview.orders) : '—'}
            </span>
          </div>
        </div>

        <div className="strip-item">
          <GitCommit size={18} className="strip-icon" />
          <div className="strip-copy">
            <span className="strip-label">Attribution Results</span>
            <span className="strip-value tabular-nums">
              {overview ? formatNumber(overview.attributionResults) : '—'}
            </span>
          </div>
        </div>
      </section>

      {/* Main Two-Column Analytics Layout */}
      <div className="dashboard-grid-2col">
        {/* Left Column: Spend vs. Attributed Revenue Chart */}
        <div className="analytics-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h2 className="card-title">Spend vs. Attributed Revenue</h2>
              <p className="card-subtitle">
                Top 8 campaigns ranked by attributed revenue under {activeModelDetail.name}{' '}
                model (INR)
              </p>
            </div>
            <div className="chart-legend-row">
              <div className="legend-item">
                <span className="legend-dot spend" />
                <span>Spend</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot revenue" />
                <span>Attributed Revenue</span>
              </div>
            </div>
          </div>

          <div className="chart-container">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 12, right: 12, left: 10, bottom: 44 }}
                  barGap={4}
                >
                  <CartesianGrid
                    strokeDasharray="2 2"
                    vertical={false}
                    stroke="#f1f5f9"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    angle={-22}
                    textAnchor="end"
                    interval={0}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickFormatter={(val: number) => {
                      if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
                      if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
                      if (val >= 1000) return `₹${(val / 1000).toFixed(0)}k`;
                      return `₹${val}`;
                    }}
                    width={56}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(15, 23, 42, 0.03)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload;
                      const spendVal = item.spend as number;
                      const revVal = item.revenue as number;
                      const netReturn = revVal - spendVal;
                      return (
                        <div className="custom-tooltip">
                          <div className="tooltip-title">{item.name}</div>
                          <div className="tooltip-row">
                            <span>Code:</span>
                            <span className="mono">{item.code}</span>
                          </div>
                          <div className="tooltip-row">
                            <span>Channel:</span>
                            <span>{item.channel}</span>
                          </div>
                          <div className="tooltip-row">
                            <span>Actual Spend:</span>
                            <strong>{formatINR(spendVal)}</strong>
                          </div>
                          <div className="tooltip-row">
                            <span>Attributed Rev:</span>
                            <strong>{formatINR(revVal)}</strong>
                          </div>
                          <div className="tooltip-row">
                            <span>Net Balance:</span>
                            <strong
                              style={{
                                color: netReturn >= 0 ? '#34d399' : '#f87171',
                              }}
                            >
                              {formatINR(netReturn)}
                            </strong>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="spend"
                    name="Spend"
                    fill="#94a3b8"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="revenue"
                    name="Attributed Revenue"
                    fill="#0d9488"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                {loading ? 'Loading campaign data…' : 'No campaign data found.'}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Attribution Model Engine Selector */}
        <div className="analytics-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h2 className="card-title">Attribution Model Engine</h2>
              <p className="card-subtitle">
                Select from all 5 supported touchpoint distribution algorithms
              </p>
            </div>
            <Layers size={18} style={{ color: 'var(--text-muted)' }} />
          </div>

          <div className="model-selector-wrap">
            <div className="model-segmented-control">
              {SUPPORTED_MODELS.map((m) => {
                const info = MODEL_DETAILS[m];
                const isSelected = selectedModel === m;
                return (
                  <button
                    key={m}
                    className={`model-option-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectModel(m)}
                    type="button"
                  >
                    <span className="model-option-name">{info.name}</span>
                    <span className="model-option-tag">{info.weighting}</span>
                  </button>
                );
              })}
            </div>

            {/* Selected Model Deep Dive */}
            <div className="model-detail-card">
              <p className="model-detail-desc">{activeModelDetail.description}</p>
              <div className="model-detail-formula mono">
                Formula: {activeModelDetail.formula}
              </div>
            </div>

            {/* Model Evaluation Summary Stats */}
            <div>
              <div className="model-stat-row">
                <span>Rule Version</span>
                <span className="mono">v2-eligible-90d</span>
              </div>
              <div className="model-stat-row">
                <span>Total Campaigns Processed</span>
                <strong className="tabular-nums">{totalCampaigns}</strong>
              </div>
              <div className="model-stat-row">
                <span>ROI Available</span>
                <strong className="tabular-nums" style={{ color: 'var(--emerald-600)' }}>
                  {roiAvailableCount} of {totalCampaigns}
                </strong>
              </div>
              <div className="model-stat-row">
                <span>ROI Withheld (Safeguard)</span>
                <strong className="tabular-nums" style={{ color: 'var(--amber-700)' }}>
                  {roiUnavailableCount}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Data Quality Findings Section */}
      <div className="analytics-card">
        <div className="card-header-row">
          <div className="card-title-group">
            <h2 className="card-title">Data Quality Exceptions & Audit Safeguards</h2>
            <p className="card-subtitle">
              Active anomalies flagged by data verification rules. ROI is quarantined
              rather than silently converted to zero.
            </p>
          </div>
          <button
            className="action-btn action-btn-secondary"
            onClick={() => onNavigate('quality')}
          >
            <span>Audit All Issues</span>
            <ArrowRight size={13} />
          </button>
        </div>

        <div className="issues-grid">
          {overview?.dataIssuesByType?.map((issue) => {
            const meta = ISSUE_REGISTRY[issue.issue_type] || {
              title: titleCase(issue.issue_type),
              severity: 'medium' as const,
              summary: 'Requires review under attribution rules.',
              safeguardAction: 'Flagged for pipeline audit.',
            };
            return (
              <div className="issue-item-card" key={issue.issue_type}>
                <div className="issue-item-top">
                  <div className="issue-badge-title">
                    <ShieldAlert size={15} style={{ color: 'var(--amber-600)' }} />
                    <span>{meta.title}</span>
                  </div>
                  <span className={`severity-pill ${meta.severity}`}>
                    {meta.severity}
                  </span>
                </div>
                <p className="issue-item-desc">{meta.summary}</p>
                <div className="issue-item-action">{meta.safeguardAction}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

