import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Organization } from '../../../types/hub';
import { PlusIcon, TrashIcon, LayersIcon, UsersIcon, FleetIcon } from '../../Icons';

export const TenantsTab: React.FC = () => {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim() || !newOrgSlug.trim() || !newAdminPass.trim()) {
      setErrorMsg(t('settings.allFieldsRequired', 'All fields are required.'));
      return;
    }

    setIsCreating(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/hub/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newOrgName,
          slug: newOrgSlug,
          admin_password: newAdminPass,
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewOrgName('');
        setNewOrgSlug('');
        setNewAdminPass('');
        fetchOrgs();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.detail || 'Failed to create tenant.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating tenant.');
    } finally {
      setIsCreating(false);
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
            setErrorMsg(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer"
        >
          <PlusIcon size={16} />
          <span>{t('settings.createTenantBtn', 'Create Tenant')}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {orgs.map((org) => (
          <div
            key={org.id}
            className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-3 relative group"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-[var(--glass-border)] flex items-center justify-center text-brand-lime text-base font-bold">
                  🏢
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">{org.name}</h4>
                  <span className="text-[11px] text-[var(--text-secondary)] font-mono block">
                    slug: {org.slug} • ID #{org.id}
                  </span>
                </div>
              </div>

              <button
                onClick={() => handleDeleteTenant(org)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                title={t('common.delete', 'Delete Tenant')}
              >
                <TrashIcon size={16} />
              </button>
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
        ))}
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

            {errorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateTenant} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.tenantName', 'Tenant Organization Name')}
                </label>
                <input
                  type="text"
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
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Initial Tenant Admin Password
                </label>
                <input
                  type="password"
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
    </div>
  );
};
