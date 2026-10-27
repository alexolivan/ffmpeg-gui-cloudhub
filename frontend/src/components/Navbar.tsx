import React from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../types/hub';

interface NavbarProps {
  currentUser: User;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onLogout: () => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  activeTab,
  onSelectTab,
  onLogout,
  currentTheme,
  onThemeChange,
}) => {
  const { t, i18n } = useTranslation();
  const [sslStatus, setSslStatus] = React.useState<{ valid?: boolean; mode?: string } | null>(null);

  React.useEffect(() => {
    fetch('/api/settings/ssl/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSslStatus(d))
      .catch(() => {});
  }, []);

  const themes = [
    { id: 'studio-dark', label: 'Studio Dark' },
    { id: 'cyberpunk', label: 'Cyberpunk' },
    { id: 'nordic-frost', label: 'Nordic Frost' },
    { id: 'broadcast-light', label: 'Broadcast Light' },
    { id: 'warm-paper', label: 'Warm Paper' },
  ];

  const languages = [
    { code: 'en', label: 'EN' },
    { code: 'es', label: 'ES' },
    { code: 'ca', label: 'CA' },
  ];

  const canManageTenants = currentUser.role === 'superadmin' || currentUser.role === 'org_admin';
  const canManageUsers = currentUser.role === 'superadmin' || currentUser.role === 'org_admin';
  const isSuperadmin = currentUser.role === 'superadmin';

  const roleBadgeColor = {
    superadmin: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    org_admin: 'bg-brand-lime/20 text-brand-lime border-brand-lime/30',
    group_operator: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  }[currentUser.role] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';

  const roleLabel = {
    superadmin: t('nav.role_superadmin'),
    org_admin: t('nav.role_org_admin'),
    group_operator: t('nav.role_group_operator'),
  }[currentUser.role] || currentUser.role;

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md border-b border-[var(--glass-border)] bg-[var(--bg-card)]">
      {sslStatus && (!sslStatus.valid || sslStatus.mode === 'disabled') && isSuperadmin && (
        <div className="w-full bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs text-amber-400">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{t('nav.sslPendingWarning', "SSL / Let's Encrypt is not configured yet. Operating in HTTP mode.")}</span>
            </div>
            <button
              type="button"
              onClick={() => onSelectTab('settings')}
              className="underline hover:text-amber-300 font-semibold cursor-pointer"
            >
              {t('nav.configureSslLink', 'Configure in Settings →')}
            </button>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Left: Brand and Navigation */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => onSelectTab('directory')}>
            <svg
              className="w-7 h-7 text-brand-lime"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-[var(--text-primary)]">
                FFmpeg <span className="text-brand-lime font-mono">CloudHub</span>
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] font-mono">v1.0.0</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            <button
              onClick={() => onSelectTab('directory')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'directory'
                  ? 'bg-brand-lime/15 text-brand-lime font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)]'
              }`}
            >
              {t('nav.directory')}
            </button>

            {canManageTenants && (
              <button
                onClick={() => onSelectTab('tenants')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'tenants'
                    ? 'bg-brand-lime/15 text-brand-lime font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)]'
                }`}
              >
                {t('nav.tenants')}
              </button>
            )}

            {canManageUsers && (
              <button
                onClick={() => onSelectTab('users')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'users'
                    ? 'bg-brand-lime/15 text-brand-lime font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)]'
                }`}
              >
                {t('nav.users')}
              </button>
            )}

            <button
              onClick={() => onSelectTab('audit')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'audit'
                  ? 'bg-brand-lime/15 text-brand-lime font-semibold'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)]'
              }`}
            >
              {t('nav.audit')}
            </button>

            {isSuperadmin && (
              <button
                onClick={() => onSelectTab('settings')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  activeTab === 'settings'
                    ? 'bg-brand-lime/15 text-brand-lime font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)]'
                }`}
              >
                {t('nav.settings')}
              </button>
            )}
          </nav>
        </div>

        {/* Right: Theme, Language, User, Logout */}
        <div className="flex items-center gap-3">
          {/* Theme Selector */}
          <select
            value={currentTheme}
            onChange={(e) => onThemeChange(e.target.value)}
            className="text-xs bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded px-2 py-1 focus:outline-none focus:border-brand-lime cursor-pointer"
            aria-label={t('nav.theme')}
          >
            {themes.map((th) => (
              <option key={th.id} value={th.id} className="bg-zinc-900 text-white">
                {th.label}
              </option>
            ))}
          </select>

          {/* Language Selector */}
          <div className="flex items-center border border-[var(--glass-border)] rounded overflow-hidden">
            {languages.map((lng) => (
              <button
                key={lng.code}
                onClick={() => {
                  i18n.changeLanguage(lng.code);
                  localStorage.setItem('cloudhub_language', lng.code);
                }}
                className={`px-2 py-1 text-[11px] font-mono font-semibold transition-colors ${
                  i18n.language === lng.code
                    ? 'bg-brand-lime/20 text-brand-lime'
                    : 'bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {lng.label}
              </button>
            ))}
          </div>

          {/* User & Role Badge */}
          <div className="flex items-center gap-2 pl-2 border-l border-[var(--glass-border)]">
            <span className="text-xs font-medium text-[var(--text-primary)] hidden sm:inline">
              {currentUser.username}
            </span>
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${roleBadgeColor}`}
            >
              {roleLabel}
            </span>
          </div>

          {/* Logout Button */}
          <button
            onClick={onLogout}
            className="p-1.5 rounded hover:bg-[var(--glass-border)] text-[var(--text-secondary)] hover:text-red-400 transition-colors"
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
};
