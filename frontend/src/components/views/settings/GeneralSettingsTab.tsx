import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '../../Icons';

const THEME_OPTIONS = [
  {
    key: 'studio-dark',
    nameKey: 'settings.theme.studioDark',
    defaultName: 'Studio Dark',
    mode: 'dark',
    bg: '#050505',
    accent1: '#d4ff5b',
    accent2: '#ff9500',
  },
  {
    key: 'cyberpunk',
    nameKey: 'settings.theme.cyberpunk',
    defaultName: 'Cyberpunk',
    mode: 'dark',
    bg: '#050508',
    accent1: '#00f0ff',
    accent2: '#ff0055',
  },
  {
    key: 'nordic-frost',
    nameKey: 'settings.theme.nordicFrost',
    defaultName: 'Nordic Frost',
    mode: 'dark',
    bg: '#0c1017',
    accent1: '#38bdf8',
    accent2: '#818cf8',
  },
  {
    key: 'broadcast-light',
    nameKey: 'settings.theme.broadcastLight',
    defaultName: 'Broadcast Light',
    mode: 'light',
    bg: '#f1f5f9',
    accent1: '#0284c7',
    accent2: '#ea580c',
  },
  {
    key: 'warm-paper',
    nameKey: 'settings.theme.warmPaper',
    defaultName: 'Warm Paper',
    mode: 'light',
    bg: '#f7f4ee',
    accent1: '#b45309',
    accent2: '#0f766e',
  },
];

interface GeneralSettingsTabProps {
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
  currentTheme = 'studio-dark',
  onThemeChange,
}) => {
  const { t, i18n } = useTranslation();
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
    <form onSubmit={handleSave} className="space-y-6">
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

      {/* ── CARD 1: Interface Language (Ported 1:1 from ffmpeg-gui) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <h4 className="text-cyan-400 font-bold text-xs uppercase tracking-wider">
            {t('settings.language.title', 'Interface Language')}
          </h4>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            {t('settings.language.description', 'Select the display language for the application user interface.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { code: 'en', label: 'English (US)', badge: 'EN' },
              { code: 'es', label: 'Español (ES)', badge: 'ES' },
              { code: 'ca', label: 'Català (CA)', badge: 'CA' },
            ].map((item) => {
              const isSelected = i18n.language.startsWith(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => i18n.changeLanguage(item.code)}
                  className={`p-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                    isSelected
                      ? 'border-brand-lime bg-brand-lime/10 text-[var(--text-primary)] font-bold shadow-md ring-1 ring-brand-lime/40'
                      : 'border-[var(--glass-border)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:border-brand-lime/40 hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="text-xs">{item.label}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--bg-dark)] border border-[var(--glass-border)] text-cyan-400 font-bold">
                    {item.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── CARD 2: Interface Theme (Ported 1:1 from ffmpeg-gui) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
            {t('settings.theme.title', 'INTERFACE THEME')}
          </h4>
        </div>

        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            {t('settings.theme.description', 'Select visual theme for the user interface.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {THEME_OPTIONS.map((item) => {
              const isSelected = currentTheme === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onThemeChange?.(item.key)}
                  className={`p-3 rounded-xl border flex flex-col justify-between transition-all cursor-pointer text-left relative overflow-hidden ${
                    isSelected
                      ? 'border-brand-lime bg-brand-lime/10 shadow-md ring-1 ring-brand-lime/50'
                      : 'border-[var(--glass-border)] bg-[var(--input-bg)] hover:border-brand-lime/40'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-brand-lime text-black flex items-center justify-center text-[10px] font-bold">
                      ✓
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 mb-2 pr-5">
                    <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {t(item.nameKey, item.defaultName)}
                    </span>
                    <span className="text-xs shrink-0" title={item.mode}>
                      {item.mode === 'dark' ? '🌙' : '☀️'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span
                      className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                      style={{ backgroundColor: item.bg }}
                      title={`BG: ${item.bg}`}
                    />
                    <span
                      className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                      style={{ backgroundColor: item.accent1 }}
                      title={`Accent 1: ${item.accent1}`}
                    />
                    <span
                      className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                      style={{ backgroundColor: item.accent2 }}
                      title={`Accent 2: ${item.accent2}`}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── CARD 3: Platform Branding ── */}
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

      {/* ── CARD 4: Security & Maintenance Policies ── */}
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
