import React from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization } from '../types/hub';
import { ChevronDownIcon, LayersIcon } from './Icons';

interface HeaderProps {
  activeView: string;
  currentUser: User;
  organizations: Organization[];
  selectedOrgId: number | null;
  onSelectOrg: (orgId: number | null) => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  currentUser,
  organizations,
  selectedOrgId,
  onSelectOrg,
  currentTheme,
  onThemeChange,
}) => {
  const { t, i18n } = useTranslation();

  const themes = [
    { id: 'studio-dark', label: 'Studio Dark' },
    { id: 'cyberpunk', label: 'Cyberpunk' },
    { id: 'nordic-frost', label: 'Nordic Frost' },
    { id: 'broadcast-light', label: 'Broadcast Light' },
    { id: 'warm-paper', label: 'Warm Paper' },
  ];

  const currentOrg = organizations.find((o) => o.id === selectedOrgId);
  const userOrg = organizations.find((o) => o.id === currentUser.org_id);

  const viewTitles: Record<string, string> = {
    fleet: t('nav.fleet', 'Fleet Directory'),
    audit: t('nav.audit', 'Audit Logs'),
    settings: t('nav.settings', 'Platform Settings'),
  };

  return (
    <header className="h-16 border-b border-[var(--glass-border)] bg-[var(--bg-card)] px-6 flex items-center justify-between transition-colors duration-300 select-none flex-shrink-0 z-20">
      {/* Left: View title */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
          {viewTitles[activeView] || activeView}
        </h1>
      </div>

      {/* Right Controls: Tenant Switcher, Theme, Language */}
      <div className="flex items-center gap-4">
        {/* Tenant Context Selector (Owner / Superadmin) */}
        {currentUser.role === 'superadmin' ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] font-mono hidden sm:inline">
              {t('common.tenant', 'Tenant')}:
            </span>
            <div className="relative">
              <select
                value={selectedOrgId ?? 'all'}
                onChange={(e) => {
                  const val = e.target.value;
                  onSelectOrg(val === 'all' ? null : Number(val));
                }}
                className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime/40 text-[var(--text-primary)] text-xs rounded-xl px-3 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-brand-lime transition-all cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#18181b] text-white">
                  🌐 {t('common.allTenants', 'All Tenants')}
                </option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id} className="bg-[#18181b] text-white">
                    🏢 {org.name} {org.nodes_count !== undefined ? `(${org.nodes_count})` : ''}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
                <ChevronDownIcon size={14} />
              </div>
            </div>
            {currentOrg && (
              <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono bg-brand-lime/10 text-brand-lime border border-brand-lime/20">
                <LayersIcon size={12} />
                {currentOrg.name}
              </span>
            )}
          </div>
        ) : (
          /* Static Tenant Badge for Tenant Admin and Operators */
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)] font-mono hidden sm:inline">
              {t('common.tenant', 'Tenant')}:
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium bg-white/5 border border-[var(--glass-border)] text-[var(--text-primary)]">
              🏢 {userOrg?.name || `Tenant #${currentUser.org_id}`}
            </span>
          </div>
        )}

        <div className="h-5 w-px bg-[var(--glass-border)] mx-1" />

        {/* Theme Selector */}
        <div className="relative">
          <select
            value={currentTheme}
            onChange={(e) => onThemeChange(e.target.value)}
            className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime/40 text-[var(--text-primary)] text-xs rounded-xl px-2.5 py-1.5 pr-7 focus:outline-none focus:ring-1 focus:ring-brand-lime transition-all cursor-pointer font-medium"
            title={t('settings.theme', 'Theme')}
          >
            {themes.map((th) => (
              <option key={th.id} value={th.id} className="bg-[#18181b] text-white">
                {th.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
            <ChevronDownIcon size={14} />
          </div>
        </div>

        {/* Language Switcher */}
        <div className="flex items-center bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-0.5 text-xs font-mono">
          {(['en', 'es', 'ca'] as const).map((lang) => {
            const isSelected = i18n.language.startsWith(lang);
            return (
              <button
                key={lang}
                onClick={() => i18n.changeLanguage(lang)}
                className={`px-2 py-1 rounded-lg transition-all cursor-pointer uppercase ${
                  isSelected
                    ? 'bg-brand-lime/20 text-brand-lime font-bold shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};

export default Header;
