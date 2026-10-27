import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization, NodeGroup } from '../../types/hub';

interface TenantsAndGroupsViewProps {
  currentUser: User;
}

export const TenantsAndGroupsView: React.FC<TenantsAndGroupsViewProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(currentUser.org_id || null);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // New Org modal
  const [showNewOrgModal, setShowNewOrgModal] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [newOrgAdminPass, setNewOrgAdminPass] = useState('');
  const [orgError, setOrgError] = useState<string | null>(null);

  // New Group modal
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const isSuperadmin = currentUser.role === 'superadmin';

  const fetchOrgs = async () => {
    try {
      const res = await fetch('/api/hub/orgs', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setOrgs(data);
        if (data.length > 0 && !selectedOrgId) {
          setSelectedOrgId(currentUser.org_id || data[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGroups = async (orgId: number) => {
    try {
      const res = await fetch(`/api/hub/orgs/${orgId}/groups`, { credentials: 'include' });
      if (res.ok) {
        setGroups(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  useEffect(() => {
    if (selectedOrgId) {
      fetchGroups(selectedOrgId);
    }
  }, [selectedOrgId]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgError(null);
    try {
      const res = await fetch('/api/hub/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newOrgName,
          slug: newOrgSlug,
          admin_password: newOrgAdminPass,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Failed to create organization');
      }
      setShowNewOrgModal(false);
      setNewOrgName('');
      setNewOrgSlug('');
      setNewOrgAdminPass('');
      fetchOrgs();
    } catch (err: any) {
      setOrgError(err.message);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !newGroupName) return;
    try {
      const res = await fetch(`/api/hub/orgs/${selectedOrgId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newGroupName }),
      });
      if (res.ok) {
        setShowNewGroupModal(false);
        setNewGroupName('');
        fetchGroups(selectedOrgId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (!selectedOrgId) return;
    if (!confirm(t('common.delete') + '?')) return;
    try {
      await fetch(`/api/hub/groups/${groupId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      fetchGroups(selectedOrgId);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('tenants.title')}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t('tenants.subtitle')}
          </p>
        </div>

        {isSuperadmin && (
          <button
            onClick={() => setShowNewOrgModal(true)}
            className="px-4 py-2 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <span>+</span>
            <span>{t('tenants.new_org')}</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Organizations list */}
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-5 shadow-[var(--card-shadow)] space-y-4">
          <h2 className="text-sm font-bold text-[var(--text-primary)] border-b border-[var(--glass-border)] pb-2">
            {t('enroll.org_label')}
          </h2>

          <div className="space-y-2">
            {orgs.map((o) => (
              <div
                key={o.id}
                onClick={() => setSelectedOrgId(o.id)}
                className={`p-3 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                  selectedOrgId === o.id
                    ? 'bg-brand-lime/10 border-brand-lime/40 text-brand-lime'
                    : 'bg-[var(--input-bg)] border-[var(--glass-border)] text-[var(--text-primary)] hover:border-[var(--glass-border-hover)]'
                }`}
              >
                <div>
                  <h3 className="font-semibold text-xs leading-tight">{o.name}</h3>
                  <span className="text-[10px] font-mono text-[var(--text-secondary)] block mt-0.5">
                    {o.slug}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-mono font-bold block">
                    {o.nodes_count || 0} nodes
                  </span>
                  <span className="text-[9px] text-[var(--text-secondary)]">
                    {o.groups_count || 0} groups
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Groups in Organization */}
        <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl p-5 shadow-[var(--card-shadow)] space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--glass-border)] pb-2">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              {t('tenants.groups_title')}
            </h2>
            {selectedOrgId && (
              <button
                onClick={() => setShowNewGroupModal(true)}
                className="px-3 py-1 bg-brand-lime/15 hover:bg-brand-lime/25 text-brand-lime border border-brand-lime/30 rounded text-xs font-bold transition-all cursor-pointer"
              >
                + {t('tenants.new_group')}
              </button>
            )}
          </div>

          {groups.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-secondary)]">
              {t('tenants.no_groups')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-brand-lime/10 border border-brand-lime/30 flex items-center justify-center text-brand-lime text-xs font-bold">
                      #
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">{g.name}</h4>
                      <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                        {g.nodes_count || 0} appliances
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteGroup(g.id)}
                    className="p-1.5 text-[var(--text-secondary)] hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                    title={t('common.delete')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Org Modal */}
      {showNewOrgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-base font-bold text-[var(--text-primary)] mb-4 pb-2 border-b border-[var(--glass-border)]">
              {t('tenants.new_org')}
            </h2>

            {orgError && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded">
                {orgError}
              </div>
            )}

            <form onSubmit={handleCreateOrg} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('tenants.org_name')}
                </label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => {
                    setNewOrgName(e.target.value);
                    if (!newOrgSlug) {
                      setNewOrgSlug(
                        e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
                      );
                    }
                  }}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('tenants.org_slug')}
                </label>
                <input
                  type="text"
                  required
                  value={newOrgSlug}
                  onChange={(e) => setNewOrgSlug(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)] font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('tenants.admin_pass')}
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newOrgAdminPass}
                  onChange={(e) => setNewOrgAdminPass(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)]"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewOrgModal(false)}
                  className="px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-brand-lime/20 text-brand-lime border border-brand-lime/40 rounded text-xs font-bold"
                >
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Group Modal */}
      {showNewGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <h2 className="text-sm font-bold text-[var(--text-primary)] mb-3 pb-2 border-b border-[var(--glass-border)]">
              {t('tenants.new_group')}
            </h2>

            <form onSubmit={handleCreateGroup} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('tenants.group_name')}
                </label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)]"
                  placeholder="Studio 1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewGroupModal(false)}
                  className="px-3 py-1 text-xs text-[var(--text-secondary)]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1 bg-brand-lime/20 text-brand-lime border border-brand-lime/40 rounded text-xs font-bold"
                >
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
