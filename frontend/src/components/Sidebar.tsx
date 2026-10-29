import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization } from '../types/hub';
import { FleetIcon, AuditIcon, GearIcon, LogoutIcon, ChevronDownIcon, LayersIcon } from './Icons';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  currentUser: User;
  onLogout: () => void;
  logoText?: string;
  logoPath?: string;
  accentColor?: string;
  organizations?: Organization[];
  selectedOrgId?: number | null;
  onSelectOrg?: (orgId: number | null) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onViewChange,
  currentUser,
  onLogout,
  logoText = 'CH',
  logoPath,
  accentColor = '#d4ff5b',
  organizations = [],
  selectedOrgId = null,
  onSelectOrg,
}) => {
  const { t } = useTranslation();

  const activeOrg = organizations.find((o) => o.id === selectedOrgId);
  const userOrg = organizations.find((o) => o.id === currentUser.org_id);

  const items = [
    { id: 'fleet', icon: <FleetIcon size={20} />, label: t('nav.fleet', 'Fleet') },
    { id: 'audit', icon: <AuditIcon size={20} />, label: t('nav.audit', 'Audit Log') },
  ];

  if (currentUser.role === 'superadmin' || currentUser.role === 'org_admin' || currentUser.role === 'tenant_admin') {
    items.push({
      id: 'settings',
      icon: <GearIcon size={20} />,
      label: t('nav.settings', 'Settings'),
    });
  }

  const roleLabel =
    currentUser.role === 'superadmin'
      ? t('auth.roleSuperadmin', 'Owner')
      : currentUser.role === 'org_admin' || currentUser.role === 'tenant_admin'
      ? t('auth.roleAdmin', 'Tenant Admin')
      : t('auth.roleOperator', 'Operator');

  const [versionInfo, setVersionInfo] = useState<{
    version: string;
    db_schema_version?: string;
    git_branch?: string;
    git_commit?: string;
    is_release?: boolean;
    update_available?: boolean;
    latest_release?: string;
    release_url?: string;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    setLogoError(false);
  }, [logoPath]);

  useEffect(() => {
    if (currentUser.role === 'superadmin') {
      fetch('/api/hub/version', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setVersionInfo(data);
        })
        .catch(() => {});
    }
  }, [currentUser.role]);

  const handleCheckUpdates = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const res = await fetch('/api/hub/version/check-updates', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setVersionInfo(await res.json());
      }
    } catch {
      // Ignore
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="w-20 lg:w-64 h-screen bg-[var(--bg-card)] border-r border-[var(--glass-border)] flex flex-col items-center py-6 transition-colors duration-300 select-none flex-shrink-0">
      {/* Brand Icon */}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 shadow-lg cursor-pointer transition-all hover:scale-105 overflow-hidden flex-shrink-0"
        style={!logoPath ? { backgroundColor: accentColor, boxShadow: `0 10px 20px ${accentColor}33` } : undefined}
        onClick={() => onViewChange('fleet')}
        title="ffmpeg-gui CloudHub"
      >
        {logoPath && !logoError ? (
          <img
            src={logoPath}
            alt="Logo"
            className="w-full h-full object-contain"
            onError={() => setLogoError(true)}
          />
        ) : (
          <span className="text-black font-black text-xl tracking-wider">{logoText}</span>
        )}
      </div>

      <div className="hidden lg:flex flex-col items-center mb-2">
        <span className="font-bold tracking-wider text-sm text-[var(--text-primary)]">CLOUDHUB</span>
        <span className="text-[10px] tracking-widest text-[var(--text-secondary)] font-mono uppercase">Control Plane</span>
      </div>

      {/* ── OWNER VERSION INDICATOR & ENVIRONMENT BADGE (Between Logo and Tenant Selector) ── */}
      {currentUser.role === 'superadmin' && (
        <>
          {/* Collapsed Sidebar Pill (Mobile / w-20) */}
          <div
            className="lg:hidden flex flex-col items-center mb-3 px-2 cursor-pointer"
            onClick={handleCheckUpdates}
            title={`CloudHub v${versionInfo?.version || '1.5.0'} (${versionInfo?.is_release ? 'Production' : `${versionInfo?.git_branch || 'devel'} @ ${versionInfo?.git_commit || 'HEAD'}`})`}
          >
            <span
              className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${
                versionInfo?.update_available
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400 animate-pulse'
                  : 'bg-white/5 border-[var(--glass-border)] text-brand-lime'
              }`}
            >
              v{versionInfo?.version || '1.5'}
            </span>
          </div>

          {/* Expanded Sidebar Version Card (Desktop / lg:w-64 - Parity with ffmpeg-gui dashboard) */}
          <div className="hidden lg:block w-full px-3 mb-3">
            <div className="p-2.5 rounded-xl bg-white/5 border border-[var(--glass-border)] space-y-0.5 shadow-xs">
              {/* Row 1: Environment */}
              <div className="flex items-center justify-between py-1 border-b border-[var(--glass-border)]/50">
                <span className="text-[10px] text-[var(--text-secondary)] font-medium">{t('common.environment', 'Environment:')}</span>
                <div className="flex items-center gap-1">
                  {versionInfo?.is_release ? (
                    <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      🟢 {t('common.envProduction', 'Production')}
                    </span>
                  ) : (
                    <span
                      className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 truncate max-w-[120px]"
                      title={`Branch: ${versionInfo?.git_branch || 'devel'}, Commit: ${versionInfo?.git_commit || 'HEAD'}`}
                    >
                      🟣 {versionInfo?.git_branch || 'devel'} {versionInfo?.git_commit ? `(${versionInfo.git_commit.slice(0, 7)})` : ''}
                    </span>
                  )}
                </div>
              </div>

              {/* Row 2: Frontend */}
              <div className="flex items-center justify-between py-1 border-b border-[var(--glass-border)]/50">
                <span className="text-[10px] text-[var(--text-secondary)] font-medium">{t('common.frontend', 'Frontend:')}</span>
                <span className="font-mono font-bold text-brand-lime text-[10px]">
                  v{versionInfo?.version || '1.5.1'}
                </span>
              </div>

              {/* Row 3: Backend & Update Check */}
              <div className="flex items-center justify-between py-1 border-b border-[var(--glass-border)]/50">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[var(--text-secondary)] font-medium">{t('common.backend', 'Backend:')}</span>
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={checkingUpdate}
                    title={checkingUpdate ? t('common.checking', 'Checking...') : t('common.checkUpdates', 'Check for updates')}
                    className="text-[10px] text-[var(--text-secondary)] hover:text-brand-lime transition-colors disabled:opacity-50 p-0.5 cursor-pointer"
                  >
                    <span className={`inline-block ${checkingUpdate ? 'animate-spin' : ''}`}>↻</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {versionInfo?.update_available && versionInfo?.latest_release ? (
                    <a
                      href={versionInfo.release_url || 'https://github.com/alexolivan/ffmpeg-gui-cloudhub/releases'}
                      target="_blank"
                      rel="noreferrer"
                      title={`${t('common.updateAvailable', 'Update available')}: v${versionInfo.latest_release}`}
                      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-all flex items-center gap-0.5 animate-pulse"
                    >
                      ▲ v{versionInfo.latest_release}
                    </a>
                  ) : null}
                  <span className={`font-mono font-bold text-[10px] ${versionInfo?.update_available ? 'text-amber-400' : 'text-brand-lime'}`}>
                    v{versionInfo?.version || '1.5.1'}
                  </span>
                </div>
              </div>

              {/* Row 4: Schema */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[10px] text-[var(--text-secondary)] font-medium">{t('common.schema', 'Schema:')}</span>
                <span className="font-mono font-bold text-brand-lime text-[10px]">
                  v{versionInfo?.db_schema_version || '1.0.0'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── TENANT CONTEXT CONTROLLER (Between Logo and Menu Items) ── */}
      {currentUser.role === 'superadmin' ? (
        <div className="w-full px-3 mb-4 space-y-2">
          {/* Dropdown Selector (Compact) */}
          <div className="relative hidden lg:block">
            <select
              value={selectedOrgId ?? 'all'}
              onChange={(e) => {
                const val = e.target.value;
                onSelectOrg?.(val === 'all' ? null : Number(val));
              }}
              className="w-full appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime/40 text-[var(--text-primary)] text-xs rounded-xl px-2.5 py-1.5 pr-7 focus:outline-none focus:ring-1 focus:ring-brand-lime transition-all cursor-pointer font-medium truncate"
              title={t('common.switchTenant', 'Switch Tenant')}
            >
              <option value="all" className="bg-[#18181b] text-white">
                🌐 {t('common.allTenants', 'All Tenants')}
              </option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id} className="bg-[#18181b] text-white">
                  🏢 {org.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <ChevronDownIcon size={12} />
            </div>
          </div>

          {/* Active Tenant Indicator Element */}
          <div
            className="flex items-center gap-2.5 p-2 rounded-xl bg-white/5 border border-[var(--glass-border)] justify-center lg:justify-start transition-all"
            title={activeOrg ? `Tenant: ${activeOrg.name}` : t('common.allTenants', 'All Tenants')}
          >
            <span className="text-base shrink-0">{activeOrg ? '🏢' : '🌐'}</span>
            <div className="hidden lg:flex flex-col min-w-0 flex-1">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
                {t('common.tenantContext', 'Active Tenant')}
              </span>
              <span className="text-xs font-bold text-brand-lime truncate">
                {activeOrg ? activeOrg.name : t('common.allTenants', 'All Tenants')}
              </span>
            </div>
            {activeOrg && activeOrg.nodes_count !== undefined && (
              <span className="hidden lg:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-brand-lime/15 text-brand-lime border border-brand-lime/30 font-bold shrink-0">
                {activeOrg.nodes_count}
              </span>
            )}
          </div>
        </div>
      ) : (
        /* Static Tenant Indicator for Tenant Admin and Operators */
        <div className="w-full px-3 mb-4">
          <div
            className="flex items-center gap-2.5 p-2 rounded-xl bg-white/5 border border-[var(--glass-border)] justify-center lg:justify-start"
            title={`Tenant: ${userOrg?.name || `Tenant #${currentUser.org_id}`}`}
          >
            <span className="text-base shrink-0">🏢</span>
            <div className="hidden lg:flex flex-col min-w-0">
              <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
                {t('common.tenantContext', 'Tenant')}
              </span>
              <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                {userOrg?.name || `Tenant #${currentUser.org_id}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Items */}
      <div className="flex-1 flex flex-col gap-2 w-full px-3">
        {items.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`flex items-center gap-3.5 p-3 rounded-xl w-full text-left transition-all cursor-pointer ${
                isActive
                  ? 'bg-white/10 text-brand-lime font-medium shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <span className="flex items-center justify-center w-6 h-6 flex-shrink-0">{item.icon}</span>
              <span className="hidden lg:block text-sm tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Footer: User profile & Logout */}
      <div className="w-full px-3 mt-auto flex flex-col gap-3">
        <div className="hidden lg:flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-[var(--glass-border)]">
          <div className="w-8 h-8 rounded-lg bg-brand-lime/20 text-brand-lime flex items-center justify-center font-bold text-xs">
            {currentUser.username.substring(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
              {currentUser.username}
            </span>
            <span className="text-[10px] text-[var(--text-secondary)] font-mono uppercase">
              {roleLabel}
            </span>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="flex items-center gap-3.5 p-3 rounded-xl w-full text-left text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
          title={t('nav.logout', 'Sign out')}
        >
          <span className="flex items-center justify-center w-6 h-6 flex-shrink-0">
            <LogoutIcon size={20} />
          </span>
          <span className="hidden lg:block text-sm font-medium">{t('nav.logout', 'Sign out')}</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
