import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SslStatus } from '../../../types/hub';
import { NetworkInterfaceSelector } from '../../common/NetworkInterfaceSelector';
import { UploadIcon, RefreshIcon, TrashIcon, CheckIcon, AlertTriangleIcon } from '../../Icons';

export const NetworkSslTab: React.FC = () => {
  const { t } = useTranslation();
  const [sslStatus, setSslStatus] = useState<SslStatus | null>(null);
  const [settings, setSettings] = useState<Record<string, any>>({
    bind_address: '0.0.0.0',
    http_port: 9000,
    https_port: 9443,
    ssl_enabled: false,
    force_https_redirect: false,
    ssl_mode: 'acme',
    hub_domain: '',
    letsencrypt_email: '',
    letsencrypt_staging: false,
  });
  const [isLoading, setIsLoading] = useState(true);

  // ACME Issue State
  const [isIssuingAcme, setIsIssuingAcme] = useState(false);
  const [acmeMsg, setAcmeMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Custom Cert Upload State (File upload matching ffmpeg-gui)
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
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
        const st = await sRes.json();
        setSslStatus(st);
      }
      if (cRes.ok) {
        const cfg = await cRes.json();
        setSettings((prev) => {
          const activeMode =
            prev.ssl_mode === 'acme' || prev.ssl_mode === 'custom'
              ? prev.ssl_mode
              : cfg.ssl_mode && cfg.ssl_mode !== 'disabled'
              ? cfg.ssl_mode
              : 'acme';

          return {
            ...prev,
            ...cfg,
            bind_address: cfg.bind_address || '0.0.0.0',
            http_port: Number(cfg.http_port || 9000),
            https_port: Number(cfg.https_port || 9443),
            ssl_enabled: Boolean(cfg.ssl_enabled),
            force_https_redirect: Boolean(cfg.force_https_redirect ?? cfg.force_https ?? false),
            ssl_mode: activeMode,
          };
        });
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
      const payload = {
        ...settings,
        http_port: Number(settings.http_port || 9000),
        https_port: Number(settings.https_port || 9443),
        ssl_enabled: Boolean(settings.ssl_enabled && sslStatus?.valid),
        force_https_redirect: Boolean(
          settings.force_https_redirect && settings.ssl_enabled && sslStatus?.valid
        ),
      };
      const res = await fetch('/api/hub/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settings: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const reloadNote = data.reloading_listeners
          ? ` ${t('settings.networkReloadingNote', 'Reloading HTTP/HTTPS listeners...')}`
          : '';
        setSettingsMsg({
          type: 'success',
          text: `${t('settings.networkSaveSuccess', 'Network parameters saved.')}${reloadNote}`,
        });
        fetchData();
        setTimeout(() => setSettingsMsg(null), 5000);
      } else {
        setSettingsMsg({
          type: 'error',
          text: data.detail || t('settings.networkSaveError', 'Failed to save network parameters'),
        });
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
    if (!domain || domain === 'localhost' || !email) {
      setAcmeMsg({
        type: 'error',
        text: t(
          'settings.acmeFieldsRequired',
          'Please configure both a valid public Domain Name (FQDN) and ACME Contact Email first.'
        ),
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
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAcmeMsg({
          type: 'success',
          text:
            data.detail ||
            data.message ||
            t('settings.acmeIssuedSuccess', 'Let’s Encrypt operation completed successfully!'),
        });
        await fetchData();
      } else {
        setAcmeMsg({
          type: 'error',
          text: data.detail || t('settings.acmeIssuedError', 'Failed to issue Let’s Encrypt certificate.'),
        });
      }
    } catch (err: any) {
      setAcmeMsg({
        type: 'error',
        text: err.message || 'Connection error during ACME issuance',
      });
    } finally {
      setIsIssuingAcme(false);
    }
  };

  const handleUploadCustomSsl = async () => {
    if (!certFile || !keyFile) {
      setCustomMsg({
        type: 'error',
        text: t('settings.bothCertsRequired', 'Both certificate chain and private key files are required.'),
      });
      return;
    }

    setIsUploadingCustom(true);
    setCustomMsg(null);
    try {
      const formData = new FormData();
      formData.append('cert_file', certFile);
      formData.append('key_file', keyFile);

      const res = await fetch('/api/hub/settings/ssl/upload-custom', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCustomMsg({
          type: 'success',
          text: data.message || t('settings.customCertInstalled', 'Custom certificate validated and installed successfully.'),
        });
        setCertFile(null);
        setKeyFile(null);
        await fetchData();
      } else {
        setCustomMsg({
          type: 'error',
          text: data.detail || t('settings.customCertInvalid', 'Invalid certificate or private key.'),
        });
      }
    } catch (err: any) {
      setCustomMsg({ type: 'error', text: err.message || 'Error uploading certificate' });
    } finally {
      setIsUploadingCustom(false);
    }
  };

  const handleDeleteCert = async () => {
    if (
      !window.confirm(
        t(
          'settings.confirmDeleteCert',
          'Are you sure you want to delete the installed SSL certificate? HTTPS encryption will be reverted and the server will listen on HTTP only.'
        )
      )
    ) {
      return;
    }
    try {
      const res = await fetch('/api/hub/settings/ssl/delete', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        setAcmeMsg(null);
        setCustomMsg(null);
        if (window.location.protocol === 'https:') {
          const httpPort = settings.http_port || 9000;
          const host = window.location.hostname;
          window.location.href = `http://${host}:${httpPort}/settings`;
          return;
        }
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to delete cert:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
        {t('common.loading', 'Loading Network & SSL settings...')}
      </div>
    );
  }

  const isCertValid = Boolean(sslStatus?.valid);
  const sslEnabled = Boolean(settings.ssl_enabled && isCertValid);
  const forceHttpsRedirect = Boolean(settings.force_https_redirect && sslEnabled);
  const sslMode = settings.ssl_mode || 'acme';

  const hostName = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const isVisitingViaIp =
    /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostName) || hostName === 'localhost';
  const secureDomain = sslStatus?.domain || settings.hub_domain || hostName;
  const securePort =
    Number(settings.https_port || 9443) === 443 ? '' : `:${settings.https_port || 9443}`;
  const secureUrl = `https://${secureDomain}${securePort}/settings`;

  return (
    <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
      {/* ── CARD 1: LISTEN PORTS & NETWORK INTERFACES (Ported from ffmpeg-gui) ── */}
      <form
        onSubmit={handleSaveNetworkSettings}
        className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4"
      >
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime" />
            <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
              🌐 {t('settings.network.cardTitle', 'LISTEN PORTS & NETWORK INTERFACES')}
            </h4>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-[var(--glass-border)] text-[var(--text-secondary)]">
              HTTP :{settings.http_port || 9000}
            </span>
            {sslEnabled && (
              <span className="px-2.5 py-0.5 rounded-full bg-brand-lime/15 border border-brand-lime/30 text-brand-lime font-bold">
                HTTPS :{settings.https_port || 9443} {forceHttpsRedirect ? '(307 Redirect)' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <NetworkInterfaceSelector
              value={settings.bind_address || '0.0.0.0'}
              onChange={(val) => setSettings({ ...settings, bind_address: val })}
              label={t('settings.network.listenInterfaces', 'Listen IP Interface')}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
              {t('settings.network.httpPort', 'HTTP Listen Port (GUI)')}
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.http_port ?? 9000}
              onChange={(e) =>
                setSettings({ ...settings, http_port: parseInt(e.target.value, 10) || 9000 })
              }
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label
              className={`text-[10px] uppercase font-bold tracking-wider block ${
                !isCertValid ? 'text-[var(--text-secondary)] opacity-50' : 'text-[var(--text-secondary)]'
              }`}
            >
              {t('settings.network.httpsPort', 'HTTPS Listen Port')}
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              disabled={!isCertValid}
              value={settings.https_port ?? 9443}
              onChange={(e) =>
                setSettings({ ...settings, https_port: parseInt(e.target.value, 10) || 9443 })
              }
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="ssl_enabled_checkbox"
              disabled={!isCertValid}
              checked={sslEnabled}
              onChange={(e) => {
                const checked = e.target.checked;
                setSettings({
                  ...settings,
                  ssl_enabled: checked,
                  force_https_redirect: checked ? settings.force_https_redirect : false,
                });
              }}
              className="w-4 h-4 rounded accent-brand-lime cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            />
            <label
              htmlFor="ssl_enabled_checkbox"
              className={`text-xs font-bold ${
                !isCertValid
                  ? 'opacity-40 cursor-not-allowed text-[var(--text-secondary)]'
                  : 'text-[var(--text-primary)] cursor-pointer'
              }`}
            >
              {t('settings.network.enableHttps', 'Enable HTTPS Encryption')}
            </label>
          </div>

          {!isCertValid && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-400 font-mono flex items-center gap-2">
              <span>⚠️</span>
              <span>
                {t(
                  'settings.network.httpsDisabledCertTooltip',
                  'HTTPS cannot be enabled until a valid SSL certificate and keypair are loaded.'
                )}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="force_https_redirect_checkbox"
              disabled={!sslEnabled || !isCertValid}
              checked={forceHttpsRedirect}
              onChange={(e) =>
                setSettings({ ...settings, force_https_redirect: e.target.checked })
              }
              className="w-4 h-4 rounded accent-brand-lime cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            />
            <label
              htmlFor="force_https_redirect_checkbox"
              className={`text-xs font-bold ${
                !sslEnabled || !isCertValid
                  ? 'opacity-40 cursor-not-allowed text-[var(--text-secondary)]'
                  : 'text-[var(--text-primary)] cursor-pointer'
              }`}
            >
              {t(
                'settings.network.forceHttpsRedirect',
                'Automatically Redirect HTTP -> HTTPS (307 Redirect to HTTPS Port)'
              )}
            </label>
          </div>
        </div>

        {settingsMsg && (
          <div
            className={`p-3 rounded-xl border text-xs font-mono flex items-center gap-2 ${
              settingsMsg.type === 'success'
                ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {settingsMsg.type === 'success' ? <CheckIcon size={15} /> : <AlertTriangleIcon size={15} />}
            <span>{settingsMsg.text}</span>
          </div>
        )}

        <div className="flex items-center justify-end pt-3 border-t border-[var(--glass-border)]">
          <button
            type="submit"
            disabled={isSavingSettings}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-lime text-black font-bold text-xs uppercase tracking-wider hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          >
            <CheckIcon size={16} />
            <span>
              {isSavingSettings
                ? t('common.saving', 'Saving...')
                : t('settings.saveNetworkBtn', 'Save Network Settings')}
            </span>
          </button>
        </div>
      </form>

      {/* ── CARD 2: SSL / TLS CERTIFICATE MANAGEMENT (Ported from ffmpeg-gui) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-brand-lime" />
            <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
              📜 {t('settings.ssl.title', 'SSL / TLS CERTIFICATE MANAGEMENT')}
            </h4>
          </div>

          {/* Status Badge + Delete Action */}
          {sslStatus && (
            <div className="flex items-center gap-2">
              <div
                className={`px-3 py-1 rounded-lg border text-xs font-mono font-bold flex items-center gap-2 ${
                  sslStatus.status === 'valid'
                    ? 'bg-brand-lime/15 border-brand-lime/30 text-brand-lime'
                    : sslStatus.status === 'warning'
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                    : sslStatus.status === 'critical' || sslStatus.status === 'expired'
                    ? 'bg-red-500/15 border-red-500/30 text-red-400 animate-pulse'
                    : 'bg-[var(--input-bg)] border-[var(--glass-border)] text-[var(--text-secondary)]'
                }`}
              >
                <span>
                  {sslStatus.status === 'valid'
                    ? '🟢'
                    : sslStatus.status === 'warning'
                    ? '🟡'
                    : '🔴'}
                </span>
                <span className="uppercase">
                  {sslStatus.status === 'valid'
                    ? t('settings.ssl.statusValid', 'Valid Certificate')
                    : sslStatus.status === 'warning'
                    ? t('settings.ssl.statusWarning', 'Expiring Soon')
                    : sslStatus.status === 'critical'
                    ? t('settings.ssl.statusCritical', 'Critical Expiration')
                    : sslStatus.status === 'expired'
                    ? t('settings.ssl.statusExpired', 'Expired Certificate')
                    : t('settings.ssl.statusMissing', 'No Active Certificate')}
                </span>
                {sslStatus.valid && (
                  <span className="opacity-80">({sslStatus.days_remaining}d remaining)</span>
                )}
              </div>

              {sslStatus.valid && (
                <button
                  type="button"
                  onClick={handleDeleteCert}
                  className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
                  title={t('settings.deleteCert', 'Remove Certificate')}
                >
                  <TrashIcon size={15} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Domain Access Guidance / Secure Link (Critical for Let's Encrypt domain validation) */}
        {sslStatus?.valid && (
          <div
            className={`p-4 rounded-xl border text-xs space-y-2.5 ${
              isVisitingViaIp
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-brand-lime/10 border-brand-lime/30'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold font-mono">
                <span>{isVisitingViaIp ? '⚠️' : '🔒'}</span>
                <span className={isVisitingViaIp ? 'text-amber-400' : 'text-brand-lime'}>
                  {isVisitingViaIp
                    ? t('settings.ssl.ipNoticeTitle', 'Accessing via Numerical IP Address')
                    : t('settings.ssl.domainActiveTitle', 'Active Secure Domain URL')}
                </span>
              </div>
              <a
                href={secureUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg font-mono font-bold text-xs transition-all cursor-pointer"
              >
                <span>{t('settings.ssl.openSecureUrl', 'Open Secure Domain')}</span>
                <span>↗</span>
              </a>
            </div>

            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              {isVisitingViaIp
                ? t(
                    'settings.ssl.ipNoticeDesc',
                    'Your SSL/TLS certificate is 100% valid, but issued specifically to your domain name. Navigating via raw IP (e.g., https://212.x.x.x) causes browsers to display a "Not Secure / Certificate Common Name Mismatch" warning. Click the button above to navigate via your secure domain.'
                  )
                : t(
                    'settings.ssl.domainActiveDesc',
                    'Your browser is connected via the verified domain name matching your SSL/TLS certificate with full cryptographic trust.'
                  )}
            </p>
          </div>
        )}

        {/* Installed Production Certificate Details (Only shown when a valid cert is installed) */}
        {sslStatus?.valid && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block font-mono">
                {t('settings.certDomain', 'Issued Domain')}
              </span>
              <span className="font-mono font-bold text-[var(--text-primary)] mt-1 block truncate">
                {sslStatus.domain || settings.hub_domain || '—'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block font-mono">
                {t('settings.daysRemaining', 'Days Remaining')}
              </span>
              <span
                className={`font-mono font-bold mt-1 block ${
                  sslStatus.days_remaining <= 15
                    ? 'text-red-400'
                    : sslStatus.days_remaining <= 30
                    ? 'text-amber-400'
                    : 'text-brand-lime'
                }`}
              >
                {sslStatus.days_remaining} {t('common.days', 'days')}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block font-mono">
                {t('settings.certIssuer', 'Issuer')}
              </span>
              <span className="font-mono text-[var(--text-secondary)] mt-1 block truncate" title={sslStatus.issuer || ''}>
                {sslStatus.issuer || '—'}
              </span>
            </div>

            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block font-mono">
                {t('settings.certExpires', 'Expiration Date')}
              </span>
              <span className="font-mono text-[var(--text-secondary)] mt-1 block">
                {sslStatus.expires_at ? new Date(sslStatus.expires_at).toLocaleDateString() : '—'}
              </span>
            </div>
          </div>
        )}

        {/* Certificate Source Mode & Domain Name */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
              {t('settings.ssl.mode', 'Certificate Source Mode')}
            </label>
            <select
              value={sslMode}
              onChange={(e) => setSettings({ ...settings, ssl_mode: e.target.value })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono cursor-pointer"
            >
              <option value="disabled">{t('settings.ssl.disabled', 'Disabled / Local Fallback')}</option>
              <option value="acme">{t('settings.ssl.acme', "Let's Encrypt (ACME Auto-Renewal)")}</option>
              <option value="custom">{t('settings.ssl.custom', 'Custom Certificate Upload')}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
              {t('settings.ssl.domain', 'Domain Name (FQDN / SNI)')}
            </label>
            <input
              type="text"
              placeholder="cloudhub.example.com"
              value={settings.hub_domain || ''}
              onChange={(e) => setSettings({ ...settings, hub_domain: e.target.value })}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
            />
          </div>
        </div>

        {/* ACME Configuration Panel */}
        {sslMode === 'acme' && (
          <div className="p-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl space-y-4">
            <h5 className="text-xs font-bold uppercase tracking-wider text-brand-lime flex items-center gap-2">
              <span>🔒</span> {t('settings.ssl.acmeConfigTitle', "Let's Encrypt ACME Configuration")}
            </h5>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.ssl.email', 'ACME Contact Email')}
                </label>
                <input
                  type="email"
                  placeholder="admin@example.com"
                  value={settings.letsencrypt_email || ''}
                  onChange={(e) =>
                    setSettings({ ...settings, letsencrypt_email: e.target.value })
                  }
                  className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 text-xs outline-none focus:border-brand-lime text-[var(--text-primary)] font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.ssl.challenge', 'Validation Challenge')}
                </label>
                <input
                  type="text"
                  disabled
                  value="HTTP-01 Challenge (Temporary TCP Port 80 Listener)"
                  className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 text-xs text-[var(--text-secondary)] font-mono opacity-75"
                />
              </div>
            </div>

            <div className="p-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl space-y-1">
              <label className="flex items-center gap-2.5 text-xs text-[var(--text-primary)] cursor-pointer font-bold">
                <input
                  type="checkbox"
                  checked={Boolean(settings.letsencrypt_staging)}
                  onChange={(e) =>
                    setSettings({ ...settings, letsencrypt_staging: e.target.checked })
                  }
                  className="rounded accent-brand-lime cursor-pointer w-4 h-4"
                />
                <span>
                  {t(
                    'settings.acmeStaging',
                    'Use Let’s Encrypt Staging Environment (Dry-Run Validation Only)'
                  )}
                </span>
              </label>
              <p className="text-[11px] text-[var(--text-secondary)] pl-6">
                {t(
                  'settings.acmeStagingHelp',
                  'Tests domain DNS resolution and Port 80 HTTP-01 reachability against Let’s Encrypt Staging without installing the untrusted test certificate. Uncheck this option to issue and install the real production certificate.'
                )}
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleIssueAcme}
                  disabled={isIssuingAcme}
                  className="px-4 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {isIssuingAcme ? (
                    <>
                      <RefreshIcon size={14} className="animate-spin" />
                      <span>
                        {settings.letsencrypt_staging
                          ? t('settings.testingAcmeDryRun', 'Running Dry-Run Validation...')
                          : t('settings.issuingAcme', 'Issuing Certificate...')}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      <span>
                        {settings.letsencrypt_staging
                          ? t('settings.testAcmeDryRunBtn', 'Test Dry-Run (Staging)')
                          : t('settings.requestAcmeBtn', 'Issue / Renew Certificate Now')}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {acmeMsg && (
                <div
                  className={`p-3.5 rounded-xl border text-xs font-mono flex items-start gap-2.5 animate-in fade-in duration-300 ${
                    acmeMsg.type === 'success'
                      ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  <span className="text-sm shrink-0">
                    {acmeMsg.type === 'success' ? '✓' : '⚠️'}
                  </span>
                  <div className="leading-relaxed break-words flex-1">{acmeMsg.text}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Custom Upload Drawer (Ported from ffmpeg-gui) */}
        {(sslMode === 'custom' || sslMode === 'disabled') && (
          <div className="p-4 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl space-y-4">
            <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
              <span>📤</span>{' '}
              {t('settings.ssl.uploadTitle', 'Upload Custom Certificate & Private Key')}
            </h5>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.ssl.certFile', 'Fullchain Certificate (.crt / .pem)')}
                </label>
                <input
                  type="file"
                  accept=".pem,.crt,.cer"
                  onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                  className="w-full text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.ssl.keyFile', 'Private Key (.key / privkey.pem)')}
                </label>
                <input
                  type="file"
                  accept=".key,.pem"
                  onChange={(e) => setKeyFile(e.target.files?.[0] || null)}
                  className="w-full text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg p-2 cursor-pointer"
                />
              </div>
            </div>

            {customMsg && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-mono flex items-start gap-2.5 ${
                  customMsg.type === 'success'
                    ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}
              >
                <span className="text-sm shrink-0">
                  {customMsg.type === 'success' ? '✓' : '⚠️'}
                </span>
                <div className="leading-relaxed break-words flex-1">{customMsg.text}</div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleUploadCustomSsl}
                disabled={isUploadingCustom || !certFile || !keyFile}
                className="px-4 py-2 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <UploadIcon size={14} />
                <span>
                  {isUploadingCustom
                    ? t('common.uploading', 'Validating & Saving...')
                    : t('settings.ssl.uploadBtn', 'Upload & Validate Keypair')}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
