import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Organization } from '../../../types/hub';
import { PlusIcon, TrashIcon, EditIcon, LayersIcon, UsersIcon, FleetIcon } from '../../Icons';

export const TenantsTab: React.FC = () => {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [newOrgMonogram, setNewOrgMonogram] = useState('');
  const [newOrgIconData, setNewOrgIconData] = useState<string | null>(null);
  const [newAdminPass, setNewAdminPass] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createErrorMsg, setCreateErrorMsg] = useState<string | null>(null);

  // Edit Modal State
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [editName, setEditName] = useState('');
  const [editMonogram, setEditMonogram] = useState('');
  const [editIconData, setEditIconData] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState<string | null>(null);

  const fetchOrgs = async () => {
    try {
      const res = await fetch('/api/hub/orgs', { credentials: 'include' });
      if (res.ok) {
        setOrgs(await res.json());
      }
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  const handleNameChange = (val: string) => {
    setNewOrgName(val);
    const slug = val
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setNewOrgSlug(slug);
    if (!newOrgMonogram || newOrgMonogram.length <= 2) {
      const initials = val
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 3)
        .toUpperCase();
      if (initials) setNewOrgMonogram(initials);
    }
  };

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
        setNewOrgIconData(result);
        setCreateErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) {
      setCreateErrorMsg(t('settings.tenantNameRequired', 'Tenant name is required.'));
      return;
    }
    if (!newOrgSlug.trim()) {
      setCreateErrorMsg(t('settings.tenantSlugRequired', 'Tenant slug / identifier is required.'));
      return;
    }
    if (!newAdminPass.trim()) {
      setCreateErrorMsg(t('settings.adminPasswordRequired', 'Admin password is required.'));
      return;
    }
    if (newAdminPass.trim().length < 6) {
      setCreateErrorMsg(t('auth.passwordLengthError', 'Password must be at least 6 characters.'));
      return;
    }

    setIsCreating(true);
    setCreateErrorMsg(null);
    try {
      const iconToSave = newOrgIconData || newOrgMonogram.trim().toUpperCase() || undefined;
      const res = await fetch('/api/hub/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newOrgName.trim(),
          slug: newOrgSlug.trim().toLowerCase(),
          icon_data: iconToSave,
          admin_password: newAdminPass.trim(),
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewOrgName('');
        setNewOrgSlug('');
        setNewOrgMonogram('');
        setNewOrgIconData(null);
        setNewAdminPass('');
        fetchOrgs();
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateErrorMsg(data.detail || 'Failed to create tenant.');
      }
    } catch (err: any) {
      setCreateErrorMsg(err.message || 'Error creating tenant.');
    } finally {
      setIsCreating(false);
    }
  };

  const openEditModal = (org: Organization) => {
    setEditingOrg(org);
    setEditName(org.name);
    if (org.icon_data && (org.icon_data.startsWith('data:image') || org.icon_data.startsWith('http') || org.icon_data.startsWith('/uploads'))) {
      setEditIconData(org.icon_data);
      setEditMonogram('');
    } else {
      setEditIconData(null);
      setEditMonogram(org.icon_data || org.name.slice(0, 3).toUpperCase());
    }
    setEditErrorMsg(null);
  };

  const handleUpdateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrg) return;
    if (!editName.trim()) {
      setEditErrorMsg(t('settings.tenantNameRequired', 'Tenant name is required.'));
      return;
    }

    setIsUpdating(true);
    setEditErrorMsg(null);
    try {
      const iconToSave = editIconData || editMonogram.trim().toUpperCase() || null;
      const res = await fetch(`/api/hub/orgs/${editingOrg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editName.trim(),
          icon_data: iconToSave,
        }),
      });
      if (res.ok) {
        setEditingOrg(null);
        fetchOrgs();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditErrorMsg(data.detail || 'Failed to update tenant.');
      }
    } catch (err: any) {
      setEditErrorMsg(err.message || 'Error updating tenant.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteTenant = async (org: Organization) => {
    if (
      !confirm(
        t('settings.confirmDeleteTenant', {
          defaultValue: 'Are you sure you want to delete tenant "{{name}}"? All associated groups and nodes will be unlinked.',
          name: org.name,
        })
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/hub/orgs/${org.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchOrgs();
      }
    } catch (err) {
      console.error('Failed to delete tenant:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
        {t('common.loading', 'Loading tenants...')}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {t('settings.tenantsTitle', 'Tenants & Organizations')}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t('settings.tenantsSubtitle', 'Isolate appliances, operators, and audit logs into independent logical tenants.')}
          </p>
        </div>

        <button
          onClick={() => {
            setCreateErrorMsg(null);
            setNewOrgName('');
            setNewOrgSlug('');
            setNewOrgMonogram('');
            setNewOrgIconData(null);
            setNewAdminPass('');
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer"
        >
          <PlusIcon size={16} />
          <span>{t('settings.createTenantBtn', 'Create Tenant')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(() => {
          const realOrgs = orgs.filter((o) => o.slug !== 'default' && o.id !== 1);
          if (realOrgs.length === 0) {
            return (
              <div className="col-span-full py-12 px-6 text-center border border-dashed border-[var(--glass-border)] rounded-2xl bg-[var(--bg-card)]/50 space-y-3">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-white/5 border border-[var(--glass-border)] flex items-center justify-center text-[var(--text-secondary)]">
                  <LayersIcon size={24} />
                </div>
                <h4 className="text-sm font-bold text-[var(--text-primary)]">
                  {t('settings.noTenantsFound', 'No Tenants Defined')}
                </h4>
                <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
                  {t('settings.noTenantsFoundDesc', 'No tenant organizations have been created yet. Click "Create Tenant" to establish isolated client environments.')}
                </p>
              </div>
            );
          }

          return realOrgs.map((org) => {
            const isImg =
              org.icon_data &&
              (org.icon_data.startsWith('data:image') ||
                org.icon_data.startsWith('http') ||
                org.icon_data.startsWith('/'));

            const fallbackMonogram = org.name.slice(0, 2).toUpperCase();

            return (
              <div
                key={org.id}
                className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-3 relative group"
              >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/5 border border-[var(--glass-border)] flex items-center justify-center overflow-hidden">
                    {isImg ? (
                      <img
                        src={org.icon_data!}
                        alt={org.name}
                        className="w-full h-full object-contain p-1"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span className="text-brand-lime font-black text-sm uppercase tracking-wider">
                        {org.icon_data || fallbackMonogram}
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--text-primary)]">{org.name}</h4>
                    <span className="text-[11px] text-[var(--text-secondary)] font-mono block">
                      slug: {org.slug}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEditModal(org)}
                    className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-brand-lime hover:bg-white/5 transition-all cursor-pointer"
                    title={t('common.edit', 'Edit Tenant')}
                  >
                    <EditIcon size={15} />
                  </button>
                  <button
                    onClick={() => handleDeleteTenant(org)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                    title={t('common.delete', 'Delete Tenant')}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--glass-border)] text-xs font-mono">
                <div className="bg-white/5 p-2 rounded-xl text-center">
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Groups</span>
                  <span className="font-bold text-[var(--text-primary)] text-sm">{org.groups_count ?? 0}</span>
                </div>
                <div className="bg-white/5 p-2 rounded-xl text-center">
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Appliances</span>
                  <span className="font-bold text-[var(--text-primary)] text-sm">{org.nodes_count ?? 0}</span>
                </div>
                <div className="bg-white/5 p-2 rounded-xl text-center">
                  <span className="text-[10px] text-[var(--text-secondary)] block uppercase">Users</span>
                  <span className="font-bold text-[var(--text-primary)] text-sm">{org.users_count ?? 0}</span>
                </div>
              </div>
            </div>
          );
        });
      })()}
      </div>

      {/* ── Create Tenant Modal ── */}
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
              {t('settings.newTenantTitle', 'Create New Tenant')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              {t('settings.newTenantDesc', 'A tenant admin user will automatically be provisioned with the initial password.')}
            </p>

            {createErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {createErrorMsg}
              </div>
            )}

            <form onSubmit={handleCreateTenant} autoComplete="off" className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.tenantName', 'Tenant Organization Name')}
                </label>
                <input
                  type="text"
                  name="org_name_new"
                  autoComplete="off"
                  value={newOrgName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Acme Broadcast Corp"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5 font-mono">
                  Slug / Identifier
                </label>
                <input
                  type="text"
                  name="org_slug_new"
                  autoComplete="off"
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value.toLowerCase())}
                  placeholder="e.g. acme-broadcast"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                />
              </div>

              {/* Branding: Monogram & Logo Upload with Drag & Drop and Preview */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-[var(--glass-border)]">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {t('settings.monogramAbbr', 'Monogram (2-4 chars)')}
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    name="org_monogram_new"
                    autoComplete="off"
                    value={newOrgMonogram}
                    onChange={(e) => {
                      setNewOrgMonogram(e.target.value.toUpperCase());
                      setNewOrgIconData(null);
                    }}
                    placeholder="e.g. ABC"
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
                      {newOrgIconData ? (
                        <div className="flex items-center gap-2 p-1 bg-[var(--input-bg)] border border-brand-lime/40 rounded-lg">
                          <img src={newOrgIconData} alt="Logo" className="w-6 h-6 rounded object-contain shrink-0 bg-black/40" />
                          <span className="text-[10px] text-brand-lime font-mono truncate">{t('common.imageSelected', '✓ Logo image')}</span>
                        </div>
                      ) : (
                        <div className="bg-[var(--input-bg)] border border-dashed border-[var(--glass-border)] hover:border-brand-lime rounded-lg px-2 py-2 text-center text-[11px] text-[var(--text-secondary)] truncate">
                          {t('common.uploadOrDrop', 'Choose or drop...')}
                        </div>
                      )}
                    </label>
                    {newOrgIconData && (
                      <button
                        type="button"
                        onClick={() => setNewOrgIconData(null)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                        title={t('common.clear', 'Remove Image')}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Initial Tenant Admin Password
                </label>
                <input
                  type="password"
                  name="org_admin_pwd_new"
                  autoComplete="new-password"
                  value={newAdminPass}
                  onChange={(e) => setNewAdminPass(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                />
                <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">
                  Admin username will be: <code className="text-brand-lime font-mono">admin_{newOrgSlug || 'slug'}</code>
                </span>
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
                  {isCreating ? t('common.creating', 'Creating...') : t('common.create', 'Create Tenant')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Tenant Modal ── */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setEditingOrg(null)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
              {t('settings.editTenantTitle', 'Edit Tenant')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              slug: <span className="text-brand-lime font-mono">{editingOrg.slug}</span>
            </p>

            {editErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {editErrorMsg}
              </div>
            )}

            <form onSubmit={handleUpdateTenant} autoComplete="off" className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.tenantName', 'Tenant Organization Name')}
                </label>
                <input
                  type="text"
                  name="edit_tenant_name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                />
              </div>

              {/* Branding: Monogram & Logo Upload with Drag & Drop and Preview */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-[var(--glass-border)]">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--text-secondary)] mb-1">
                    {t('settings.monogramAbbr', 'Monogram (2-4 chars)')}
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    name="edit_tenant_monogram"
                    value={editMonogram}
                    onChange={(e) => {
                      setEditMonogram(e.target.value.toUpperCase());
                      setEditIconData(null);
                    }}
                    placeholder="e.g. ABC"
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
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isUpdating}
                  className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isUpdating ? t('common.saving', 'Saving...') : t('common.save', 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
