"""Effective RBAC claims compiler translating CloudHub Teams and overrides into signed Edge claims."""

import copy
import json
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session

from backend.database.db import DEFAULT_CONSERVATIVE_SCOPES, ensure_default_team_for_org
from backend.database.models import (
    User,
    EnrolledNode,
    Team,
    TeamMember,
    NodePermissionOverride,
)
from backend.core.auth_manager import AuthManager, FULL_ADMIN_SCOPES

LEVEL_RANK: Dict[str, int] = {
    "none": 0,
    "monitor": 1,
    "operate": 2,
    "manage": 3,
    "admin": 4,
}

DOMAIN_KEYS = ("dashboard", "hardware", "media", "settings", "forge")


def normalize_level(level: Optional[str], fallback: str = "none") -> str:
    """Return a valid capability level name."""
    if isinstance(level, str):
        lvl = level.strip().lower()
        if lvl in LEVEL_RANK:
            return lvl
    return fallback


def max_level(a: Optional[str], b: Optional[str]) -> str:
    """Return the higher capability level between two level strings."""
    la = normalize_level(a)
    lb = normalize_level(b)
    return la if LEVEL_RANK[la] >= LEVEL_RANK[lb] else lb


def _empty_none_claims(username: str) -> Dict[str, Any]:
    return {
        "user": username,
        "channel": "cloudhub",
        "scopes": {
            "dashboard": "none",
            "hardware": "none",
            "media": "none",
            "settings": "none",
            "forge": "none",
            "processes": {
                "default": "none",
                "by_type": {},
                "services": {},
                "tasks": {},
            },
        },
    }


def parse_team_claims(raw_json: Optional[str]) -> Dict[str, Any]:
    """Parse team default_claims_json safely into normalized scopes dictionary."""
    base = copy.deepcopy(DEFAULT_CONSERVATIVE_SCOPES)
    if not raw_json:
        return base
    try:
        parsed = json.loads(raw_json)
        if not isinstance(parsed, dict):
            return base
        for dk in DOMAIN_KEYS:
            if dk in parsed:
                base[dk] = normalize_level(parsed[dk], base[dk])
        procs = parsed.get("processes")
        if isinstance(procs, dict):
            base["processes"]["default"] = normalize_level(procs.get("default"), "none")
            by_type = procs.get("by_type")
            if isinstance(by_type, dict):
                base["processes"]["by_type"] = {
                    str(k): normalize_level(v)
                    for k, v in by_type.items()
                    if isinstance(k, str)
                }
        return base
    except Exception:
        return base


def _apply_overrides(
    scopes: Dict[str, Any],
    overrides: List[NodePermissionOverride],
    merge_with_max: bool,
) -> None:
    """
    Apply NodePermissionOverride rows onto a scopes dict.
    When merge_with_max is True (merging multiple teams), combine values with max_level.
    When False (direct user overrides), directly overwrite target values.
    """
    staged_domain: Dict[str, str] = {}
    staged_proc_default: Optional[str] = None
    staged_by_type: Dict[str, str] = {}
    staged_services: Dict[str, str] = {}
    staged_tasks: Dict[str, str] = {}

    for ov in overrides:
        lvl = normalize_level(ov.level)
        if ov.scope_type == "domain":
            if ov.target_key in DOMAIN_KEYS:
                staged_domain[ov.target_key] = (
                    max_level(staged_domain.get(ov.target_key), lvl)
                    if merge_with_max and ov.target_key in staged_domain
                    else lvl
                )
            elif ov.target_key == "processes":
                staged_proc_default = (
                    max_level(staged_proc_default, lvl)
                    if merge_with_max and staged_proc_default is not None
                    else lvl
                )
        elif ov.scope_type == "process_type":
            if ov.target_key == "default":
                staged_proc_default = (
                    max_level(staged_proc_default, lvl)
                    if merge_with_max and staged_proc_default is not None
                    else lvl
                )
            else:
                staged_by_type[ov.target_key] = (
                    max_level(staged_by_type.get(ov.target_key), lvl)
                    if merge_with_max and ov.target_key in staged_by_type
                    else lvl
                )
        elif ov.scope_type == "service":
            staged_services[str(ov.target_key)] = (
                max_level(staged_services.get(str(ov.target_key)), lvl)
                if merge_with_max and str(ov.target_key) in staged_services
                else lvl
            )
        elif ov.scope_type == "task":
            staged_tasks[str(ov.target_key)] = (
                max_level(staged_tasks.get(str(ov.target_key)), lvl)
                if merge_with_max and str(ov.target_key) in staged_tasks
                else lvl
            )

    for dk, lvl in staged_domain.items():
        scopes[dk] = lvl
    if staged_proc_default is not None:
        scopes["processes"]["default"] = staged_proc_default
    for ptype, lvl in staged_by_type.items():
        scopes["processes"]["by_type"][ptype] = lvl
    for sid, lvl in staged_services.items():
        scopes["processes"]["services"][sid] = lvl
    for tid, lvl in staged_tasks.items():
        scopes["processes"]["tasks"][tid] = lvl


