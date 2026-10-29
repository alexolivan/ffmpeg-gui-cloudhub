import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, AuditLogEntry, EnrolledNode } from '../../types/hub';
import { SearchIcon, RefreshIcon, AuditIcon, ChevronDownIcon, ExportIcon } from '../Icons';

interface AuditLogsViewProps {
  currentUser?: User;
  selectedOrgId?: number | null;
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nodes, setNodes] = useState<EnrolledNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<string>('all');
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [selectedTargetType, setSelectedTargetType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState<number>(200);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDetailLog, setSelectedDetailLog] = useState<AuditLogEntry | null>(null);

  // Date Range Filtering
  const [datePreset, setDatePreset] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportingSingleId, setExportingSingleId] = useState<number | null>(null);

  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleDatePresetChange = (preset: string) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'today') {
      const todayStr = formatLocalDate(now);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === '24h') {
      const d24 = new Date(now.getTime() - 24 * 3600 * 1000);
      setStartDate(d24.toISOString());
      setEndDate(now.toISOString());
    } else if (preset === '7d') {
      const d7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      setStartDate(formatLocalDate(d7));
      setEndDate(formatLocalDate(now));
    } else if (preset === '30d') {
      const d30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      setStartDate(formatLocalDate(d30));
      setEndDate(formatLocalDate(now));
    } else if (preset === 'custom') {
      if (startDate.length > 10) setStartDate(startDate.slice(0, 10));
      if (endDate.length > 10) setEndDate(endDate.slice(0, 10));
    }
  };

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
      let url = `/api/hub/audit-logs?limit=${limit}`;
      if (selectedNode !== 'all') {
        url += `&node_id=${encodeURIComponent(selectedNode)}`;
      }
      if (selectedOrgId !== null && selectedOrgId !== undefined) {
        url += `&org_id=${selectedOrgId}`;
      }
      if (selectedChannel !== 'all') {
        url += `&channel=${encodeURIComponent(selectedChannel)}`;
      }
      if (startDate) {
        url += `&start_date=${encodeURIComponent(startDate)}`;
      }
      if (endDate) {
        url += `&end_date=${encodeURIComponent(endDate)}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      let url = `/api/hub/audit-logs/export-pdf?limit=1500`;
      if (selectedNode !== 'all') {
        url += `&node_id=${encodeURIComponent(selectedNode)}`;
      }
      if (selectedOrgId !== null && selectedOrgId !== undefined) {
        url += `&org_id=${selectedOrgId}`;
      }
      if (selectedChannel !== 'all') {
        url += `&channel=${encodeURIComponent(selectedChannel)}`;
      }
      if (startDate) {
        url += `&start_date=${encodeURIComponent(startDate)}`;
      }
      if (endDate) {
        url += `&end_date=${encodeURIComponent(endDate)}`;
      }
      if (searchQuery.trim()) {
        url += `&search=${encodeURIComponent(searchQuery.trim())}`;
      }

      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to generate audit report PDF');
      }

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = `cloudhub_audit_report_${ts}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(err.message || 'Error exporting PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportSinglePdf = async (entry: AuditLogEntry) => {
    setExportingSingleId(entry.id);
    try {
      const res = await fetch(`/api/hub/audit-logs/${entry.id}/export-pdf`, { credentials: 'include' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to generate single-event audit PDF');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      let filename = `audit_event_${entry.id}.pdf`;
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert(err.message || 'Error exporting event PDF');
    } finally {
      setExportingSingleId(null);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [selectedNode, selectedOrgId, selectedChannel, limit, startDate, endDate]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Channel / Origin filter
      if (selectedChannel !== 'all') {
        const ch = (log.channel || 'cloudhub').toLowerCase();
        if (ch !== selectedChannel) return false;
      }

      // Target Type filter
      if (selectedTargetType !== 'all') {
        if ((log.target_type || '').toLowerCase() !== selectedTargetType) return false;
      }

      // Search Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesUser = log.username.toLowerCase().includes(q);
        const matchesAction = log.action.toLowerCase().includes(q);
        const matchesDetails = (log.details || '').toLowerCase().includes(q);
        const matchesIp = (log.ip_address || '').toLowerCase().includes(q);
        const matchesNode = (log.node_id || '').toLowerCase().includes(q);
        if (!matchesUser && !matchesAction && !matchesDetails && !matchesIp && !matchesNode) {
          return false;
        }
      }

      return true;
    });
  }, [logs, selectedChannel, selectedTargetType, searchQuery]);

  const formatTimestamp = (iso: string) => {
    try {
      if (!iso) return '—';
      const normalized = !iso.endsWith('Z') && !iso.includes('+') ? `${iso}Z` : iso;
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? iso : d.toLocaleString();
    } catch {
      return iso;
    }
  };

  const getActionBadgeColor = (action: string) => {
    if (
      action.includes('FAIL') ||
      action.includes('DELETE') ||
      action.includes('LOCKOUT') ||
      action.includes('STOP') ||
      action.includes('REVOKE')
    ) {
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    }
    if (
      action.includes('SUCCESS') ||
      action.includes('ENROLL') ||
      action.includes('CREATE') ||
      action.includes('START') ||
      action.includes('ISSUE')
    ) {
      return 'bg-brand-lime/15 text-brand-lime border-brand-lime/30';
    }
    if (action.includes('RESTART') || action.includes('UPDATE') || action.includes('RENEW')) {
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    }
    return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  };

  const getChannelBadge = (channel?: string | null) => {
    const ch = (channel || 'cloudhub').toLowerCase();
    if (ch === 'cloudhub') {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 inline-flex items-center gap-1 font-medium">
          ☁️ CloudHub
        </span>
      );
    }
    if (ch === 'local_gui') {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 inline-flex items-center gap-1 font-medium">
          🖥️ Local GUI
        </span>
      );
    }
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 inline-flex items-center gap-1 font-medium">
        ⌨️ {ch.toUpperCase()}
      </span>
    );
  };

  const getNodeFriendlyName = (nodeId?: string | null) => {
    if (!nodeId) return '—';
    const found = nodes.find((n) => n.node_id === nodeId);
    return found ? found.name : nodeId.substring(0, 14);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Top Banner Header & Floating Actions (Parity with ffmpeg-gui) ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
            {t('nav.audit', 'Audit Logs')}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t(
              'audit.manageSubtitle',
              'Centralized operational event logs, security actions, and edge appliance relays.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            onClick={fetchLogs}
            disabled={isLoading}
            className="pill-button bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 text-xs py-2 px-3.5 flex items-center gap-1.5 flex-1 sm:flex-initial justify-center cursor-pointer transition-all"
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshIcon size={14} className={isLoading ? 'animate-spin' : ''} />
            <span>{t('common.refresh', 'Refresh')}</span>
          </button>

          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf || logs.length === 0}
            className="pill-button bg-brand-lime text-black font-bold text-xs py-2 px-3.5 flex items-center gap-1.5 cursor-pointer hover:bg-brand-lime/90 disabled:opacity-50 transition-all shadow-md shadow-brand-lime/10"
            title={t('audit.exportPdf', 'Export Corporate PDF Report')}
          >
            <ExportIcon size={14} className={isExportingPdf ? 'animate-bounce' : ''} />
            <span>
              {isExportingPdf
                ? t('audit.exportingPdf', 'GENERATING PDF...')
                : t('audit.exportPdfBtn', 'EXPORT PDF REPORT')}
            </span>
          </button>
        </div>
      </div>

      {/* ── Business Filter Bar ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('audit.searchPlaceholder', 'Filter by actor, action, IP, or details...')}
            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime/40 rounded-xl pl-9 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-brand-lime transition-all"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Node Filter */}
          <div className="relative">
            <select
              value={selectedNode}
              onChange={(e) => setSelectedNode(e.target.value)}
              className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 pr-8 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer font-medium"
            >
              <option value="all" className="bg-[#18181b] text-white">
                🖥️ {t('audit.allNodes', 'All Appliances')}
              </option>
              {nodes.map((n) => (
                <option key={n.node_id} value={n.node_id} className="bg-[#18181b] text-white">
                  {n.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <ChevronDownIcon size={14} />
            </div>
          </div>

          {/* Origin / Channel Filter */}
          <div className="relative">
            <select
              value={selectedChannel}
              onChange={(e) => setSelectedChannel(e.target.value)}
              className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 pr-8 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer font-medium"
            >
              <option value="all" className="bg-[#18181b] text-white">
                🌐 {t('audit.allOrigins', 'All Origins')}
              </option>
              <option value="cloudhub" className="bg-[#18181b] text-white">
                ☁️ CloudHub
              </option>
              <option value="local_gui" className="bg-[#18181b] text-white">
                🖥️ Local GUI
              </option>
              <option value="cli" className="bg-[#18181b] text-white">
                ⌨️ CLI
              </option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <ChevronDownIcon size={14} />
            </div>
          </div>

          {/* Category / Target Filter */}
          <div className="relative">
            <select
              value={selectedTargetType}
              onChange={(e) => setSelectedTargetType(e.target.value)}
              className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 pr-8 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer font-medium"
            >
              <option value="all" className="bg-[#18181b] text-white">
                🎯 {t('audit.allCategories', 'All Categories')}
              </option>
              <option value="auth" className="bg-[#18181b] text-white">
                Auth / SSO
              </option>
              <option value="services" className="bg-[#18181b] text-white">
                Services
              </option>
              <option value="node" className="bg-[#18181b] text-white">
                Nodes / Appliances
              </option>
              <option value="settings" className="bg-[#18181b] text-white">
                Settings
              </option>
              <option value="ssl" className="bg-[#18181b] text-white">
                SSL / Certificates
              </option>
              <option value="group" className="bg-[#18181b] text-white">
                Groups
              </option>
              <option value="user" className="bg-[#18181b] text-white">
                Users
              </option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <ChevronDownIcon size={14} />
            </div>
          </div>

          {/* Date Range Filter */}
          <div className="relative">
            <select
              value={datePreset}
              onChange={(e) => handleDatePresetChange(e.target.value)}
              className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 pr-8 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer font-medium"
              title={t('audit.dateRange', 'Date Range')}
            >
              <option value="all" className="bg-[#18181b] text-white">
                📅 {t('audit.dateAll', 'All Time')}
              </option>
              <option value="today" className="bg-[#18181b] text-white">
                📅 {t('audit.dateToday', 'Today')}
              </option>
              <option value="24h" className="bg-[#18181b] text-white">
                📅 {t('audit.date24h', 'Last 24 Hours')}
              </option>
              <option value="7d" className="bg-[#18181b] text-white">
                📅 {t('audit.date7d', 'Last 7 Days')}
              </option>
              <option value="30d" className="bg-[#18181b] text-white">
                📅 {t('audit.date30d', 'Last 30 Days')}
              </option>
              <option value="custom" className="bg-[#18181b] text-white">
                📅 {t('audit.dateCustom', 'Custom Range...')}
              </option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
              <ChevronDownIcon size={14} />
            </div>
          </div>

          {/* Custom Date Pickers */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
              <input
                type="date"
                value={startDate.length > 10 ? startDate.slice(0, 10) : startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                title={t('audit.startDate', 'Start Date')}
              />
              <span className="text-xs text-[var(--text-secondary)]">→</span>
              <input
                type="date"
                value={endDate.length > 10 ? endDate.slice(0, 10) : endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-2.5 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                title={t('audit.endDate', 'End Date')}
              />
            </div>
          )}

          {/* Limit */}
          <div className="relative">
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-2.5 py-1.5 pr-7 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer font-mono"
            >
              <option value={50} className="bg-[#18181b] text-white">50</option>
              <option value={100} className="bg-[#18181b] text-white">100</option>
              <option value={200} className="bg-[#18181b] text-white">200</option>
              <option value={500} className="bg-[#18181b] text-white">500</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-[var(--text-secondary)]">
              <ChevronDownIcon size={12} />
            </div>
          </div>

          {/* Refresh button */}
          <button
            onClick={fetchLogs}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] transition-all cursor-pointer"
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshIcon size={16} />
          </button>
        </div>
      </div>

      {/* ── Audit Logs Grid (Sticky Header) ── */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl overflow-hidden shadow-sm">
        <div className="max-h-[680px] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--glass-border)] z-10 backdrop-blur-md">
              <tr className="text-[11px] font-mono uppercase text-[var(--text-secondary)] tracking-wider">
                <th className="py-3 px-4 font-semibold">{t('audit.timestamp', 'Timestamp')}</th>
                <th className="py-3 px-4 font-semibold">{t('audit.origin', 'Origin')}</th>
                <th className="py-3 px-4 font-semibold">{t('audit.node', 'Appliance')}</th>
                <th className="py-3 px-4 font-semibold">{t('audit.actor', 'Actor / User')}</th>
                <th className="py-3 px-4 font-semibold">{t('audit.action', 'Action')}</th>
                <th className="py-3 px-4 font-semibold">{t('audit.target', 'Target')}</th>
                <th className="py-3 px-4 font-semibold">{t('audit.ip', 'Client IP')}</th>
                <th className="py-3 px-4 font-semibold text-right">{t('audit.details', 'Details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)] font-mono">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-[var(--text-secondary)] font-mono">
                    {t('common.loading', 'Loading audit entries...')}
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-[var(--text-secondary)] font-mono">
                    {t('audit.noLogsFound', 'No audit logs found matching selected criteria.')}
                  </td>
                </tr>
              ) : (
                filteredLogs.map((entry) => (
                  <tr
                    key={entry.id}
                    className="hover:bg-white/[0.03] transition-colors group cursor-pointer"
                    onClick={() => setSelectedDetailLog(entry)}
                  >
                    <td className="py-3 px-4 text-[var(--text-secondary)] whitespace-nowrap text-[11px]">
                      {formatTimestamp(entry.timestamp)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getChannelBadge(entry.channel)}
                    </td>
                    <td className="py-3 px-4 text-[var(--text-primary)] font-semibold whitespace-nowrap truncate max-w-[140px]">
                      {getNodeFriendlyName(entry.node_id)}
                    </td>
                    <td className="py-3 px-4 text-[var(--text-primary)] whitespace-nowrap">
                      <span className="font-medium">{entry.username}</span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-lg text-[10px] border font-bold ${getActionBadgeColor(
                          entry.action
                        )}`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[var(--text-secondary)] whitespace-nowrap">
                      <span className="text-[11px]">
                        {entry.target_type}
                        {entry.target_id ? ` #${entry.target_id}` : ''}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[var(--text-secondary)] whitespace-nowrap text-[11px]">
                      {entry.ip_address || '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDetailLog(entry);
                          }}
                          className="text-[11px] text-brand-lime hover:underline cursor-pointer"
                        >
                          {t('audit.viewJson', 'View')}
                        </button>
                        <span className="text-[var(--glass-border)]">•</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportSinglePdf(entry);
                          }}
                          disabled={exportingSingleId === entry.id}
                          title={t('audit.exportEventPdf', 'Export Event PDF')}
                          className="text-[11px] text-[var(--text-secondary)] hover:text-brand-lime transition-colors cursor-pointer flex items-center gap-0.5 disabled:opacity-50"
                        >
                          {exportingSingleId === entry.id ? (
                            <span className="animate-spin text-[10px]">↻</span>
                          ) : (
                            <span className="font-mono text-[10px] font-bold">PDF</span>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {selectedDetailLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-xl p-6 shadow-2xl relative">
            <button
              onClick={() => setSelectedDetailLog(null)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <div className="flex items-center gap-2 mb-2">
              <AuditIcon size={18} className="text-brand-lime" />
              <h3 className="text-base font-bold text-[var(--text-primary)]">
                {t('audit.entryDetails', 'Audit Log Details')}
              </h3>
            </div>
            <p className="text-xs text-[var(--text-secondary)] font-mono mb-4">
              ID #{selectedDetailLog.id} • {formatTimestamp(selectedDetailLog.timestamp)}
            </p>

            <div className="space-y-3 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3 bg-white/5 p-3 rounded-xl border border-[var(--glass-border)]">
                <div>
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Actor:</span>
                  <span className="text-[var(--text-primary)] font-bold">{selectedDetailLog.username}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Origin:</span>
                  <span>{getChannelBadge(selectedDetailLog.channel)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Action:</span>
                  <span className="text-[var(--text-primary)] font-bold">{selectedDetailLog.action}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Target:</span>
                  <span className="text-[var(--text-primary)]">
                    {selectedDetailLog.target_type} ({selectedDetailLog.target_id || 'global'})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Appliance Node:</span>
                  <span className="text-[var(--text-primary)]">{selectedDetailLog.node_id || 'N/A (CloudHub)'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Client IP:</span>
                  <span className="text-[var(--text-primary)]">{selectedDetailLog.ip_address || '—'}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-[var(--text-secondary)] block uppercase mb-1">Payload / Details:</span>
                <pre className="p-3 bg-black/50 border border-[var(--glass-border)] rounded-xl text-[11px] text-zinc-300 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                  {selectedDetailLog.details || '(No details payload)'}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[var(--glass-border)]">
              <button
                onClick={() => handleExportSinglePdf(selectedDetailLog)}
                disabled={exportingSingleId === selectedDetailLog.id}
                className="px-3.5 py-1.5 rounded-xl bg-brand-lime/10 border border-brand-lime/30 text-brand-lime hover:bg-brand-lime/20 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <ExportIcon size={13} />
                <span>
                  {exportingSingleId === selectedDetailLog.id
                    ? t('common.exporting', 'Exporting...')
                    : t('audit.exportEventPdf', 'Export Event PDF')}
                </span>
              </button>
              <button
                onClick={() => setSelectedDetailLog(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-[var(--text-primary)] text-xs font-medium transition-all cursor-pointer"
              >
                {t('common.close', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
