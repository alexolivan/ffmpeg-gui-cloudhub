import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization } from '../../../types/hub';
import { ExportIcon, ImportIcon, ShieldIcon, LayersIcon, UsersIcon, GearIcon } from '../../Icons';

interface BackupRestoreTabProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const BackupRestoreTab: React.FC<BackupRestoreTabProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const isSuperadmin = currentUser.role === 'superadmin';

  // Organizations list
  const [orgs, setOrgs] = useState<Organization[]>([]);

  // Export State
  const [exportScope, setExportScope] = useState<'full' | 'tenant'>(isSuperadmin ? 'full' : 'tenant');
  const [exportOrgId, setExportOrgId] = useState<number>(currentUser.org_id || selectedOrgId || 1);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [includeAppliances, setIncludeAppliances] = useState(true);
  const [includeUsers, setIncludeUsers] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPayload, setImportPayload] = useState<any>(null);
  const [validationInfo, setValidationInfo] = useState<any>(null);
  const [targetOrgId, setTargetOrgId] = useState<number | undefined>(undefined);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Load organizations for superadmin
  useEffect(() => {
    const fetchOrgs = async () => {
      try {
        const res = await fetch('/api/hub/orgs', { credentials: 'include' });
        if (res.ok) {
          const data: Organization[] = await res.json();
          setOrgs(data);
          if (data.length > 0 && !currentUser.org_id && !selectedOrgId) {
            setExportOrgId(data[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to fetch orgs for backup:', err);
      }
    };
    fetchOrgs();
  }, [currentUser.org_id, selectedOrgId]);

  const handleSelectAll = (val: boolean) => {
    if (isSuperadmin && exportScope === 'full') {
      setIncludeSettings(val);
    }
    setIncludeGroups(val);
    setIncludeAppliances(val);
    setIncludeUsers(val);
  };

  const handleExport = async () => {
    setIsExporting(true);
    setImportError(null);
    try {
      const payload: Record<string, any> = {
        scope: exportScope,
        include_groups: includeGroups,
        include_appliances: includeAppliances,
        include_users: includeUsers,
      };

      if (isSuperadmin && exportScope === 'full') {
        payload.include_settings = includeSettings;
      } else {
        payload.org_id = currentUser.org_id || exportOrgId;
      }

      const res = await fetch('/api/hub/backup/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to generate backup export');
      }

      const data = await res.json();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const scopeSuffix = exportScope === 'full' ? 'full' : `tenant_${payload.org_id || 'org'}`;
      const filename = `cloudhub_backup_${scopeSuffix}_${timestamp}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setImportError(err.message || 'Error exporting backup');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    setValidationInfo(null);
    setImportPayload(null);

    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        if (!parsed || parsed.app !== 'ffmpeg-gui-cloudhub') {
          throw new Error(
            t(
              'settings.backup.invalidSignature',
              'Invalid backup file: Missing ffmpeg-gui-cloudhub application signature.'
            )
          );
        }
        setImportPayload(parsed);

        // Pre-validate with backend
        setIsValidating(true);
        const res = await fetch('/api/hub/backup/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(parsed),
        });

        const valResult = await res.json();
        if (!res.ok) {
          throw new Error(valResult.detail || valResult.error || 'Validation failed');
        }

        setValidationInfo(valResult);
        if (valResult.target_tenant?.id) {
          setTargetOrgId(valResult.target_tenant.id);
        } else if (valResult.source_tenant?.id) {
          setTargetOrgId(valResult.source_tenant.id);
        }
      } catch (err: any) {
        setImportError(err.message || 'Failed to read or validate JSON file');
        setImportFile(null);
        setImportPayload(null);
      } finally {
        setIsValidating(false);
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!importPayload) return;
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);
    setShowConfirmModal(false);

    try {
      const payload: Record<string, any> = {
        backup_data: importPayload,
      };
      if (targetOrgId !== undefined) {
        payload.target_org_id = targetOrgId;
      }

      const res = await fetch('/api/hub/backup/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.detail || 'Import failed');
      }

      const counts = result.imported || {};
      const summary = `${t('settings.backup.importSuccess', 'Backup restored successfully!')} (${t('settings.tabs.tenants', 'Tenants')}: ${counts.organizations || 0}, ${t('settings.tabs.groups', 'Groups')}: ${counts.groups || 0}, ${t('fleet.nodes', 'Appliances')}: ${counts.appliances || 0}, ${t('settings.tabs.users', 'Users')}: ${counts.users || 0}${counts.settings_keys ? `, ${t('settings.tabs.general', 'Settings')}: ${counts.settings_keys}` : ''})`;
      setImportSuccess(summary);
      setImportFile(null);
      setImportPayload(null);
      setValidationInfo(null);
    } catch (err: any) {
      setImportError(err.message || 'Error executing restore');
    } finally {
      setIsImporting(false);
    }
  };

  const anyExportSelected =
    (isSuperadmin && exportScope === 'full' && includeSettings) ||
    includeGroups ||
    includeAppliances ||
    includeUsers;

  return (
    <div className="space-y-6">
      {/* CARD 1: EXPORT CONFIGURATION */}
      <div className="glass-card p-6 border-[var(--glass-border)] shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2.5">
            <ExportIcon size={20} className="text-brand-lime" />
            <div>
              <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
                {t('settings.backup.exportTitle', 'Export System Backup (.json)')}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {t(
                  'settings.backup.exportDesc',
                  'Download a portable JSON archive of your cloud control plane configuration, groups, and nodes.'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-brand-lime border border-white/10 transition-colors"
            >
              {t('common.selectAll', 'Select All')}
            </button>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] border border-white/10 transition-colors"
            >
              {t('common.deselectAll', 'Deselect All')}
            </button>
          </div>
        </div>

        {/* Scope Selection */}
        <div className="mb-5 p-4 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-3">
          <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
            <ShieldIcon size={14} className="text-brand-lime" />
            {t('settings.backup.scopeTitle', 'Export Scope & Tenant Boundary')}
          </h3>

          {isSuperadmin ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                exportScope === 'full'
                  ? 'bg-brand-lime/10 border-brand-lime/40 text-[var(--text-primary)]'
                  : 'bg-white/5 border-[var(--glass-border)] text-[var(--text-secondary)] hover:border-white/20'
              }`}>
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === 'full'}
                  onChange={() => setExportScope('full')}
                  className="accent-brand-lime mt-1"
                />
                <div className="min-w-0">
                  <span className="font-bold text-xs block text-[var(--text-primary)]">
                    {t('settings.backup.scopeFullTitle', 'Full Platform Backup')}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] block mt-0.5 leading-snug">
                    {t('settings.backup.scopeFullDesc', 'Exports all tenants, appliance groups, registered nodes, users, and platform settings.')}
                  </span>
                </div>
              </label>

              <div className={`p-3 rounded-xl border transition-all ${
                exportScope === 'tenant'
                  ? 'bg-brand-lime/10 border-brand-lime/40 text-[var(--text-primary)]'
                  : 'bg-white/5 border-[var(--glass-border)] text-[var(--text-secondary)]'
              }`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="exportScope"
                    checked={exportScope === 'tenant'}
                    onChange={() => setExportScope('tenant')}
                    className="accent-brand-lime mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-xs block text-[var(--text-primary)]">
                      {t('settings.backup.scopeTenantTitle', 'Tenant Scoped Backup')}
                    </span>
                    <span className="text-[11px] text-[var(--text-secondary)] block mt-0.5 leading-snug">
                      {t('settings.backup.scopeTenantDesc', 'Restricts the exported configuration strictly to a single tenant organization.')}
                    </span>
                  </div>
                </label>

                {exportScope === 'tenant' && (
                  <div className="mt-3 pt-2 border-t border-[var(--glass-border)]">
                    <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">
                      {t('settings.backup.selectTargetTenant', 'Select Tenant:')}
                    </label>
                    <select
                      value={exportOrgId}
                      onChange={(e) => setExportOrgId(Number(e.target.value))}
                      className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-brand-lime focus:outline-hidden"
                    >
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.slug})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-white/5 border border-brand-lime/30 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-[var(--text-primary)] block">
                  {t('settings.backup.tenantLocked', 'Tenant Administrator Mode')}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t('settings.backup.tenantLockedDesc', 'Backups are strictly confined to your assigned organization.')}
                </span>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-brand-lime/10 text-brand-lime border border-brand-lime/30">
                🏢 {orgs.find((o) => o.id === currentUser.org_id)?.name || `Org #${currentUser.org_id}`}
              </span>
            </div>
          )}
        </div>

        {/* Section Toggles */}
        <div className="space-y-4 mb-5">
          <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
            <LayersIcon size={12} /> {t('settings.backup.sectionsTitle', 'Configuration Sections')}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            {isSuperadmin && exportScope === 'full' && (
              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
                <input
                  type="checkbox"
                  checked={includeSettings}
                  onChange={(e) => setIncludeSettings(e.target.checked)}
                  className="accent-brand-lime w-4 h-4 rounded"
                />
                <div className="text-xs min-w-0">
                  <span className="font-bold text-[var(--text-primary)] block truncate">
                    <GearIcon size={12} className="inline mr-1 text-brand-lime" />
                    {t('settings.backup.secPlatformSettings', 'Platform Settings')}
                  </span>
                  <span className="text-[10px] text-[var(--text-secondary)] truncate block">
                    {t('settings.backup.secPlatformSettingsDesc', 'Branding, network ports, SSL & logs')}
                  </span>
                </div>
              </label>
            )}

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
              <input
                type="checkbox"
                checked={includeGroups}
                onChange={(e) => setIncludeGroups(e.target.checked)}
                className="accent-brand-lime w-4 h-4 rounded"
              />
              <div className="text-xs min-w-0">
                <span className="font-bold text-[var(--text-primary)] block truncate">
                  <LayersIcon size={12} className="inline mr-1 text-brand-lime" />
                  {t('settings.backup.secGroups', 'Appliance Groups')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] truncate block">
                  {t('settings.backup.secGroupsDesc', 'Group names, metadata & badge icons')}
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
              <input
                type="checkbox"
                checked={includeAppliances}
                onChange={(e) => setIncludeAppliances(e.target.checked)}
                className="accent-brand-lime w-4 h-4 rounded"
              />
              <div className="text-xs min-w-0">
                <span className="font-bold text-[var(--text-primary)] block truncate">
                  <ShieldIcon size={12} className="inline mr-1 text-brand-lime" />
                  {t('settings.backup.secAppliances', 'Enrolled Appliances')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] truncate block">
                  {t('settings.backup.secAppliancesDesc', 'Node IDs, keys, IPs & group mappings')}
                </span>
              </div>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] cursor-pointer hover:border-brand-lime/30 transition-all">
              <input
                type="checkbox"
                checked={includeUsers}
                onChange={(e) => setIncludeUsers(e.target.checked)}
                className="accent-brand-lime w-4 h-4 rounded"
              />
              <div className="text-xs min-w-0">
                <span className="font-bold text-[var(--text-primary)] block truncate">
                  <UsersIcon size={12} className="inline mr-1 text-brand-lime" />
                  {t('settings.backup.secUsers', 'User Accounts')}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)] truncate block">
                  {t('settings.backup.secUsersDesc', 'User credentials, roles & permissions')}
                </span>
              </div>
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={isExporting || !anyExportSelected}
          onClick={handleExport}
          className="pill-button bg-brand-lime text-black font-bold py-2.5 px-6 hover:bg-brand-lime/90 disabled:opacity-50 flex items-center gap-2 cursor-pointer transition-transform active:scale-95 shadow-md shadow-brand-lime/10"
        >
          <ExportIcon size={16} />
          {isExporting
            ? t('settings.backup.exporting', 'GENERATING ARCHIVE...')
            : t('settings.backup.exportBtn', 'EXPORT BACKUP (.JSON)')}
        </button>
      </div>

      {/* CARD 2: RESTORE / IMPORT CONFIGURATION */}
      <div className="glass-card p-6 border-[var(--glass-border)] shadow-xl relative overflow-hidden">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--glass-border)]">
          <div className="flex items-center gap-2.5">
            <ImportIcon size={20} className="text-brand-orange" />
            <div>
              <h2 className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
                {t('settings.backup.importTitle', 'Restore System Backup')}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {t(
                  'settings.backup.importDesc',
                  'Upload a verified CloudHub JSON backup file to restore tenants, groups, nodes, and users.'
                )}
              </p>
            </div>
          </div>
        </div>

        {importSuccess && (
          <div className="mb-4 p-3.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <span>✓</span> {importSuccess}
          </div>
        )}

        {importError && (
          <div className="mb-4 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
            <span>⚠️</span> {importError}
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="cursor-pointer pill-button bg-white/10 hover:bg-white/15 border border-[var(--glass-border)] text-[var(--text-primary)] text-xs font-bold py-2.5 px-5 flex items-center gap-2 transition-all">
              <ImportIcon size={16} />
              {isValidating
                ? t('settings.backup.validating', 'VALIDATING FILE...')
                : t('settings.backup.selectBackupFile', 'SELECT BACKUP FILE (.JSON)')}
              <input type="file" accept=".json" onChange={handleFileChange} className="hidden" />
            </label>
            {importFile && (
              <span className="text-xs font-mono text-brand-lime">
                {importFile.name} ({(importFile.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>

          {/* Validation & Preview Metadata */}
          {validationInfo && (
            <div className="p-4 rounded-xl bg-[var(--input-bg)] border border-brand-orange/30 space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs border-b border-white/5 pb-2 gap-2">
                <span className="font-bold text-[var(--text-primary)]">
                  📄 {t('settings.backup.backupMetadata', 'Archive Metadata')}:{' '}
                  <span className="text-brand-orange">
                    {validationInfo.app} v{validationInfo.version}
                  </span>{' '}
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-white/10 ml-2">
                    {validationInfo.scope}
                  </span>
                </span>
                <span className="text-[var(--text-secondary)] font-mono text-[11px]">
                  {validationInfo.exported_at ? new Date(validationInfo.exported_at).toLocaleString() : 'N/A'}
                </span>
              </div>

              {/* Source & Target Tenant Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold block mb-1">
                    {t('settings.backup.sourceOrigin', 'Source Scope')}
                  </span>
                  {validationInfo.scope === 'full' ? (
                    <span className="font-bold text-brand-lime">🌐 Full Platform Backup</span>
                  ) : (
                    <span className="font-bold text-[var(--text-primary)]">
                      🏢 {validationInfo.source_tenant?.name || 'Tenant Scoped'} (
                      {validationInfo.source_tenant?.slug || 'slug'})
                    </span>
                  )}
                </div>

                <div className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold block mb-1">
                    {t('settings.backup.targetTenantTitle', 'Target Destination')}
                  </span>
                  {validationInfo.scope === 'full' ? (
                    <span className="font-bold text-brand-lime">🌐 Full Platform Database</span>
                  ) : isSuperadmin ? (
                    <select
                      value={targetOrgId || ''}
                      onChange={(e) => setTargetOrgId(Number(e.target.value))}
                      className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-md px-2 py-1 text-xs text-[var(--text-primary)] focus:border-brand-orange focus:outline-hidden"
                    >
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id}>
                          🏢 {o.name} ({o.slug})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-bold text-[var(--text-primary)]">
                      🏢 {validationInfo.target_tenant?.name || `Org #${currentUser.org_id}`}
                    </span>
                  )}
                </div>
              </div>

              {/* Entity Count Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] block">
                    {t('settings.tabs.tenants', 'Tenants')}
                  </span>
                  <strong className="text-[var(--text-primary)] text-sm">
                    {validationInfo.counts?.organizations || 0}
                  </strong>
                </div>

                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] block">
                    {t('settings.tabs.groups', 'Groups')}
                  </span>
                  <strong className="text-[var(--text-primary)] text-sm">
                    {validationInfo.counts?.groups || 0}
                  </strong>
                </div>

                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] block">
                    {t('fleet.nodes', 'Appliances')}
                  </span>
                  <strong className="text-[var(--text-primary)] text-sm">
                    {validationInfo.counts?.appliances || 0}
                  </strong>
                </div>

                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] block">
                    {t('settings.tabs.users', 'Users')}
                  </span>
                  <strong className="text-[var(--text-primary)] text-sm">
                    {validationInfo.counts?.users || 0}
                  </strong>
                </div>

                <div className="p-2 rounded bg-white/5 border border-white/5">
                  <span className="text-[10px] text-[var(--text-secondary)] block">
                    {t('settings.tabs.general', 'Settings')}
                  </span>
                  <strong className="text-[var(--text-primary)] text-sm">
                    {validationInfo.counts?.settings_keys || 0}
                  </strong>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-center gap-2">
                <ShieldIcon size={16} className="shrink-0" />
                <span>
                  {t(
                    'settings.backup.restoreWarning',
                    'Warning: Restoring this backup will insert missing items and merge configuration safely in SQLite.'
                  )}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowConfirmModal(true)}
                disabled={isImporting}
                className="pill-button bg-brand-orange text-black font-bold py-2.5 px-6 hover:bg-brand-orange/90 disabled:opacity-50 flex items-center gap-2 cursor-pointer transition-transform active:scale-95 shadow-md shadow-brand-orange/20"
              >
                <ImportIcon size={16} />
                {t('settings.backup.restoreBtn', 'RESTORE BACKUP CONFIGURATION')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="glass-card w-full max-w-md p-6 border-brand-orange/40 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-brand-orange uppercase tracking-wider flex items-center gap-2">
              ⚠️ {t('settings.backup.confirmTitle', 'Confirm Configuration Restore')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {t(
                'settings.backup.confirmDesc',
                'Are you sure you want to restore this configuration? Existing records will be updated or preserved and non-existing groups, nodes, and users will be imported.'
              )}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={isImporting}
                className="px-4 py-2 bg-brand-orange text-black font-bold rounded-lg text-xs uppercase tracking-wider hover:bg-brand-orange/90 shadow-lg shadow-brand-orange/20 cursor-pointer transition-transform active:scale-95"
              >
                {isImporting
                  ? t('settings.backup.restoring', 'RESTORING...')
                  : t('settings.backup.confirmBtn', 'Confirm Restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupRestoreTab;
