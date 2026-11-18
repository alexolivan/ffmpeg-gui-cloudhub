import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  EnrolledNode,
  NodeCatalogResponse,
  NodePermissionOverride,
  NodePermissionsResponse,
  SubjectTeamSummary,
  Team,
  User,
} from '../../types/hub';
import {
  CAPABILITY_LEVELS,
  DEFAULT_CONSERVATIVE_CLAIMS,
  DOMAIN_KEYS,
  PROCESS_TYPE_KEYS,
  levelBadgeClass,
  normalizeClaims,
  type CapabilityLevel,
} from '../../utils/rbacClaims';
import {
  AlertTriangleIcon,
  KeyIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  TrashIcon,
  UsersIcon,
} from '../Icons';

interface NodePermissionsModalProps {
  node: EnrolledNode;
  onClose: () => void;
}

type SubjectType = 'team' | 'user';
type ModalTab = 'domains' | 'services' | 'tasks';

const LEVEL_RANK: Record<CapabilityLevel, number> = {
  none: 0,
  monitor: 1,
  operate: 2,
  manage: 3,
  admin: 4,
};

const serializeOverrideMap = (map: Record<string, CapabilityLevel>): string =>
  JSON.stringify(
    Object.keys(map)
      .sort()
      .map((k) => [k, map[k]])
  );

