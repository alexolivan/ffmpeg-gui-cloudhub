import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { User, Organization, NodeGroup, UserRole } from '../../../types/hub';
import { PlusIcon, TrashIcon, UsersIcon, EditIcon } from '../../Icons';

interface UsersTabProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const UsersTab: React.FC<UsersTabProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [allGroups, setAllGroups] = useState<NodeGroup[]>([]);
  const [modalGroups, setModalGroups] = useState<NodeGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search & Role Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admins' | 'operators'>('all');

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalOrgId, setModalOrgId] = useState<number>(selectedOrgId || 1);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('group_operator');
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit User State
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('group_operator');
  const [editPassword, setEditPassword] = useState('');
  const [editOrgId, setEditOrgId] = useState<number>(1);
  const [editSelectedGroupIds, setEditSelectedGroupIds] = useState<number[]>([]);
  const [editGroupsList, setEditGroupsList] = useState<NodeGroup[]>([]);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState<string | null>(null);

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

  const fetchOrgs = async () => {
    if (!isSuperadmin) return;
    try {
      const res = await fetch('/api/hub/orgs', { credentials: 'include' });
      if (res.ok) {
        const orgsData: Organization[] = await res.json();
        setOrgs(orgsData);
        if (orgsData.length > 0 && !selectedOrgId) {
          setModalOrgId(orgsData[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load orgs for users:', err);
    }
  };

  const fetchAllGroups = async () => {
    try {
      const res = await fetch('/api/hub/groups', { credentials: 'include' });
      if (res.ok) {
        setAllGroups(await res.json());
      }
    } catch (err) {
      console.error('Failed to load groups dictionary:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchOrgs();
    fetchAllGroups();
  }, []);

  // Map of group_id -> group_name for fast lookup
  const groupMap = useMemo(() => {
    const map: Record<number, string> = {};
    allGroups.forEach((g) => {
      map[g.id] = g.name;
    });
    return map;
  }, [allGroups]);

  // Sync modalOrgId when selectedOrgId changes in sidebar
  useEffect(() => {
    if (selectedOrgId) {
      setModalOrgId(selectedOrgId);
    } else if (orgs.length > 0) {
      setModalOrgId(orgs[0].id);
    }
  }, [selectedOrgId, orgs]);

  // Load groups for the target tenant inside the create modal
  useEffect(() => {
    const targetOrg = isSuperadmin ? modalOrgId : currentUser.org_id;
    if (targetOrg) {
      fetch(`/api/hub/orgs/${targetOrg}/groups`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : []))
        .then(setModalGroups)
        .catch(() => setModalGroups([]));
    }
  }, [modalOrgId, currentUser.org_id, isSuperadmin]);

  // Load groups for the target tenant inside the edit modal
  useEffect(() => {
    if (editingUser) {
      const targetOrg = isSuperadmin ? editOrgId : currentUser.org_id;
      if (targetOrg) {
        fetch(`/api/hub/orgs/${targetOrg}/groups`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : []))
          .then(setEditGroupsList)
          .catch(() => setEditGroupsList([]));
      }
    }
  }, [editingUser, editOrgId, currentUser.org_id, isSuperadmin]);

  const openEditUserModal = (user: User) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditPassword('');
    setEditOrgId(user.org_id || (orgs[0]?.id ?? 1));
    setEditSelectedGroupIds(user.group_ids || []);
    setEditErrorMsg(null);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsUpdatingUser(true);
    setEditErrorMsg(null);

    const payload: Record<string, any> = {
      role: editRole,
      group_ids: editRole === 'group_operator' ? editSelectedGroupIds : [],
    };
    if (isSuperadmin && editOrgId) {
      payload.org_id = editOrgId;
    }
    if (editPassword && editPassword.trim()) {
      payload.password = editPassword;
    }

    try {
      const res = await fetch(`/api/hub/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setEditingUser(null);
        fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        setEditErrorMsg(data.detail || 'Failed to update user.');
      }
    } catch (err: any) {
      setEditErrorMsg(err.message || 'Error updating user.');
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      setErrorMsg('Username and password are required.');
      return;
    }

    setIsCreating(true);
    setErrorMsg(null);

    const targetOrgId = isSuperadmin ? modalOrgId : currentUser.org_id;

    try {
      const res = await fetch('/api/hub/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          org_id: targetOrgId,
          group_ids: newRole === 'group_operator' ? selectedGroupIds : [],
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

  // ── Scoping and Filters ──
  const tenantScopedUsers = useMemo(() => {
    return users.filter((u) => {
      if (isSuperadmin) {
        if (selectedOrgId) {
          return u.org_id === selectedOrgId;
        }
        return true; // Show all users when 'All Tenants' is active
      }
      return u.org_id === currentUser.org_id;
    });
  }, [users, isSuperadmin, selectedOrgId, currentUser.org_id]);

  const filteredUsers = useMemo(() => {
    return tenantScopedUsers.filter((u) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = u.username.toLowerCase().includes(q);
        const matchesOrg = u.org_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesOrg) return false;
      }

      // Role filter
      if (roleFilter === 'admins') {
        if (u.role !== 'superadmin' && u.role !== 'org_admin') return false;
      } else if (roleFilter === 'operators') {
        if (u.role !== 'group_operator') return false;
      }

      return true;
    });
  }, [tenantScopedUsers, searchQuery, roleFilter]);

  // ── Render Individual User Card ──
  const renderUserCard = (u: User) => {
    // Resolve group names
    const resolvedGroupNames: string[] = [];
    if (u.groups && u.groups.length > 0) {
      u.groups.forEach((g) => resolvedGroupNames.push(g.name));
    } else if (u.group_names && u.group_names.length > 0) {
      resolvedGroupNames.push(...u.group_names);
    } else if (u.group_ids && u.group_ids.length > 0) {
      u.group_ids.forEach((gid) => {
        resolvedGroupNames.push(groupMap[gid] || `Group #${gid}`);
      });
    }

    return (
      <div
        key={u.id}
        className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-5 shadow-sm space-y-3 relative group hover:border-brand-lime/30 transition-all"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                u.role === 'superadmin'
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                  : u.role === 'org_admin'
                  ? 'bg-brand-lime/10 border border-brand-lime/30 text-brand-lime'
                  : 'bg-white/5 border border-[var(--glass-border)] text-[var(--text-secondary)]'
              }`}
            >
              <UsersIcon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-[var(--text-primary)] font-mono">{u.username}</h4>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase ${
                    u.role === 'superadmin'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                      : u.role === 'org_admin'
                      ? 'bg-brand-lime/10 text-brand-lime border border-brand-lime/30'
                      : 'bg-white/10 text-[var(--text-secondary)] border border-[var(--glass-border)]'
                  }`}
                >
                  {u.role === 'superadmin'
                    ? 'Owner'
                    : u.role === 'org_admin'
                    ? 'Tenant Admin'
                    : 'Operator'}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-[var(--text-secondary)] font-mono flex items-center gap-1">
                  {u.role === 'superadmin' ? (
                    <>👑 {t('settings.platformOwners', 'Platform Superadmin')}</>
                  ) : (
                    <>🏢 {u.org_name || 'Tenant Organization'}</>
                  )}
                </span>
              </div>
            </div>
          </div>

          {u.id !== currentUser.id && u.role !== 'superadmin' && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => openEditUserModal(u)}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-brand-lime hover:bg-white/5 transition-all cursor-pointer"
                title={t('common.edit', 'Edit User')}
              >
                <EditIcon size={15} />
              </button>
              <button
                onClick={() => handleDeleteUser(u)}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                title={t('common.delete', 'Delete User')}
              >
                <TrashIcon size={15} />
              </button>
            </div>
          )}
        </div>

        {u.role === 'org_admin' && (
          <div className="pt-2 border-t border-[var(--glass-border)] text-xs">
            <span className="text-[10px] text-[var(--text-secondary)] block uppercase font-mono mb-1 font-bold tracking-wider">
              {t('settings.permissionScope', 'Permission Scope')}:
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono text-brand-lime bg-brand-lime/10 border border-brand-lime/20">
              🛡️ {t('settings.fullTenantGovernance', 'Full Tenant Scope')}
            </span>
          </div>
        )}

        {u.role === 'group_operator' && (
          <div className="pt-2 border-t border-[var(--glass-border)] text-xs">
            <span className="text-[10px] text-[var(--text-secondary)] block uppercase font-mono mb-1.5 font-bold tracking-wider">
              {t('settings.clusterScope', 'Cluster & Group Scope')}:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {resolvedGroupNames.length > 0 ? (
                resolvedGroupNames.map((name, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium bg-brand-lime/10 border border-brand-lime/25 text-brand-lime"
                  >
                    🏷️ {name}
                  </span>
                ))
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-mono italic text-[var(--text-secondary)] bg-white/5 border border-[var(--glass-border)]">
                  ✓ {t('settings.allGroupsOrFull', 'All / Full Access')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)]">
        {t('common.loading', 'Loading users...')}
      </div>
    );
  }

  // Group users hierarchically for All Tenants view
  const platformOwners = filteredUsers.filter((u) => u.role === 'superadmin');

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Header & Action Controls ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">
            {t('settings.usersTitle', 'User Accounts & Access Control')}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t('settings.usersSubtitle', 'Manage system operators, tenant administrators, and group access scopes.')}
          </p>
        </div>

        <button
          onClick={() => {
            setErrorMsg(null);
            setNewUsername('');
            setNewPassword('');
            setSelectedGroupIds([]);
            setNewRole('group_operator');
            setModalOrgId(selectedOrgId || (orgs[0]?.id ?? 1));
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-brand-lime text-black font-bold text-xs tracking-wide hover:bg-brand-lime/90 transition-all shadow-sm cursor-pointer self-start sm:self-auto"
        >
          <PlusIcon size={16} />
          <span>{t('settings.createUserBtn', 'Create User')}</span>
        </button>
      </div>

      {/* ── Search & Role Filters ── */}
      <div className="flex flex-col sm:flex-row items-center gap-3 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-2.5 shadow-sm">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('settings.searchUsersPlaceholder', 'Filter users by username or tenant...')}
            className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 self-stretch sm:self-auto justify-end">
          <button
            onClick={() => setRoleFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              roleFilter === 'all'
                ? 'bg-brand-lime text-black font-bold shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
            }`}
          >
            {t('settings.allRoles', 'All Roles')}
          </button>
          <button
            onClick={() => setRoleFilter('admins')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              roleFilter === 'admins'
                ? 'bg-brand-lime text-black font-bold shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
            }`}
          >
            {t('settings.adminsOnly', 'Administrators')}
          </button>
          <button
            onClick={() => setRoleFilter('operators')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              roleFilter === 'operators'
                ? 'bg-brand-lime text-black font-bold shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
            }`}
          >
            {t('settings.operatorsOnly', 'Operators')}
          </button>
        </div>
      </div>

      {/* ── Hierarchical Content Sections ── */}
      {filteredUsers.length === 0 ? (
        <div className="py-12 text-center text-xs font-mono text-[var(--text-secondary)] border border-dashed border-[var(--glass-border)] rounded-2xl">
          {t('settings.noUsersFound', 'No users found matching current filters.')}
        </div>
      ) : isSuperadmin && !selectedOrgId ? (
        /* Superadmin viewing All Tenants: Hierarchical 2-Level View */
        <div className="space-y-8">
          {/* Platform Owners Section */}
          {platformOwners.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-border)]">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 text-sm">👑</span>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                    {t('settings.platformOwners', 'Platform Administrators (Owners)')}
                  </h4>
                </div>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/25">
                  {platformOwners.length} {platformOwners.length === 1 ? t('settings.user', 'user') : t('settings.users', 'users')}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {platformOwners.map(renderUserCard)}
              </div>
            </div>
          )}

          {/* Per-Tenant Sections */}
          {orgs.map((org) => {
            const orgUsers = filteredUsers.filter((u) => u.org_id === org.id);
            if (orgUsers.length === 0 && searchQuery.trim()) return null;

            const orgAdmins = orgUsers.filter((u) => u.role === 'org_admin');
            const orgOperators = orgUsers.filter((u) => u.role === 'group_operator');

            return (
              <div key={org.id} className="space-y-4 pt-2">
                <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-brand-lime text-sm">🏢</span>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                      {org.name}
                    </h4>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">({org.slug})</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-white/5 text-[var(--text-secondary)] border border-[var(--glass-border)]">
                    {orgUsers.length} {orgUsers.length === 1 ? t('settings.user', 'user') : t('settings.users', 'users')}
                  </span>
                </div>

                {orgUsers.length === 0 ? (
                  <div className="py-6 text-center text-xs font-mono text-[var(--text-secondary)] border border-dashed border-[var(--glass-border)] rounded-xl">
                    {t('settings.noUsersInTenant', 'No users registered in this tenant.')}
                  </div>
                ) : (
                  <div className="space-y-5 pl-2">
                    {/* Tenant Administrators Sub-section */}
                    {orgAdmins.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-[var(--text-secondary)]">
                          <span>🛡️</span>
                          <span>{t('settings.tenantAdmins', 'Tenant Administrators')}</span>
                          <span className="text-[10px] font-normal text-[var(--text-secondary)]/60">
                            ({orgAdmins.length})
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {orgAdmins.map(renderUserCard)}
                        </div>
                      </div>
                    )}

                    {/* Operators & Cluster Scopes Sub-section */}
                    {orgOperators.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2 text-[11px] font-mono font-bold text-[var(--text-secondary)]">
                          <span>👷</span>
                          <span>{t('settings.operatorsTitle', 'Operators & Cluster Scopes')}</span>
                          <span className="text-[10px] font-normal text-[var(--text-secondary)]/60">
                            ({orgOperators.length})
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {orgOperators.map(renderUserCard)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Scoped Tenant View: Partitioned into Admins and Operators */
        <div className="space-y-6">
          {(() => {
            const tenantAdmins = filteredUsers.filter((u) => u.role === 'org_admin' || u.role === 'superadmin');
            const tenantOperators = filteredUsers.filter((u) => u.role === 'group_operator');

            return (
              <>
                {tenantAdmins.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-border)]">
                      <div className="flex items-center gap-2">
                        <span className="text-brand-lime text-sm">🛡️</span>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                          {t('settings.tenantAdmins', 'Tenant Administrators')}
                        </h4>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-brand-lime/10 text-brand-lime border border-brand-lime/25">
                        {tenantAdmins.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tenantAdmins.map(renderUserCard)}
                    </div>
                  </div>
                )}

                {tenantOperators.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--glass-border)]">
                      <div className="flex items-center gap-2">
                        <span className="text-brand-lime text-sm">👷</span>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] font-mono">
                          {t('settings.operatorsTitle', 'Operators & Cluster Scopes')}
                        </h4>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-white/5 text-[var(--text-secondary)] border border-[var(--glass-border)]">
                        {tenantOperators.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tenantOperators.map(renderUserCard)}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── Edit User Modal ── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <button
              onClick={() => setEditingUser(null)}
              className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="text-base font-bold text-[var(--text-primary)] mb-1">
              {t('settings.editUserTitle', 'Edit User Account')}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4 font-mono">
              user: <span className="text-brand-lime font-bold">{editingUser.username}</span>
            </p>

            {editErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {editErrorMsg}
              </div>
            )}

            <form onSubmit={handleUpdateUser} autoComplete="off" className="space-y-4">
              {isSuperadmin && orgs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.assignTenant', 'Tenant Organization')}
                  </label>
                  <select
                    value={editOrgId}
                    onChange={(e) => {
                      setEditOrgId(Number(e.target.value));
                      setEditSelectedGroupIds([]);
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
                  {t('settings.role', 'User Role')}
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer"
                >
                  <option value="group_operator" className="bg-[#18181b] text-white">
                    Operator (View & Connect to Appliances)
                  </option>
                  <option value="org_admin" className="bg-[#18181b] text-white">
                    Tenant Admin (Manage Groups & Users in Tenant)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  {t('settings.newPasswordOptional', 'New Password (leave blank to keep current)')}
                </label>
                <input
                  type="password"
                  name="edit_user_pwd"
                  autoComplete="new-password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime font-mono"
                />
              </div>

              {editGroupsList.length > 0 && editRole === 'group_operator' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.restrictGroups', 'Restrict to Specific Groups (Optional)')}
                  </label>
                  <div className="max-h-28 overflow-y-auto space-y-1.5 p-2 bg-black/20 rounded-xl border border-[var(--glass-border)]">
                    {editGroupsList.map((grp) => (
                      <label key={grp.id} className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editSelectedGroupIds.includes(grp.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEditSelectedGroupIds([...editSelectedGroupIds, grp.id]);
                            } else {
                              setEditSelectedGroupIds(editSelectedGroupIds.filter((id) => id !== grp.id));
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
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingUser}
                  className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isUpdatingUser ? t('common.saving', 'Saving...') : t('common.save', 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
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

            <form onSubmit={handleCreateUser} autoComplete="off" className="space-y-4">
              {/* Tenant selector inside modal for superadmin */}
              {isSuperadmin && orgs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.assignTenant', 'Tenant Organization')}
                  </label>
                  <select
                    value={modalOrgId}
                    onChange={(e) => {
                      setModalOrgId(Number(e.target.value));
                      setSelectedGroupIds([]);
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
                  {t('settings.username', 'Username')}
                </label>
                <input
                  type="text"
                  name="create_user_name_unique"
                  autoComplete="off"
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
                  name="create_user_pass_unique"
                  autoComplete="new-password"
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
                </select>
              </div>

              {modalGroups.length > 0 && newRole === 'group_operator' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                    {t('settings.restrictGroups', 'Restrict to Specific Groups (Optional)')}
                  </label>
                  <div className="max-h-28 overflow-y-auto space-y-1.5 p-2 bg-black/20 rounded-xl border border-[var(--glass-border)]">
                    {modalGroups.map((grp) => (
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
