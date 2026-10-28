import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization, NodeGroup, UserRole } from '../../../types/hub';
import { PlusIcon, TrashIcon, UsersIcon, ChevronDownIcon } from '../../Icons';

interface UsersTabProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const UsersTab: React.FC<UsersTabProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<number>(
    currentUser.org_id || selectedOrgId || 1
  );
  const [isLoading, setIsLoading] = useState(true);

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('group_operator');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isSuperadmin = currentUser.role === 'superadmin';

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/hub/users', { credentials: 'include' });
      if (res.ok) {
        setUsers(await res.json());
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchOrgsAndGroups = async () => {
    try {
      const [oRes, gRes] = await Promise.all([
        fetch('/api/hub/orgs', { credentials: 'include' }),
        fetch(`/api/hub/orgs/${activeOrgId}/groups`, { credentials: 'include' }),
      ]);
      if (oRes.ok) {
        const orgsData: Organization[] = await oRes.json();
        setOrgs(orgsData);
        if (orgsData.length > 0 && !currentUser.org_id && !selectedOrgId) {
          setActiveOrgId(orgsData[0].id);
        }
      }
      if (gRes.ok) {
        setGroups(await gRes.json());
      }
    } catch (err) {
      console.error('Failed to load orgs/groups for users:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchOrgsAndGroups();
  }, []);

  useEffect(() => {
    if (activeOrgId) {
      fetch(`/api/hub/orgs/${activeOrgId}/groups`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : []))
        .then(setGroups)
        .catch(() => {});
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (selectedOrgId && isSuperadmin) {
      setActiveOrgId(selectedOrgId);
    }
  }, [selectedOrgId]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      setErrorMsg(t('settings.usernameAndPassRequired', 'Username and password are required.'));
      return;
    }

    setIsCreating(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/hub/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
          org_id: activeOrgId,
          group_ids: selectedGroupIds,
        }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setNewUsername('');
        setNewPassword('');
        setSelectedGroupIds([]);
        fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.detail || 'Failed to create user.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating user.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.id === currentUser.id) {
      alert(t('settings.cannotDeleteSelf', 'You cannot delete your own active user account.'));
      return;
    }

    if (
      !confirm(
        t('settings.confirmDeleteUser', {
          defaultValue: 'Are you sure you want to delete user "{{username}}"?',
          username: user.username,
        })
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/hub/users/${user.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        fetchUsers();
      }
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const filteredUsers = users.filter((u) => {
    if (isSuperadmin) {
      if (activeOrgId && u.role !== 'superadmin') {
        return u.org_id === activeOrgId;
      }
      return true;
    }
    return u.org_id === currentUser.org_id;
  });

  const getRoleBadge = (role: string) => {
    if (role === 'superadmin') {
      return (
        <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          OWNER
        </span>
      );
    }
    if (role === 'org_admin' || role === 'tenant_admin') {
      return (
        <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-brand-lime/10 text-brand-lime border border-brand-lime/20">
          TENANT ADMIN
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
        OPERATOR
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {t('settings.usersTitle', 'User Accounts & Access Control')}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t('settings.usersSubtitle', 'Manage system operators, tenant administrators, and group access scopes.')}
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
            <span>{t('settings.createUserBtn', 'Create User')}</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
          {t('common.loading', 'Loading user accounts...')}
        </div>
      ) : (
        <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="border-b border-[var(--glass-border)] bg-white/[0.02] text-[11px] text-[var(--text-secondary)] uppercase">
                <th className="py-3 px-4 font-semibold">{t('settings.username', 'Username')}</th>
                <th className="py-3 px-4 font-semibold">{t('settings.role', 'Role')}</th>
                <th className="py-3 px-4 font-semibold">{t('common.tenant', 'Tenant')}</th>
                <th className="py-3 px-4 font-semibold">{t('settings.assignedGroups', 'Assigned Groups')}</th>
                <th className="py-3 px-4 font-semibold text-right">{t('common.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--glass-border)]">
              {filteredUsers.map((u) => {
                const tenantName = orgs.find((o) => o.id === u.org_id)?.name || (u.org_id ? `#${u.org_id}` : 'Global');
                return (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-[var(--text-primary)] font-bold">{u.username}</td>
                    <td className="py-3 px-4">{getRoleBadge(u.role)}</td>
                    <td className="py-3 px-4 text-[var(--text-secondary)]">{tenantName}</td>
                    <td className="py-3 px-4 text-[var(--text-secondary)]">
                      {u.group_ids && u.group_ids.length > 0
                        ? `${u.group_ids.length} groups`
                        : t('settings.allGroupsOrFull', 'All / Full Access')}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {u.id !== currentUser.id && (
                        <button
                          onClick={() => handleDeleteUser(u)}
                          className="p-1 rounded-lg text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                          title={t('common.delete', 'Delete User')}
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create User Modal ── */}
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
              {t('settings.newUserTitle', 'Create User Account')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              {t('settings.newUserDesc', 'Provision operator or tenant admin credentials.')}
            </p>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.username', 'Username')}
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g. operator_john"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.password', 'Password')}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.role', 'User Role')}
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer"
                >
                  <option value="group_operator" className="bg-[#18181b] text-white">
                    Operator (View & Connect to Appliances)
                  </option>
                  <option value="org_admin" className="bg-[#18181b] text-white">
                    Tenant Admin (Manage Groups & Users in Tenant)
                  </option>
                  {isSuperadmin && (
                    <option value="superadmin" className="bg-[#18181b] text-white">
                      Owner / Superadmin (Full System Access)
                    </option>
                  )}
                </select>
              </div>

              {groups.length > 0 && newRole === 'group_operator' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.restrictGroups', 'Restrict to Specific Groups (Optional)')}
                  </label>
                  <div className="max-h-28 overflow-y-auto space-y-1.5 p-2 bg-black/20 rounded-xl border border-[var(--glass-border)]">
                    {groups.map((grp) => (
                      <label key={grp.id} className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedGroupIds.includes(grp.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedGroupIds([...selectedGroupIds, grp.id]);
                            } else {
                              setSelectedGroupIds(selectedGroupIds.filter((id) => id !== grp.id));
                            }
                          }}
                          className="rounded accent-brand-lime"
                        />
                        <span>{grp.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

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
                  {isCreating ? t('common.creating', 'Creating...') : t('common.create', 'Create User')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
