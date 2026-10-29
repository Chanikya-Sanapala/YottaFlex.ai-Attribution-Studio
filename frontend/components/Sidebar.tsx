'use client';

import React from 'react';
import {
  LayoutDashboard,
  BarChart3,
  ShieldCheck,
  Files,
  PanelLeftClose,
  PanelLeft,
  Layers,
} from 'lucide-react';
import { NavigationPage } from '../types/attribution';

interface SidebarProps {
  currentPage: NavigationPage;
  onPageChange: (page: NavigationPage) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  openIssuesCount: number;
  apiConnected: boolean;
  apiLoading: boolean;
}

export function Sidebar({
  currentPage,
  onPageChange,
  collapsed,
  onToggleCollapse,
  openIssuesCount,
  apiConnected,
  apiLoading,
}: SidebarProps) {
  const navItems = [
    {
      id: 'overview' as NavigationPage,
      label: 'Marketing Overview',
      shortLabel: 'Overview',
      icon: LayoutDashboard,
    },
    {
      id: 'campaigns' as NavigationPage,
      label: 'Campaign Performance',
      shortLabel: 'Campaigns',
      icon: BarChart3,
    },
    {
      id: 'quality' as NavigationPage,
      label: 'Data Quality & Audit',
      shortLabel: 'Data Quality',
      icon: ShieldCheck,
      badge: openIssuesCount > 0 ? openIssuesCount : null,
    },
    {
      id: 'imports' as NavigationPage,
      label: 'Data Import Center',
      shortLabel: 'Data Import',
      icon: Files,
    },
  ];

  return (
    <aside className="app-sidebar" aria-label="Main Navigation">
      {/* Brand Header */}
      <div className="sidebar-brand">
        <div className="brand-identity" title="YottaFlex.ai Attribution Studio">
          <div className="brand-icon-wrap">
            <Layers size={18} strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="brand-copy">
              <span className="brand-name">
                YottaFlex<span className="brand-suffix">.ai</span>
              </span>
              <span className="brand-product">Attribution Studio</span>
            </div>
          )}
        </div>
        <button
          className="collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="sidebar-nav-container">
        <div>
          {!collapsed && <div className="nav-section-title">Workspace</div>}
          <ul className="sidebar-nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <li key={item.id}>
                  <button
                    className={`nav-item-btn ${isActive ? 'active' : ''}`}
                    onClick={() => onPageChange(item.id)}
                    title={collapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
                    {!collapsed && (
                      <>
                        <span className="nav-item-text">{item.label}</span>
                        {item.badge != null && (
                          <span
                            className="nav-badge"
                            title={`${item.badge} open data quality issues`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Sidebar Footer with API Connection Status */}
      <div className="sidebar-footer">
        <div className="api-status-card">
          <span
            className={`status-indicator-dot ${
              !apiConnected ? 'offline' : apiLoading ? 'pending' : ''
            }`}
          />
          {!collapsed && (
            <div className="api-status-info">
              <span className="api-status-title">
                {apiLoading
                  ? 'Connecting to API…'
                  : apiConnected
                  ? 'API Connected'
                  : 'API Offline'}
              </span>
              <span className="api-status-subtitle">Spring Boot :8080</span>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="system-meta-row">
            <span>Attribution Engine</span>
            <span className="version-pill">v2-eligible-90d</span>
          </div>
        )}
      </div>
    </aside>
  );
}

