import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrolledNode } from '../../types/hub';

interface NodeAccessCardProps {
  node: EnrolledNode;
  onEdit?: (node: EnrolledNode) => void;
  onDelete?: (nodeId: string) => void;
  canManage?: boolean;
}

export const NodeAccessCard: React.FC<NodeAccessCardProps> = ({
  node,
  onEdit,
  onDelete,
  canManage = false,
}) => {
  const { t } = useTranslation();
  const [isOpening, setIsOpening] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const vitality = node.vitality || {
    status: 'offline',
    system: {},
    workload: {},
  };

  const status = vitality.status;
  const isOnline = status === 'online';
  const isDegraded = status === 'degraded';
  const isOffline = status === 'offline';

  const statusBadge = {
    online: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    degraded: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    offline: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
  }[status];

  const statusPulse = {
    online: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
    degraded: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    offline: 'bg-zinc-500',
  }[status];

  const statusLabel = {
    online: t('common.online'),
    degraded: t('common.degraded'),
    offline: t('common.offline'),
  }[status];

  const formatUptime = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return '0m';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const handleOpenGui = async () => {
    if (isOffline) return;
    setIsOpening(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/hub/nodes/${node.node_id}/sso-url`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to generate SSO launch URL');
      }
      const data = await res.json();
      window.open(data.sso_path, '_blank');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error opening node');
    } finally {
      setIsOpening(false);
    }
  };

  const cpuPercent = vitality.system?.cpu_percent ?? 0;
  const ramPercent = vitality.system?.memory_percent ?? 0;
  const diskPercent = vitality.system?.disk_percent ?? 0;
  const uptimeStr = formatUptime(vitality.system?.uptime_seconds);

  const runningServices = vitality.workload?.services_running ?? 0;
  const totalServices = vitality.workload?.total_services ?? 0;
  const errorServices = vitality.workload?.services_error ?? 0;

  const updateAvailable = vitality.version?.update_available;
  const latestVersion = vitality.version?.latest_upstream;
  const currentVersion = node.current_version || vitality.version?.current || '2.50.0';

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] hover:border-[var(--glass-border-hover)] rounded-xl p-5 shadow-[var(--card-shadow)] hover:shadow-[var(--card-shadow-hover)] transition-all flex flex-col justify-between relative group">
      <div>
        {/* Header: Node Icon, Name, and Status Badge */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            {node.icon_data ? (
              <img
                src={node.icon_data}
                alt={node.name}
                className="w-10 h-10 rounded-lg object-cover border border-[var(--glass-border)] bg-[var(--input-bg)]"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg border border-[var(--glass-border)] bg-brand-lime/10 flex items-center justify-center text-brand-lime">
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
                  <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
                  <line x1="6" x2="6.01" y1="6" y2="6" />
                  <line x1="6" x2="6.01" y1="18" y2="18" />
                </svg>
              </div>
            )}
            <div>
              <h3 className="font-bold text-sm text-[var(--text-primary)] leading-tight">
                {node.name}
              </h3>
              <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-0.5">
                {node.node_id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${statusBadge}`}
            >
              <span className={`w-2 h-2 rounded-full ${statusPulse}`} />
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Vitality Metrics Strip */}
        <div className="grid grid-cols-4 gap-2 py-3 border-y border-[var(--glass-border)] text-center my-3 bg-[var(--input-bg)]/30 rounded-lg">
          <div>
            <span className="block text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
              {t('node_card.cpu')}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                cpuPercent > 85 ? 'text-red-400' : 'text-[var(--text-primary)]'
              }`}
            >
              {isOffline ? '--' : `${Math.round(cpuPercent)}%`}
            </span>
          </div>

          <div>
            <span className="block text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
              {t('node_card.ram')}
            </span>
            <span
              className={`text-xs font-mono font-bold ${
                ramPercent > 85 ? 'text-amber-400' : 'text-[var(--text-primary)]'
              }`}
            >
              {isOffline ? '--' : `${Math.round(ramPercent)}%`}
            </span>
          </div>

          <div>
            <span className="block text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
              {t('node_card.uptime')}
            </span>
            <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
              {isOffline ? '--' : uptimeStr}
            </span>
          </div>

          <div>
            <span className="block text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
              {t('node_card.services')}
            </span>
            <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
              {isOffline ? (
                '--'
              ) : (
                <>
                  {runningServices}/{totalServices}
                  {errorServices > 0 && (
                    <span className="text-red-400 ml-1">({errorServices} err)</span>
                  )}
                </>
              )}
            </span>
          </div>
        </div>

        {/* Version & Update radar */}
        <div className="flex items-center justify-between text-xs my-2">
          <span className="text-[11px] font-mono text-[var(--text-secondary)]">
            v{currentVersion}
          </span>
          {updateAvailable && (
            <span
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-brand-lime/15 text-brand-lime border border-brand-lime/30 flex items-center gap-1"
              title={t('node_card.latest_version', { version: latestVersion })}
            >
              <span>↑</span> {t('node_card.update_available')}
            </span>
          )}
        </div>

        {errorMsg && (
          <div className="p-2 mb-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Footer: Open GUI Button and Management actions */}
      <div className="pt-3 flex items-center justify-between gap-2 mt-2">
        <button
          onClick={handleOpenGui}
          disabled={isOffline || isOpening}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            isOffline
              ? 'bg-zinc-800/40 text-zinc-500 border border-zinc-700/30 cursor-not-allowed'
              : 'bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 hover:border-brand-lime/50 shadow-sm cursor-pointer'
          }`}
          title={isOffline ? t('node_card.offline_notice') : ''}
        >
          {isOpening ? (
            <span>{t('common.loading')}</span>
          ) : (
            <>
              <span>{t('node_card.open_gui')}</span>
              <span className="text-sm">↗</span>
            </>
          )}
        </button>

        {canManage && (
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                onClick={() => onEdit(node)}
                className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-colors"
                title={t('common.edit')}
                aria-label={t('common.edit')}
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(node.node_id)}
                className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title={t('common.delete')}
                aria-label={t('common.delete')}
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
