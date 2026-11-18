import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Organization, Team, User } from '../../../types/hub';
import {
  CAPABILITY_LEVELS,
  DEFAULT_CONSERVATIVE_CLAIMS,
  DOMAIN_KEYS,
  PROCESS_TYPE_KEYS,
  levelBadgeClass,
  normalizeClaims,
  type CapabilityLevel,
  type TeamClaims,
} from '../../../utils/rbacClaims';
import { EditIcon, PlusIcon, ShieldIcon, TrashIcon, UsersIcon } from '../../Icons';

interface TeamsTabProps {
  currentUser: User;
  selectedOrgId: number | null;
}

export const TeamsTab: React.FC<TeamsTabProps> = ({ currentUser, selectedOrgId }) => {
  const { t } = useTranslation();
  const isSuperadmin = currentUser.role === 'superadmin';

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<number>(
    selectedOrgId || currentUser.org_id || 1
  );
  const [teams, setTeams] = useState<Team[]>([]);
  const [orgOperators, setOrgOperators] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create / Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formClaims, setFormClaims] = useState<TeamClaims>(DEFAULT_CONSERVATIVE_CLAIMS);
  const [formMembers, setFormMembers] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedOrgId) {
      setActiveOrgId(selectedOrgId);
    } else if (!isSuperadmin && currentUser.org_id) {
      setActiveOrgId(currentUser.org_id);
    }
  }, [selectedOrgId, isSuperadmin, currentUser.org_id]);

  useEffect(() => {
    const loadOrgs = async () => {
      try {
        const res = await fetch('/api/hub/orgs', { credentials: 'include' });
        if (res.ok) {
          const data: Organization[] = await res.json();
          setOrgs(data);
          if (!selectedOrgId && isSuperadmin && data.length > 0) {
            const preferred = data.find((o) => o.slug !== 'default') || data[0];
            setActiveOrgId((prev) => (data.some((o) => o.id === prev) ? prev : preferred.id));
          }
        }
      } catch (err) {
        console.error('Failed to load orgs in TeamsTab:', err);
      }
    };
    loadOrgs();
  }, [isSuperadmin, selectedOrgId]);

  const fetchTeamsAndOperators = async (orgId: number) => {
    if (!orgId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [teamsRes, usersRes] = await Promise.all([
        fetch(`/api/hub/orgs/${orgId}/teams`, { credentials: 'include' }),
        fetch('/api/hub/users', { credentials: 'include' }),
      ]);
      if (teamsRes.ok) {
        setTeams(await teamsRes.json());
      } else {
        const err = await teamsRes.json().catch(() => ({}));
        setErrorMsg(err.detail || t('teams.loadError', 'Failed to load teams'));
      }
      if (usersRes.ok) {
        const allUsers: User[] = await usersRes.json();
        setOrgOperators(
          allUsers.filter((u) => u.org_id === orgId && u.role === 'group_operator')
        );
      }
    } catch (err: any) {
      setErrorMsg(err.message || t('teams.loadError', 'Failed to load teams'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeOrgId) {
      fetchTeamsAndOperators(activeOrgId);
    }
  }, [activeOrgId]);

  const activeOrgName = useMemo(() => {
    return orgs.find((o) => o.id === activeOrgId)?.name || `#${activeOrgId}`;
  }, [orgs, activeOrgId]);

  const openCreateModal = () => {
    setEditingTeam(null);
    setFormName('');
    setFormDesc('');
    setFormClaims(normalizeClaims(DEFAULT_CONSERVATIVE_CLAIMS));
    setFormMembers([]);
    setModalError(null);
    setShowModal(true);
  };

  const openEditModal = (team: Team) => {
    setEditingTeam(team);
    setFormName(team.name);
    setFormDesc(team.description || '');
    setFormClaims(normalizeClaims(team.default_claims));
    setFormMembers(Array.isArray(team.member_user_ids) ? [...team.member_user_ids] : []);
    setModalError(null);
    setShowModal(true);
  };

  const handleToggleMember = (uid: number) => {
    setFormMembers((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSaveTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setModalError(t('teams.nameRequired', 'Team name is required'));
      return;
    }
    setIsSaving(true);
    setModalError(null);
    try {
      const payload = {
        name: formName.trim(),
        description: formDesc.trim() || null,
        default_claims: formClaims,
        member_user_ids: formMembers,
      };
      const url = editingTeam
        ? `/api/hub/teams/${editingTeam.id}`
        : `/api/hub/orgs/${activeOrgId}/teams`;
      const method = editingTeam ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || t('teams.saveError', 'Failed to save team'));
      }
      setShowModal(false);
      await fetchTeamsAndOperators(activeOrgId);
    } catch (err: any) {
      setModalError(err.message || t('teams.saveError', 'Failed to save team'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTeam = async (team: Team) => {
    if (team.is_default_template) return;
    if (!confirm(t('teams.confirmDelete', 'Delete team "{{name}}"?', { name: team.name }))) {
      return;
    }
    try {
      const res = await fetch(`/api/hub/teams/${team.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || t('teams.deleteError', 'Failed to delete team'));
      }
      await fetchTeamsAndOperators(activeOrgId);
    } catch (err: any) {
      setErrorMsg(err.message || t('teams.deleteError', 'Failed to delete team'));
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-4">
        <div>
          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <ShieldIcon size={18} className="text-brand-lime" />
            <span>{t('teams.title', 'RBAC Teams & Capability Templates')}</span>
          </h3>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {t(
              'teams.subtitle',
              'Define reusable domain and service permission policies and assign tenant operators.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isSuperadmin && !selectedOrgId && orgs.length > 0 && (
            <select
              value={activeOrgId}
              onChange={(e) => setActiveOrgId(Number(e.target.value))}
              className="bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime cursor-pointer"
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                  {org.name} ({org.slug})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs flex items-center gap-1.5 hover:bg-brand-lime/90 transition-all cursor-pointer shadow-sm"
          >
            <PlusIcon size={14} />
            <span>{t('teams.createTeam', 'Create Team')}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          {errorMsg}
        </div>
      )}

      {/* Teams List */}
      {isLoading ? (
        <div className="py-12 text-center text-xs text-[var(--text-secondary)] font-mono">
          {t('common.loading', 'Loading...')}
        </div>
      ) : teams.length === 0 ? (
        <div className="py-12 text-center bg-[var(--bg-card)] border border-dashed border-[var(--glass-border)] rounded-2xl text-xs text-[var(--text-secondary)]">
          {t('teams.noTeams', 'No RBAC teams configured for {{org}}.', { org: activeOrgName })}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {teams.map((team) => {
            const claims = normalizeClaims(team.default_claims);
            return (
              <div
                key={team.id}
                className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl p-4 space-y-3 hover:border-brand-lime/30 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-sm text-[var(--text-primary)] truncate">
                        {team.name}
                      </h4>
                      {team.is_default_template && (
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border bg-brand-lime/10 text-brand-lime border-brand-lime/30">
                          {t('teams.defaultTemplateBadge', 'Default Template')}
                        </span>
                      )}
                    </div>
                    {team.description && (
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                        {team.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(team)}
                      className="p-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-brand-lime/40 transition-colors cursor-pointer"
                      title={t('common.edit', 'Edit')}
                    >
                      <EditIcon size={14} />
                    </button>
                    {!team.is_default_template && (
                      <button
                        type="button"
                        onClick={() => handleDeleteTeam(team)}
                        className="p-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                        title={t('common.delete', 'Delete')}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Domain Badges */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {DOMAIN_KEYS.map((dk) => (
                    <span
                      key={dk}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border capitalize ${levelBadgeClass(
                        claims[dk]
                      )}`}
                    >
                      {t(`rbac.domains.${dk}`, dk)}: <strong>{claims[dk]}</strong>
                    </span>
                  ))}
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border ${levelBadgeClass(
                      claims.processes.default
                    )}`}
                  >
                    {t('rbac.processesDefault', 'Processes Default')}: <strong>{claims.processes.default}</strong>
                  </span>
                </div>

                {/* Members */}
                <div className="pt-2 border-t border-[var(--glass-border)] flex items-center justify-between gap-2 flex-wrap text-xs">
                  <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                    <UsersIcon size={13} />
                    <span>
                      {t('teams.membersCount', '{{count}} members', {
                        count: team.members?.length || 0,
                      })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(team.members || []).slice(0, 6).map((m) => (
                      <span
                        key={m.id}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--glass-border)] text-[var(--text-primary)]"
                      >
                        {m.username}
                      </span>
                    ))}
                    {(team.members || []).length > 6 && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 text-[var(--text-secondary)]">
                        +{(team.members || []).length - 6}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Team Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                {editingTeam
                  ? t('teams.editTeam', 'Edit Team Policy')
                  : t('teams.createTeam', 'Create Team')}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTeam} className="p-5 overflow-y-auto space-y-5 flex-1">
              {modalError && (
                <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {modalError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {t('common.name', 'Name')}
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                    {t('teams.description', 'Description')}
                  </label>
                  <input
                    type="text"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder={t('teams.descriptionPlaceholder', 'Optional role description')}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>
              </div>

              {/* Domain Scopes */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('teams.domainScopesTitle', 'Domain Capabilities')}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {DOMAIN_KEYS.map((dk) => (
                    <div
                      key={dk}
                      className="p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-1"
                    >
                      <label className="block text-[11px] font-semibold text-[var(--text-primary)] capitalize">
                        {t(`rbac.domains.${dk}`, dk)}
                      </label>
                      <select
                        value={formClaims[dk]}
                        onChange={(e) =>
                          setFormClaims((prev) => ({
                            ...prev,
                            [dk]: e.target.value as CapabilityLevel,
                          }))
                        }
                        className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
                      >
                        {CAPABILITY_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                            {t(`rbac.levels.${lvl}`, lvl)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <div className="p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-1">
                    <label className="block text-[11px] font-semibold text-[var(--text-primary)]">
                      {t('rbac.processesDefault', 'Processes Default')}
                    </label>
                    <select
                      value={formClaims.processes.default}
                      onChange={(e) =>
                        setFormClaims((prev) => ({
                          ...prev,
                          processes: {
                            ...prev.processes,
                            default: e.target.value as CapabilityLevel,
                          },
                        }))
                      }
                      className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
                    >
                      {CAPABILITY_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                          {t(`rbac.levels.${lvl}`, lvl)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Process Type Scopes */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('teams.processTypesTitle', 'Default By Service / Task Type')}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {PROCESS_TYPE_KEYS.map((pt) => {
                    const currentVal = formClaims.processes.by_type[pt] || '';
                    return (
                      <div
                        key={pt}
                        className="p-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-1"
                      >
                        <label className="block text-[10px] font-mono font-semibold text-[var(--text-secondary)] truncate" title={pt}>
                          {t(`rbac.processTypes.${pt}`, pt)}
                        </label>
                        <select
                          value={currentVal}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormClaims((prev) => {
                              const nextByType = { ...prev.processes.by_type };
                              if (!val) {
                                delete nextByType[pt];
                              } else {
                                nextByType[pt] = val as CapabilityLevel;
                              }
                              return {
                                ...prev,
                                processes: {
                                  ...prev.processes,
                                  by_type: nextByType,
                                },
                              };
                            });
                          }}
                          className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
                        >
                          <option value="" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                            {t('rbac.inheritDefault', 'Inherit Default')}
                          </option>
                          {CAPABILITY_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                              {t(`rbac.levels.${lvl}`, lvl)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Team Members */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('teams.assignOperators', 'Assigned Operators')}
                </h4>
                {orgOperators.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)] italic">
                    {t('teams.noOperatorsInOrg', 'No operators exist in this organization yet.')}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto p-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)]">
                    {orgOperators.map((op) => {
                      const checked = formMembers.includes(op.id);
                      return (
                        <label
                          key={op.id}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                            checked
                              ? 'bg-brand-lime/10 border-brand-lime/30 text-[var(--text-primary)]'
                              : 'border-transparent hover:bg-white/5 text-[var(--text-secondary)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleMember(op.id)}
                            className="accent-brand-lime cursor-pointer"
                          />
                          <span className="truncate font-mono">{op.username}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[var(--glass-border)]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {t('common.cancel', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
