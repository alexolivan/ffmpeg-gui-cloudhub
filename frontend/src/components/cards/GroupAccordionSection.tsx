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
    <div className="bg-[var(--bg-card)] border border-[var(--glass-border)] rounded-2xl overflow-hidden shadow-sm transition-all mb-4">
      {/* Accordion Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-5 py-4 flex items-center justify-between cursor-pointer select-none bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-3">
          <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-transform">
            {isExpanded ? <ChevronDownIcon size={18} /> : <ChevronRightIcon size={18} />}
          </button>

          <div className="w-8 h-8 rounded-xl bg-brand-lime/10 border border-brand-lime/20 flex items-center justify-center text-brand-lime text-xs font-bold">
            {groupIcon ? (
              <img src={groupIcon} alt={groupName} className="w-5 h-5 object-contain" />
            ) : (
              <LayersIcon size={16} />
            )}
          </div>

          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-wide">{groupName}</h2>
            <span className="text-xs text-[var(--text-secondary)] font-mono">
              ({totalCount} {totalCount === 1 ? t('common.node', 'appliance') : t('common.nodes', 'appliances')})
            </span>
          </div>
        </div>

        {/* Online / Offline Badges */}
        <div className="flex items-center gap-2">
          {onlineCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              {onlineCount} {t('common.online', 'Online')}
            </span>
          )}
          {degradedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {degradedCount} {t('common.degraded', 'Degraded')}
            </span>
          )}
          {totalCount - onlineCount - degradedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
              {totalCount - onlineCount - degradedCount} {t('common.offline', 'Offline')}
            </span>
          )}
        </div>
      </div>

      {/* Accordion Content */}
      {isExpanded && (
        <div className="p-5 border-t border-[var(--glass-border)] bg-black/10">
          {nodes.length === 0 ? (
            <div className="py-8 text-center text-xs text-[var(--text-secondary)] font-mono">
              {t('fleet.noNodesInGroup', 'No appliances currently registered in this group.')}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
