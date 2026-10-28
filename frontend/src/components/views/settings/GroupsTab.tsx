import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization, NodeGroup } from '../../../types/hub';
import { PlusIcon, TrashIcon, LayersIcon, ChevronDownIcon } from '../../Icons';

interface GroupsTabProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const GroupsTab: React.FC<GroupsTabProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<number>(
    currentUser.org_id || selectedOrgId || 1
  );
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isSuperadmin = currentUser.role === 'superadmin';

  const fetchOrgs = async () => {
    try {
      const res = await fetch('/api/hub/orgs', { credentials: 'include' });
      if (res.ok) {
        const data: Organization[] = await res.json();
        setOrgs(data);
        if (data.length > 0 && !currentUser.org_id && !selectedOrgId) {
          setActiveOrgId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load orgs:', err);
    }
  };

  const fetchGroups = async (orgId: number) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/hub/orgs/${orgId}/groups`, { credentials: 'include' });
      if (res.ok) {
        setGroups(await res.json());
      }
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  useEffect(() => {
    if (activeOrgId) {
      fetchGroups(activeOrgId);
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (selectedOrgId && isSuperadmin) {
      setActiveOrgId(selectedOrgId);
    }
  }, [selectedOrgId]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      setErrorMsg(t('settings.groupNameRequired', 'Group name is required.'));
      return;
    }

    setIsCreating(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/hub/orgs/${activeOrgId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newGroupName }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewGroupName('');
        fetchGroups(activeOrgId);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.detail || 'Failed to create group.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating group.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteGroup = async (group: NodeGroup) => {
    if (
      !confirm(
        t('settings.confirmDeleteGroup', {
          defaultValue: 'Are you sure you want to delete group "{{name}}"? Appliances will be moved to unassigned.',
          name: group.name,
        })
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/hub/orgs/${activeOrgId}/groups/${group.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchGroups(activeOrgId);
      }
    } catch (err) {
      console.error('Failed to delete group:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {t('settings.groupsTitle', 'Appliance Clusters & Groups')}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t('settings.groupsSubtitle', 'Organize edge encoders, ingest nodes, and streamers into logical accordions.')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Tenant Selector for Superadmin */}
          {isSuperadmin && orgs.length > 0 && (
            <div className="relative">
              <select
                value={activeOrgId}
                onChange={(e) => setActiveOrgId(Number(e.target.value))}
                className="appearance-none bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 pr-8 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-medium cursor-pointer"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id} className="bg-[#18181b] text-white">
                    🏢 {o.name}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[var(--text-secondary)]">
                <ChevronDownIcon size={14} />
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setErrorMsg(null);
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer"
          >
            <PlusIcon size={16} />
            <span>{t('settings.createGroupBtn', 'Create Group')}</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
          {t('common.loading', 'Loading groups...')}
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-12 text-center">
          <LayersIcon size={32} className="mx-auto text-[var(--text-secondary)] mb-2 opacity-50" />
          <h4 className="text-sm font-bold text-[var(--text-primary)] mb-1">
            {t('settings.noGroupsFound', 'No groups defined yet')}
          </h4>
          <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto mb-4">
            {t('settings.noGroupsDesc', 'Create groups to categorize appliances by studio, location, or broadcast channel.')}
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all cursor-pointer"
          >
            <PlusIcon size={16} />
            <span>{t('settings.createGroupBtn', 'Create Group')}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((grp) => (
            <div
              key={grp.id}
              className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-3 relative group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime">
                    <LayersIcon size={18} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">{grp.name}</h4>
                    <span className="text-[11px] text-[var(--text-secondary)] font-mono block">
                      ID #{grp.id}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDeleteGroup(grp)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                  title={t('common.delete', 'Delete Group')}
                >
                  <TrashIcon size={16} />
                </button>
              </div>

              <div className="pt-2 border-t border-[var(--glass-border)] flex items-center justify-between text-xs font-mono">
                <span className="text-[var(--text-secondary)]">{t('common.nodes', 'Appliances')}:</span>
                <span className="font-bold text-[var(--text-primary)]">{grp.nodes_count ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Group Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
              {t('settings.newGroupTitle', 'Create Appliance Group')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              {t('settings.newGroupDesc', 'Group appliances together into logical clusters inside this tenant.')}
            </p>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.groupName', 'Group Name')}
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Master Control, OB Van 1, Stage Left"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-medium"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isCreating ? t('common.creating', 'Creating...') : t('common.create', 'Create Group')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
