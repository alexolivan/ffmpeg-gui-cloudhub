import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EnrolledNode,
  NodeCatalogResponse,
  NodePermissionOverride,
  Team,
  User,
} from '../../types/hub';
import {
  CAPABILITY_LEVELS,
  DOMAIN_KEYS,
  PROCESS_TYPE_KEYS,
  levelBadgeClass,
  type CapabilityLevel,
} from '../../utils/rbacClaims';
import { RefreshIcon, ShieldIcon, TrashIcon } from '../Icons';

interface NodePermissionsModalProps {
  node: EnrolledNode;
  onClose: () => void;
}

type SubjectType = 'team' | 'user';

export const NodePermissionsModal: React.FC<NodePermissionsModalProps> = ({ node, onClose }) => {
  const { t } = useTranslation();

  const [catalog, setCatalog] = useState<NodeCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [operators, setOperators] = useState<User[]>([]);

  const [subjectType, setSubjectType] = useState<SubjectType>('team');
  const [selectedSubjectId, setSelectedSubjectId] = useState<number>(0);

  // Keyed by `${scope_type}:${target_key}` -> CapabilityLevel
  const [overrideMap, setOverrideMap] = useState<Record<string, CapabilityLevel>>({});
  const [compiledPreview, setCompiledPreview] = useState<Record<string, any> | null>(null);

  const [isLoadingPerms, setIsLoadingPerms] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPurgingOrphans, setIsPurgingOrphans] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchCatalog = async (refresh = false) => {
    if (refresh) setCatalogRefreshing(true);
    else setCatalogLoading(true);
    try {
      const res = await fetch(
        `/api/hub/nodes/${encodeURIComponent(node.node_id)}/catalog${refresh ? '?refresh=true' : ''}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        setCatalog(await res.json());
      }
    } catch (err) {
      console.error('Failed to load node catalog:', err);
    } finally {
      setCatalogLoading(false);
      setCatalogRefreshing(false);
    }
  };

  useEffect(() => {
    const loadBootstrap = async () => {
      await fetchCatalog(false);
      try {
        const [teamsRes, usersRes] = await Promise.all([
          fetch(`/api/hub/orgs/${node.org_id}/teams`, { credentials: 'include' }),
          fetch('/api/hub/users', { credentials: 'include' }),
        ]);
        if (teamsRes.ok) {
          const teamList: Team[] = await teamsRes.json();
          setTeams(teamList);
          if (teamList.length > 0) {
            setSubjectType('team');
            setSelectedSubjectId(teamList[0].id);
          }
        }
        if (usersRes.ok) {
          const allUsers: User[] = await usersRes.json();
          setOperators(
            allUsers.filter((u) => u.org_id === node.org_id && u.role === 'group_operator')
          );
        }
      } catch (err) {
        console.error('Failed to load RBAC subjects:', err);
      }
    };
    loadBootstrap();
  }, [node.node_id, node.org_id]);

  const fetchSubjectPermissions = async (stype: SubjectType, sid: number) => {
    if (!sid) {
      setOverrideMap({});
      setCompiledPreview(null);
      return;
    }
    setIsLoadingPerms(true);
    try {
      const qs = stype === 'team' ? `team_id=${sid}` : `user_id=${sid}`;
      const res = await fetch(
        `/api/hub/nodes/${encodeURIComponent(node.node_id)}/permissions?${qs}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        const nextMap: Record<string, CapabilityLevel> = {};
        for (const ov of (data.overrides || []) as NodePermissionOverride[]) {
          nextMap[`${ov.scope_type}:${ov.target_key}`] = ov.level;
        }
        setOverrideMap(nextMap);
        setCompiledPreview(data.compiled_preview || null);
      }
    } catch (err) {
      console.error('Failed to load subject node permissions:', err);
    } finally {
      setIsLoadingPerms(false);
    }
  };

  useEffect(() => {
    if (selectedSubjectId) {
      fetchSubjectPermissions(subjectType, selectedSubjectId);
    } else {
      setOverrideMap({});
      setCompiledPreview(null);
    }
  }, [subjectType, selectedSubjectId, node.node_id]);

  const handleSubjectTypeChange = (nextType: SubjectType) => {
    setSubjectType(nextType);
    setStatusMessage(null);
    if (nextType === 'team') {
      setSelectedSubjectId(teams[0]?.id || 0);
    } else {
      setSelectedSubjectId(operators[0]?.id || 0);
    }
  };

  const setOverride = (scopeType: NodePermissionOverride['scope_type'], targetKey: string, val: string) => {
    const key = `${scopeType}:${targetKey}`;
    setStatusMessage(null);
    setOverrideMap((prev) => {
      const next = { ...prev };
      if (!val || val === 'inherit') {
        delete next[key];
      } else {
        next[key] = val as CapabilityLevel;
      }
      return next;
    });
  };

  const getOverrideVal = (scopeType: NodePermissionOverride['scope_type'], targetKey: string): string => {
    return overrideMap[`${scopeType}:${targetKey}`] || 'inherit';
  };

  const handleSave = async () => {
    if (!selectedSubjectId) return;
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const overridesPayload: NodePermissionOverride[] = Object.entries(overrideMap).map(
        ([k, level]) => {
          const idx = k.indexOf(':');
          return {
            scope_type: k.slice(0, idx) as NodePermissionOverride['scope_type'],
            target_key: k.slice(idx + 1),
            level,
          };
        }
      );

      const body =
        subjectType === 'team'
          ? { team_id: selectedSubjectId, overrides: overridesPayload }
          : { user_id: selectedSubjectId, overrides: overridesPayload };

      const res = await fetch(`/api/hub/nodes/${encodeURIComponent(node.node_id)}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || t('nodePermissions.saveError', 'Failed to save permissions'));
      }
      await Promise.all([fetchSubjectPermissions(subjectType, selectedSubjectId), fetchCatalog(false)]);
      setStatusMessage({
        type: 'ok',
        text: t('nodePermissions.saveSuccess', 'Permissions saved for this appliance.'),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'err',
        text: err.message || t('nodePermissions.saveError', 'Failed to save permissions'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePurgeOrphans = async () => {
    setIsPurgingOrphans(true);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `/api/hub/nodes/${encodeURIComponent(node.node_id)}/permissions/orphans`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (!res.ok) {
        throw new Error(t('nodePermissions.purgeError', 'Failed to remove orphaned overrides'));
      }
      const data = await res.json();
      await Promise.all([
        fetchCatalog(false),
        selectedSubjectId ? fetchSubjectPermissions(subjectType, selectedSubjectId) : Promise.resolve(),
      ]);
      setStatusMessage({
        type: 'ok',
        text: t('nodePermissions.purgeSuccess', 'Cleaned up {{count}} orphaned rule(s).', {
          count: data.deleted ?? 0,
        }),
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'err',
        text: err.message || t('nodePermissions.purgeError', 'Failed to remove orphaned overrides'),
      });
    } finally {
      setIsPurgingOrphans(false);
    }
  };

  const selectedTeam = useMemo(
    () => (subjectType === 'team' ? teams.find((tm) => tm.id === selectedSubjectId) || null : null),
    [subjectType, teams, selectedSubjectId]
  );

  const previewScopes = compiledPreview?.scopes || null;
  const implicitMonitors = catalog?.implicit_monitors || {};
  const orphanedCount = catalog?.orphaned_overrides?.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-[var(--glass-border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2 truncate">
              <ShieldIcon size={18} className="text-brand-lime shrink-0" />
              <span className="truncate">
                {t('nodePermissions.title', 'Appliance Permissions')}: {node.name}
              </span>
            </h3>
            <p className="text-[11px] font-mono text-[var(--text-secondary)] mt-0.5 truncate">
              {node.node_id}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {catalog && (
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  catalog.offline
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : catalog.cached
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                }`}
              >
                {catalog.offline
                  ? t('nodePermissions.catalogOffline', 'Offline Cache')
                  : catalog.cached
                  ? t('nodePermissions.catalogCached', 'Cached')
                  : t('nodePermissions.catalogLive', 'Live Catalog')}
              </span>
            )}
            <button
              type="button"
              onClick={() => fetchCatalog(true)}
              disabled={catalogRefreshing}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-primary)] hover:border-brand-lime/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title={t('nodePermissions.refreshCatalog', 'Refresh live service & task catalog')}
            >
              <RefreshIcon size={13} className={catalogRefreshing ? 'animate-spin' : ''} />
              <span>{t('common.refresh', 'Refresh')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm px-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Orphaned Override Warning */}
          {orphanedCount > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-amber-300">
                <strong className="font-bold">
                  {t('nodePermissions.orphanWarningTitle', 'Orphaned Permission Rules Detected ({{count}})', {
                    count: orphanedCount,
                  })}
                </strong>
                <p className="text-[11px] opacity-90 mt-0.5">
                  {t(
                    'nodePermissions.orphanWarningDesc',
                    'Some stored overrides point to services or tasks that no longer exist on this appliance.'
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={isPurgingOrphans}
                onClick={handlePurgeOrphans}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <TrashIcon size={13} />
                <span>
                  {isPurgingOrphans
                    ? t('common.loading', 'Loading...')
                    : t('nodePermissions.cleanOrphans', 'Clean Up Orphans')}
                </span>
              </button>
            </div>
          )}

          {/* Subject Selector */}
          <div className="p-3.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleSubjectTypeChange('team')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  subjectType === 'team'
                    ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--glass-border)]'
                }`}
              >
                {t('nodePermissions.targetTeam', 'Team Policy')}
              </button>
              <button
                type="button"
                onClick={() => handleSubjectTypeChange('user')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  subjectType === 'user'
                    ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--glass-border)]'
                }`}
              >
                {t('nodePermissions.targetOperator', 'Operator Override')}
              </button>
            </div>

            <div className="flex-1 sm:max-w-xs">
              {subjectType === 'team' ? (
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(Number(e.target.value))}
                  className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] cursor-pointer"
                >
                  {teams.length === 0 ? (
                    <option value={0}>{t('nodePermissions.noTeams', 'No teams available')}</option>
                  ) : (
                    teams.map((tm) => (
                      <option key={tm.id} value={tm.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                        {tm.name}
                      </option>
                    ))
                  )}
                </select>
              ) : (
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(Number(e.target.value))}
                  className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] cursor-pointer"
                >
                  {operators.length === 0 ? (
                    <option value={0}>{t('nodePermissions.noOperators', 'No operators in tenant')}</option>
                  ) : (
                    operators.map((op) => (
                      <option key={op.id} value={op.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                        {op.username}
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>
          </div>

          {statusMessage && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                statusMessage.type === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              {statusMessage.text}
            </div>
          )}

          {!selectedSubjectId || isLoadingPerms ? (
            <div className="py-10 text-center text-xs text-[var(--text-secondary)] font-mono">
              {isLoadingPerms
                ? t('common.loading', 'Loading...')
                : t('nodePermissions.selectSubjectPrompt', 'Select a team or operator to configure appliance rules.')}
            </div>
          ) : (
            <>
              {/* 1. Domain & Process Default Overrides */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('nodePermissions.domainOverrides', 'Module & Default Overrides')}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {DOMAIN_KEYS.map((dk) => {
                    const inherited =
                      subjectType === 'team'
                        ? selectedTeam?.default_claims?.[dk]
                        : previewScopes?.[dk];
                    return (
                      <div
                        key={dk}
                        className="p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-[var(--text-primary)] capitalize">
                            {t(`rbac.domains.${dk}`, dk)}
                          </span>
                          {inherited && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${levelBadgeClass(inherited)}`}>
                              {subjectType === 'team' ? 'tmpl' : 'eff'}: {inherited}
                            </span>
                          )}
                        </div>
                        <select
                          value={getOverrideVal('domain', dk)}
                          onChange={(e) => setOverride('domain', dk, e.target.value)}
                          className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
                        >
                          <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                            {t('rbac.inheritDefault', 'Inherit')}
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

                  <div className="p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                        {t('rbac.processesDefault', 'Processes Default')}
                      </span>
                      {(subjectType === 'team'
                        ? selectedTeam?.default_claims?.processes?.default
                        : previewScopes?.processes?.default) && (
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${levelBadgeClass(
                            subjectType === 'team'
                              ? selectedTeam?.default_claims?.processes?.default
                              : previewScopes?.processes?.default
                          )}`}
                        >
                          {subjectType === 'team' ? 'tmpl' : 'eff'}:{' '}
                          {subjectType === 'team'
                            ? selectedTeam?.default_claims?.processes?.default
                            : previewScopes?.processes?.default}
                        </span>
                      )}
                    </div>
                    <select
                      value={getOverrideVal('process_type', 'default')}
                      onChange={(e) => setOverride('process_type', 'default', e.target.value)}
                      className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
                    >
                      <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                        {t('rbac.inheritDefault', 'Inherit')}
                      </option>
                      {CAPABILITY_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                          {t(`rbac.levels.${lvl}`, lvl)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 2. By Process Type Overrides */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('nodePermissions.processTypeOverrides', 'Service & Task Type Overrides')}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {PROCESS_TYPE_KEYS.map((pt) => (
                    <div
                      key={pt}
                      className="p-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] space-y-1"
                    >
                      <label className="block text-[10px] font-mono font-semibold text-[var(--text-secondary)] truncate" title={pt}>
                        {t(`rbac.processTypes.${pt}`, pt)}
                      </label>
                      <select
                        value={getOverrideVal('process_type', pt)}
                        onChange={(e) => setOverride('process_type', pt, e.target.value)}
                        className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] cursor-pointer"
                      >
                        <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                          {t('rbac.inheritDefault', 'Inherit')}
                        </option>
                        {CAPABILITY_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                            {t(`rbac.levels.${lvl}`, lvl)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Live Edge Services & Tasks */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Services */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    {t('nodePermissions.servicesCatalog', 'Services')} ({catalog?.services?.length || 0})
                  </h4>
                  {catalogLoading ? (
                    <p className="text-xs text-[var(--text-secondary)] font-mono py-3">
                      {t('common.loading', 'Loading...')}
                    </p>
                  ) : !catalog || catalog.services.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)] italic py-3">
                      {t('nodePermissions.noServicesInCatalog', 'No services reported by appliance.')}
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {catalog.services.map((svc) => {
                        const sid = String(svc.id);
                        const consumers = implicitMonitors[sid] || [];
                        return (
                          <div
                            key={sid}
                            className="p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                                {svc.alias || svc.name}
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                                  #{sid} · {svc.service_type}
                                </span>
                                {consumers.length > 0 && (
                                  <span
                                    className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                                    title={consumers.join(', ')}
                                  >
                                    🔗 {t('nodePermissions.autoMonitorVia', 'Auto-Monitor (via {{consumer}})', {
                                      consumer: consumers[0],
                                    })}
                                    {consumers.length > 1 ? ` +${consumers.length - 1}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                            <select
                              value={getOverrideVal('service', sid)}
                              onChange={(e) => setOverride('service', sid, e.target.value)}
                              className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] shrink-0 cursor-pointer"
                            >
                              <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                                {t('rbac.inheritDefault', 'Inherit')}
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
                  )}
                </div>

                {/* Tasks */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    {t('nodePermissions.tasksCatalog', 'Scheduled Tasks')} ({catalog?.tasks?.length || 0})
                  </h4>
                  {catalogLoading ? (
                    <p className="text-xs text-[var(--text-secondary)] font-mono py-3">
                      {t('common.loading', 'Loading...')}
                    </p>
                  ) : !catalog || catalog.tasks.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)] italic py-3">
                      {t('nodePermissions.noTasksInCatalog', 'No tasks reported by appliance.')}
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {catalog.tasks.map((tsk) => {
                        const tid = String(tsk.id);
                        return (
                          <div
                            key={tid}
                            className="p-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                                {tsk.alias || tsk.name}
                              </div>
                              <div className="text-[10px] font-mono text-[var(--text-secondary)] mt-0.5 truncate">
                                #{tid} · {tsk.schedule_type || 'task'}
                              </div>
                            </div>
                            <select
                              value={getOverrideVal('task', tid)}
                              onChange={(e) => setOverride('task', tid, e.target.value)}
                              className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] shrink-0 cursor-pointer"
                            >
                              <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                                {t('rbac.inheritDefault', 'Inherit')}
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
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--glass-border)] flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            {t('common.close', 'Close')}
          </button>
          <button
            type="button"
            disabled={isSaving || !selectedSubjectId}
            onClick={handleSave}
            className="px-4 py-2 rounded-xl bg-brand-lime text-black font-bold text-xs hover:bg-brand-lime/90 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSaving ? t('common.saving', 'Saving...') : t('nodePermissions.saveButton', 'Save Node Permissions')}
          </button>
        </div>
      </div>
    </div>
  );
};
