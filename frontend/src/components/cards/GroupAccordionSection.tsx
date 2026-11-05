import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnrolledNode } from '../../types/hub';
import { NodeAccessCard } from './NodeAccessCard';
import { ChevronDownIcon, ChevronRightIcon, LayersIcon } from '../Icons';

interface GroupAccordionSectionProps {
  groupId: number | null;
  groupName: string;
  groupIcon?: string | null;
  nodes: EnrolledNode[];
  defaultExpanded?: boolean;
  onEditNode?: (node: EnrolledNode) => void;
  onDeleteNode?: (nodeId: string) => void;
  canManage?: boolean;
}

export const GroupAccordionSection: React.FC<GroupAccordionSectionProps> = ({
  groupId,
  groupName,
  groupIcon,
  nodes,
  defaultExpanded = true,
  onEditNode,
  onDeleteNode,
  canManage = false,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const totalCount = nodes.length;
  const onlineCount = nodes.filter((n) => n.vitality?.status === 'online').length;
  const degradedCount = nodes.filter((n) => n.vitality?.status === 'degraded').length;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-xl overflow-hidden shadow-xs transition-all mb-2.5">
      {/* Accordion Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-3.5 py-2 flex items-center justify-between cursor-pointer select-none bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-transform">
            {isExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
          </button>

          <div className="w-7 h-7 rounded-lg bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime text-xs font-bold shrink-0">
            {groupIcon ? (
              <img src={groupIcon} alt={groupName} className="w-4 h-4 object-contain" />
            ) : (
              <LayersIcon size={14} />
            )}
          </div>

          <div className="flex items-baseline gap-2">
            <h2 className="text-xs sm:text-sm font-bold text-[var(--text-primary)] tracking-wide">{groupName}</h2>
            <span className="text-[11px] text-[var(--text-secondary)] font-mono">
              ({totalCount} {totalCount === 1 ? t('common.node', 'appliance') : t('common.nodes', 'appliances')})
            </span>
          </div>
        </div>

        {/* Online / Offline Badges */}
        <div className="flex items-center gap-1.5">
          {onlineCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {onlineCount} {t('common.online', 'Online')}
            </span>
          )}
          {degradedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {degradedCount} {t('common.degraded', 'Degraded')}
            </span>
          )}
          {totalCount - onlineCount - degradedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              {totalCount - onlineCount - degradedCount} {t('common.offline', 'Offline')}
            </span>
          )}
        </div>
      </div>

      {/* Accordion Content */}
      {isExpanded && (
        <div className="p-2 border-t border-[var(--glass-border)] bg-black/10">
          {nodes.length === 0 ? (
            <div className="py-6 text-center text-xs text-[var(--text-secondary)] font-mono">
              {t('fleet.noNodesInGroup', 'No appliances currently registered in this group.')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {nodes.map((node) => (
                <NodeAccessCard
                  key={node.node_id}
                  node={node}
                  onEdit={onEditNode}
                  onDelete={onDeleteNode}
                  canManage={canManage}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
