'use client';

import React, { useState, useMemo } from 'react';
import {
  Download,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import { CampaignData, AttributionModel } from '../types/attribution';
import {
  formatINR,
  formatNumber,
  formatROI,
  MODEL_DETAILS,
} from '../utils/formatters';

interface CampaignsPageProps {
  campaigns: CampaignData[];
  selectedModel: AttributionModel;
  loading: boolean;
}

export function CampaignsPage({
  campaigns,
  selectedModel,
  loading,
}: CampaignsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [roiFilter, setRoiFilter] = useState<'ALL' | 'AVAILABLE' | 'UNAVAILABLE'>('ALL');

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const matchesSearch =
        !searchTerm ||
        `${c.campaign_code} ${c.campaign_name} ${c.channel_name} ${c.channel_type}`
          .toLowerCase()
          .includes(searchTerm.toLowerCase().trim());

      const matchesRoi =
        roiFilter === 'ALL' ||
        (roiFilter === 'AVAILABLE'
          ? c.roiStatus === 'AVAILABLE'
          : c.roiStatus !== 'AVAILABLE');

      return matchesSearch && matchesRoi;
    });
  }, [campaigns, searchTerm, roiFilter]);

  // Aggregate totals for visible filtered campaigns
  const totals = useMemo(() => {
    let totalSpend = 0;
    let totalRevenue = 0;
    let totalOrders = 0;

    for (const c of filteredCampaigns) {
      const spend =
        c.actualSpendByCurrency?.find((x) => x.currency === 'INR')?.spend ?? 0;
      const rev =
        c.attributedRevenueByCurrency?.find((x) => x.currency === 'INR')
          ?.attributed_revenue ?? 0;
      const orders =
        c.attributedRevenueByCurrency?.reduce(
          (sum, x) => sum + (x.attributed_orders || 0),
          0
        ) ?? 0;

      totalSpend += spend;
      totalRevenue += rev;
      totalOrders += orders;
    }

    return { totalSpend, totalRevenue, totalOrders };
  }, [filteredCampaigns]);

  // Export CSV handler
  const handleExportCSV = () => {
    const headers = [
      'campaign_code',
      'campaign_name',
      'status',
      'channel_name',
      'channel_type',
      'attribution_model',
      'spend_inr',
      'attributed_revenue_inr',
      'attributed_orders',
      'roi_status',
      'roi_percent',
    ];

    const rows = filteredCampaigns.map((c) => {
      const spend =
        c.actualSpendByCurrency?.find((x) => x.currency === 'INR')?.spend ?? '';
      const revenue =
        c.attributedRevenueByCurrency?.find((x) => x.currency === 'INR')
          ?.attributed_revenue ?? '';
      const orders =
        c.attributedRevenueByCurrency?.reduce(
          (sum, x) => sum + (x.attributed_orders || 0),
          0
        ) ?? 0;

      return [
        c.campaign_code,
        c.campaign_name,
        c.status,
        c.channel_name,
        c.channel_type,
        c.attributionModel || selectedModel,
        spend,
        revenue,
        orders,
        c.roiStatus,
        c.roiPercent != null ? c.roiPercent.toFixed(2) : '',
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\r\n');

    const blob = new Blob([`\uFEFF${csvContent}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `campaign-performance-${selectedModel.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderRoiCell = (c: CampaignData) => {
    if (c.roiStatus === 'AVAILABLE' && c.roiPercent != null) {
      const { text, isPositive } = formatROI(c.roiPercent);
      return (
        <span className="roi-badge available">
          {isPositive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
          <span>{text}</span>
        </span>
      );
    }

    if (c.roiStatus === 'UNAVAILABLE_CURRENCY_MISMATCH') {
      return (
        <span
          className="roi-badge currency-mismatch"
          title="Spend currency differs from revenue currency without certified FX rate"
        >
          <AlertTriangle size={12} />
          <span>Currency Mismatch</span>
        </span>
      );
    }

    if (c.roiStatus === 'UNAVAILABLE_MISSING_COST') {
      return (
        <span
          className="roi-badge missing-cost"
          title="No marketing cost record exists; ROI withheld to prevent artificial +∞"
        >
          <AlertTriangle size={12} />
          <span>Missing Cost</span>
        </span>
      );
    }

    if (c.roiStatus === 'UNAVAILABLE_NO_ATTRIBUTED_REVENUE') {
      return (
        <span
          className="roi-badge no-revenue"
          title="0 conversions attributed under this model"
        >
          <HelpCircle size={12} />
          <span>No Revenue</span>
        </span>
      );
    }

    if (c.roiStatus === 'UNAVAILABLE_ZERO_SPEND') {
      return (
        <span className="roi-badge no-revenue">
          <span>Zero Spend</span>
        </span>
      );
    }

    return (
      <span className="roi-badge no-revenue">
        <span>Unavailable</span>
      </span>
    );
  };

  return (
    <div className="content-wrapper">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-group">
          <span className="page-eyebrow">Financial Attribution Table</span>
          <h1 className="page-title">Campaign Performance</h1>
          <p className="page-description">
            Multi-touch revenue distribution, currency-safe spend reconciliation, and
            safeguarded ROI calculations under {MODEL_DETAILS[selectedModel].name} model.
          </p>
        </div>

        <div className="page-header-actions">
          <button
            className="action-btn action-btn-secondary"
            onClick={handleExportCSV}
            title="Download UTF-8 CSV table of filtered campaigns"
          >
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table Controls Bar */}
      <div className="table-controls-bar">
        <div className="search-input-wrap">
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by campaign name, code, or channel…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            className="filter-select"
            value={roiFilter}
            onChange={(e) =>
              setRoiFilter(e.target.value as 'ALL' | 'AVAILABLE' | 'UNAVAILABLE')
            }
            aria-label="Filter by ROI status"
          >
            <option value="ALL">All ROI Statuses</option>
            <option value="AVAILABLE">ROI Available Only</option>
            <option value="UNAVAILABLE">ROI Withheld / Exceptions</option>
          </select>

          <span
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            Showing {filteredCampaigns.length} of {campaigns.length}
          </span>
        </div>
      </div>

      {/* Enterprise Data Table */}
      <div className="table-container">
        <table className="enterprise-table">
          <thead>
            <tr>
              <th style={{ width: '280px' }}>Campaign</th>
              <th style={{ width: '150px' }}>Channel</th>
              <th className="num" style={{ width: '140px' }}>
                Spend (INR)
              </th>
              <th className="num" style={{ width: '160px' }}>
                Attributed Rev (INR)
              </th>
              <th className="num" style={{ width: '100px' }}>
                Orders
              </th>
              <th style={{ width: '180px' }}>Audited ROI</th>
            </tr>
          </thead>
          <tbody>
            {filteredCampaigns.map((c) => {
              const spend = c.actualSpendByCurrency?.find(
                (x) => x.currency === 'INR'
              )?.spend;
              const revenue = c.attributedRevenueByCurrency?.find(
                (x) => x.currency === 'INR'
              )?.attributed_revenue;
              const orders =
                c.attributedRevenueByCurrency?.reduce(
                  (sum, x) => sum + (x.attributed_orders || 0),
                  0
                ) ?? 0;

              return (
                <tr key={c.campaign_code}>
                  <td>
                    <div className="campaign-cell-name">
                      <span className="campaign-title-text">{c.campaign_name}</span>
                      <span className="campaign-code-tag mono">{c.campaign_code}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {c.channel_name}
                      </span>
                      <span className="channel-tag" style={{ width: 'fit-content' }}>
                        {c.channel_type}
                      </span>
                    </div>
                  </td>
                  <td className="num tabular-nums">
                    {spend != null ? formatINR(spend) : '—'}
                  </td>
                  <td className="num tabular-nums">
                    {revenue != null ? formatINR(revenue) : '—'}
                  </td>
                  <td className="num tabular-nums">{formatNumber(orders)}</td>
                  <td>{renderRoiCell(c)}</td>
                </tr>
              );
            })}

            {filteredCampaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="table-empty-row">
                  {loading
                    ? 'Loading campaign data from backend…'
                    : 'No campaigns match the active search or filter criteria.'}
                </td>
              </tr>
            )}

            {filteredCampaigns.length > 0 && (
              <tr className="table-summary-row">
                <td colSpan={2}>
                  Total ({filteredCampaigns.length} campaigns)
                </td>
                <td className="num tabular-nums">{formatINR(totals.totalSpend)}</td>
                <td className="num tabular-nums">{formatINR(totals.totalRevenue)}</td>
                <td className="num tabular-nums">{formatNumber(totals.totalOrders)}</td>
                <td style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Aggregated sums
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

