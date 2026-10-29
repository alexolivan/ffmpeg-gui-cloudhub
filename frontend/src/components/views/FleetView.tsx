import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, EnrolledNode, Organization, NodeGroup } from '../../types/hub';
import { GroupAccordionSection } from '../cards/GroupAccordionSection';
import { SearchIcon, PlusIcon, RefreshIcon, FleetIcon, LayersIcon } from '../Icons';

interface FleetViewProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const FleetView: React.FC<FleetViewProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<EnrolledNode[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');

  // Token Modal
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [targetOrgId, setTargetOrgId] = useState<number>(selectedOrgId || currentUser.org_id || 1);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [tokenHours, setTokenHours] = useState<number>(24);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  // Edit Node Modal
  const [editingNode, setEditingNode] = useState<EnrolledNode | null>(null);
  const [editName, setEditName] = useState('');
  const [editGroupId, setEditGroupId] = useState<string>('');
  const [editOrgId, setEditOrgId] = useState<number>(1);
  const [editIconData, setEditIconData] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const canManage =
    currentUser.role === 'superadmin' ||
    currentUser.role === 'org_admin' ||
    currentUser.role === 'tenant_admin';

  const fetchData = async () => {
    try {
      const [nodesRes, orgsRes, groupsRes] = await Promise.all([
        fetch('/api/hub/nodes', { credentials: 'include' }),
        fetch('/api/hub/orgs', { credentials: 'include' }),
        fetch('/api/hub/groups', { credentials: 'include' }),
      ]);

      if (nodesRes.ok) {
        setNodes(await nodesRes.json());
      }
      if (orgsRes.ok) {
        const orgsData: Organization[] = await orgsRes.json();
        setOrgs(orgsData);
        if (orgsData.length > 0 && !targetOrgId) {
          setTargetOrgId(orgsData[0].id);
        }
      }
      if (groupsRes.ok) {
        setGroups(await groupsRes.json());
      }
    } catch (err) {
      console.error('Failed to fetch fleet data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedOrgId) {
      setTargetOrgId(selectedOrgId);
    }
  }, [selectedOrgId]);

  // Filtered nodes
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      // Organization / Tenant filter
      if (selectedOrgId !== null && node.org_id !== selectedOrgId) {
        return false;
      }

      // Status filter
      const status = node.vitality?.status || 'offline';
      if (statusFilter === 'online' && status !== 'online') return false;
      if (statusFilter === 'offline' && status !== 'offline') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = node.name.toLowerCase().includes(q);
        const matchesId = node.node_id.toLowerCase().includes(q);
        const matchesVersion = (node.current_version || '').toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesVersion) return false;
      }

      return true;
    });
  }, [nodes, selectedOrgId, statusFilter, searchQuery]);

  // KPI metrics
  const totalAppliances = filteredNodes.length;
  const onlineAppliances = filteredNodes.filter((n) => n.vitality?.status === 'online').length;
  const offlineAppliances = filteredNodes.filter((n) => n.vitality?.status === 'offline').length;
  const degradedAppliances = filteredNodes.filter((n) => n.vitality?.status === 'degraded').length;

  // Relevant groups based on selected tenant
  const visibleGroups = useMemo(() => {
    if (selectedOrgId !== null) {
      return groups.filter((g) => g.org_id === selectedOrgId);
    }
    return groups;
  }, [groups, selectedOrgId]);

  // Handle Enrollment Token Generation
  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setTokenCopied(false);
    try {
      const res = await fetch('/api/hub/enrollment-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          org_id: targetOrgId,
          group_id: targetGroupId ? Number(targetGroupId) : null,
          validity_hours: tokenHours,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedToken(data.token);
      }
    } catch (err) {
      console.error('Failed to create enrollment token:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyToken = () => {
    if (!generatedToken) return;
    navigator.clipboard.writeText(generatedToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 3000);
  };

  // Handle Node Edit Modal
  const openEditModal = (node: EnrolledNode) => {
    setEditingNode(node);
    setEditName(node.name);
    setEditGroupId(node.group_id ? String(node.group_id) : '');
    setEditOrgId(node.org_id);
    setEditIconData(node.icon_data || '');
  };

  const handleSaveEdit = async () => {
    if (!editingNode) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/hub/nodes/${editingNode.node_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editName.trim(),
          group_id: editGroupId ? Number(editGroupId) : -1,
          org_id: currentUser.role === 'superadmin' ? editOrgId : undefined,
          icon_data: editIconData.trim() || null,
        }),
      });
      if (res.ok) {
        setEditingNode(null);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to update node:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!confirm(t('fleet.confirmDeleteNode', 'Are you sure you want to remove this appliance from CloudHub?'))) {
      return;
    }
    try {
      const res = await fetch(`/api/hub/nodes/${nodeId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to delete node:', err);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ── Top Banner Header & Floating Actions (Parity with ffmpeg-gui) ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
            {t('nav.fleet', 'Fleet Directory')}
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t(
              'fleet.manageSubtitle',
              'Monitor and manage connected ffmpeg-gui edge appliances across distributed networks.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {canManage && (
            <button
              onClick={() => {
                setShowTokenModal(true);
                setGeneratedToken(null);
              }}
              className="pill-button bg-brand-lime hover:bg-brand-lime/90 text-black font-bold text-xs py-2 px-4 flex items-center gap-1.5 flex-1 sm:flex-initial justify-center shadow-lg shadow-brand-lime/10 cursor-pointer"
            >
              <PlusIcon size={14} />
              <span>{t('fleet.enrollNewNode', 'Enroll Node')}</span>
            </button>
          )}
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="pill-button bg-white/5 hover:bg-white/10 text-[var(--text-primary)] border border-white/10 text-xs py-2 px-3.5 flex items-center gap-1.5 flex-1 sm:flex-initial justify-center cursor-pointer"
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshIcon size={14} className={isLoading ? 'animate-spin' : ''} />
            <span>{t('common.refresh', 'Refresh')}</span>
          </button>
        </div>
      </div>

      {/* ── Top 4 KPI Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Nodes */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-secondary)] font-mono uppercase tracking-wider">
              {t('fleet.totalAppliances', 'Total Appliances')}
            </span>
            <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-[var(--text-secondary)]">
              <FleetIcon size={16} />
            </div>
          </div>
          <div className="text-3xl font-black text-[var(--text-primary)] font-mono tracking-tight">
            {totalAppliances}
          </div>
          <span className="text-[11px] text-[var(--text-secondary)] mt-1 block">
            {selectedOrgId ? t('fleet.inSelectedTenant', 'In active tenant') : t('fleet.acrossAllTenants', 'Across all tenants')}
          </span>
        </div>

        {/* Online Nodes */}
        <div className="bg-[var(--bg-card)] border border-emerald-500/20 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-emerald-400 font-mono uppercase tracking-wider">
              {t('common.online', 'Online')}
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            </div>
          </div>
          <div className="text-3xl font-black text-emerald-400 font-mono tracking-tight">
            {onlineAppliances}
          </div>
          <span className="text-[11px] text-emerald-500/70 mt-1 block">
            {t('fleet.tunnelConnected', 'Tunnel connection active')}
          </span>
        </div>

        {/* Offline / Degraded */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-secondary)] font-mono uppercase tracking-wider">
              {t('common.offline', 'Offline')}
            </span>
            <div className="w-8 h-8 rounded-xl bg-zinc-500/10 text-zinc-400 flex items-center justify-center font-mono text-xs">
              {degradedAppliances > 0 ? `!${degradedAppliances}` : '—'}
            </div>
          </div>
          <div className="text-3xl font-black text-[var(--text-secondary)] font-mono tracking-tight">
            {offlineAppliances}
          </div>
          <span className="text-[11px] text-[var(--text-secondary)] mt-1 block">
            {degradedAppliances > 0
              ? `${degradedAppliances} ${t('common.degraded', 'degraded')}`
              : t('fleet.allOthersHealthy', 'No degraded appliances')}
          </span>
        </div>

        {/* Groups */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-secondary)] font-mono uppercase tracking-wider">
              {t('fleet.groupsCount', 'Active Groups')}
            </span>
            <div className="w-8 h-8 rounded-xl bg-brand-lime/10 text-brand-lime flex items-center justify-center">
              <LayersIcon size={16} />
            </div>
          </div>
          <div className="text-3xl font-black text-brand-lime font-mono tracking-tight">
            {visibleGroups.length}
          </div>
          <span className="text-[11px] text-[var(--text-secondary)] mt-1 block">
            {t('fleet.clustersConfigured', 'Logical clusters')}
          </span>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[var(--bg-card)] border border-[var(--glass-border)] p-3 rounded-2xl">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <SearchIcon size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('fleet.searchPlaceholder', 'Filter by name, ID or version...')}
              className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] hover:border-brand-lime/40 rounded-xl pl-9 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-1 focus:ring-brand-lime transition-all"
            />
          </div>

          <div className="flex items-center bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl p-0.5 text-xs font-mono">
            {(['all', 'online', 'offline'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setStatusFilter(mode)}
                className={`px-3 py-1 rounded-lg capitalize transition-all cursor-pointer ${
                  statusFilter === mode
                    ? 'bg-brand-lime/20 text-brand-lime font-bold shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t(`common.${mode}`, mode)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchData}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--glass-border)] transition-all cursor-pointer"
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshIcon size={16} />
          </button>

          {canManage && (
            <button
              onClick={() => {
                setGeneratedToken(null);
                setShowTokenModal(true);
              }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer"
            >
              <PlusIcon size={16} />
              <span>{t('fleet.enrollAppliance', 'Enroll Appliance')}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Group Accordions ── */}
      {isLoading ? (
        <div className="py-20 text-center text-xs font-mono text-[var(--text-secondary)]">
          {t('common.loading', 'Loading fleet appliances...')}
        </div>
      ) : filteredNodes.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-12 text-center">
          <FleetIcon size={36} className="mx-auto text-[var(--text-secondary)] mb-3 opacity-40" />
          <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
            {t('fleet.noAppliancesFound', 'No appliances found')}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto mb-4">
            {searchQuery
              ? t('fleet.noMatchingFilter', 'No appliances matched your search or status criteria.')
              : t('fleet.noAppliancesEnrolled', 'No appliances enrolled in this tenant yet. Click "Enroll Appliance" to generate an enrollment token.')}
          </p>
          {canManage && (
            <button
              onClick={() => setShowTokenModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all cursor-pointer"
            >
              <PlusIcon size={16} />
              <span>{t('fleet.enrollAppliance', 'Enroll Appliance')}</span>
            </button>
          )}
        </div>
      ) : (
        <div>
          {/* Render Groups with Accordions */}
          {visibleGroups.map((group) => {
            const groupNodes = filteredNodes.filter((n) => n.group_id === group.id);
            return (
              <GroupAccordionSection
                key={`group-${group.id}`}
                groupId={group.id}
                groupName={group.name}
                groupIcon={group.icon_data}
                nodes={groupNodes}
                onEditNode={openEditModal}
                onDeleteNode={handleDeleteNode}
                canManage={canManage}
              />
            );
          })}

          {/* Render Unassigned Accordion for nodes without group */}
          {(() => {
            const unassignedNodes = filteredNodes.filter((n) => !n.group_id);
            if (unassignedNodes.length === 0 && visibleGroups.length > 0) return null;
            return (
              <GroupAccordionSection
                key="unassigned-group"
                groupId={null}
                groupName={t('fleet.ungroupedGroup', 'Ungrouped Appliances')}
                nodes={unassignedNodes}
                onEditNode={openEditModal}
                onDeleteNode={handleDeleteNode}
                canManage={canManage}
              />
            );
          })()}
        </div>
      )}

      {/* ── Enrollment Token Modal ── */}
      {showTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => setShowTokenModal(false)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
              {t('fleet.enrollmentTokenTitle', 'Generate Appliance Enrollment Token')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              {t('fleet.enrollmentTokenDesc', 'Issue a one-time enrollment token to connect a physical or virtual ffmpeg-gui appliance to this CloudHub.')}
            </p>

            {generatedToken ? (
              <div className="space-y-4">
                <div className="p-3 bg-brand-lime/10 border border-brand-lime/30 rounded-xl">
                  <span className="text-[11px] font-mono text-brand-lime block mb-1 uppercase tracking-wider">
                    {t('fleet.tokenGeneratedSuccess', 'Token generated successfully:')}
                  </span>
                  <div className="font-mono text-xs break-all text-[var(--text-primary)] bg-black/30 p-2.5 rounded-lg select-all border border-brand-lime/20">
                    {generatedToken}
                  </div>
                </div>

                <div className="bg-white/5 p-3 rounded-xl border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] space-y-1">
                  <span className="font-semibold text-[var(--text-primary)] block">
                    {t('fleet.enrollmentCliCommand', 'Run on appliance shell:')}
                  </span>
                  <pre className="font-mono text-[11px] bg-black/40 p-2 rounded text-zinc-300 overflow-x-auto">
                    ./bin/ffmpeg-gui-admin enroll-cloudhub {window.location.origin} {generatedToken}
                  </pre>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={handleCopyToken}
                    className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all cursor-pointer"
                  >
                    {tokenCopied ? t('common.copied', 'Copied!') : t('common.copyToken', 'Copy Token')}
                  </button>
                  <button
                    onClick={() => setShowTokenModal(false)}
                    className="px-4 py-2 rounded-xl bg-white/10 text-[var(--text-primary)] font-medium text-xs hover:bg-white/15 transition-all cursor-pointer"
                  >
                    {t('common.done', 'Done')}
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleGenerateToken} className="space-y-4">
                {currentUser.role === 'superadmin' && (
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      {t('common.tenant', 'Target Tenant')}
                    </label>
                    <select
                      value={targetOrgId}
                      onChange={(e) => setTargetOrgId(Number(e.target.value))}
                      className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer"
                    >
                      {orgs.map((o) => (
                        <option key={o.id} value={o.id} className="bg-[#18181b] text-white">
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('fleet.assignGroup', 'Assign to Group (Optional)')}
                  </label>
                  <select
                    value={targetGroupId}
                    onChange={(e) => setTargetGroupId(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer"
                  >
                    <option value="" className="bg-[#18181b] text-white">
                      -- {t('fleet.noGroupUnassigned', 'None (Unassigned)')} --
                    </option>
                    {groups
                      .filter((g) => g.org_id === targetOrgId)
                      .map((g) => (
                        <option key={g.id} value={g.id} className="bg-[#18181b] text-white">
                          {g.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('fleet.tokenValidityHours', 'Token Validity (Hours)')}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={tokenHours}
                    onChange={(e) => setTokenHours(Number(e.target.value))}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setShowTokenModal(false)}
                    className="px-4 py-2 rounded-xl bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isGenerating ? t('common.generating', 'Generating...') : t('fleet.createTokenBtn', 'Generate Token')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Node Modal ── */}
      {editingNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setEditingNode(null)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
              {t('fleet.editApplianceTitle', 'Edit Appliance Details')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] font-mono mb-4">{editingNode.node_id}</p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('fleet.applianceFriendlyName', 'Appliance Friendly Name')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>

              {currentUser.role === 'superadmin' && orgs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('common.tenant', 'Tenant Organization')}
                  </label>
                  <select
                    value={editOrgId}
                    onChange={(e) => {
                      setEditOrgId(Number(e.target.value));
                      setEditGroupId('');
                    }}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer font-mono"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id} className="bg-[#18181b] text-white">
                        {o.name} ({o.slug})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('fleet.monogramAbbr', 'Monogram / Abbreviation')}
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={editIconData}
                  onChange={(e) => setEditIconData(e.target.value.toUpperCase())}
                  placeholder="e.g. ENC, ST1"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-brand-lime font-mono font-bold uppercase focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('fleet.assignGroup', 'Assigned Group')}
                </label>
                <select
                  value={editGroupId}
                  onChange={(e) => setEditGroupId(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer"
                >
                  <option value="" className="bg-[#18181b] text-white">
                    -- {t('fleet.noGroupUngrouped', 'None (Ungrouped)')} --
                  </option>
                  {groups
                    .filter((g) => g.org_id === (currentUser.role === 'superadmin' ? editOrgId : editingNode.org_id))
                    .map((g) => (
                      <option key={g.id} value={g.id} className="bg-[#18181b] text-white">
                        {g.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingNode(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={handleSaveEdit}
                  className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSavingEdit ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save Changes')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
