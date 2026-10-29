import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization, NodeGroup } from '../../../types/hub';
import { PlusIcon, TrashIcon, LayersIcon, EditIcon } from '../../Icons';

interface GroupsTabProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const GroupsTab: React.FC<GroupsTabProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createOrgId, setCreateOrgId] = useState<number>(
    selectedOrgId || currentUser.org_id || 1
  );
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMonogram, setNewGroupMonogram] = useState('');
  const [newGroupIconData, setNewGroupIconData] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createErrorMsg, setCreateErrorMsg] = useState<string | null>(null);

  // Edit Modal State
  const [editingGroup, setEditingGroup] = useState<NodeGroup | null>(null);
  const [editName, setEditName] = useState('');
  const [editOrgId, setEditOrgId] = useState<number>(1);
  const [editMonogram, setEditMonogram] = useState('');
  const [editIconData, setEditIconData] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState<string | null>(null);

  const isSuperadmin = currentUser.role === 'superadmin';

  const fetchOrgs = async () => {
    try {
      const res = await fetch('/api/hub/orgs', { credentials: 'include' });
      if (res.ok) {
        const data: Organization[] = await res.json();
        setOrgs(data);
      }
    } catch (err) {
      console.error('Failed to load orgs:', err);
    }
  };

  const fetchGroups = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/hub/groups', { credentials: 'include' });
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
    fetchGroups();
  }, []);

  const filteredGroups = groups.filter((g) => {
    if (!selectedOrgId) return true;
    return g.org_id === selectedOrgId;
  });

  const handleIconFileUpload = (file: File, isEdit: boolean) => {
    if (!file.type.startsWith('image/')) {
      const msg = t('settings.invalidImageType', 'Please choose a valid image file (PNG, SVG, JPG, WebP).');
      if (isEdit) setEditErrorMsg(msg);
      else setCreateErrorMsg(msg);
      return;
    }
    if (file.size > 1024 * 1024) {
      const msg = t('settings.imageTooLarge', 'Image file is too large (maximum 1 MB).');
      if (isEdit) setEditErrorMsg(msg);
      else setCreateErrorMsg(msg);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (isEdit) {
        setEditIconData(result);
        setEditErrorMsg(null);
      } else {
        setNewGroupIconData(result);
        setCreateErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const openCreateModal = () => {
    setCreateOrgId(selectedOrgId || (orgs.length > 0 ? orgs[0].id : (currentUser.org_id || 1)));
    setNewGroupName('');
    setNewGroupMonogram('');
    setNewGroupIconData(null);
    setCreateErrorMsg(null);
    setShowCreateModal(true);
  };

  const openEditModal = (group: NodeGroup) => {
    setEditingGroup(group);
    setEditName(group.name);
    setEditOrgId(group.org_id);
    const isImage = group.icon_data && (group.icon_data.startsWith('data:image') || group.icon_data.startsWith('http') || group.icon_data.startsWith('/'));
    if (isImage) {
      setEditIconData(group.icon_data || null);
      setEditMonogram('');
    } else {
      setEditIconData(null);
      setEditMonogram(group.icon_data || '');
    }
    setEditErrorMsg(null);
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      setCreateErrorMsg(t('settings.groupNameRequired', 'Group name is required.'));
      return;
    }

    setIsCreating(true);
    setCreateErrorMsg(null);
    try {
      const targetOrg = isSuperadmin ? createOrgId : (currentUser.org_id || 1);
      const iconToSave = newGroupIconData || newGroupMonogram.trim().toUpperCase() || undefined;
      const res = await fetch(`/api/hub/orgs/${targetOrg}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newGroupName.trim(),
          icon_data: iconToSave,
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        fetchGroups();
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateErrorMsg(data.detail || t('settings.groupCreateError', 'Failed to create group.'));
      }
    } catch (err: any) {
      setCreateErrorMsg(err.message || 'Error creating group.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup) return;
    if (!editName.trim()) {
      setEditErrorMsg(t('settings.groupNameRequired', 'Group name is required.'));
      return;
    }

    setIsUpdating(true);
    setEditErrorMsg(null);
    try {
      const iconToSave = editIconData || editMonogram.trim().toUpperCase() || null;
      const payload: any = {
        name: editName.trim(),
        icon_data: iconToSave,
      };
      if (isSuperadmin) {
        payload.org_id = editOrgId;
      }

      const res = await fetch(`/api/hub/groups/${editingGroup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setEditingGroup(null);
        fetchGroups();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditErrorMsg(data.detail || t('settings.groupUpdateError', 'Failed to update group.'));
      }
    } catch (err: any) {
      setEditErrorMsg(err.message || 'Error updating group.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteGroup = async (group: NodeGroup) => {
    if (
      !confirm(
        t('settings.confirmDeleteGroup', {
          defaultValue: 'Are you sure you want to delete group "{{name}}"? Appliances will be moved to ungrouped.',
          name: group.name,
        })
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/hub/groups/${group.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchGroups();
      }
    } catch (err) {
      console.error('Failed to delete group:', err);
    }
  };

  const renderGroupIcon = (group: NodeGroup) => {
    const icon = group.icon_data;
    if (icon) {
      const isImage = icon.startsWith('data:image') || icon.startsWith('http') || icon.startsWith('/');
      if (isImage) {
        return (
          <img
            src={icon}
            alt={group.name}
            className="w-10 h-10 rounded-xl object-contain bg-white/5 border border-[var(--glass-border)] p-1 shrink-0"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        );
      }
      return (
        <div className="w-10 h-10 rounded-xl bg-brand-lime/10 border border-brand-lime/30 text-brand-lime font-bold text-xs flex items-center justify-center font-mono shrink-0">
          {icon.slice(0, 4)}
        </div>
      );
    }

    return (
      <div className="w-10 h-10 rounded-xl bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime shrink-0">
        <LayersIcon size={18} />
      </div>
    );
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

        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer self-start sm:self-auto"
        >
          <PlusIcon size={16} />
          <span>{t('settings.createGroupBtn', 'Create Group')}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
          {t('common.loading', 'Loading groups...')}
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-12 text-center">
          <LayersIcon size={32} className="mx-auto text-[var(--text-secondary)] mb-2 opacity-50" />
          <h4 className="text-sm font-bold text-[var(--text-primary)] mb-1">
            {t('settings.noGroupsFound', 'No groups defined yet')}
          </h4>
          <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto mb-4">
            {t('settings.noGroupsDesc', 'Create groups to categorize appliances by studio, location, or broadcast channel.')}
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all cursor-pointer"
          >
            <PlusIcon size={16} />
            <span>{t('settings.createGroupBtn', 'Create Group')}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGroups.map((grp) => (
            <div
              key={grp.id}
              className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-3 relative group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {renderGroupIcon(grp)}
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">{grp.name}</h4>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-[var(--text-secondary)] font-mono">
                        ID #{grp.id}
                      </span>
                      {isSuperadmin && !selectedOrgId && grp.org_name && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-brand-lime/10 border border-brand-lime/20 text-brand-lime">
                          🏢 {grp.org_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditModal(grp)}
                    className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-brand-lime hover:bg-brand-lime/10 transition-all cursor-pointer"
                    title={t('common.edit', 'Edit Group')}
                  >
                    <EditIcon size={15} />
                  </button>
                  <button
                    onClick={() => handleDeleteGroup(grp)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title={t('common.delete', 'Delete Group')}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
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

            {createErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {createErrorMsg}
              </div>
            )}

            <form onSubmit={handleCreateGroup} className="space-y-4">
              {/* Tenant selector if superadmin */}
              {isSuperadmin && orgs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.tenant', 'Tenant / Organization')}
                  </label>
                  <select
                    value={createOrgId}
                    onChange={(e) => setCreateOrgId(Number(e.target.value))}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-medium cursor-pointer"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id} className="bg-[#18181b] text-white">
                        🏢 {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

              {/* Branding: Monogram & Logo Upload */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-[var(--glass-border)]">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {t('settings.monogramAbbr', 'Monogram (2-4 chars)')}
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    value={newGroupMonogram}
                    onChange={(e) => {
                      setNewGroupMonogram(e.target.value.toUpperCase());
                      setNewGroupIconData(null);
                    }}
                    placeholder="e.g. OB1"
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-brand-lime font-mono font-bold uppercase focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {t('settings.customLogo', 'Custom Logo Image')}
                  </label>
                  <div className="flex items-center gap-2">
                    <label
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.dataTransfer.files?.[0]) handleIconFileUpload(e.dataTransfer.files[0], false);
                      }}
                      className="flex-1 cursor-pointer"
                    >
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleIconFileUpload(e.target.files[0], false);
                        }}
                      />
                      {newGroupIconData ? (
                        <div className="flex items-center gap-2 p-1 bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg">
                          <img src={newGroupIconData} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0 bg-black/40" />
                          <span className="text-[10px] text-brand-lime font-mono truncate">{t('common.imageSelected', '✓ Logo image')}</span>
                        </div>
                      ) : (
                        <div className="bg-[var(--input-bg)] border border-dashed border-[var(--glass-border)] hover:border-brand-lime rounded-lg px-2 py-2 text-center text-[11px] text-[var(--text-secondary)] truncate">
                          {t('common.uploadOrDrop', 'Choose or drop...')}
                        </div>
                      )}
                    </label>
                    {newGroupIconData && (
                      <button
                        type="button"
                        onClick={() => setNewGroupIconData(null)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                        title={t('common.clear', 'Remove Image')}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
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

      {/* ── Edit Group Modal ── */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setEditingGroup(null)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
              {t('settings.editGroupTitle', 'Edit Appliance Group')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              {t('settings.editGroupDesc', 'Update cluster identifier, assigned tenant, or visual badge.')}
            </p>

            {editErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {editErrorMsg}
              </div>
            )}

            <form onSubmit={handleUpdateGroup} className="space-y-4">
              {/* Tenant selector if superadmin */}
              {isSuperadmin && orgs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.tenant', 'Tenant / Organization')}
                  </label>
                  <select
                    value={editOrgId}
                    onChange={(e) => setEditOrgId(Number(e.target.value))}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-medium cursor-pointer"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id} className="bg-[#18181b] text-white">
                        🏢 {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.groupName', 'Group Name')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-medium"
                />
              </div>

              {/* Branding: Monogram & Logo Upload */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-[var(--glass-border)]">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {t('settings.monogramAbbr', 'Monogram (2-4 chars)')}
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    value={editMonogram}
                    onChange={(e) => {
                      setEditMonogram(e.target.value.toUpperCase());
                      setEditIconData(null);
                    }}
                    placeholder="e.g. OB1"
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-brand-lime font-mono font-bold uppercase focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {t('settings.customLogo', 'Custom Logo Image')}
                  </label>
                  <div className="flex items-center gap-2">
                    <label
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.dataTransfer.files?.[0]) handleIconFileUpload(e.dataTransfer.files[0], true);
                      }}
                      className="flex-1 cursor-pointer"
                    >
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleIconFileUpload(e.target.files[0], true);
                        }}
                      />
                      {editIconData ? (
                        <div className="flex items-center gap-2 p-1 bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg">
                          <img src={editIconData} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0 bg-black/40" />
                          <span className="text-[10px] text-brand-lime font-mono truncate">{t('common.imageSelected', '✓ Logo image')}</span>
                        </div>
                      ) : (
                        <div className="bg-[var(--input-bg)] border border-dashed border-[var(--glass-border)] hover:border-brand-lime rounded-lg px-2 py-2 text-center text-[11px] text-[var(--text-secondary)] truncate">
                          {t('common.uploadOrDrop', 'Choose or drop...')}
                        </div>
                      )}
                    </label>
                    {editIconData && (
                      <button
                        type="button"
                        onClick={() => setEditIconData(null)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                        title={t('common.clear', 'Remove Image')}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingGroup(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isUpdating ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
