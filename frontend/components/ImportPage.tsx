'use client';

import React, { useState, DragEvent, ChangeEvent } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { StagedFile } from '../types/attribution';
import {
  SUPPORTED_DATASETS,
  formatNumber,
} from '../utils/formatters';

interface ImportPageProps {
  files: StagedFile[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (index: number) => void;
  onClearFiles: () => void;
  notice: string;
}

export function ImportPage({
  files,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
  notice,
}: ImportPageProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      onAddFiles(e.target.files);
    }
    e.target.value = '';
  };

  const pipelineSteps = [
    {
      num: '1',
      title: 'Stage & Preview',
      desc: 'Parse client-side CSV files, verify column headers, count records.',
      status: 'Ready',
      isReady: true,
    },
    {
      num: '2',
      title: 'Validate Schema',
      desc: 'Verify types, non-null constraints, timestamps, and currency codes.',
      status: 'Planned',
      isReady: false,
    },
    {
      num: '3',
      title: 'Check Integrity',
      desc: 'Enforce relational foreign keys between touchpoints, campaigns, and contacts.',
      status: 'Planned',
      isReady: false,
    },
    {
      num: '4',
      title: 'Transactional Commit',
      desc: 'Execute atomic batch inserts into PostgreSQL with idempotent rollback.',
      status: 'Planned',
      isReady: false,
    },
    {
      num: '5',
      title: 'Recalculate & Audit',
      desc: 'Trigger versioned v2 attribution runs and reconcile ledger entries.',
      status: 'Planned',
      isReady: false,
    },
  ];

  return (
    <div className="content-wrapper">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-group">
          <span className="page-eyebrow">Data Pipeline & Ingestion</span>
          <h1 className="page-title">Data Import Center</h1>
          <p className="page-description">
            Inspect local CSV data files, verify column header structures, and simulate
            staging steps prior to transactional database ingestion.
          </p>
        </div>
      </div>

      {/* Explicit Staging Mode Limitation Callout */}
      <div className="safeguard-policy-callout" style={{ backgroundColor: '#fffbeb', borderColor: '#fde68a', color: '#92400e' }}>
        <ShieldAlert size={20} style={{ color: '#d97706' }} />
        <div className="safeguard-content">
          <h4 style={{ color: '#78350f' }}>Browser Staging & Structural Preview Mode</h4>
          <p style={{ color: '#92400e' }}>
            This interface stages and previews uploaded CSV datasets entirely in your
            browser for header validation and row estimation. <strong>No writes to the
            underlying PostgreSQL database are executed</strong> from this preview
            sandbox. To apply database modifications, execute the server-side ingestion
            generator scripts as documented in the challenge instructions.
          </p>
        </div>
      </div>

      {/* Two-Column Upload & Preview Layout */}
      <div className="import-grid">
        {/* Left Column: Upload Dropzone & Datasets Guide */}
        <div className="analytics-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h2 className="card-title">Upload Datasets</h2>
              <p className="card-subtitle">
                Select one or more entity CSV files to stage in the browser
              </p>
            </div>
            <UploadCloud size={18} style={{ color: 'var(--teal-600)' }} />
          </div>

          <label
            className={`dropzone-container ${isDragging ? 'is-dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              onChange={handleFileInput}
              style={{ display: 'none' }}
            />
            <div className="dropzone-icon-circle">
              <UploadCloud size={20} />
            </div>
            <div className="dropzone-prompt">
              Drag & drop CSV files here, or{' '}
              <span className="dropzone-browse-link">browse files</span>
            </div>
            <span className="dropzone-subtext">
              Accepts .csv format · Multiple files supported · Instant header parsing
            </span>
          </label>

          {notice && (
            <div
              style={{
                fontSize: '12px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--teal-50)',
                border: '1px solid var(--teal-200)',
                color: 'var(--teal-900)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={15} style={{ color: 'var(--teal-700)' }} />
              <span>{notice}</span>
            </div>
          )}

          <div>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: '8px',
              }}
            >
              Supported Entity Datasets ({SUPPORTED_DATASETS.length})
            </div>
            <div className="supported-chips-wrap">
              {SUPPORTED_DATASETS.map((d) => (
                <span key={d} className="dataset-chip mono">
                  {d}.csv
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Staged Files Preview */}
        <div className="analytics-card">
          <div className="card-header-row">
            <div className="card-title-group">
              <h2 className="card-title">Staged Files ({files.length})</h2>
              <p className="card-subtitle">
                Detected row counts, file sizes, and recognized schemas
              </p>
            </div>
            {files.length > 0 && (
              <button
                className="action-btn action-btn-secondary"
                onClick={onClearFiles}
                style={{ height: '28px', padding: '0 8px', fontSize: '11px' }}
                title="Clear all staged files"
              >
                <Trash2 size={12} />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {files.length === 0 ? (
            <div
              style={{
                padding: '48px 20px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <FileSpreadsheet size={32} strokeWidth={1.5} />
              <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                No files staged yet
              </strong>
              <span style={{ fontSize: '12px' }}>
                Drop or browse CSV files from the starter dataset to preview schema headers.
              </span>
            </div>
          ) : (
            <div className="staged-files-list">
              {files.map((file, idx) => (
                <div className="staged-file-card" key={`${file.file.name}-${idx}`}>
                  <FileSpreadsheet
                    size={20}
                    style={{
                      color: file.error ? 'var(--rose-600)' : 'var(--teal-700)',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  />
                  <div className="staged-file-info">
                    <span className="staged-file-name">{file.file.name}</span>
                    <span className="staged-file-meta">
                      {formatNumber(file.rows)} rows · {(file.file.size / 1024).toFixed(1)} KB
                    </span>

                    {file.headers.length > 0 && (
                      <div className="staged-headers-chips">
                        {file.headers.slice(0, 5).map((h) => (
                          <span className="header-chip mono" key={h}>
                            {h}
                          </span>
                        ))}
                        {file.headers.length > 5 && (
                          <span className="header-chip mono">
                            +{file.headers.length - 5} more
                          </span>
                        )}
                      </div>
                    )}

                    <div
                      className={`staged-status-line ${
                        file.error ? 'error' : 'valid'
                      }`}
                    >
                      {file.error ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertCircle size={12} />
                          {file.error}
                        </span>
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} />
                          Dataset recognized: <strong>{file.dataset}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    className="collapse-toggle"
                    onClick={() => onRemoveFile(idx)}
                    aria-label={`Remove ${file.file.name}`}
                    title="Remove from staging"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Production Ingestion Pipeline Architecture Flow */}
      <div className="analytics-card">
        <div className="card-header-row">
          <div className="card-title-group">
            <h2 className="card-title">Production Ingestion Pipeline Workflow</h2>
            <p className="card-subtitle">
              Strict multi-phase validation lifecycle ensuring zero corrupt records reach
              the database
            </p>
          </div>
        </div>

        <div className="pipeline-steps-grid">
          {pipelineSteps.map((step) => (
            <div
              className={`pipeline-step-card ${step.isReady ? 'active' : ''}`}
              key={step.num}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span className="step-number-pill">{step.num}</span>
                <span className={`step-badge ${step.isReady ? 'ready' : 'planned'}`}>
                  {step.status}
                </span>
              </div>
              <h3 className="step-card-title">{step.title}</h3>
              <p className="step-card-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

