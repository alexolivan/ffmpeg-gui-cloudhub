import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../types/hub';

interface LoginViewProps {
  onLoginSuccess: (user: User, token: string) => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  onLoginSuccess,
  currentTheme,
  onThemeChange,
}) => {
  const { t, i18n } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/hub/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || t('auth.locked_account', { seconds: 900 }));
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || t('auth.invalid_credentials'));
      }

      const data = await res.json();
      localStorage.setItem('cloudhub_token', data.token);
      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setErrorMsg(err.message || t('auth.invalid_credentials'));
    } finally {
      setIsLoading(false);
    }
  };

  const languages = [
    { code: 'en', label: 'EN' },
    { code: 'es', label: 'ES' },
    { code: 'ca', label: 'CA' },
  ];

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 relative">
      {/* Top right language and theme bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <select
          value={currentTheme}
          onChange={(e) => onThemeChange(e.target.value)}
          className="text-xs bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded px-2 py-1 focus:outline-none focus:border-brand-lime cursor-pointer"
        >
          <option value="studio-dark" className="bg-zinc-900 text-white">Studio Dark</option>
          <option value="cyberpunk" className="bg-zinc-900 text-white">Cyberpunk</option>
          <option value="nordic-frost" className="bg-zinc-900 text-white">Nordic Frost</option>
          <option value="broadcast-light" className="bg-zinc-900 text-white">Broadcast Light</option>
          <option value="warm-paper" className="bg-zinc-900 text-white">Warm Paper</option>
        </select>

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
      </div>

      <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-8 shadow-[var(--card-shadow)]">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-lime/15 border border-brand-lime/30 text-brand-lime mb-3">
            <svg
              className="w-8 h-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('auth.login_title')}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1.5">
            {t('auth.login_subtitle')}
          </p>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {t('auth.username')}
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {t('auth.password')}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-brand-lime transition-colors"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-sm font-bold transition-all shadow-sm flex items-center justify-center cursor-pointer"
          >
            {isLoading ? t('auth.logging_in') : t('auth.login_button')}
          </button>
        </form>
      </div>
    </div>
  );
};
