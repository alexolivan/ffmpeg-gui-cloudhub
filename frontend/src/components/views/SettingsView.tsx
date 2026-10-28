import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../types/hub';
import { GeneralSettingsTab } from './settings/GeneralSettingsTab';
import { NetworkSslTab } from './settings/NetworkSslTab';
import { TenantsTab } from './settings/TenantsTab';
import { GroupsTab } from './settings/GroupsTab';
import { UsersTab } from './settings/UsersTab';
import { BackupRestoreTab } from './settings/BackupRestoreTab';
import { GearIcon, ShieldIcon, LayersIcon, UsersIcon, ExportIcon } from '../Icons';

interface SettingsViewProps {
  currentUser: User;
  selectedOrgId: number | null;
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
  onSettingsUpdated?: () => void;
  onUserUpdated?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser,
  selectedOrgId,
  currentTheme,
  onThemeChange,
  onSettingsUpdated,
  onUserUpdated,
}) => {
  const { t } = useTranslation();
  const isSuperadmin = currentUser.role === 'superadmin';

  const [activeTab, setActiveTab] = useState<string>(isSuperadmin ? 'general' : 'groups');

  const tabs = [];
  if (isSuperadmin) {
    tabs.push(
      { id: 'general', label: t('settings.tabs.general', 'General & Branding'), icon: <GearIcon size={16} /> },
      { id: 'network_ssl', label: t('settings.tabs.network_ssl', 'Network & SSL/TLS'), icon: <ShieldIcon size={16} /> },
      { id: 'tenants', label: t('settings.tabs.tenants', 'Tenants & Orgs'), icon: <span className="text-sm">🏢</span> }
    );
  }

  tabs.push(
    { id: 'groups', label: t('settings.tabs.groups', 'Appliance Groups'), icon: <LayersIcon size={16} /> },
    { id: 'users', label: t('settings.tabs.users', 'Users & RBAC'), icon: <UsersIcon size={16} /> },
    { id: 'backup', label: t('settings.tabs.backup', 'Backup & Restore'), icon: <ExportIcon size={16} /> }
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Top Banner Header (Parity with ffmpeg-gui) ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
            {t('nav.settings', 'Settings')}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t(
              'settings.subtitle',
              'Configure global branding, networking, security policies, and tenant access.'
            )}
          </p>
        </div>
      </div>

      {/* ── Subtitle and Tab Bar ── */}
      <div className="border-b border-[var(--glass-border)] pb-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-brand-lime/10 text-brand-lime border border-brand-lime/30 shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div>
        {activeTab === 'general' && isSuperadmin && (
          <GeneralSettingsTab
            currentUser={currentUser}
            currentTheme={currentTheme}
            onThemeChange={onThemeChange}
            onSettingsUpdated={onSettingsUpdated}
            onUserUpdated={onUserUpdated}
          />
        )}
        {activeTab === 'network_ssl' && isSuperadmin && <NetworkSslTab />}
        {activeTab === 'tenants' && isSuperadmin && <TenantsTab />}
        {activeTab === 'groups' && <GroupsTab currentUser={currentUser} selectedOrgId={selectedOrgId} />}
        {activeTab === 'users' && <UsersTab currentUser={currentUser} selectedOrgId={selectedOrgId} />}
        {activeTab === 'backup' && <BackupRestoreTab currentUser={currentUser} selectedOrgId={selectedOrgId} />}
      </div>
    </div>
  );
};

export default SettingsView;
