import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SslStatus } from '../../../types/hub';
import { ShieldIcon, KeyIcon, UploadIcon, RefreshIcon, TrashIcon, CheckIcon, AlertTriangleIcon } from '../../Icons';

export const NetworkSslTab: React.FC = () => {
  const { t } = useTranslation();
  const [sslStatus, setSslStatus] = useState<SslStatus | null>(null);
  const [settings, setSettings] = useState<Record<string, any>>({
    hub_domain: '',
    force_https: false,
    letsencrypt_email: '',
    letsencrypt_staging: false,
  });
  const [isLoading, setIsLoading] = useState(true);

  // ACME Issue State
  const [isIssuingAcme, setIsIssuingAcme] = useState(false);
  const [acmeMsg, setAcmeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Custom Cert Upload State
  const [customCertPem, setCustomCertPem] = useState('');
  const [customKeyPem, setCustomKeyPem] = useState('');
  const [isUploadingCustom, setIsUploadingCustom] = useState(false);
  const [customMsg, setCustomMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Settings Save State
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch('/api/hub/settings/ssl/status', { credentials: 'include' }),
        fetch('/api/hub/settings', { credentials: 'include' }),
      ]);
      if (sRes.ok) {
        setSslStatus(await sRes.json());
      }
      if (cRes.ok) {
        setSettings(await cRes.json());
      }
    } catch (err) {
      console.error('Failed to load SSL status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveNetworkSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsMsg(null);
    try {
      const res = await fetch('/api/hub/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        setSettingsMsg({ type: 'success', text: t('settings.networkSaveSuccess', 'Network parameters saved.') });
        setTimeout(() => setSettingsMsg(null), 4000);
      } else {
        const err = await res.json().catch(() => ({}));
        setSettingsMsg({ type: 'error', text: err.detail || 'Failed to save network parameters' });
      }
    } catch (err: any) {
      setSettingsMsg({ type: 'error', text: err.message || 'Network error' });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleIssueAcme = async () => {
    const domain = settings.hub_domain?.trim();
    const email = settings.letsencrypt_email?.trim();
    if (!domain || !email) {
      setAcmeMsg({
        type: 'error',
        text: t('settings.acmeFieldsRequired', 'Please configure both Hostname FQDN and Contact Email first.'),
      });
      return;
    }

    setIsIssuingAcme(true);
    setAcmeMsg(null);
    try {
      const res = await fetch('/api/hub/settings/ssl/issue-acme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain,
          email,
          staging: Boolean(settings.letsencrypt_staging),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAcmeMsg({
          type: 'success',
          text: data.detail || 'Let’s Encrypt certificate successfully issued and installed!',
        });
        fetchData();
      } else {
        setAcmeMsg({ type: 'error', text: data.detail || 'Failed to issue Let’s Encrypt certificate.' });
      }
    } catch (err: any) {
      setAcmeMsg({ type: 'error', text: err.message || 'Connection error during ACME issuance' });
    } finally {
      setIsIssuingAcme(false);
    }
  };

  const handleUploadCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customCertPem.trim() || !customKeyPem.trim()) {
      setCustomMsg({ type: 'error', text: t('settings.bothCertsRequired', 'Both certificate chain and private key are required.') });
      return;
    }

    setIsUploadingCustom(true);
    setCustomMsg(null);
    try {
      const res = await fetch('/api/hub/settings/ssl/upload-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cert_pem: customCertPem,
          key_pem: customKeyPem,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCustomMsg({ type: 'success', text: data.detail || 'Custom certificate installed successfully.' });
        setCustomCertPem('');
        setCustomKeyPem('');
        fetchData();
      } else {
        setCustomMsg({ type: 'error', text: data.detail || 'Invalid certificate or private key.' });
      }
    } catch (err: any) {
      setCustomMsg({ type: 'error', text: err.message || 'Error uploading certificate' });
    } finally {
      setIsUploadingCustom(false);
    }
  };

  const handleDeleteCert = async () => {
    if (!confirm(t('settings.confirmDeleteCert', 'Are you sure you want to delete the installed SSL certificate? Server will fall back to HTTP/unencrypted.'))) {
      return;
    }
    try {
      const res = await fetch('/api/hub/settings/ssl/delete', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to delete cert:', err);
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

  if (isLoading) {
    return (
      <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
        {t('common.loading', 'Loading SSL status...')}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Active SSL Status Card ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
          <div className="flex items-center gap-2.5">
            <ShieldIcon size={20} className={sslStatus?.valid ? 'text-emerald-400' : 'text-amber-400'} />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                {t('settings.activeCertStatus', 'Active TLS / SSL Certificate')}
              </h3>
              <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                Mode: {(sslStatus?.mode || 'none').toUpperCase()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-mono font-bold px-3 py-1 rounded-full border ${sslBadge}`}>
              {sslStatus?.status?.toUpperCase() || 'UNKNOWN'}
            </span>

            {sslStatus?.valid && (
              <button
                onClick={handleDeleteCert}
                className="p-1.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                title={t('settings.deleteCert', 'Remove Certificate')}
              >
                <TrashIcon size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block font-mono">
              {t('settings.certDomain', 'Issued Domain:')}
            </span>
            <span className="font-mono font-bold text-[var(--text-primary)] mt-1 block truncate">
              {sslStatus?.domain || settings.hub_domain || 'None'}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block font-mono">
              {t('settings.daysRemaining', 'Days Remaining:')}
            </span>
            <span
              className={`font-mono font-bold mt-1 block text-base ${
                (sslStatus?.days_remaining ?? 0) <= 15
                  ? 'text-red-400'
                  : (sslStatus?.days_remaining ?? 0) <= 30
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {sslStatus?.days_remaining ?? 0} {t('common.days', 'days')}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block font-mono">
              {t('settings.certIssuer', 'Issuer:')}
            </span>
            <span className="font-mono text-[var(--text-secondary)] mt-1 block truncate">
              {sslStatus?.issuer || 'Self-Signed / Internal'}
            </span>
          </div>

          <div>
            <span className="text-[11px] text-[var(--text-secondary)] block font-mono">
              {t('settings.certExpires', 'Expiration Date:')}
            </span>
            <span className="font-mono text-[var(--text-secondary)] mt-1 block">
              {sslStatus?.expires_at ? new Date(sslStatus.expires_at).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Network & FQDN Configuration ── */}
      <form onSubmit={handleSaveNetworkSettings} className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {t('settings.networkFqdnTitle', 'Domain & Network Routing')}
          </h3>
          <button
            type="submit"
            disabled={isSavingSettings}
            className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-[var(--text-primary)] text-xs font-medium transition-all cursor-pointer disabled:opacity-50"
          >
            {isSavingSettings ? t('common.saving', 'Saving...') : t('common.saveSettings', 'Save Network')}
          </button>
        </div>

        {settingsMsg && (
          <div
            className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
              settingsMsg.type === 'success'
                ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            <span>{settingsMsg.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('settings.hubDomain', 'CloudHub Public FQDN / Hostname')}
            </label>
            <input
              type="text"
              value={settings.hub_domain || ''}
              onChange={(e) => setSettings({ ...settings, hub_domain: e.target.value })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
              placeholder="hub.example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('settings.acmeEmail', 'Let’s Encrypt Notification Email')}
            </label>
            <input
              type="email"
              value={settings.letsencrypt_email || ''}
              onChange={(e) => setSettings({ ...settings, letsencrypt_email: e.target.value })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
              placeholder="admin@example.com"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2">
          <label className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(settings.force_https)}
              onChange={(e) => setSettings({ ...settings, force_https: e.target.checked })}
              className="rounded accent-brand-lime cursor-pointer w-4 h-4"
            />
            <span>{t('settings.forceHttps', 'Enforce HTTPS & WSS Redirection')}</span>
          </label>

          <label className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(settings.letsencrypt_staging)}
              onChange={(e) => setSettings({ ...settings, letsencrypt_staging: e.target.checked })}
              className="rounded accent-brand-lime cursor-pointer w-4 h-4"
            />
            <span>{t('settings.acmeStaging', 'Use Let’s Encrypt Staging Environment (Dry-run)')}</span>
          </label>
        </div>
      </form>

      {/* ── Let's Encrypt Autonomous Issuance ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
          <div className="flex items-center gap-2.5">
            <ShieldIcon size={18} className="text-brand-lime" />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              {t('settings.acmeEngineTitle', 'Automated Let’s Encrypt Certificate Engine')}
            </h3>
          </div>

          <button
            type="button"
            disabled={isIssuingAcme}
            onClick={handleIssueAcme}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            {isIssuingAcme ? (
              <>
                <RefreshIcon size={14} className="animate-spin" />
                <span>{t('settings.issuingAcme', 'Issuing Certificate...')}</span>
              </>
            ) : (
              <>
                <CheckIcon size={14} />
                <span>{t('settings.requestAcmeBtn', 'Issue / Renew Certificate')}</span>
              </>
            )}
          </button>
        </div>

        <p className="text-xs text-[var(--text-secondary)]">
          {t('settings.acmeDesc', 'Pure-Python ACME v2 HTTP-01 automated issuance. CloudHub temporarily binds TCP port 80 to complete domain ownership challenges and installs fullchain.pem and privkey.pem automatically with background auto-renewal.')}
        </p>

        {acmeMsg && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
              acmeMsg.type === 'success'
                ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {acmeMsg.type === 'success' ? <CheckIcon size={16} /> : <AlertTriangleIcon size={16} />}
            <span>{acmeMsg.text}</span>
          </div>
        )}
      </div>

      {/* ── Custom Certificate Upload ── */}
      <form onSubmit={handleUploadCustom} className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
          <div className="flex items-center gap-2.5">
            <KeyIcon size={18} className="text-brand-lime" />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">
              {t('settings.customCertTitle', 'Manual / Commercial Certificate Upload')}
            </h3>
          </div>

          <button
            type="submit"
            disabled={isUploadingCustom}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-[var(--text-primary)] text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
          >
            <UploadIcon size={14} />
            <span>{isUploadingCustom ? t('common.uploading', 'Installing...') : t('settings.installCustomCert', 'Install Custom Certificate')}</span>
          </button>
        </div>

        {customMsg && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-medium flex items-center gap-2 ${
              customMsg.type === 'success'
                ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            <span>{customMsg.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5 font-mono">
              Certificate Chain (fullchain.pem)
            </label>
            <textarea
              rows={6}
              value={customCertPem}
              onChange={(e) => setCustomCertPem(e.target.value)}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5 font-mono">
              Private Key (privkey.pem)
            </label>
            <textarea
              rows={6}
              value={customKeyPem}
              onChange={(e) => setCustomKeyPem(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-3 text-[11px] font-mono text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
            />
          </div>
        </div>
      </form>
    </div>
  );
};
