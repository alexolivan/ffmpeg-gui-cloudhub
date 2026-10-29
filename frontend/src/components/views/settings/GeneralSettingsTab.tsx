import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../types/hub';
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
  currentUser?: User;
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
  onSettingsUpdated?: () => void;
  onUserUpdated?: () => void;
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
  currentUser,
  currentTheme = 'studio-dark',
  onThemeChange,
  onSettingsUpdated,
  onUserUpdated,
}) => {
  const { t, i18n } = useTranslation();

  // Platform general settings
  const [settings, setSettings] = useState<Record<string, any>>({
    hub_name: 'ffmpeg-gui CloudHub',
    login_logo_text: 'CH',
    login_logo_url: '',
    session_timeout_days: 7,
    audit_retention_days: 90,
    logging_mode: 'both',
    logging_timestamp_tz: 'utc',
    logging_path: 'data/logs',
    logging_rotation_enabled: true,
    logging_rotation_max_bytes: 10485760,
    logging_rotation_backup_count: 5,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Owner credentials state
  const [ownerUsername, setOwnerUsername] = useState<string>(currentUser?.username || 'admin');
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isUpdatingCredentials, setIsUpdatingCredentials] = useState(false);
  const [credentialFeedback, setCredentialFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Logo upload state
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const [logoImgError, setLogoImgError] = useState(false);

  useEffect(() => {
    setLogoImgError(false);
  }, [settings.login_logo_url]);

  // Shield browser from navigating to dropped file anywhere on screen
  useEffect(() => {
    const preventFileDropNav = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventFileDropNav);
    window.addEventListener('drop', preventFileDropNav);
    return () => {
      window.removeEventListener('dragover', preventFileDropNav);
      window.removeEventListener('drop', preventFileDropNav);
    };
  }, []);

  // Log path test state
  const [pathTestStatus, setPathTestStatus] = useState<{
    state: 'idle' | 'testing' | 'success' | 'error';
    message?: string;
  }>({ state: 'idle' });

  useEffect(() => {
    if (currentUser?.username) {
      setOwnerUsername(currentUser.username);
    }
  }, [currentUser]);

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

  // Handler: Save general configuration (Branding names, logging, policies)
  const handleSaveGeneral = async (e: React.FormEvent) => {
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
        onSettingsUpdated?.();
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

  // Handler: Update Owner Credentials
  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredentialFeedback(null);

    if (!currentPassword) {
      setCredentialFeedback({
        type: 'error',
        text: t('settings.security.currentPasswordRequired', 'Current password is required to update credentials.'),
      });
      return;
    }

    if (newPassword || confirmPassword) {
      if (newPassword !== confirmPassword) {
        setCredentialFeedback({
          type: 'error',
          text: t('settings.security.passwordMismatch', 'New passwords do not match.'),
        });
        return;
      }
      if (newPassword.length < 6) {
        setCredentialFeedback({
          type: 'error',
          text: t('auth.passwordLengthError', 'New password must be at least 6 characters.'),
        });
        return;
      }
    }

    setIsUpdatingCredentials(true);
    try {
      const res = await fetch('/api/hub/auth/owner-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          current_password: currentPassword,
          new_username: ownerUsername.trim() || undefined,
          new_password: newPassword.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setCredentialFeedback({
          type: 'success',
          text: t('settings.security.credentialsUpdated', 'Owner credentials updated successfully.'),
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        onUserUpdated?.();
        setTimeout(() => setCredentialFeedback(null), 5000);
      } else {
        setCredentialFeedback({
          type: 'error',
          text: data.detail || 'Failed to update credentials.',
        });
      }
    } catch (err: any) {
      setCredentialFeedback({
        type: 'error',
        text: err.message || 'Network error updating credentials.',
      });
    } finally {
      setIsUpdatingCredentials(false);
    }
  };

  // Reusable file uploader for Logo (both Click and Drag & Drop)
  const uploadLogoFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatusMsg({
        type: 'error',
        text: t('settings.branding.logoInvalidType', 'Please drop a valid image file (PNG, SVG, JPG, WebP).'),
      });
      return;
    }
    const formData = new FormData();
    formData.append('file', file);

    setIsUploadingLogo(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/hub/settings/logo', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setSettings((prev) => ({ ...prev, login_logo_url: data.logo_url }));
        onSettingsUpdated?.();
        setStatusMsg({
          type: 'success',
          text: t('settings.branding.logoSuccess', 'Logo uploaded successfully.'),
        });
        setTimeout(() => setStatusMsg(null), 3000);
      } else {
        setStatusMsg({
          type: 'error',
          text: data.detail || t('settings.branding.logoError', 'Failed to upload logo.'),
        });
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || t('settings.branding.logoError', 'Failed to upload logo.'),
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    uploadLogoFile(e.target.files[0]);
    e.target.value = '';
  };

  // Handler: Remove Logo
  const handleRemoveLogo = async () => {
    if (!window.confirm(t('common.confirmDelete', 'Are you sure you want to remove the custom logo?'))) return;
    setStatusMsg(null);
    try {
      const res = await fetch('/api/hub/settings/logo', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, login_logo_url: '' }));
        onSettingsUpdated?.();
        setStatusMsg({
          type: 'success',
          text: t('settings.branding.logoRemoved', 'Custom logo removed.'),
        });
        setTimeout(() => setStatusMsg(null), 3000);
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Failed to remove custom logo.',
      });
    }
  };

  // Handler: Test Log Path Writable Probe
  const handleTestPath = async () => {
    const targetPath = settings.logging_path?.trim() || 'data/logs';
    setPathTestStatus({ state: 'testing' });
    try {
      const res = await fetch('/api/hub/settings/logging/test-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ path: targetPath }),
      });
      const data = await res.json();
      if (res.ok) {
        setPathTestStatus({
          state: 'success',
          message: data.resolved_path || targetPath,
        });
      } else {
        setPathTestStatus({
          state: 'error',
          message: data.detail || 'Permission Denied / Unwritable path',
        });
      }
    } catch (err: any) {
      setPathTestStatus({
        state: 'error',
        message: err.message || 'Error validating path permissions',
      });
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
    <div className="space-y-6">
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

      {/* ── CARD 3: Authentication & Password Management (Parity with ffmpeg-gui) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <h4 className="text-red-400 font-bold text-xs uppercase tracking-wider">
            🔑 {t('settings.security.passwordTitle', 'AUTHENTICATION & PASSWORD MANAGEMENT')}
          </h4>
        </div>

        <form onSubmit={handleUpdateCredentials} className="max-w-2xl space-y-4">
          <p className="text-xs text-[var(--text-secondary)]">
            {t('settings.security.description', 'Manage master platform owner credentials and administrative access.')}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.security.ownerUsername', 'Owner Username')}
              </label>
              <input
                type="text"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-red-500 text-[var(--text-primary)] font-mono transition-all"
                value={ownerUsername}
                onChange={(e) => setOwnerUsername(e.target.value)}
                placeholder={t('settings.security.ownerUsernamePlaceholder', 'Enter owner username')}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.security.currentPassword', 'Current Password')}
              </label>
              <input
                type="password"
                autoComplete="current-password"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-red-500 text-[var(--text-primary)] transition-all"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('settings.security.currentPasswordPlaceholder', 'Enter current password (required)')}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.security.newPassword', 'New Password')}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-red-500 text-[var(--text-primary)] transition-all"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('settings.security.newPasswordPlaceholder', 'Leave empty to keep current password')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.security.confirmPassword', 'Confirm Password')}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-red-500 text-[var(--text-primary)] transition-all"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('settings.security.confirmPasswordPlaceholder', 'Confirm new password')}
              />
            </div>
          </div>

          {credentialFeedback && (
            <div
              className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                credentialFeedback.type === 'success'
                  ? 'bg-brand-lime/10 border-brand-lime/30 text-brand-lime'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              <span>{credentialFeedback.text}</span>
            </div>
          )}

          <div className="pt-1 flex justify-start">
            <button
              type="submit"
              disabled={isUpdatingCredentials}
              className="px-4 py-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 font-bold text-xs tracking-wide transition-all cursor-pointer disabled:opacity-50"
            >
              {isUpdatingCredentials
                ? t('settings.security.updatingCredentials', 'Updating...')
                : t('settings.security.updateCredentialsBtn', 'Update Credentials')}
            </button>
          </div>
        </form>
      </div>

      {/* ── CARD 4: Branding & Platform Identity (Ported 1:1 from ffmpeg-gui) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
            {t('settings.branding.title', 'Branding & Platform Identity')}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.branding.stationName', 'Hub Platform Name')}
              </label>
              <input
                type="text"
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)] rounded-lg p-2.5 text-xs outline-none focus:border-brand-lime transition-all"
                value={settings.hub_name || ''}
                onChange={(e) => setSettings({ ...settings, hub_name: e.target.value })}
                placeholder={t('settings.branding.stationNamePlaceholder', 'e.g. ffmpeg-gui CloudHub')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.branding.logoAbbr', 'Logo Monogram Text')}
              </label>
              <input
                type="text"
                maxLength={4}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-brand-lime transition-all uppercase font-mono font-bold tracking-widest text-brand-lime"
                value={settings.login_logo_text || ''}
                onChange={(e) => setSettings({ ...settings, login_logo_text: e.target.value.toUpperCase() })}
                placeholder={t('settings.branding.logoAbbrPlaceholder', 'e.g. CH')}
              />
            </div>
          </div>

          {/* Interactive Logo Upload Drag & Drop / Click Box */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingLogo(true);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingLogo(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingLogo(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingLogo(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                uploadLogoFile(e.dataTransfer.files[0]);
              }
            }}
            className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-4 transition-all relative group cursor-pointer h-full min-h-[140px] ${
              isDraggingLogo
                ? 'border-brand-lime bg-brand-lime/10 ring-2 ring-brand-lime/40'
                : 'border-[var(--glass-border)] hover:border-brand-lime bg-[var(--input-bg)]'
            }`}
          >
            <label className="absolute inset-0 cursor-pointer flex flex-col items-center justify-center w-full h-full z-10">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={isUploadingLogo}
                onChange={handleLogoUpload}
              />
            </label>

            {settings.login_logo_url && !logoImgError ? (
              <div className="relative flex flex-col items-center gap-2 z-20">
                <div className="relative w-16 h-16 flex items-center justify-center">
                  <img
                    src={settings.login_logo_url}
                    alt="Custom Logo"
                    className="max-w-full max-h-full object-contain"
                    onError={() => setLogoImgError(true)}
                  />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveLogo();
                  }}
                  className="text-[9px] text-red-400 hover:text-red-300 font-bold underline cursor-pointer"
                >
                  {t('settings.branding.logoRemove', '✕ Remove Logo')}
                </button>
              </div>
            ) : (
              <div className="w-12 h-12 bg-brand-lime/10 border border-brand-lime/30 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <span className="text-brand-lime font-black text-lg uppercase tracking-wider">
                  {settings.login_logo_text || 'CH'}
                </span>
              </div>
            )}

            <div className="text-[9px] uppercase font-bold text-[var(--text-secondary)] mt-2 text-center tracking-wider">
              {isUploadingLogo
                ? t('settings.branding.logoUploading', 'Uploading logo...')
                : settings.login_logo_url
                ? t('settings.branding.logoChange', 'Click to change logo')
                : t('settings.branding.logoUpload', 'Upload custom logo')}
            </div>
          </div>
        </div>
      </div>

      {/* ── CARD 5: Logging Configuration (Ported 1:1 with path tester) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-brand-lime" />
          <h4 className="text-brand-lime font-bold text-xs uppercase tracking-wider">
            {t('settings.logging.title', 'LOGGING CONFIGURATION')}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.logging.mode', 'Mode')}
              </label>
              <select
                value={settings.logging_mode || 'both'}
                onChange={(e) => setSettings({ ...settings, logging_mode: e.target.value })}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
              >
                <option value="journalctl" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {t('settings.logging.modeJournalctl', 'journalctl (journald console)')}
                </option>
                <option value="file" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {t('settings.logging.modeFile', 'file (log file only)')}
                </option>
                <option value="both" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {t('settings.logging.modeBoth', 'both (console + log file)')}
                </option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                {t('settings.logging.timestampTz', 'Log Timestamp Format')}
              </label>
              <select
                value={settings.logging_timestamp_tz || 'utc'}
                onChange={(e) => setSettings({ ...settings, logging_timestamp_tz: e.target.value })}
                className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)]"
              >
                <option value="utc" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {t('settings.logging.timestampTzUtc', 'UTC (Universal Coordinated Time - Standard)')}
                </option>
                <option value="local" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {t('settings.logging.timestampTzLocal', 'Local Machine Timezone (Offset)')}
                </option>
              </select>
            </div>

            {(settings.logging_mode === 'file' || settings.logging_mode === 'both') && (
              <div className="space-y-2 pt-1">
                <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                  {t('settings.logging.logPath', 'Log Storage Path')}
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={settings.logging_path || ''}
                    onChange={(e) => {
                      setSettings({ ...settings, logging_path: e.target.value });
                      setPathTestStatus({ state: 'idle' });
                    }}
                    placeholder={t('settings.logging.logPathPlaceholder', 'e.g. data/logs or /var/log/ffmpeg-gui-cloudhub')}
                    className="flex-1 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs font-mono text-[var(--text-primary)] outline-none focus:border-brand-lime transition-all"
                  />
                  <button
                    type="button"
                    onClick={handleTestPath}
                    disabled={pathTestStatus.state === 'testing'}
                    className="px-3.5 py-2.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime text-xs font-bold text-[var(--text-primary)] hover:text-brand-lime transition-all cursor-pointer whitespace-nowrap"
                  >
                    {pathTestStatus.state === 'testing'
                      ? t('settings.logging.testingPath', 'Testing...')
                      : t('settings.logging.testPathBtn', 'Test Path')}
                  </button>
                </div>

                {pathTestStatus.state === 'success' && (
                  <p className="text-[11px] text-brand-lime font-mono flex items-center gap-1.5 mt-1">
                    <span>✅</span>
                    <span>
                      {t('settings.logging.pathValid', 'Writable')}: {pathTestStatus.message}
                    </span>
                  </p>
                )}

                {pathTestStatus.state === 'error' && (
                  <p className="text-[11px] text-red-400 font-mono flex items-center gap-1.5 mt-1">
                    <span>❌</span>
                    <span>
                      {t('settings.logging.pathInvalid', 'Permission Error')}: {pathTestStatus.message}
                    </span>
                  </p>
                )}

                <p className="text-[10px] text-[var(--text-secondary)] leading-tight italic">
                  {t('settings.logging.logPathHelp', 'Filesystem directory or file path for rotated application logs.')}
                </p>
              </div>
            )}
          </div>

          {(settings.logging_mode === 'file' || settings.logging_mode === 'both') && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-[var(--input-bg)] rounded-xl border border-[var(--glass-border)]">
                <div>
                  <h4 className="text-xs font-bold text-[var(--text-primary)]">
                    {t('settings.logging.enableRotation', 'Enable Rotation')}
                  </h4>
                  <p className="text-[10px] text-[var(--text-secondary)] leading-snug">
                    {t('settings.logging.rotationDesc', 'Limit log file size and retain compressed archives')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      logging_rotation_enabled: !settings.logging_rotation_enabled,
                    })
                  }
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                    settings.logging_rotation_enabled ? 'bg-brand-lime' : 'bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-black transition-transform ${
                      settings.logging_rotation_enabled ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {settings.logging_rotation_enabled && (
                <div className="grid grid-cols-2 gap-3 pl-1">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                      {t('settings.logging.maxBytes', 'Max Bytes')}
                    </label>
                    <input
                      type="number"
                      min={102400}
                      step={102400}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                      value={settings.logging_rotation_max_bytes || 10485760}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          logging_rotation_max_bytes: Number(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] tracking-wider block">
                      {t('settings.logging.backupCount', 'Backup Count')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-2.5 text-xs outline-none focus:border-brand-lime transition-all text-[var(--text-primary)] font-mono"
                      value={settings.logging_rotation_backup_count || 5}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          logging_rotation_backup_count: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── CARD 6: Security & Maintenance Policies ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-blue-400" />
          <h4 className="text-blue-400 font-bold text-xs uppercase tracking-wider">
            {t('settings.maintenanceTitle', 'Security & Retention Policies')}
          </h4>
        </div>

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

      {/* Save General Settings Button */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSaveGeneral}
          disabled={isSaving}
          className="px-5 py-2.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer disabled:opacity-50"
        >
          {isSaving ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save Changes')}
        </button>
      </div>
    </div>
  );
};
