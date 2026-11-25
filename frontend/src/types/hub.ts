export type UserRole = 'superadmin' | 'org_admin' | 'group_operator' | 'tenant_admin' | 'operator';
export type VitalityStatus = 'online' | 'degraded' | 'offline' | 'unlinked';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  org_id: number | null;
  org_name?: string;
  org_icon?: string | null;
  group_ids?: number[];
  group_names?: string[];
  groups?: Array<{ id: number; name: string }>;
  all_groups_access?: boolean;
  include_ungrouped?: boolean;
  created_at?: string;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  icon_data?: string | null;
  groups_count?: number;
  nodes_count?: number;
  users_count?: number;
  created_at?: string;
}

export interface NodeGroup {
  id: number;
  org_id: number;
  org_name?: string;
  name: string;
  icon_data?: string | null;
  nodes_count?: number;
  created_at?: string;
}

export interface NodeVitality {
  status: VitalityStatus;
  last_seen_seconds_ago?: number | null;
  system: {
    cpu_percent?: number;
    memory_percent?: number;
    disk_percent?: number;
    uptime_seconds?: number;
  };
  workload: {
    total_services?: number;
    services_running?: number;
    services_error?: number;
    total_tasks?: number;
    tasks_running?: number;
  };
  lcd?: {
    enabled?: boolean;
    connected?: boolean;
    alias?: string | null;
    model?: string;
    locator_active?: boolean;
    leds?: string[];
  };
  version?: {
    current?: string | null;
    latest_upstream?: string | null;
    update_available?: boolean;
  };
}

export interface EnrolledNode {
  id: number;
  node_id: string;
  name: string;
  org_id: number;
  group_id: number | null;
  icon_data?: string | null;
  current_version?: string | null;
  last_seen_at?: string | null;
  vitality: NodeVitality;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  org_id?: number | null;
  node_id?: string | null;
  channel?: string | null;
  username: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  ip_address?: string | null;
  details?: string | null;
}


export interface SslStatus {
  status: 'valid' | 'warning' | 'critical' | 'expired' | 'missing' | 'disabled' | 'error';
  valid: boolean;
  days_remaining: number;
  domain: string | null;
  issuer: string | null;
  expires_at: string | null;
  mode: string;
  error: string | null;
  http_port?: number;
  https_port?: number;
  ssl_enabled?: boolean;
  force_https_redirect?: boolean;
  listen_port?: number;
  listen_scheme?: string;
}

export interface TeamMemberSummary {
  id: number;
  username: string;
}

export interface Team {
  id: number;
  org_id: number;
  name: string;
  description?: string | null;
  is_default_template: boolean;
  default_claims: Record<string, any>;
  member_user_ids: number[];
  members: TeamMemberSummary[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface NodePermissionOverride {
  id?: number;
  node_id?: string;
  team_id?: number | null;
  user_id?: number | null;
  scope_type: 'domain' | 'process_type' | 'service' | 'task';
  target_key: string;
  level: 'none' | 'monitor' | 'operate' | 'manage' | 'admin';
}

export interface NodeCatalogService {
  id: number | string;
  name: string;
  alias?: string | null;
  service_type: string;
  status?: string;
  dependencies?: Array<number | string>;
}

export interface NodeCatalogTask {
  id: number | string;
  name: string;
  alias?: string | null;
  command?: string;
  schedule_type?: string;
}

export interface NodeCatalogResponse {
  node_id: string;
  offline: boolean;
  cached: boolean;
  fetched_at?: number | null;
  services: NodeCatalogService[];
  tasks: NodeCatalogTask[];
  implicit_monitors: Record<string, string[]>;
  orphaned_overrides: NodePermissionOverride[];
}

export interface SubjectTeamSummary {
  id: number;
  name: string;
  is_default_template: boolean;
}

export interface NodePermissionsResponse {
  node_id: string;
  overrides: NodePermissionOverride[];
  compiled_preview?: Record<string, any> | null;
  inherited_preview?: Record<string, any> | null;
  subject_teams?: SubjectTeamSummary[];
  override_counts?: {
    teams: Record<string, number>;
    users: Record<string, number>;
  };
}
