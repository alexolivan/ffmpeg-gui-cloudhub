import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditLogEntry, EnrolledNode } from '../../types/hub';

export const AuditLogsView: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nodes, setNodes] = useState<EnrolledNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchNodes = async () => {
    try {
      const res = await fetch('/api/hub/nodes', { credentials: 'include' });
      if (res.ok) {
        setNodes(await res.json());
      }
    } catch (err) {
      console.error('Failed to load nodes for audit filter:', err);
    }
  };

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      let url = '/api/hub/audit-logs?limit=150';
      if (selectedNode !== 'all') {
        url += `&node_id=${encodeURIComponent(selectedNode)}`;
      }
      const res = await fetch(url, { credentials: 'include' });
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
    fetchNodes();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [selectedNode]);

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes('FAILED') || action.includes('DELETE') || action.includes('LOCKOUT') || action.includes('STOP')) {
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    }
    if (action.includes('SUCCESS') || action.includes('ENROLL') || action.includes('CREATE') || action.includes('START')) {
      return 'bg-brand-lime/15 text-brand-lime border-brand-lime/30';
    }
    if (action.includes('RESTART') || action.includes('UPDATE')) {
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    }
    return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  };

  const getChannelBadge = (channel?: string | null) => {
    const ch = (channel || 'cloudhub').toLowerCase();
    if (ch === 'cloudhub') {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 inline-flex items-center gap-1">
          ☁️ CloudHub
        </span>
      );
    }
    if (ch === 'local_gui') {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/30 inline-flex items-center gap-1">
          🖥️ Local GUI
        </span>
      );
    }
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/30 inline-flex items-center gap-1">
        ⌨️ {ch.toUpperCase()}
      </span>
    );
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

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* Node Filter Selector */}
          <select
            value={selectedNode}
            onChange={(e) => setSelectedNode(e.target.value)}
            className="px-3 py-1.5 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-medium focus:outline-none focus:border-brand-lime"
          >
            <option value="all">{t('audit.all_nodes')}</option>
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                🖥️ {n.name} ({n.node_id})
              </option>
            ))}
          </select>

          <button
            onClick={fetchLogs}
            className="px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--glass-border)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span>↻</span>
            <span>{t('common.refresh')}</span>
          </button>
        </div>
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
                  <th className="px-5 py-3">{t('audit.node')}</th>
                  <th className="px-5 py-3">{t('audit.channel')}</th>
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
                    <td className="px-5 py-3 whitespace-nowrap">
                      {log.node_id ? (
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-brand-lime/10 text-brand-lime border border-brand-lime/30">
                          🖥️ {log.node_id}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                          ☁️ {t('audit.hub_central')}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {getChannelBadge(log.channel)}
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
                      {log.target_type} {log.target_id ? `(#${log.target_id})` : ''}
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                      {log.ip_address || '—'}
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)] max-w-md truncate" title={log.details || ''}>
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