def get_user_effective_teams(db: Session, user: User, node: EnrolledNode) -> List[Team]:
    """Return the user's effective teams in node.org_id (falling back to default template)."""
    user_teams = (
        db.query(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .filter(TeamMember.user_id == user.id, Team.org_id == node.org_id)
        .all()
    )
    if not user_teams:
        default_team = ensure_default_team_for_org(db, node.org_id)
        user_teams = [default_team]
    return user_teams


def compile_effective_claims(
    db: Session,
    user: Optional[User],
    node: EnrolledNode,
    include_user_overrides: bool = True,
) -> Dict[str, Any]:
    """
    Compile the canonical capability claims dictionary for `(user, node)`:
    1. superadmin / org_admin -> FULL_ADMIN_SCOPES.
    2. Layer 1 reachability gate (`AuthManager.can_user_access_node`).
    3. Union of user's Teams in `node.org_id` via `max_level` (fallback: default template).
    4. Per-node Team overrides replace team defaults for the specified target keys.
    5. Per-node User overrides take highest precedence when `include_user_overrides` is True.
    """
    if not user:
        return _empty_none_claims("anonymous")

    if user.role == "superadmin" or (user.role == "org_admin" and user.org_id == node.org_id):
        return {
            "user": user.username,
            "channel": "cloudhub",
            "scopes": copy.deepcopy(FULL_ADMIN_SCOPES),
        }

    if not AuthManager.can_user_access_node(db, user, node):
        return _empty_none_claims(user.username)

    user_teams = get_user_effective_teams(db, user, node)

    # Merge team base policies using max_level across teams
    merged_scopes = _empty_none_claims(user.username)["scopes"]
    is_first = True
    for tm in user_teams:
        parsed = parse_team_claims(tm.default_claims_json)
        if is_first:
            merged_scopes = parsed
            is_first = False
        else:
            for dk in DOMAIN_KEYS:
                merged_scopes[dk] = max_level(merged_scopes.get(dk), parsed.get(dk))
            merged_scopes["processes"]["default"] = max_level(
                merged_scopes["processes"].get("default"),
                parsed["processes"].get("default"),
            )
            for ptype, lvl in parsed["processes"].get("by_type", {}).items():
                cur = merged_scopes["processes"]["by_type"].get(ptype, "none")
                merged_scopes["processes"]["by_type"][ptype] = max_level(cur, lvl)

    team_ids = [t.id for t in user_teams]
    node_overrides = (
        db.query(NodePermissionOverride)
        .filter(NodePermissionOverride.node_id == node.node_id)
        .all()
    )

    team_overrides = [ov for ov in node_overrides if ov.team_id in team_ids and ov.user_id is None]
    if team_overrides:
        _apply_overrides(merged_scopes, team_overrides, merge_with_max=True)

    if include_user_overrides:
        user_overrides = [ov for ov in node_overrides if ov.user_id == user.id]
        if user_overrides:
            _apply_overrides(merged_scopes, user_overrides, merge_with_max=False)

    return {
        "user": user.username,
        "channel": "cloudhub",
        "scopes": merged_scopes,
    }


def is_restricted_claims(claims: Dict[str, Any]) -> bool:
    """Return True unless every domain and default process permission is 'admin' with no downgrades."""
    scopes = claims.get("scopes") or {}
    for dk in DOMAIN_KEYS:
        if normalize_level(scopes.get(dk)) != "admin":
            return True
    procs = scopes.get("processes") or {}
    if normalize_level(procs.get("default")) != "admin":
        return True
    for map_key in ("by_type", "services", "tasks"):
        for lvl in (procs.get(map_key) or {}).values():
            if normalize_level(lvl) != "admin":
                return True
    return False
