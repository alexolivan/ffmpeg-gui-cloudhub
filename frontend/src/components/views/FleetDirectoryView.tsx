import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, EnrolledNode, Organization, NodeGroup, VitalityStatus } from '../../types/hub';
import { NodeAccessCard } from '../cards/NodeAccessCard';

interface FleetDirectoryViewProps {
  currentUser: User;
}

export const FleetDirectoryView: React.FC<FleetDirectoryViewProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<EnrolledNode[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Enrollment modal state
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollOrgId, setEnrollOrgId] = useState<number>(currentUser.org_id || 1);
  const [enrollGroupId, setEnrollGroupId] = useState<string>('');
  const [enrollHours, setEnrollHours] = useState<number>(24);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const fetchData = async () => {
    try {
      const [nodesRes, orgsRes] = await Promise.all([
        fetch('/api/hub/nodes', { credentials: 'include' }),
        fetch('/api/hub/orgs', { credentials: 'include' }),
      ]);

      if (nodesRes.ok) {
        const nodesData = await nodesRes.json();
        setNodes(nodesData);
      }

      if (orgsRes.ok) {
        const orgsData = await orgsRes.json();
        setOrgs(orgsData);
        if (orgsData.length > 0 && !currentUser.org_id) {
          setEnrollOrgId(orgsData[0].id);
        }

        // Fetch groups for the current or first org
        const targetOrgId = currentUser.org_id || orgsData[0]?.id;
        if (targetOrgId) {
          const groupsRes = await fetch(`/api/hub/orgs/${targetOrgId}/groups`, {
            credentials: 'include',
          });
          if (groupsRes.ok) {
            setGroups(await groupsRes.json());
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch fleet directory data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // 5-second telemetry heartbeat poll
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setCopySuccess(false);
    try {
      const res = await fetch('/api/hub/enrollment-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          org_id: enrollOrgId,
          group_id: enrollGroupId ? Number(enrollGroupId) : null,
          validity_hours: enrollHours,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedToken(data.token);
      }
    } catch (err) {
      console.error('Failed to create token:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyToken = () => {
    if (!generatedToken) return;
    navigator.clipboard.writeText(generatedToken);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // KPIs
  const totalCount = nodes.length;
  const onlineCount = nodes.filter((n) => n.vitality?.status === 'online').length;
  const degradedCount = nodes.filter((n) => n.vitality?.status === 'degraded').length;
  const offlineCount = nodes.filter((n) => n.vitality?.status === 'offline').length;

  // Filtered nodes
  const filteredNodes = nodes.filter((node) => {
    const matchesSearch =
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.node_id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || node.vitality?.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const canEnroll = currentUser.role === 'superadmin' || currentUser.role === 'org_admin';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Title & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('directory.title')}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t('directory.subtitle')}
          </p>
        </div>

        {canEnroll && (
          <button
            onClick={() => {
              setGeneratedToken(null);
              setShowEnrollModal(true);
            }}
            className="px-4 py-2 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer self-start sm:self-auto"
          >
            <span className="text-base leading-none">+</span>
            <span>{t('directory.generate_token')}</span>
          </button>
        )}
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-[var(--card-shadow)]">
          <span className="text-[11px] font-medium text-[var(--text-secondary)] uppercase tracking-wider block">
            {t('directory.total_nodes')}
          </span>
          <span className="text-2xl font-bold font-mono text-[var(--text-primary)] mt-1 block">
            {totalCount}
          </span>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-[var(--card-shadow)]">
          <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider block">
            {t('directory.online_nodes')}
          </span>
          <span className="text-2xl font-bold font-mono text-emerald-400 mt-1 block">
            {onlineCount}
          </span>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-[var(--card-shadow)]">
          <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider block">
            {t('directory.degraded_nodes')}
          </span>
          <span className="text-2xl font-bold font-mono text-amber-400 mt-1 block">
            {degradedCount}
          </span>
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-4 shadow-[var(--card-shadow)]">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">
            {t('directory.offline_nodes')}
          </span>
          <span className="text-2xl font-bold font-mono text-zinc-400 mt-1 block">
            {offlineCount}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[var(--bg-card)] border border-[var(--glass-border)] p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('directory.search_placeholder')}
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)] focus:outline-none focus:border-brand-lime"
          />
          <svg
            className="w-4 h-4 text-[var(--text-secondary)] absolute left-3 top-2.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {[
            { id: 'all', label: t('common.all') },
            { id: 'online', label: t('common.online') },
            { id: 'degraded', label: t('common.degraded') },
            { id: 'offline', label: t('common.offline') },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setStatusFilter(st.id)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                statusFilter === st.id
                  ? 'bg-brand-lime/20 text-brand-lime border border-brand-lime/30'
                  : 'bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Nodes Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-xs text-[var(--text-secondary)]">
          {t('common.loading')}
        </div>
      ) : filteredNodes.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl">
          <svg
            className="w-12 h-12 text-[var(--text-secondary)] mx-auto mb-3 opacity-40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
            <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
            <line x1="6" x2="6.01" y1="6" y2="6" />
            <line x1="6" x2="6.01" y1="18" y2="18" />
          </svg>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {t('directory.no_nodes')}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm mx-auto">
            {t('directory.no_nodes_desc')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredNodes.map((node) => (
            <NodeAccessCard key={node.node_id} node={node} canManage={canEnroll} />
          ))}
        </div>
      )}

      {/* Modal: Enroll Appliance Token */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--glass-border)] mb-4">
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                {t('enroll.title')}
              </h2>
              <button
                onClick={() => setShowEnrollModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded"
              >
                ✕
              </button>
            </div>

            {generatedToken ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-brand-lime/10 border border-brand-lime/30 text-center">
                  <span className="text-xs font-semibold text-brand-lime block mb-2">
                    {t('enroll.token_ready')}
                  </span>
                  <div className="bg-[var(--input-bg)] p-3 rounded-lg font-mono text-sm text-[var(--text-primary)] break-all select-all border border-[var(--glass-border)]">
                    {generatedToken}
                  </div>
                </div>

                <p className="text-xs text-[var(--text-secondary)]">
                  {t('enroll.instructions')}
                </p>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={handleCopyToken}
                    className="px-4 py-2 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-xs font-bold transition-all"
                  >
                    {copySuccess ? t('common.copied') : t('common.copy')}
                  </button>
                  <button
                    onClick={() => setShowEnrollModal(false)}
                    className="px-4 py-2 bg-[var(--input-bg)] text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-semibold"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleGenerateToken} className="space-y-4">
                {currentUser.role === 'superadmin' && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                      {t('enroll.org_label')}
                    </label>
                    <select
                      value={enrollOrgId}
                      onChange={(e) => setEnrollOrgId(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)]"
                    >
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id} className="bg-zinc-900 text-white">
                          {o.name} ({o.slug})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    {t('enroll.group_label')}
                  </label>
                  <select
                    value={enrollGroupId}
                    onChange={(e) => setEnrollGroupId(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)]"
                  >
                    <option value="" className="bg-zinc-900 text-white">
                      {t('enroll.group_none')}
                    </option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id} className="bg-zinc-900 text-white">
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    {t('enroll.validity_hours')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={enrollHours}
                    onChange={(e) => setEnrollHours(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)]"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowEnrollModal(false)}
                    className="px-4 py-2 bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] rounded-lg text-xs font-semibold"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="px-4 py-2 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-xs font-bold transition-all"
                  >
                    {isGenerating ? t('common.loading') : t('enroll.generate')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
