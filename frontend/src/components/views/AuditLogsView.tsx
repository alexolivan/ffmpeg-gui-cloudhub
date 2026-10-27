import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditLogEntry } from '../../types/hub';

export const AuditLogsView: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/hub/audit-logs?limit=150', { credentials: 'include' });
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes('FAILED') || action.includes('DELETE') || action.includes('LOCKOUT')) {
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    }
    if (action.includes('SUCCESS') || action.includes('ENROLL') || action.includes('CREATE')) {
      return 'bg-brand-lime/15 text-brand-lime border-brand-lime/30';
    }
    return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('audit.title')}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t('audit.subtitle')}
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <span>↻</span>
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl overflow-hidden shadow-[var(--card-shadow)]">
        {isLoading ? (
          <div className="text-center py-12 text-xs text-[var(--text-secondary)]">
            {t('common.loading')}
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 text-xs text-[var(--text-secondary)]">
            {t('audit.no_logs')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--input-bg)] text-[var(--text-secondary)] border-b border-[var(--glass-border)] uppercase tracking-wider font-mono text-[10px]">
                <tr>
                  <th className="px-5 py-3">{t('audit.timestamp')}</th>
                  <th className="px-5 py-3">{t('audit.user')}</th>
                  <th className="px-5 py-3">{t('audit.action')}</th>
                  <th className="px-5 py-3">{t('audit.target')}</th>
                  <th className="px-5 py-3">{t('audit.ip')}</th>
                  <th className="px-5 py-3">{t('audit.details')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--glass-border)] text-[var(--text-primary)]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--input-bg)]/40 transition-colors">
                    <td className="px-5 py-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-5 py-3 font-medium whitespace-nowrap">{log.username}</td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${getActionBadgeColor(
                          log.action
                        )}`}
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                      {log.target_type} {log.target_id ? `(${log.target_id})` : ''}
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                      {log.ip_address || '—'}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)] max-w-xs truncate">
                      {log.details || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
