'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { OverviewPage } from '../components/OverviewPage';
import { CampaignsPage } from '../components/CampaignsPage';
import { QualityPage } from '../components/QualityPage';
import { ImportPage } from '../components/ImportPage';
import {
  AttributionModel,
  NavigationPage,
  OverviewData,
  CampaignData,
  StagedFile,
} from '../types/attribution';
import { SUPPORTED_DATASETS } from '../utils/formatters';
import { AlertCircle } from 'lucide-react';

function parseCSVPreview(text: string): { headers: string[]; rows: number } {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return { headers: [], rows: 0 };
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: 0 };

  const headerLine = lines[0];
  const headers = headerLine
    .split(',')
    .map((h) => h.trim().replace(/^["']|["']$/g, ''));

  return {
    headers,
    rows: Math.max(0, lines.length - 1),
  };
}

export default function Home() {
  const [selectedModel, setSelectedModel] = useState<AttributionModel>('LINEAR');
  const [currentPage, setCurrentPage] = useState<NavigationPage>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [importNotice, setImportNotice] = useState<string>('');

  // Primary API loader
  const loadData = useCallback(async (modelToUse: AttributionModel = selectedModel) => {
    setLoading(true);
    setError('');

    try {
      const [overviewRes, campaignsRes] = await Promise.all([
        fetch('/backend-api/api/overview', { cache: 'no-store' }),
        fetch(`/backend-api/api/campaigns?model=${modelToUse}`, {
          cache: 'no-store',
        }),
      ]);

      if (!overviewRes.ok) {
        throw new Error(`Overview API returned HTTP ${overviewRes.status}`);
      }
      if (!campaignsRes.ok) {
        throw new Error(`Campaigns API returned HTTP ${campaignsRes.status}`);
      }

      const overviewJson: OverviewData = await overviewRes.json();
      const campaignsJson = await campaignsRes.json();

      setOverview(overviewJson);
      setCampaigns(
        Array.isArray(campaignsJson.campaigns) ? campaignsJson.campaigns : []
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? `${err.message}. Ensure Spring Boot is running on port 8080.`
          : 'Failed to communicate with attribution backend.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedModel]);

  // Initial load
  useEffect(() => {
    void loadData(selectedModel);
  }, [loadData, selectedModel]);

  // Model change handler
  const handleSelectModel = (newModel: AttributionModel) => {
    if (newModel === selectedModel) return;
    setSelectedModel(newModel);
    void loadData(newModel);
  };

  // CSV Staging handler
  const handleAddFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith('.csv')
    );

    if (incoming.length === 0) {
      setImportNotice('Please select one or more valid .csv files.');
      return;
    }

    const parsed: StagedFile[] = await Promise.all(
      incoming.map(async (file) => {
        const text = await file.text();
        const { headers, rows } = parseCSVPreview(text);
        const datasetName = file.name.toLowerCase().replace(/\.csv$/, '');
        const isSupported = SUPPORTED_DATASETS.includes(
          datasetName as (typeof SUPPORTED_DATASETS)[number]
        );

        let validationError = '';
        if (headers.length === 0) {
          validationError = 'File is empty or contains no valid header row.';
        } else if (!isSupported) {
          validationError =
            'Filename does not match a known dataset. Expected e.g. campaign.csv, touchpoint.csv.';
        }

        return {
          file,
          rows,
          headers,
          dataset: isSupported ? datasetName : '',
          error: validationError,
        };
      })
    );

    setStagedFiles((prev) => {
      const updated = [...prev];
      for (const item of parsed) {
        const existingIdx = updated.findIndex(
          (x) => x.file.name.toLowerCase() === item.file.name.toLowerCase()
        );
        if (existingIdx >= 0) {
          updated[existingIdx] = item;
        } else {
          updated.push(item);
        }
      }
      return updated;
    });

    setImportNotice(
      `${parsed.length} file(s) staged for local preview. No database records modified.`
    );
  };

  const handleRemoveStagedFile = (index: number) => {
    setStagedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleClearStagedFiles = () => {
    setStagedFiles([]);
    setImportNotice('Staged files cleared. No database modifications made.');
  };

  const openIssuesCount = overview?.openDataIssues ?? 0;

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${
        mobileMenuOpen ? 'mobile-open' : ''
      }`}
    >
      {/* Mobile Backdrop Scrim */}
      {mobileMenuOpen && (
        <div
          className="mobile-scrim"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Persistent Enterprise Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onPageChange={(page) => {
          setCurrentPage(page);
          setMobileMenuOpen(false);
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        openIssuesCount={openIssuesCount}
        apiConnected={!error && overview != null}
        apiLoading={loading && !overview}
      />

      {/* Main App Canvas */}
      <main className="app-main">
        {/* Sticky Topbar */}
        <Header
          currentPage={currentPage}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          loading={loading}
          onRefresh={() => void loadData(selectedModel)}
          apiConnected={!error && overview != null}
          activeModel={selectedModel}
        />

        {/* Global Connection Error Banner */}
        {error && (
          <div style={{ padding: '0 28px', marginTop: '16px' }}>
            <div className="error-banner">
              <div className="error-banner-content">
                <AlertCircle size={18} />
                <span>
                  <strong>API Connection Notice:</strong> {error}
                </span>
              </div>
              <button
                className="action-btn action-btn-secondary"
                onClick={() => void loadData(selectedModel)}
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Page Views */}
        {currentPage === 'overview' && (
          <OverviewPage
            overview={overview}
            campaigns={campaigns}
            selectedModel={selectedModel}
            onSelectModel={handleSelectModel}
            onNavigate={(p) => setCurrentPage(p)}
            loading={loading}
          />
        )}

        {currentPage === 'campaigns' && (
          <CampaignsPage
            campaigns={campaigns}
            selectedModel={selectedModel}
            loading={loading}
          />
        )}

        {currentPage === 'quality' && (
          <QualityPage
            overview={overview}
            selectedModel={selectedModel}
            onNavigate={(p) => setCurrentPage(p)}
            onRefresh={() => void loadData(selectedModel)}
            loading={loading}
          />
        )}

        {currentPage === 'imports' && (
          <ImportPage
            files={stagedFiles}
            onAddFiles={handleAddFiles}
            onRemoveFile={handleRemoveStagedFile}
            onClearFiles={handleClearStagedFiles}
            notice={importNotice}
          />
        )}

        {/* Persistent Enterprise Footer */}
        <footer className="app-footer">
          <div>
            <span>© YottaFlex.ai · Attribution Studio</span>
            <span style={{ margin: '0 8px', color: 'var(--border-strong)' }}>|</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              Deterministic Rule Version:{' '}
              <strong className="mono">v2-eligible-90d</strong>
            </span>
          </div>

          <div>
            <span>
              {overview?.generatedAt
                ? `Last synced: ${new Date(overview.generatedAt).toLocaleTimeString(
                    'en-IN',
                    { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                  )}`
                : 'Connecting to backend…'}
            </span>
            <span style={{ margin: '0 8px', color: 'var(--border-strong)' }}>·</span>
            <span>PostgreSQL 16 · Spring Boot 3</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