export const NodePermissionsModal: React.FC<NodePermissionsModalProps> = ({ node, onClose }) => {
  const { t } = useTranslation();

  const [catalog, setCatalog] = useState<NodeCatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [operators, setOperators] = useState<User[]>([]);

  const [subjectType, setSubjectType] = useState<SubjectType>('team');
  const [selectedTeamId, setSelectedTeamId] = useState<number>(0);
  const [selectedUserId, setSelectedUserId] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<ModalTab>('domains');

  const [serviceSearch, setServiceSearch] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [onlyOverridesFilter, setOnlyOverridesFilter] = useState(false);

  // Keyed by `${scope_type}:${target_key}` -> CapabilityLevel
  const [overrideMap, setOverrideMap] = useState<Record<string, CapabilityLevel>>({});
  const [savedSnapshot, setSavedSnapshot] = useState<string>('[]');
  const [inheritedPreview, setInheritedPreview] = useState<Record<string, any> | null>(null);
  const [subjectTeams, setSubjectTeams] = useState<SubjectTeamSummary[]>([]);
  const [overrideCounts, setOverrideCounts] = useState<{
    teams: Record<string, number>;
    users: Record<string, number>;
  }>({ teams: {}, users: {} });

  const [isLoadingPerms, setIsLoadingPerms] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPurgingOrphans, setIsPurgingOrphans] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const activeSubjectId = subjectType === 'team' ? selectedTeamId : selectedUserId;
  const isDirty = useMemo(
    () => serializeOverrideMap(overrideMap) !== savedSnapshot,
    [overrideMap, savedSnapshot]
  );

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
            setSelectedTeamId(teamList[0].id);
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
      setSavedSnapshot('[]');
      setInheritedPreview(null);
      setSubjectTeams([]);
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
        const data: NodePermissionsResponse = await res.json();
        const nextMap: Record<string, CapabilityLevel> = {};
        for (const ov of data.overrides || []) {
          nextMap[`${ov.scope_type}:${ov.target_key}`] = ov.level;
        }
        setOverrideMap(nextMap);
        setSavedSnapshot(serializeOverrideMap(nextMap));
        setInheritedPreview(data.inherited_preview || null);
        setSubjectTeams(data.subject_teams || []);
        if (data.override_counts) {
          setOverrideCounts(data.override_counts);
        }
      }
    } catch (err) {
      console.error('Failed to load subject node permissions:', err);
    } finally {
      setIsLoadingPerms(false);
    }
  };

  useEffect(() => {
    if (activeSubjectId) {
      fetchSubjectPermissions(subjectType, activeSubjectId);
    } else {
      setOverrideMap({});
      setSavedSnapshot('[]');
      setInheritedPreview(null);
      setSubjectTeams([]);
    }
  }, [subjectType, activeSubjectId, node.node_id]);

  const confirmDiscardIfDirty = (): boolean => {
    if (!isDirty) return true;
    return confirm(
      t(
        'nodePermissions.confirmDiscard',
        'You have unsaved permission changes for the current selection. Discard them and switch?'
      )
    );
  };

  const handleSelectTeam = (teamId: number) => {
    if (subjectType === 'team' && teamId === selectedTeamId) return;
    if (!confirmDiscardIfDirty()) return;
    setStatusMessage(null);
    setSelectedTeamId(teamId);
    setSelectedUserId(0);
    setSubjectType('team');
  };

  const handleFocusTeamSelector = () => {
    if (subjectType === 'team') return;
    if (!selectedTeamId && teams.length === 0) return;
    if (!confirmDiscardIfDirty()) return;
    setStatusMessage(null);
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0].id);
    }
    setSelectedUserId(0);
    setSubjectType('team');
  };

  const handleSelectOperator = (uid: number) => {
    if (uid === 0) {
      handleFocusTeamSelector();
      return;
    }
    if (subjectType === 'user' && uid === selectedUserId) return;
    if (!confirmDiscardIfDirty()) return;
    setStatusMessage(null);
    setSelectedUserId(uid);
    setSubjectType('user');
  };

  const handleClose = () => {
    if (!confirmDiscardIfDirty()) return;
    onClose();
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
    if (!activeSubjectId) return;
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
          ? { team_id: selectedTeamId, overrides: overridesPayload }
          : { user_id: selectedUserId, overrides: overridesPayload };

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
      await Promise.all([fetchSubjectPermissions(subjectType, activeSubjectId), fetchCatalog(false)]);
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
        activeSubjectId ? fetchSubjectPermissions(subjectType, activeSubjectId) : Promise.resolve(),
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
    () => teams.find((tm) => tm.id === selectedTeamId) || null,
    [teams, selectedTeamId]
  );
  const selectedOperator = useMemo(
    () => operators.find((op) => op.id === selectedUserId) || null,
    [operators, selectedUserId]
  );

  const canOperatorAccessNode = (op: User): boolean =>
    Boolean(node.group_id && Array.isArray(op.group_ids) && op.group_ids.includes(node.group_id));

  const sortedOperators = useMemo(() => {
    const reachable = operators.filter(canOperatorAccessNode);
    const unreachable = operators.filter((op) => !canOperatorAccessNode(op));
    return { reachable, unreachable };
  }, [operators, node.group_id]);

  // Inherited scopes baseline (before active subject's node overrides)
  const baseScopes = useMemo(() => {
    if (subjectType === 'team') {
      return normalizeClaims(selectedTeam?.default_claims || DEFAULT_CONSERVATIVE_CLAIMS);
    }
    return normalizeClaims(inheritedPreview?.scopes || DEFAULT_CONSERVATIVE_CLAIMS);
  }, [subjectType, selectedTeam, inheritedPreview]);

  const effectiveProcDefault: CapabilityLevel =
    overrideMap['process_type:default'] || baseScopes.processes.default;

  const getDomainInherited = (dk: (typeof DOMAIN_KEYS)[number]): { level: CapabilityLevel; source: string } => {
    const source =
      subjectType === 'team'
        ? t('nodePermissions.sourceTeamTemplate', 'Team template')
        : t('nodePermissions.sourceInheritedTeam', 'Team rules');
    return { level: baseScopes[dk], source };
  };

  const getProcDefaultInherited = (): { level: CapabilityLevel; source: string } => ({
    level: baseScopes.processes.default,
    source:
      subjectType === 'team'
        ? t('nodePermissions.sourceTeamTemplate', 'Team template')
        : t('nodePermissions.sourceInheritedTeam', 'Team rules'),
  });

  const getProcTypeInherited = (pt: string): { level: CapabilityLevel; source: string } => {
    const explicitType = baseScopes.processes.by_type?.[pt];
    if (explicitType) {
      return {
        level: explicitType,
        source:
          subjectType === 'team'
            ? t('nodePermissions.sourceTeamTemplate', 'Team template')
            : t('nodePermissions.sourceInheritedTeam', 'Team rules'),
      };
    }
    return {
      level: effectiveProcDefault,
      source: t('rbac.processesDefault', 'Processes Default'),
    };
  };

  const getServiceInherited = (
    sid: string,
    serviceType: string
  ): { level: CapabilityLevel; source: string } => {
    if (subjectType === 'user') {
      const teamSvcRule = inheritedPreview?.scopes?.processes?.services?.[sid] as CapabilityLevel | undefined;
      if (teamSvcRule) {
        return {
          level: teamSvcRule,
          source: t('nodePermissions.sourceTeamNodeRule', 'Team node rule'),
        };
      }
      const userTypeOv = overrideMap[`process_type:${serviceType}`];
      if (userTypeOv) {
        return {
          level: userTypeOv,
          source: t('nodePermissions.sourceTypeOverride', 'Type {{type}}', { type: serviceType }),
        };
      }
    } else {
      const teamTypeOv = overrideMap[`process_type:${serviceType}`];
      if (teamTypeOv) {
        return {
          level: teamTypeOv,
          source: t('nodePermissions.sourceTypeOverride', 'Type {{type}}', { type: serviceType }),
        };
      }
    }

    const byType = baseScopes.processes.by_type?.[serviceType];
    if (byType) {
      return {
        level: byType,
        source: t('nodePermissions.sourceTypeOverride', 'Type {{type}}', { type: serviceType }),
      };
    }

    return {
      level: effectiveProcDefault,
      source: t('rbac.processesDefault', 'Processes Default'),
    };
  };

  const getTaskInherited = (tid: string): { level: CapabilityLevel; source: string } => {
    if (subjectType === 'user') {
      const teamTaskRule = inheritedPreview?.scopes?.processes?.tasks?.[tid] as CapabilityLevel | undefined;
      if (teamTaskRule) {
        return {
          level: teamTaskRule,
          source: t('nodePermissions.sourceTeamNodeRule', 'Team node rule'),
        };
      }
    }
    const ownTypeOv = overrideMap['process_type:task'];
    if (ownTypeOv) {
      return {
        level: ownTypeOv,
        source: t('nodePermissions.sourceTypeOverride', 'Type task'),
      };
    }
    const byTypeTask = baseScopes.processes.by_type?.task;
    if (byTypeTask) {
      return {
        level: byTypeTask,
        source: t('nodePermissions.sourceTypeOverride', 'Type task'),
      };
    }
    return {
      level: effectiveProcDefault,
      source: t('rbac.processesDefault', 'Processes Default'),
    };
  };

  const tabCounts = useMemo(() => {
    let domains = 0;
    let services = 0;
    let tasks = 0;
    for (const k of Object.keys(overrideMap)) {
      if (k.startsWith('domain:') || k.startsWith('process_type:')) domains += 1;
      else if (k.startsWith('service:')) services += 1;
      else if (k.startsWith('task:')) tasks += 1;
    }
    return { domains, services, tasks };
  }, [overrideMap]);

  const filteredServices = useMemo(() => {
    const list = catalog?.services || [];
    const q = serviceSearch.trim().toLowerCase();
    return list.filter((svc) => {
      const sid = String(svc.id);
      if (onlyOverridesFilter && !overrideMap[`service:${sid}`]) return false;
      if (!q) return true;
      return (
        (svc.alias || '').toLowerCase().includes(q) ||
        (svc.name || '').toLowerCase().includes(q) ||
        (svc.service_type || '').toLowerCase().includes(q) ||
        sid.includes(q)
      );
    });
  }, [catalog, serviceSearch, onlyOverridesFilter, overrideMap]);

  const filteredTasks = useMemo(() => {
    const list = catalog?.tasks || [];
    const q = taskSearch.trim().toLowerCase();
    return list.filter((tsk) => {
      const tid = String(tsk.id);
      if (onlyOverridesFilter && !overrideMap[`task:${tid}`]) return false;
      if (!q) return true;
      return (
        (tsk.alias || '').toLowerCase().includes(q) ||
        (tsk.name || '').toLowerCase().includes(q) ||
        (tsk.schedule_type || '').toLowerCase().includes(q) ||
        tid.includes(q)
      );
    });
  }, [catalog, taskSearch, onlyOverridesFilter, overrideMap]);

  const isTeamActive = subjectType === 'team';
  const activeAccentCardClass = isTeamActive
    ? 'border-brand-lime/50 bg-brand-lime/5'
    : 'border-cyan-400/50 bg-cyan-500/5';
  const activeBadgeClass = isTeamActive
    ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
    : 'bg-cyan-500/15 text-cyan-400 border-cyan-400/30';

  const implicitMonitors = catalog?.implicit_monitors || {};
  const orphanedCount = catalog?.orphaned_overrides?.length || 0;

  const formatInheritedLabel = (level: CapabilityLevel, source: string) =>
    `${t(`rbac.levels.${level}`, level)} — ${t('nodePermissions.inheritedFrom', 'Inherited ({{source}})', {
      source,
    })}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
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
              onClick={handleClose}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm px-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Fixed Dual-Selector Scope Header + Tabs */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--glass-border)] space-y-3 bg-[var(--bg-card)]">
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

          {/* Side-by-side Dual Selectors with Active Focus Border */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Team Selector Box */}
            <div
              onClick={() => {
                if (!isTeamActive) handleFocusTeamSelector();
              }}
              className={`p-3 rounded-xl border transition-all ${
                isTeamActive
                  ? 'border-brand-lime ring-2 ring-brand-lime/25 bg-brand-lime/5'
                  : 'border-[var(--glass-border)] bg-[var(--input-bg)]/60 opacity-80 hover:opacity-100 cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-[var(--text-primary)]">
                  <UsersIcon size={13} className={isTeamActive ? 'text-brand-lime' : 'text-[var(--text-secondary)]'} />
                  <span>{t('nodePermissions.teamScopeLabel', 'Team / Policy Template')}</span>
                </span>
                {isTeamActive && (
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-brand-lime text-black font-bold">
                    {t('nodePermissions.activeScopeBadge', 'Editing')}
                  </span>
                )}
              </div>
              <select
                value={selectedTeamId}
                onChange={(e) => handleSelectTeam(Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
                className={`w-full bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none ${
                  isTeamActive ? 'border-brand-lime/60' : 'border-[var(--glass-border)]'
                }`}
              >
                {teams.length === 0 ? (
                  <option value={0}>{t('nodePermissions.noTeams', 'No teams available')}</option>
                ) : (
                  teams.map((tm) => {
                    const cnt = overrideCounts.teams?.[String(tm.id)] || 0;
                    return (
                      <option key={tm.id} value={tm.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                        {tm.name}
                        {cnt > 0 ? ` (${cnt})` : ''}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            {/* Operator Selector Box */}
            <div
              className={`p-3 rounded-xl border transition-all ${
                !isTeamActive
                  ? 'border-cyan-400 ring-2 ring-cyan-400/25 bg-cyan-500/5'
                  : 'border-[var(--glass-border)] bg-[var(--input-bg)]/75'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-[var(--text-primary)]">
                  <KeyIcon size={13} className={!isTeamActive ? 'text-cyan-400' : 'text-[var(--text-secondary)]'} />
                  <span>{t('nodePermissions.operatorScopeLabel', 'Individual Operator Exception')}</span>
                </span>
                {!isTeamActive && (
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-400 text-black font-bold">
                    {t('nodePermissions.activeScopeBadge', 'Editing')}
                  </span>
                )}
              </div>
              <select
                value={selectedUserId}
                onChange={(e) => handleSelectOperator(Number(e.target.value))}
                className={`w-full bg-[var(--bg-card)] border rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none ${
                  !isTeamActive ? 'border-cyan-400/60' : 'border-[var(--glass-border)]'
                }`}
              >
                <option value={0} className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                  — {t('nodePermissions.noOperatorSelected', 'Team policy (no individual override)')} —
                </option>
                {sortedOperators.reachable.map((op) => {
                  const cnt = overrideCounts.users?.[String(op.id)] || 0;
                  return (
                    <option key={op.id} value={op.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                      @{op.username}
                      {cnt > 0 ? ` (${cnt})` : ''}
                    </option>
                  );
                })}
                {sortedOperators.unreachable.map((op) => (
                  <option
                    key={op.id}
                    value={op.id}
                    disabled
                    className="bg-[var(--bg-card)] text-[var(--text-secondary)] opacity-40"
                  >
                    @{op.username} — ({t('nodePermissions.noGroupAccess', 'no group access')})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Context Banner */}
          <div
            className={`px-3.5 py-2 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 ${
              isTeamActive
                ? 'bg-brand-lime/10 border-brand-lime/30 text-[var(--text-primary)]'
                : 'bg-cyan-500/10 border-cyan-400/30 text-[var(--text-primary)]'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isTeamActive ? (
                <>
                  <UsersIcon size={14} className="text-brand-lime shrink-0" />
                  <span className="truncate">
                    {selectedTeam
                      ? t(
                          'nodePermissions.teamBanner',
                          'Editing rules for team "{{name}}" on this appliance ({{count}} member(s)).',
                          { name: selectedTeam.name, count: selectedTeam.members?.length || 0 }
                        )
                      : t('nodePermissions.noTeams', 'No teams available')}
                  </span>
                </>
              ) : (
                <>
                  <KeyIcon size={14} className="text-cyan-400 shrink-0" />
                  <span className="truncate">
                    {selectedOperator &&
                      t(
                        'nodePermissions.operatorBanner',
                        'Editing individual exceptions for @{{username}} · Inherits from: {{teams}}',
                        {
                          username: selectedOperator.username,
                          teams:
                            subjectTeams.length > 0
                              ? subjectTeams.map((tm) => tm.name).join(', ')
                              : t('teams.defaultTemplateBadge', 'Default Template'),
                        }
                      )}
                  </span>
                </>
              )}
            </div>
            {!isTeamActive && node.group_id === null && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-amber-400">
                <AlertTriangleIcon size={12} />
                {t('nodePermissions.ungroupedWarning', 'Appliance has no group assigned')}
              </span>
            )}
          </div>

          {/* 3 Context-Separating Tabs */}
          <div className="flex items-center gap-2 pt-0.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('domains')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'domains'
                  ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <span>{t('nodePermissions.tabModulesAndTypes', 'Modules & Types')}</span>
              {tabCounts.domains > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${activeBadgeClass}`}>
                  {tabCounts.domains}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('services')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'services'
                  ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <span>
                {t('nodePermissions.servicesCatalog', 'Services')} ({catalog?.services?.length || 0})
              </span>
              {tabCounts.services > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${activeBadgeClass}`}>
                  {tabCounts.services}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                activeTab === 'tasks'
                  ? 'bg-brand-lime/15 text-brand-lime border-brand-lime/30'
                  : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)] hover:bg-white/5'
              }`}
            >
              <span>
                {t('nodePermissions.tasksCatalog', 'Scheduled Tasks')} ({catalog?.tasks?.length || 0})
              </span>
              {tabCounts.tasks > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${activeBadgeClass}`}>
                  {tabCounts.tasks}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Single Scrollable Body (Zero Nested Scroll) */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
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

          {!activeSubjectId || isLoadingPerms ? (
            <div className="py-12 text-center text-xs text-[var(--text-secondary)] font-mono">
              {isLoadingPerms
                ? t('common.loading', 'Loading...')
                : t('nodePermissions.selectSubjectPrompt', 'Select a team or operator to configure appliance rules.')}
            </div>
          ) : activeTab === 'domains' ? (
            <div className="space-y-5">
              {/* 1. Domain & Process Default */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('nodePermissions.domainOverrides', 'Module & Default Overrides')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {DOMAIN_KEYS.map((dk) => {
                    const val = getOverrideVal('domain', dk);
                    const isOverridden = val !== 'inherit';
                    const inherited = getDomainInherited(dk);
                    const displayLevel = isOverridden ? (val as CapabilityLevel) : inherited.level;
                    return (
                      <div
                        key={dk}
                        className={`p-3 rounded-xl border transition-colors space-y-2 ${
                          isOverridden
                            ? activeAccentCardClass
                            : 'bg-[var(--input-bg)] border-[var(--glass-border)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[var(--text-primary)] capitalize">
                            {t(`rbac.domains.${dk}`, dk)}
                          </span>
                          <div className="flex items-center gap-1">
                            {isOverridden ? (
                              <>
                                <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${activeBadgeClass}`}>
                                  {t('nodePermissions.overrideBadge', 'Override')}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setOverride('domain', dk, 'inherit')}
                                  title={t('nodePermissions.resetToInherited', 'Reset to inherited')}
                                  className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                                >
                                  ↺
                                </button>
                              </>
                            ) : (
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${levelBadgeClass(displayLevel)}`}>
                                {displayLevel}
                              </span>
                            )}
                          </div>
                        </div>
                        <select
                          value={val}
                          onChange={(e) => setOverride('domain', dk, e.target.value)}
                          className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-lime"
                        >
                          <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                            {formatInheritedLabel(inherited.level, inherited.source)}
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

                  {/* Processes Default */}
                  {(() => {
                    const val = getOverrideVal('process_type', 'default');
                    const isOverridden = val !== 'inherit';
                    const inherited = getProcDefaultInherited();
                    const displayLevel = isOverridden ? (val as CapabilityLevel) : inherited.level;
                    return (
                      <div
                        className={`p-3 rounded-xl border transition-colors space-y-2 ${
                          isOverridden
                            ? activeAccentCardClass
                            : 'bg-[var(--input-bg)] border-[var(--glass-border)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[var(--text-primary)]">
                            {t('rbac.processesDefault', 'Processes Default')}
                          </span>
                          <div className="flex items-center gap-1">
                            {isOverridden ? (
                              <>
                                <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${activeBadgeClass}`}>
                                  {t('nodePermissions.overrideBadge', 'Override')}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setOverride('process_type', 'default', 'inherit')}
                                  title={t('nodePermissions.resetToInherited', 'Reset to inherited')}
                                  className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                                >
                                  ↺
                                </button>
                              </>
                            ) : (
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${levelBadgeClass(displayLevel)}`}>
                                {displayLevel}
                              </span>
                            )}
                          </div>
                        </div>
                        <select
                          value={val}
                          onChange={(e) => setOverride('process_type', 'default', e.target.value)}
                          className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-lime"
                        >
                          <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                            {formatInheritedLabel(inherited.level, inherited.source)}
                          </option>
                          {CAPABILITY_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                              {t(`rbac.levels.${lvl}`, lvl)}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* 2. By Process Type */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  {t('nodePermissions.processTypeOverrides', 'Service & Task Type Overrides')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {PROCESS_TYPE_KEYS.map((pt) => {
                    const val = getOverrideVal('process_type', pt);
                    const isOverridden = val !== 'inherit';
                    const inherited = getProcTypeInherited(pt);
                    const displayLevel = isOverridden ? (val as CapabilityLevel) : inherited.level;
                    return (
                      <div
                        key={pt}
                        className={`p-2.5 rounded-xl border transition-colors space-y-1.5 ${
                          isOverridden
                            ? activeAccentCardClass
                            : 'bg-[var(--input-bg)] border-[var(--glass-border)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <label className="text-[11px] font-mono font-semibold text-[var(--text-primary)] truncate" title={pt}>
                            {t(`rbac.processTypes.${pt}`, pt)}
                          </label>
                          {isOverridden ? (
                            <button
                              type="button"
                              onClick={() => setOverride('process_type', pt, 'inherit')}
                              title={t('nodePermissions.resetToInherited', 'Reset to inherited')}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0"
                            >
                              ↺
                            </button>
                          ) : (
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${levelBadgeClass(displayLevel)}`}>
                              {displayLevel}
                            </span>
                          )}
                        </div>
                        <select
                          value={val}
                          onChange={(e) => setOverride('process_type', pt, e.target.value)}
                          className="w-full bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-lime"
                        >
                          <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                            {formatInheritedLabel(inherited.level, inherited.source)}
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
            </div>
          ) : activeTab === 'services' ? (
            <div className="space-y-3">
              {/* Filter Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    placeholder={t('nodePermissions.searchServicesPlaceholder', 'Filter services by name, ID, or type...')}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl pl-8 pr-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setOnlyOverridesFilter((v) => !v)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer shrink-0 ${
                    onlyOverridesFilter
                      ? activeBadgeClass
                      : 'bg-[var(--input-bg)] border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t('nodePermissions.onlyOverrides', 'Only Overrides')} ({tabCounts.services})
                </button>
              </div>

              {catalogLoading ? (
                <p className="text-xs text-[var(--text-secondary)] font-mono py-6 text-center">
                  {t('common.loading', 'Loading...')}
                </p>
              ) : filteredServices.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)] italic py-8 text-center">
                  {catalog?.services?.length === 0
                    ? t('nodePermissions.noServicesInCatalog', 'No services reported by appliance.')
                    : t('nodePermissions.noMatchingItems', 'No matching items found.')}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredServices.map((svc) => {
                    const sid = String(svc.id);
                    const consumers = implicitMonitors[sid] || [];
                    const val = getOverrideVal('service', sid);
                    const isOverridden = val !== 'inherit';
                    const inherited = getServiceInherited(sid, svc.service_type);
                    const effectiveLevel = isOverridden ? (val as CapabilityLevel) : inherited.level;
                    const autoMonitored = consumers.length > 0 && LEVEL_RANK[effectiveLevel] < LEVEL_RANK.monitor;

                    return (
                      <div
                        key={sid}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isOverridden
                            ? activeAccentCardClass
                            : 'bg-[var(--input-bg)] border-[var(--glass-border)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {svc.alias || svc.name}
                            </span>
                            {isOverridden ? (
                              <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${activeBadgeClass}`}>
                                {t('nodePermissions.overrideBadge', 'Override')}
                              </span>
                            ) : (
                              <span
                                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${levelBadgeClass(
                                  autoMonitored ? 'monitor' : effectiveLevel
                                )}`}
                              >
                                {autoMonitored ? 'monitor' : effectiveLevel}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            <span className="text-[10px] font-mono text-[var(--text-secondary)]">
                              #{sid} · {svc.service_type}
                            </span>
                            {consumers.length > 0 && (
                              <span
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                                title={consumers.join(', ')}
                              >
                                🔗{' '}
                                {t('nodePermissions.autoMonitorVia', 'Auto-Monitor (via {{consumer}})', {
                                  consumer: consumers[0],
                                })}
                                {consumers.length > 1 ? ` +${consumers.length - 1}` : ''}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            value={val}
                            onChange={(e) => setOverride('service', sid, e.target.value)}
                            className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-lime min-w-[230px]"
                          >
                            <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                              {formatInheritedLabel(inherited.level, inherited.source)}
                            </option>
                            {CAPABILITY_LEVELS.map((lvl) => (
                              <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                                {t(`rbac.levels.${lvl}`, lvl)}
                              </option>
                            ))}
                          </select>
                          {isOverridden && (
                            <button
                              type="button"
                              onClick={() => setOverride('service', sid, 'inherit')}
                              title={t('nodePermissions.resetToInherited', 'Reset to inherited')}
                              className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Filter Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    placeholder={t('nodePermissions.searchTasksPlaceholder', 'Filter tasks by name, ID, or schedule...')}
                    className="w-full bg-[var(--input-bg)] border border-[var(--glass-border)] rounded-xl pl-8 pr-3 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-brand-lime"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setOnlyOverridesFilter((v) => !v)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer shrink-0 ${
                    onlyOverridesFilter
                      ? activeBadgeClass
                      : 'bg-[var(--input-bg)] border-[var(--glass-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t('nodePermissions.onlyOverrides', 'Only Overrides')} ({tabCounts.tasks})
                </button>
              </div>

              {catalogLoading ? (
                <p className="text-xs text-[var(--text-secondary)] font-mono py-6 text-center">
                  {t('common.loading', 'Loading...')}
                </p>
              ) : filteredTasks.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary)] italic py-8 text-center">
                  {catalog?.tasks?.length === 0
                    ? t('nodePermissions.noTasksInCatalog', 'No tasks reported by appliance.')
                    : t('nodePermissions.noMatchingItems', 'No matching items found.')}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredTasks.map((tsk) => {
                    const tid = String(tsk.id);
                    const val = getOverrideVal('task', tid);
                    const isOverridden = val !== 'inherit';
                    const inherited = getTaskInherited(tid);
                    const effectiveLevel = isOverridden ? (val as CapabilityLevel) : inherited.level;

                    return (
                      <div
                        key={tid}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isOverridden
                            ? activeAccentCardClass
                            : 'bg-[var(--input-bg)] border-[var(--glass-border)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-[var(--text-primary)] truncate">
                              {tsk.alias || tsk.name}
                            </span>
                            {isOverridden ? (
                              <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${activeBadgeClass}`}>
                                {t('nodePermissions.overrideBadge', 'Override')}
                              </span>
                            ) : (
                              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${levelBadgeClass(effectiveLevel)}`}>
                                {effectiveLevel}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-[var(--text-secondary)] mt-1 truncate">
                            #{tid} · {tsk.schedule_type || 'task'}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            value={val}
                            onChange={(e) => setOverride('task', tid, e.target.value)}
                            className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-lime min-w-[230px]"
                          >
                            <option value="inherit" className="bg-[var(--bg-card)] text-[var(--text-secondary)]">
                              {formatInheritedLabel(inherited.level, inherited.source)}
                            </option>
                            {CAPABILITY_LEVELS.map((lvl) => (
                              <option key={lvl} value={lvl} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                                {t(`rbac.levels.${lvl}`, lvl)}
                              </option>
                            ))}
                          </select>
                          {isOverridden && (
                            <button
                              type="button"
                              onClick={() => setOverride('task', tid, 'inherit')}
                              title={t('nodePermissions.resetToInherited', 'Reset to inherited')}
                              className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--glass-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-mono text-[var(--text-secondary)]">
            {isDirty && (
              <span className={isTeamActive ? 'text-brand-lime' : 'text-cyan-400'}>
                ● {t('nodePermissions.unsavedChanges', 'Unsaved changes')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl bg-[var(--input-bg)] border border-[var(--glass-border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {t('common.close', 'Close')}
            </button>
            <button
              type="button"
              disabled={isSaving || !activeSubjectId}
              onClick={handleSave}
              className={`px-4 py-2 rounded-xl font-bold text-xs transition-all cursor-pointer disabled:opacity-50 ${
                isTeamActive
                  ? 'bg-brand-lime text-black hover:bg-brand-lime/90'
                  : 'bg-cyan-400 text-black hover:bg-cyan-300'
              }`}
            >
              {isSaving
                ? t('common.saving', 'Saving...')
                : isTeamActive
                ? t('nodePermissions.saveTeamButton', 'Save Rules for {{name}}', {
                    name: selectedTeam?.name || t('nodePermissions.targetTeam', 'Team'),
                  })
                : t('nodePermissions.saveOperatorButton', 'Save Exception for @{{username}}', {
                    username: selectedOperator?.username || '',
                  })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
