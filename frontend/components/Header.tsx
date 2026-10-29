'use client';

import React from 'react';
import { Menu, RefreshCw } from 'lucide-react';
import { NavigationPage } from '../types/attribution';

interface HeaderProps {
  currentPage: NavigationPage;
  onOpenMobileMenu: () => void;
  loading: boolean;
  onRefresh: () => void;
  apiConnected: boolean;
  activeModel: string;
}

const PAGE_TITLES: Record<NavigationPage, string> = {
  overview: 'Marketing Overview',
  campaigns: 'Campaign Performance',
  quality: 'Data Quality & Audit',
  imports: 'Data Import Center',
};

export function Header({
  currentPage,
  onOpenMobileMenu,
  loading,
  onRefresh,
  apiConnected,
  activeModel,
}: HeaderProps) {
  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-toggle"
          onClick={onOpenMobileMenu}
          aria-label="Open mobile navigation"
        >
          <Menu size={18} />
        </button>

        <nav aria-label="Breadcrumb" className="topbar-breadcrumbs">
          <span className="breadcrumb-segment">Workspace</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">{PAGE_TITLES[currentPage]}</span>
        </nav>
      </div>

      <div className="topbar-right">
        <div className="live-badge" title="Backend connection status">
          <span className={`live-dot ${!apiConnected ? 'offline' : ''}`} />
          <span>{apiConnected ? 'Live API' : 'Disconnected'}</span>
        </div>

        <button
          className="action-btn action-btn-secondary"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh analytics from Spring Boot API"
        >
          <RefreshCw
            size={13}
            className={loading ? 'spin-animation' : ''}
          />
          <span>{loading ? 'Refreshing…' : 'Refresh Data'}</span>
        </button>
      </div>
    </header>
  );
}

