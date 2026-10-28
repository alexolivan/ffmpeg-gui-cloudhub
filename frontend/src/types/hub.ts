export type UserRole = 'superadmin' | 'org_admin' | 'group_operator' | 'tenant_admin' | 'operator';
export type VitalityStatus = 'online' | 'degraded' | 'offline';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  org_id: number | null;
  group_ids?: number[];
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
}
