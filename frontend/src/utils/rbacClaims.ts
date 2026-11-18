export type CapabilityLevel = 'none' | 'monitor' | 'operate' | 'manage' | 'admin';

export type OverrideLevel = CapabilityLevel | 'inherit';

export const CAPABILITY_LEVELS: CapabilityLevel[] = [
  'none',
  'monitor',
  'operate',
  'manage',
  'admin',
];

export const DOMAIN_KEYS = ['dashboard', 'hardware', 'media', 'settings', 'forge'] as const;

export const PROCESS_TYPE_KEYS = [
  'ffmpeg_stream',
  'mediamtx_hub',
  'icecast_server',
  'desktop',
  'kiosk_browser',
  'pipewire_hub',
  'task',
] as const;

export interface TeamClaims {
  dashboard: CapabilityLevel;
  hardware: CapabilityLevel;
  media: CapabilityLevel;
  settings: CapabilityLevel;
  forge: CapabilityLevel;
  processes: {
    default: CapabilityLevel;
    by_type: Record<string, CapabilityLevel>;
  };
}

export const DEFAULT_CONSERVATIVE_CLAIMS: TeamClaims = {
  dashboard: 'monitor',
  hardware: 'none',
  media: 'monitor',
  settings: 'none',
  forge: 'none',
  processes: {
    default: 'none',
    by_type: {},
  },
};

export function normalizeClaims(raw: any): TeamClaims {
  const src = raw && typeof raw === 'object' ? raw : {};
  const procs = src.processes && typeof src.processes === 'object' ? src.processes : {};
  return {
    dashboard: CAPABILITY_LEVELS.includes(src.dashboard) ? src.dashboard : 'monitor',
    hardware: CAPABILITY_LEVELS.includes(src.hardware) ? src.hardware : 'none',
    media: CAPABILITY_LEVELS.includes(src.media) ? src.media : 'monitor',
    settings: CAPABILITY_LEVELS.includes(src.settings) ? src.settings : 'none',
    forge: CAPABILITY_LEVELS.includes(src.forge) ? src.forge : 'none',
    processes: {
      default: CAPABILITY_LEVELS.includes(procs.default) ? procs.default : 'none',
      by_type: procs.by_type && typeof procs.by_type === 'object' ? { ...procs.by_type } : {},
    },
  };
}

export function levelBadgeClass(level: string): string {
  switch (level) {
    case 'admin':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'manage':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'operate':
      return 'bg-brand-lime/15 text-brand-lime border-brand-lime/30';
    case 'monitor':
      return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
    case 'inherit':
      return 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--glass-border)] border-dashed';
    default:
      return 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--glass-border)] opacity-70';
  }
}
