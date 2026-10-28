import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '../../Icons';

export const GeneralSettingsTab: React.FC = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Record<string, any>>({
    hub_name: 'ffmpeg-gui CloudHub',
    login_logo_text: 'CH',
    login_logo_url: '',
    session_timeout_days: 7,
    audit_retention_days: 90,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/hub/settings', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setSettings((prev) => ({ ...prev, ...data }));
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/hub/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setStatusMsg({ type: 'success', text: t('settings.saveSuccess', 'Settings updated successfully.') });
        setTimeout(() => setStatusMsg(null), 4000);
      } else {
        const data = await res.json().catch(() => ({}));
        setStatusMsg({ type: 'error', text: data.detail || 'Failed to save settings' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Network error saving settings' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
        {t('common.loading', 'Loading platform configuration...')}
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
      {statusMsg && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {statusMsg.type === 'success' && <CheckIcon size={16} />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Platform Branding */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] border-b border-[var(--glass-border)] pb-3">
          {t('settings.brandingTitle', 'Platform Branding')}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('settings.platformName', 'Hub Platform Name')}
            </label>
            <input
              type="text"
              value={settings.hub_name || ''}
              onChange={(e) => setSettings({ ...settings, hub_name: e.target.value })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-medium"
              placeholder="ffmpeg-gui CloudHub"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('settings.logoText', 'Logo Monogram Text')}
            </label>
            <input
              type="text"
              maxLength={4}
              value={settings.login_logo_text || ''}
              onChange={(e) => setSettings({ ...settings, login_logo_text: e.target.value })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono font-bold"
              placeholder="CH"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            {t('settings.logoUrl', 'Custom Logo Image URL (Optional)')}
          </label>
          <input
            type="text"
            value={settings.login_logo_url || ''}
            onChange={(e) => setSettings({ ...settings, login_logo_url: e.target.value })}
            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
            placeholder="https://example.com/assets/logo.png"
          />
          <span className="text-[11px] text-[var(--text-secondary)] mt-1 block">
            {t('settings.logoUrlHelp', 'Relative or HTTPS URL for custom brand icon rendered in login and header.')}
          </span>
        </div>
      </div>

      {/* Security & Maintenance Policies */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-[var(--text-primary)] border-b border-[var(--glass-border)] pb-3">
          {t('settings.maintenanceTitle', 'Security & Retention Policies')}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('settings.sessionTimeout', 'Operator Session Timeout (Days)')}
            </label>
            <input
              type="number"
              min="1"
              max="90"
              value={settings.session_timeout_days || 7}
              onChange={(e) => setSettings({ ...settings, session_timeout_days: Number(e.target.value) })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('settings.auditRetention', 'Audit Log Retention Policy (Days)')}
            </label>
            <input
              type="number"
              min="7"
              max="365"
              value={settings.audit_retention_days || 90}
              onChange={(e) => setSettings({ ...settings, audit_retention_days: Number(e.target.value) })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isSaving}
          className="px-5 py-2.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer disabled:opacity-50"
        >
          {isSaving ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save Changes')}
        </button>
      </div>
    </form>
  );
};
