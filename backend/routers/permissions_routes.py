"""RBAC Teams, policy templates, per-appliance overrides, and live edge catalog API routes."""

import copy
import json
import time
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database.db import (
    get_db,
    ensure_default_team_for_org,
    DEFAULT_CONSERVATIVE_SCOPES,
)
from backend.database.models import (
    User,
    Organization,
    EnrolledNode,
    Team,
    TeamMember,
    NodePermissionOverride,
    AuditLog,
)
from backend.core.auth_manager import AuthManager, FULL_ADMIN_SCOPES
from backend.core.permissions_compiler import (
    DOMAIN_KEYS,
    LEVEL_RANK,
    compile_effective_claims,
    normalize_level,
    parse_team_claims,
)
from backend.core.tunnel_server import tunnel_server
from backend.routers.auth_routes import get_current_user

logger = logging.getLogger("cloudhub.api.permissions")
router = APIRouter(prefix="/api/hub", tags=["permissions"])

# In-memory cache of last known remote appliance catalog: node_id -> {"catalog": ..., "fetched_at": float}
_NODE_CATALOG_CACHE: Dict[str, Dict[str, Any]] = {}


def _require_org_admin_or_superadmin(current_user: User, target_org_id: int) -> None:
    if current_user.role == "superadmin":
        return
    if current_user.role == "org_admin" and current_user.org_id == target_org_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied: tenant administrator or superadmin role required",
    )


