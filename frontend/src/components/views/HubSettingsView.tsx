import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SslStatus } from '../../types/hub';

export const HubSettingsView: React.FC = () => {
  const { t } = useTranslation();
  const [sslStatus, setSslStatus] = useState<SslStatus | null>(null);
  const [settings, setSettings] = useState<Record<string, any>>({
    hub_domain: '',
    force_https: false,
    letsencrypt_email: '',
    letsencrypt_staging: false,
    session_timeout_days: 7,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchData = async () => {
    try {
      const sRes = await fetch('/api/hub/settings/ssl/status', { credentials: 'include' });
      if (sRes.ok) {
        setSslStatus(await sRes.json());
      }

      const cfgRes = await fetch('/api/hub/settings', { credentials: 'include' });
      if (cfgRes.ok) {
        setSettings(await cfgRes.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/hub/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const sslBadge = {
    valid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    critical: 'bg-red-500/15 text-red-400 border-red-500/30',
    expired: 'bg-red-500/15 text-red-400 border-red-500/30',
    missing: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    disabled: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    error: 'bg-red-500/15 text-red-400 border-red-500/30',
  }[sslStatus?.status || 'missing'];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          {t('settings.title')}
        </h1>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* SSL / TLS Status Card */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-6 shadow-[var(--card-shadow)] space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
          <h2 className="text-sm font-bold text-[var(--text-primary)]">
            {t('settings.ssl_title')}
          </h2>
          <span
            className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${sslBadge}`}
          >
            {sslStatus?.status?.toUpperCase() || 'UNKNOWN'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block">
              {t('settings.cert_domain')}
            </span>
            <span className="font-mono font-bold text-[var(--text-primary)] mt-0.5 block">
              {sslStatus?.domain || settings.hub_domain || 'localhost'}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block">
              {t('settings.days_remaining')}
            </span>
            <span className="font-mono font-bold text-[var(--text-primary)] mt-0.5 block">
              {sslStatus?.days_remaining ?? 0} days
            </span>
          </div>

          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block">
              {t('settings.cert_issuer')}
            </span>
            <span className="font-mono text-[var(--text-secondary)] mt-0.5 block truncate">
              {sslStatus?.issuer || 'Self-Signed / Internal'}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block">
              {t('settings.cert_expires')}
            </span>
            <span className="font-mono text-[var(--text-secondary)] mt-0.5 block">
              {sslStatus?.expires_at ? new Date(sslStatus.expires_at).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-6 shadow-[var(--card-shadow)] space-y-4">
        <h2 className="text-sm font-bold text-[var(--text-primary)] border-b border-[var(--glass-border)] pb-3">
          Network & Bastion Domain
        </h2>

        {saveSuccess && (
          <div className="p-3 bg-brand-lime/10 border border-brand-lime/30 text-brand-lime text-xs rounded-lg font-semibold">
            {t('common.success')}! Settings saved successfully.
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              CloudHub Hostname / Domain FQDN
            </label>
            <input
              type="text"
              value={settings.hub_domain || ''}
              onChange={(e) => setSettings({ ...settings, hub_domain: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)] font-mono"
              placeholder="myolicaster.streaming-pro.com"
            />
            <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
              Standard FQDN used by appliances to connect reverse tunnels over Let's Encrypt HTTPS / WSS.
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              Let's Encrypt Email
            </label>
            <input
              type="email"
              value={settings.letsencrypt_email || ''}
              onChange={(e) => setSettings({ ...settings, letsencrypt_email: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)] font-mono"
              placeholder="admin@streaming-pro.com"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="force_https"
              checked={!!settings.force_https}
              onChange={(e) => setSettings({ ...settings, force_https: e.target.checked })}
              className="rounded accent-brand-lime cursor-pointer"
            />
            <label htmlFor="force_https" className="text-xs text-[var(--text-primary)] cursor-pointer">
              Force HTTPS / WSS Redirection
            </label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="letsencrypt_staging"
              checked={!!settings.letsencrypt_staging}
              onChange={(e) =>
                setSettings({ ...settings, letsencrypt_staging: e.target.checked })
              }
              className="rounded accent-brand-lime cursor-pointer"
            />
            <label
              htmlFor="letsencrypt_staging"
              className="text-xs text-[var(--text-primary)] cursor-pointer"
            >
              Use Let's Encrypt Staging Environment (for testing/dry-runs)
            </label>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              {isSaving ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
