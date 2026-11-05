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
  const [imgError, setImgError] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isImageLogo =
    Boolean(node.icon_data) &&
    !imgError &&
    (node.icon_data!.startsWith('data:image') ||
      node.icon_data!.startsWith('http://') ||
      node.icon_data!.startsWith('https://') ||
      node.icon_data!.startsWith('/'));

  const monogramText =
    node.icon_data && !isImageLogo
      ? node.icon_data.slice(0, 4).toUpperCase()
      : (node.name
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 3)
          .toUpperCase() || 'AP');

  const vitality = node.vitality || {
    status: 'offline',
    system: {},
    workload: {},
  };

  const status = vitality.status;
  const isOnline = status === 'online';
  const isDegraded = status === 'degraded';
  const isOffline = status === 'offline';
  const isUnlinked = status === 'unlinked';

  const statusBadge = {
    online: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    degraded: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    offline: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
    unlinked: 'bg-orange-500/10 text-orange-400 border-orange-500/40',
  }[status] || 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30';

  const statusPulse = {
    online: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
    degraded: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
    offline: 'bg-zinc-500',
    unlinked: 'bg-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.8)]',
  }[status] || 'bg-zinc-500';

  const statusLabel = {
    online: t('common.online'),
    degraded: t('common.degraded'),
    offline: t('common.offline'),
    unlinked: t('common.unlinked', 'Unlinked'),
  }[status] || status;

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

  const containerStatusStyle = isOnline
    ? 'bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07] border-[var(--glass-border)] hover:border-emerald-500/30 border-l-4 border-l-emerald-400'
    : isDegraded
    ? 'bg-amber-500/[0.04] hover:bg-amber-500/[0.08] border-[var(--glass-border)] hover:border-amber-500/30 border-l-4 border-l-amber-400'
    : isUnlinked
    ? 'bg-orange-500/[0.04] hover:bg-orange-500/[0.08] border-[var(--glass-border)] hover:border-orange-500/30 border-l-4 border-l-orange-400'
    : 'bg-white/[0.01] hover:bg-white/[0.03] border-[var(--glass-border)] border-l-4 border-l-zinc-600 opacity-80 hover:opacity-100';

  return (
    <div className={`rounded-lg px-3 py-1.5 transition-all shadow-xs relative group ${containerStatusStyle}`}>
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-x-4 gap-y-2">
        {/* Left Column: Identity & Metadata */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {/* Status LED */}
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusPulse}`} />

          {/* Icon / Monogram */}
          {isImageLogo ? (
            <div className="w-7 h-7 rounded-lg border border-[var(--glass-border)] bg-[var(--input-bg)] flex items-center justify-center overflow-hidden shrink-0">
              <img
                src={node.icon_data!}
                alt={node.name}
                className="w-full h-full object-contain p-0.5"
                onError={() => setImgError(true)}
              />
            </div>
          ) : (
            <div className="w-7 h-7 rounded-lg border border-brand-lime/30 bg-brand-lime/10 flex items-center justify-center text-brand-lime font-mono font-black text-[10px] uppercase tracking-wider shadow-xs shrink-0">
              {monogramText}
            </div>
          )}

          {/* Node Friendly Name */}
          <span className="font-bold text-xs sm:text-sm text-[var(--text-primary)] truncate" title={node.name}>
            {node.name}
          </span>

          {/* Node ID */}
          <span
            className="text-[11px] font-mono text-[var(--text-secondary)] bg-[var(--input-bg)]/60 px-1.5 py-0.5 rounded border border-[var(--glass-border)] shrink-0"
            title={node.node_id}
          >
            {node.node_id}
          </span>

          {/* Version */}
          <span className="text-[11px] font-mono text-[var(--text-secondary)] shrink-0">
            v{currentVersion}
          </span>

          {/* Upstream Update Available */}
          {updateAvailable && (
            <span
              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-brand-lime/15 text-brand-lime border border-brand-lime/30 flex items-center gap-0.5 shrink-0"
              title={t('node_card.latest_version', { version: latestVersion })}
            >
              <span>↑</span> {t('node_card.update_available')}
            </span>
          )}

          {/* Unlinked Alert */}
          {isUnlinked && (
            <span className="text-[11px] text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded flex items-center gap-1 shrink-0 font-medium truncate">
              <span>⚠️</span> {t('node_card.unlinkedWarning', 'Appliance unlinked by hardware owner')}
            </span>
          )}

          {/* Error Message */}
          {errorMsg && (
            <span className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded shrink-0">
              {errorMsg}
            </span>
          )}
        </div>

        {/* Middle Column: Telemetry Matrix Inline */}
        <div className="flex items-center gap-2.5 px-3 py-1 rounded-lg bg-[var(--input-bg)]/40 border border-[var(--glass-border)] font-mono text-xs tabular-nums text-[var(--text-secondary)] shrink-0">
          <span>
            {t('node_card.cpu')}:{' '}
            <strong
              className={
                isOffline || isUnlinked
                  ? 'text-zinc-500 font-normal'
                  : cpuPercent > 85
                  ? 'text-red-400 font-bold'
                  : 'text-[var(--text-primary)] font-bold'
              }
            >
              {isOffline || isUnlinked ? '--' : `${Math.round(cpuPercent)}%`}
            </strong>
          </span>
          <span className="opacity-20">|</span>
          <span>
            {t('node_card.ram')}:{' '}
            <strong
              className={
                isOffline || isUnlinked
                  ? 'text-zinc-500 font-normal'
                  : ramPercent > 85
                  ? 'text-amber-400 font-bold'
                  : 'text-[var(--text-primary)] font-bold'
              }
            >
              {isOffline || isUnlinked ? '--' : `${Math.round(ramPercent)}%`}
            </strong>
          </span>
          <span className="opacity-20">|</span>
          <span>
            {t('node_card.uptime')}:{' '}
            <strong className={isOffline || isUnlinked ? 'text-zinc-500 font-normal' : 'text-[var(--text-primary)] font-bold'}>
              {isOffline || isUnlinked ? '--' : uptimeStr}
            </strong>
          </span>
          <span className="opacity-20">|</span>
          <span>
            {t('node_card.services')}:{' '}
            <strong className={isOffline || isUnlinked ? 'text-zinc-500 font-normal' : 'text-[var(--text-primary)] font-bold'}>
              {isOffline || isUnlinked ? '--' : `${runningServices}/${totalServices}`}
            </strong>
            {!isOffline && !isUnlinked && errorServices > 0 && (
              <span className="text-red-400 font-bold ml-1">({errorServices} err)</span>
            )}
          </span>
        </div>

        {/* Right Column: Status Badge, Launch Button and Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Status Badge */}
          <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadge}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusPulse}`} />
            {statusLabel}
          </span>

          {/* Open Web GUI */}
          <button
            onClick={handleOpenGui}
            disabled={isOffline || isUnlinked || isOpening}
            className={`py-1 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
              isOffline || isUnlinked
                ? 'bg-zinc-800/40 text-zinc-500 border border-zinc-700/30 cursor-not-allowed'
                : 'bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 hover:border-brand-lime/50 shadow-xs cursor-pointer'
            }`}
            title={
              isUnlinked
                ? t('node_card.unlinkedWarning', 'Appliance unlinked by hardware owner')
                : isOffline
                ? t('node_card.offline_notice')
                : ''
            }
          >
            {isOpening ? (
              <span>{t('common.loading')}</span>
            ) : isUnlinked ? (
              <span>{t('common.unlinked', 'Unlinked')}</span>
            ) : (
              <>
                <span>{t('node_card.open_gui')}</span>
                <span className="text-xs">↗</span>
              </>
            )}
          </button>

          {/* Node Edit / Delete Actions */}
          {canManage && (
            <div className="flex items-center gap-0.5">
              {onEdit && (
                <button
                  onClick={() => onEdit(node)}
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--glass-border)] transition-colors cursor-pointer"
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                >
                  <svg
                    className="w-3.5 h-3.5"
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
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                >
                  <svg
                    className="w-3.5 h-3.5"
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
    </div>
  );
};