def _sanitize_claims_payload(raw_claims: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    scopes = copy.deepcopy(DEFAULT_CONSERVATIVE_SCOPES)
    if not isinstance(raw_claims, dict):
        return scopes
    for dk in DOMAIN_KEYS:
        if dk in raw_claims:
            scopes[dk] = normalize_level(raw_claims[dk], scopes[dk])
    procs = raw_claims.get("processes")
    if isinstance(procs, dict):
        scopes["processes"]["default"] = normalize_level(procs.get("default"), "none")
        by_type = procs.get("by_type")
        if isinstance(by_type, dict):
            scopes["processes"]["by_type"] = {
                str(k): normalize_level(v)
                for k, v in by_type.items()
                if isinstance(k, str)
            }
    return scopes


class TeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    description: Optional[str] = None
    default_claims: Optional[Dict[str, Any]] = None
    member_user_ids: Optional[List[int]] = None


class TeamUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    description: Optional[str] = None
    default_claims: Optional[Dict[str, Any]] = None
    member_user_ids: Optional[List[int]] = None


class TeamMembersUpdateRequest(BaseModel):
    member_user_ids: List[int] = Field(default_factory=list)


class NodeOverrideItem(BaseModel):
    scope_type: str = Field(..., pattern="^(domain|process_type|service|task)$")
    target_key: str = Field(..., min_length=1, max_length=64)
    level: str = Field(..., pattern="^(none|monitor|operate|manage|admin)$")


class NodePermissionsPutRequest(BaseModel):
    team_id: Optional[int] = None
    user_id: Optional[int] = None
    overrides: List[NodeOverrideItem] = Field(default_factory=list)


def _serialize_team(team: Team, db: Session) -> Dict[str, Any]:
    member_rows = (
        db.query(User.id, User.username)
        .join(TeamMember, TeamMember.user_id == User.id)
        .filter(TeamMember.team_id == team.id)
        .order_by(User.username)
        .all()
    )
    return {
        "id": team.id,
        "org_id": team.org_id,
        "name": team.name,
        "description": team.description,
        "is_default_template": bool(team.is_default_template),
        "default_claims": parse_team_claims(team.default_claims_json),
        "member_user_ids": [r.id for r in member_rows],
        "members": [{"id": r.id, "username": r.username} for r in member_rows],
        "created_at": team.created_at.isoformat() if team.created_at else None,
        "updated_at": team.updated_at.isoformat() if team.updated_at else None,
    }


def _sync_team_members(db: Session, team: Team, user_ids: List[int]) -> None:
    db.query(TeamMember).filter(TeamMember.team_id == team.id).delete()
    if not user_ids:
        return
    valid_users = (
        db.query(User)
        .filter(
            User.id.in_(set(user_ids)),
            User.org_id == team.org_id,
            User.role == "group_operator",
        )
        .all()
    )
    for u in valid_users:
        db.add(TeamMember(team_id=team.id, user_id=u.id))


# =========================================================================
# Teams & Capability Policies CRUD
# =========================================================================

@router.get("/orgs/{org_id}/teams")
def list_org_teams(
    org_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_org_admin_or_superadmin(current_user, org_id)
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    ensure_default_team_for_org(db, org_id)
    db.commit()

    teams = (
        db.query(Team)
        .filter(Team.org_id == org_id)
        .order_by(Team.is_default_template.desc(), Team.name.asc())
        .all()
    )
    return [_serialize_team(t, db) for t in teams]


@router.post("/orgs/{org_id}/teams")
def create_org_team(
    org_id: int,
    req: TeamCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_org_admin_or_superadmin(current_user, org_id)
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    sanitized = _sanitize_claims_payload(req.default_claims)
    team = Team(
        org_id=org_id,
        name=req.name.strip(),
        description=req.description,
        is_default_template=False,
        default_claims_json=json.dumps(sanitized),
    )
    db.add(team)
    db.flush()

    if req.member_user_ids is not None:
        _sync_team_members(db, team, req.member_user_ids)

    db.add(
        AuditLog(
            username=current_user.username,
            org_id=org_id,
            action="CREATE_TEAM",
            target_type="team",
            target_id=str(team.id),
            details=f"Created team '{team.name}' in org #{org_id}",
        )
    )
    db.commit()
    db.refresh(team)
    return {"status": "ok", "team": _serialize_team(team, db)}


@router.put("/teams/{team_id}")
def update_team(
    team_id: int,
    req: TeamUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    _require_org_admin_or_superadmin(current_user, team.org_id)

    if req.name is not None:
        team.name = req.name.strip()
    if req.description is not None:
        team.description = req.description
    if req.default_claims is not None:
        sanitized = _sanitize_claims_payload(req.default_claims)
        team.default_claims_json = json.dumps(sanitized)
    if req.member_user_ids is not None:
        _sync_team_members(db, team, req.member_user_ids)

    db.add(
        AuditLog(
            username=current_user.username,
            org_id=team.org_id,
            action="UPDATE_TEAM",
            target_type="team",
            target_id=str(team.id),
            details=f"Updated team policy '{team.name}'",
        )
    )
    db.commit()
    db.refresh(team)
    return {"status": "ok", "team": _serialize_team(team, db)}


@router.put("/teams/{team_id}/members")
def update_team_members(
    team_id: int,
    req: TeamMembersUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    _require_org_admin_or_superadmin(current_user, team.org_id)

    _sync_team_members(db, team, req.member_user_ids)
    db.commit()
    return {"status": "ok", "team": _serialize_team(team, db)}


@router.delete("/teams/{team_id}")
def delete_team(
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    _require_org_admin_or_superadmin(current_user, team.org_id)

    if team.is_default_template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Default conservative operator template cannot be deleted",
        )

    org_id = team.org_id
    team_name = team.name
    db.delete(team)
    db.flush()

    # Guarantee no group_operator becomes teamless
    ensure_default_team_for_org(db, org_id)

    db.add(
        AuditLog(
            username=current_user.username,
            org_id=org_id,
            action="DELETE_TEAM",
            target_type="team",
            target_id=str(team_id),
            details=f"Deleted team '{team_name}'",
        )
    )
    db.commit()
    return {"status": "ok"}


# =========================================================================
# Per-Node Permission Overrides & Live Edge Catalog
# =========================================================================

def _get_authorized_node(db: Session, current_user: User, node_id: str) -> EnrolledNode:
    node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")
    _require_org_admin_or_superadmin(current_user, node.org_id)
    return node


def _serialize_override(ov: NodePermissionOverride) -> Dict[str, Any]:
    return {
        "id": ov.id,
        "node_id": ov.node_id,
        "team_id": ov.team_id,
        "user_id": ov.user_id,
        "scope_type": ov.scope_type,
        "target_key": ov.target_key,
        "level": ov.level,
    }


@router.get("/nodes/{node_id}/permissions")
def get_node_permissions(
    node_id: str,
    user_id: Optional[int] = Query(None),
    team_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = _get_authorized_node(db, current_user, node_id)
    query = db.query(NodePermissionOverride).filter(NodePermissionOverride.node_id == node.node_id)
    if team_id is not None:
        query = query.filter(NodePermissionOverride.team_id == team_id)
    if user_id is not None:
        query = query.filter(NodePermissionOverride.user_id == user_id)

    overrides = query.all()
    compiled_preview = None
    if user_id is not None:
        target_user = db.query(User).filter(User.id == user_id, User.org_id == node.org_id).first()
        if target_user:
            compiled_preview = compile_effective_claims(db, target_user, node)

    return {
        "node_id": node.node_id,
        "overrides": [_serialize_override(ov) for ov in overrides],
        "compiled_preview": compiled_preview,
    }


@router.put("/nodes/{node_id}/permissions")
def put_node_permissions(
    node_id: str,
    req: NodePermissionsPutRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = _get_authorized_node(db, current_user, node_id)
    if (req.team_id is None) == (req.user_id is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Exactly one of 'team_id' or 'user_id' must be provided",
        )

    if req.team_id is not None:
        team = db.query(Team).filter(Team.id == req.team_id, Team.org_id == node.org_id).first()
        if not team:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found in node organization")
        db.query(NodePermissionOverride).filter(
            NodePermissionOverride.node_id == node.node_id,
            NodePermissionOverride.team_id == team.id,
            NodePermissionOverride.user_id.is_(None),
        ).delete()
    else:
        target_user = db.query(User).filter(User.id == req.user_id, User.org_id == node.org_id).first()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in node organization")
        db.query(NodePermissionOverride).filter(
            NodePermissionOverride.node_id == node.node_id,
            NodePermissionOverride.user_id == target_user.id,
        ).delete()

    for item in req.overrides:
        db.add(
            NodePermissionOverride(
                node_id=node.node_id,
                team_id=req.team_id,
                user_id=req.user_id,
                scope_type=item.scope_type,
                target_key=item.target_key.strip(),
                level=normalize_level(item.level),
            )
        )

    db.add(
        AuditLog(
            username=current_user.username,
            org_id=node.org_id,
            node_id=node.node_id,
            action="UPDATE_NODE_PERMISSIONS",
            target_type="node",
            target_id=node.node_id,
            details=(
                f"Updated {len(req.overrides)} overrides on node '{node.name}' "
                f"({'team:' + str(req.team_id) if req.team_id else 'user:' + str(req.user_id)})"
            ),
        )
    )
    db.commit()

    saved = (
        db.query(NodePermissionOverride)
        .filter(
            NodePermissionOverride.node_id == node.node_id,
            NodePermissionOverride.team_id == req.team_id if req.team_id is not None else NodePermissionOverride.user_id == req.user_id,
        )
        .all()
    )
    return {"status": "ok", "overrides": [_serialize_override(ov) for ov in saved]}


def _compute_implicit_monitors(services: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """Map provider service IDs to consumer names relying on them."""
    svc_names: Dict[str, str] = {
        str(s.get("id")): (s.get("alias") or s.get("name") or f"Service #{s.get('id')}")
        for s in services
        if s.get("id") is not None
    }
    providers: Dict[str, List[str]] = {}
    for s in services:
        cid = str(s.get("id"))
        cname = svc_names.get(cid, f"Service #{cid}")
        for dep_id in s.get("dependencies") or []:
            pid = str(dep_id)
            if pid == cid:
                continue
            lst = providers.setdefault(pid, [])
            if cname not in lst:
                lst.append(cname)
    return providers


@router.get("/nodes/{node_id}/catalog")
async def get_node_catalog(
    node_id: str,
    refresh: bool = Query(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = _get_authorized_node(db, current_user, node_id)

    catalog: Optional[Dict[str, Any]] = None
    cached_flag = False
    offline_flag = not tunnel_server.is_connected(node.node_id)
    cached_rec = _NODE_CATALOG_CACHE.get(node.node_id)

    if cached_rec and offline_flag:
        catalog = cached_rec["catalog"]
        cached_flag = True

    if not offline_flag:
        admin_claims = {
            "user": current_user.username,
            "channel": "cloudhub",
            "scopes": copy.deepcopy(FULL_ADMIN_SCOPES),
        }
        sso_assertion = AuthManager.create_sso_assertion(
            node_id=node.node_id,
            tunnel_secret=node.tunnel_secret,
            username=current_user.username,
            ttl_seconds=60,
        )
        authz_assertion = AuthManager.create_authz_assertion(
            node_id=node.node_id,
            tunnel_secret=node.tunnel_secret,
            username=current_user.username,
            claims=admin_claims,
            ttl_seconds=60,
        )
        try:
            status_code, _headers, is_stream, body_or_stream = await tunnel_server.forward_http_stream(
                node_id=node.node_id,
                method="GET",
                path="/api/cloudhub/catalog",
                query="",
                headers={"accept": "application/json"},
                body=b"",
                sso_assertion=sso_assertion,
                timeout=10.0,
                authz_assertion=authz_assertion,
            )
            if is_stream:
                chunks = []
                async for ch in body_or_stream:
                    chunks.append(ch)
                raw_bytes = b"".join(chunks)
            else:
                raw_bytes = body_or_stream or b""

            if status_code == 200 and raw_bytes:
                catalog = json.loads(raw_bytes.decode("utf-8"))
                _NODE_CATALOG_CACHE[node.node_id] = {
                    "catalog": catalog,
                    "fetched_at": time.time(),
                }
                cached_flag = False
        except Exception as err:
            logger.debug("Live catalog fetch failed for node '%s': %s", node_id, err)

    if catalog is None and cached_rec:
        catalog = cached_rec["catalog"]
        cached_flag = True

    if catalog is None:
        catalog = {"services": [], "tasks": []}

    services = catalog.get("services") or []
    tasks = catalog.get("tasks") or []
    live_service_ids = {str(s.get("id")) for s in services if s.get("id") is not None}
    live_task_ids = {str(t.get("id")) for t in tasks if t.get("id") is not None}

    overrides = (
        db.query(NodePermissionOverride)
        .filter(NodePermissionOverride.node_id == node.node_id)
        .all()
    )
    orphaned = []
    # Check orphans only if we actually retrieved a catalog (live or cached) or node is connected
    if services or tasks or (not offline_flag and not cached_flag):
        for ov in overrides:
            if ov.scope_type == "service" and ov.target_key not in live_service_ids:
                orphaned.append(_serialize_override(ov))
            elif ov.scope_type == "task" and ov.target_key not in live_task_ids:
                orphaned.append(_serialize_override(ov))

    return {
        "node_id": node.node_id,
        "offline": offline_flag,
        "cached": cached_flag,
        "fetched_at": (_NODE_CATALOG_CACHE.get(node.node_id) or {}).get("fetched_at"),
        "services": services,
        "tasks": tasks,
        "implicit_monitors": _compute_implicit_monitors(services),
        "orphaned_overrides": orphaned,
    }


@router.delete("/nodes/{node_id}/permissions/orphans")
def purge_orphaned_node_permissions(
    node_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = _get_authorized_node(db, current_user, node_id)
    cached_rec = _NODE_CATALOG_CACHE.get(node.node_id)
    if not cached_rec:
        return {"status": "ok", "deleted": 0}

    catalog = cached_rec["catalog"]
    live_service_ids = {str(s.get("id")) for s in (catalog.get("services") or []) if s.get("id") is not None}
    live_task_ids = {str(t.get("id")) for t in (catalog.get("tasks") or []) if t.get("id") is not None}

    overrides = (
        db.query(NodePermissionOverride)
        .filter(NodePermissionOverride.node_id == node.node_id)
        .all()
    )
    deleted = 0
    for ov in overrides:
        is_orphan = (
            (ov.scope_type == "service" and ov.target_key not in live_service_ids)
            or (ov.scope_type == "task" and ov.target_key not in live_task_ids)
        )
        if is_orphan:
            db.delete(ov)
            deleted += 1

    if deleted > 0:
        db.commit()
    return {"status": "ok", "deleted": deleted}
