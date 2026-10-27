import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, NodeGroup, Organization } from '../../types/hub';

interface UsersAndAccessViewProps {
  currentUser: User;
}

export const UsersAndAccessView: React.FC<UsersAndAccessViewProps> = ({ currentUser }) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<NodeGroup[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<number>(currentUser.org_id || 1);
  const [isLoading, setIsLoading] = useState(true);

  // New User Modal
  const [showModal, setShowModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'org_admin' | 'group_operator'>('group_operator');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isSuperadmin = currentUser.role === 'superadmin';

  const fetchData = async () => {
    try {
      if (isSuperadmin) {
        const orgsRes = await fetch('/api/hub/orgs', { credentials: 'include' });
        if (orgsRes.ok) {
          const orgsData = await orgsRes.json();
          setOrgs(orgsData);
        }
      }

      const [usersRes, groupsRes] = await Promise.all([
        fetch(`/api/hub/orgs/${selectedOrgId}/users`, { credentials: 'include' }),
        fetch(`/api/hub/orgs/${selectedOrgId}/groups`, { credentials: 'include' }),
      ]);

      if (usersRes.ok) {
        setUsers(await usersRes.json());
      }
      if (groupsRes.ok) {
        setGroups(await groupsRes.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedOrgId]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/hub/orgs/${selectedOrgId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
          group_ids: newRole === 'group_operator' ? selectedGroupIds : [],
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Failed to create user');
      }

      setShowModal(false);
      setNewUsername('');
      setNewPassword('');
      setSelectedGroupIds([]);
      fetchData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (userId === currentUser.id) return;
    if (!confirm(t('common.delete') + '?')) return;
    try {
      await fetch(`/api/hub/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleGroup = (groupId: number) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('users.title')}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            {t('users.subtitle')}
          </p>
        </div>

        <button
          onClick={() => {
            setErrorMsg(null);
            setShowModal(true);
          }}
          className="px-4 py-2 bg-brand-lime/20 hover:bg-brand-lime/30 text-brand-lime border border-brand-lime/40 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <span>+</span>
          <span>{t('users.new_user')}</span>
        </button>
      </div>

      {isSuperadmin && orgs.length > 0 && (
        <div className="flex items-center gap-3 bg-[var(--bg-card)] border border-[var(--glass-border)] p-3 rounded-xl">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            {t('enroll.org_label')}:
          </label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(Number(e.target.value))}
            className="px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-lg text-xs text-[var(--text-primary)]"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id} className="bg-zinc-900 text-white">
                {o.name} ({o.slug})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl overflow-hidden shadow-[var(--card-shadow)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--input-bg)] text-[var(--text-secondary)] border-b border-[var(--glass-border)] uppercase tracking-wider font-mono text-[10px]">
            <tr>
              <th className="px-5 py-3">{t('auth.username')}</th>
              <th className="px-5 py-3">{t('users.role')}</th>
              <th className="px-5 py-3">{t('users.assigned_groups')}</th>
              <th className="px-5 py-3 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)] text-[var(--text-primary)]">
            {users.map((u) => {
              const userGroupNames = groups
                .filter((g) => u.group_ids?.includes(g.id))
                .map((g) => g.name);

              return (
                <tr key={u.id} className="hover:bg-[var(--input-bg)]/40 transition-colors">
                  <td className="px-5 py-3.5 font-medium">{u.username}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                        u.role === 'org_admin'
                          ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
                          : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                      }`}
                    >
                      {u.role === 'org_admin'
                        ? t('nav.role_org_admin')
                        : t('nav.role_group_operator')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {u.role === 'org_admin' ? (
                      <span className="text-[11px] text-[var(--text-secondary)] italic">
                        {t('common.all')} ({t('tenants.groups_title')})
                      </span>
                    ) : userGroupNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {userGroupNames.map((gname) => (
                          <span
                            key={gname}
                            className="text-[10px] bg-[var(--input-bg)] px-2 py-0.5 rounded border border-[var(--glass-border)]"
                          >
                            {gname}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-amber-400/80 italic">
                        {t('users.no_groups_assigned')}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {u.id !== currentUser.id && (
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="p-1.5 text-[var(--text-secondary)] hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
                        title={t('common.delete')}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-base font-bold text-[var(--text-primary)] mb-4 pb-2 border-b border-[var(--glass-border)]">
              {t('users.new_user')}
            </h2>

            {errorMsg && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('auth.username')}
                </label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('auth.password')}
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)]"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  {t('users.role')}
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as any)}
                  className="w-full px-3 py-1.5 bg-[var(--input-bg)] border border-[var(--glass-border)] rounded text-xs text-[var(--text-primary)]"
                >
                  <option value="group_operator" className="bg-zinc-900 text-white">
                    {t('nav.role_group_operator')}
                  </option>
                  <option value="org_admin" className="bg-zinc-900 text-white">
                    {t('nav.role_org_admin')}
                  </option>
                </select>
              </div>

              {newRole === 'group_operator' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('users.assigned_groups')}
                  </label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto border border-[var(--glass-border)] p-2 rounded bg-[var(--input-bg)]">
                    {groups.length === 0 ? (
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {t('tenants.no_groups')}
                      </span>
                    ) : (
                      groups.map((g) => (
                        <label
                          key={g.id}
                          className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedGroupIds.includes(g.id)}
                            onChange={() => toggleGroup(g.id)}
                            className="rounded accent-brand-lime"
                          />
                          <span>{g.name}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
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
    </div>
  );
};
