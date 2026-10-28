import React from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../types/hub';
import { FleetIcon, AuditIcon, GearIcon, LogoutIcon } from './Icons';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
  currentUser: User;
  onLogout: () => void;
  logoText?: string;
  logoPath?: string;
  accentColor?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onViewChange,
  currentUser,
  onLogout,
  logoText = 'CH',
  logoPath,
  accentColor = '#d4ff5b',
}) => {
  const { t } = useTranslation();

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

  return (
    <div className="w-20 lg:w-64 h-screen bg-[var(--bg-card)] border-r border-[var(--glass-border)] flex flex-col items-center py-6 transition-colors duration-300 select-none flex-shrink-0">
      {/* Brand Icon */}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2 shadow-lg cursor-pointer transition-all hover:scale-105 overflow-hidden flex-shrink-0"
        style={!logoPath ? { backgroundColor: accentColor, boxShadow: `0 10px 20px ${accentColor}33` } : undefined}
        onClick={() => onViewChange('fleet')}
        title="ffmpeg-gui CloudHub"
      >
        {logoPath ? (
          <img src={logoPath} alt="Logo" className="w-full h-full object-contain" />
        ) : (
          <span className="text-black font-black text-xl tracking-wider">{logoText}</span>
        )}
      </div>

      <div className="hidden lg:flex flex-col items-center mb-6">
        <span className="font-bold tracking-wider text-sm text-[var(--text-primary)]">CLOUDHUB</span>
        <span className="text-[10px] tracking-widest text-[var(--text-secondary)] font-mono uppercase">Control Plane</span>
      </div>

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
