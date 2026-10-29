"""Multi-tenant management routes for Organizations, Groups, Users, Nodes and Tokens."""

import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Any
from fastapi import APIRouter, Depends, HTTPException, status, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import (
    User,
    Organization,
    NodeGroup,
    UserGroupPermission,
    EnrollmentToken,
    EnrolledNode,
    AuditLog,
)
from backend.core.auth_manager import AuthManager
from backend.core.telemetry_collector import telemetry_collector
from backend.routers.auth_routes import get_current_user, require_roles

logger = logging.getLogger("cloudhub.api.tenants")
router = APIRouter(prefix="/api/hub", tags=["tenants"])


# =========================================================================
# Pydantic Schemas
# =========================================================================

class CreateOrgRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    slug: str = Field(..., min_length=2, max_length=100)
    icon_data: Optional[str] = None
    admin_username: Optional[str] = None
    admin_password: str = Field(..., min_length=6)


class UpdateOrgRequest(BaseModel):
    name: Optional[str] = None
    icon_data: Optional[str] = None


class CreateGroupRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    icon_data: Optional[str] = None


class UpdateGroupRequest(BaseModel):
    name: Optional[str] = None
    icon_data: Optional[str] = None


class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=6)
    role: str = Field("group_operator", pattern="^(org_admin|group_operator)$")
    group_ids: Optional[List[int]] = None


class CreateUserGlobalRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=100)
    password: str = Field(..., min_length=6)
    role: str = Field("group_operator", pattern="^(org_admin|group_operator)$")
    org_id: Optional[int] = None
    group_ids: Optional[List[int]] = None


class UpdateUserRequest(BaseModel):
    password: Optional[str] = Field(None, min_length=6)
    role: Optional[str] = Field(None, pattern="^(org_admin|group_operator)$")
    group_ids: Optional[List[int]] = None


class CreateTokenRequest(BaseModel):
    org_id: int
    group_id: Optional[int] = None
    validity_hours: int = Field(24, ge=1, le=720)


class UpdateNodeRequest(BaseModel):
    name: Optional[str] = None
    group_id: Optional[int] = None
    icon_data: Optional[str] = None


# =========================================================================
# Organizations Endpoints
# =========================================================================

@router.get("/orgs")
def list_organizations(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if user.role == "superadmin":
        orgs = db.query(Organization).order_by(Organization.name).all()
    else:
        orgs = db.query(Organization).filter(Organization.id == user.org_id).all()

    result = []
    for o in orgs:
        result.append(
            {
                "id": o.id,
                "name": o.name,
                "slug": o.slug,
                "icon_data": o.icon_data,
                "groups_count": len(o.groups),
                "nodes_count": len(o.nodes),
                "users_count": len(o.users),
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
        )
    return result


@router.post("/orgs")
def create_organization(
    req: CreateOrgRequest,
    user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    slug_clean = req.slug.strip().lower()
    existing_org = db.query(Organization).filter(Organization.slug == slug_clean).first()
    if existing_org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Organization with slug '{slug_clean}' already exists",
        )

    admin_username = req.admin_username.strip() if req.admin_username else f"admin_{slug_clean}"
    existing_user = db.query(User).filter(User.username == admin_username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with username '{admin_username}' already exists",
        )

    # Atomic creation of Organization and its initial org_admin
    org = Organization(
        name=req.name.strip(),
        slug=slug_clean,
        icon_data=req.icon_data,
    )
    db.add(org)
    db.flush()

    org_admin = User(
        username=admin_username,
        password_hash=AuthManager.hash_password(req.admin_password),
        role="org_admin",
        org_id=org.id,
    )
    db.add(org_admin)

    db.add(
        AuditLog(
            username=user.username,
            org_id=org.id,
            action="CREATE_ORGANIZATION",
            target_type="organization",
            target_id=str(org.id),
            details=f"Created org '{org.name}' with admin '{admin_username}'",
        )
    )
    db.commit()

    return {
        "status": "ok",
        "organization": {
            "id": org.id,
            "name": org.name,
            "slug": org.slug,
            "icon_data": org.icon_data,
        },
        "admin_user": {
            "id": org_admin.id,
            "username": org_admin.username,
            "role": org_admin.role,
        },
    }


@router.put("/orgs/{org_id}")
def update_organization(
    org_id: int,
    req: UpdateOrgRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "superadmin" and (user.role != "org_admin" or user.org_id != org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    if req.name is not None:
        org.name = req.name.strip()
    if req.icon_data is not None:
        org.icon_data = req.icon_data

    db.commit()
    return {"status": "ok", "organization": {"id": org.id, "name": org.name, "slug": org.slug, "icon_data": org.icon_data}}


@router.delete("/orgs/{org_id}")
def delete_organization(
    org_id: int,
    user: User = Depends(require_roles(["superadmin"])),
    db: Session = Depends(get_db),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    db.delete(org)
    db.add(
        AuditLog(
            username=user.username,
            action="DELETE_ORGANIZATION",
            target_type="organization",
            target_id=str(org_id),
            details=f"Deleted org '{org.name}' and all associated nodes/users",
        )
    )
    db.commit()
    return {"status": "ok", "message": f"Organization {org_id} deleted"}


# =========================================================================
# Node Groups Endpoints
# =========================================================================

@router.get("/orgs/{org_id}/groups")
def list_groups(
    org_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "superadmin" and user.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    query = db.query(NodeGroup).filter(NodeGroup.org_id == org_id)
    if user.role == "group_operator":
        allowed_group_ids = [p.group_id for p in user.group_permissions]
        query = query.filter(NodeGroup.id.in_(allowed_group_ids))

    groups = query.order_by(NodeGroup.name).all()
    return [
        {
            "id": g.id,
            "org_id": g.org_id,
            "name": g.name,
            "icon_data": g.icon_data,
            "nodes_count": len(g.nodes),
            "created_at": g.created_at.isoformat() if g.created_at else None,
        }
        for g in groups
    ]


@router.post("/orgs/{org_id}/groups")
def create_group(
    org_id: int,
    req: CreateGroupRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "superadmin" and (user.role != "org_admin" or user.org_id != org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    group = NodeGroup(org_id=org_id, name=req.name.strip(), icon_data=req.icon_data)
    db.add(group)
    db.commit()
    return {"status": "ok", "group": {"id": group.id, "name": group.name, "org_id": group.org_id}}


@router.put("/groups/{group_id}")
def update_group(
    group_id: int,
    req: UpdateGroupRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(NodeGroup).filter(NodeGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    if user.role != "superadmin" and (user.role != "org_admin" or user.org_id != group.org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if req.name is not None:
        group.name = req.name.strip()
    if req.icon_data is not None:
        group.icon_data = req.icon_data

    db.commit()
    return {"status": "ok", "group": {"id": group.id, "name": group.name}}


@router.delete("/groups/{group_id}")
def delete_group(
    group_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    group = db.query(NodeGroup).filter(NodeGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")

    if user.role != "superadmin" and (user.role != "org_admin" or user.org_id != group.org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Set group_id = None for associated nodes
    for node in group.nodes:
        node.group_id = None

    db.delete(group)
    db.commit()
    return {"status": "ok", "message": f"Group {group_id} deleted"}


# =========================================================================
# Users and Group Permissions Endpoints
# =========================================================================

@router.get("/users")
def list_all_users(
    org_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if user.role != "superadmin":
        query = query.filter(User.org_id == user.org_id)
    elif org_id is not None:
        query = query.filter(User.org_id == org_id)

    users = query.all()
    org_map = {o.id: o.name for o in db.query(Organization).all()}

    return [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "org_id": u.org_id,
            "org_name": org_map.get(u.org_id, "Platform / Superadmin") if u.org_id else "Platform / Superadmin",
            "group_ids": [p.group_id for p in u.group_permissions],
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/users")
def create_user_global(
    req: CreateUserGlobalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role == "superadmin":
        target_org_id = req.org_id
        if not target_org_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Organization ID is required to create a tenant user",
            )
    else:
        target_org_id = current_user.org_id

    org = db.query(Organization).filter(Organization.id == target_org_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization #{target_org_id} not found",
        )

    return create_user(
        org_id=target_org_id,
        req=CreateUserRequest(
            username=req.username,
            password=req.password,
            role=req.role,
            group_ids=req.group_ids,
        ),
        current_user=current_user,
        db=db,
    )


@router.get("/orgs/{org_id}/users")
def list_users(
    org_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "superadmin" and (user.role != "org_admin" or user.org_id != org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    users = db.query(User).filter(User.org_id == org_id).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "org_id": u.org_id,
            "group_ids": [p.group_id for p in u.group_permissions],
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/orgs/{org_id}/users")
def create_user(
    org_id: int,
    req: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "superadmin" and (
        current_user.role != "org_admin" or current_user.org_id != org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    username_clean = req.username.strip()
    existing = db.query(User).filter(User.username == username_clean).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{username_clean}' already taken",
        )

    new_user = User(
        username=username_clean,
        password_hash=AuthManager.hash_password(req.password),
        role=req.role,
        org_id=org_id,
    )
    db.add(new_user)
    db.flush()

    if req.role == "group_operator" and req.group_ids:
        for gid in req.group_ids:
            # Verify group belongs to this org
            g = db.query(NodeGroup).filter(NodeGroup.id == gid, NodeGroup.org_id == org_id).first()
            if g:
                db.add(UserGroupPermission(user_id=new_user.id, group_id=gid))

    db.commit()
    return {"status": "ok", "user": {"id": new_user.id, "username": new_user.username, "role": new_user.role}}


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    req: UpdateUserRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if current_user.role != "superadmin" and (
        current_user.role != "org_admin" or current_user.org_id != target_user.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if req.password:
        target_user.password_hash = AuthManager.hash_password(req.password)
    if req.role:
        target_user.role = req.role

    if req.group_ids is not None:
        db.query(UserGroupPermission).filter(UserGroupPermission.user_id == user_id).delete()
        if target_user.role == "group_operator":
            for gid in req.group_ids:
                g = db.query(NodeGroup).filter(
                    NodeGroup.id == gid, NodeGroup.org_id == target_user.org_id
                ).first()
                if g:
                    db.add(UserGroupPermission(user_id=target_user.id, group_id=gid))

    db.commit()
    return {"status": "ok", "message": "User updated"}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if current_user.id == target_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete own account")

    if current_user.role != "superadmin" and (
        current_user.role != "org_admin" or current_user.org_id != target_user.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    db.delete(target_user)
    db.commit()
    return {"status": "ok", "message": f"User {user_id} deleted"}


# =========================================================================
# Enrollment Tokens Endpoints
# =========================================================================

@router.post("/enrollment-tokens")
def create_enrollment_token(
    req: CreateTokenRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.role != "superadmin" and (
        current_user.role != "org_admin" or current_user.org_id != req.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    token_string = f"ch_enr_{secrets.token_hex(24)}"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=req.validity_hours)

    token = EnrollmentToken(
        token=token_string,
        org_id=req.org_id,
        group_id=req.group_id,
        expires_at=expires_at,
    )
    db.add(token)
    db.commit()

    return {
        "status": "ok",
        "token": token_string,
        "expires_at": expires_at.isoformat(),
        "org_id": req.org_id,
        "group_id": req.group_id,
    }


@router.get("/enrollment-tokens")
def list_enrollment_tokens(
    org_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(EnrollmentToken).filter(EnrollmentToken.used == False)
    if current_user.role == "superadmin":
        if org_id:
            query = query.filter(EnrollmentToken.org_id == org_id)
    else:
        query = query.filter(EnrollmentToken.org_id == current_user.org_id)

    tokens = query.order_by(EnrollmentToken.created_at.desc()).all()
    now = datetime.now(timezone.utc)
    return [
        {
            "id": t.id,
            "token": t.token,
            "org_id": t.org_id,
            "group_id": t.group_id,
            "expires_at": t.expires_at.isoformat(),
            "expired": t.expires_at < now,
            "created_at": t.created_at.isoformat(),
        }
        for t in tokens
    ]


@router.delete("/enrollment-tokens/{token_id}")
def delete_enrollment_token(
    token_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    token = db.query(EnrollmentToken).filter(EnrollmentToken.id == token_id).first()
    if not token:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")

    if current_user.role != "superadmin" and (
        current_user.role != "org_admin" or current_user.org_id != token.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    db.delete(token)
    db.commit()
    return {"status": "ok", "message": "Enrollment token deleted"}


# =========================================================================
# Enrolled Nodes Endpoints
# =========================================================================

@router.get("/nodes")
def list_nodes(
    org_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(EnrolledNode)
    if current_user.role == "superadmin":
        if org_id:
            query = query.filter(EnrolledNode.org_id == org_id)
    else:
        query = query.filter(EnrolledNode.org_id == current_user.org_id)

    nodes = query.all()
    accessible_nodes = [
        n for n in nodes if AuthManager.can_user_access_node(db, current_user, n)
    ]

    result = []
    for n in accessible_nodes:
        vitality = telemetry_collector.get_node_vitality(n.node_id, n.current_version)
        result.append(
            {
                "id": n.id,
                "node_id": n.node_id,
                "name": n.name,
                "org_id": n.org_id,
                "group_id": n.group_id,
                "icon_data": n.icon_data,
                "current_version": n.current_version,
                "last_seen_at": n.last_seen_at.isoformat() if n.last_seen_at else None,
                "vitality": vitality,
            }
        )
    return result


@router.put("/nodes/{node_id}")
def update_node(
    node_id: str,
    req: UpdateNodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    if not AuthManager.can_user_access_node(db, current_user, node) or current_user.role == "group_operator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    if req.name is not None:
        node.name = req.name.strip()
    if req.group_id is not None:
        if req.group_id == 0 or req.group_id == -1:
            node.group_id = None
        else:
            g = db.query(NodeGroup).filter(NodeGroup.id == req.group_id, NodeGroup.org_id == node.org_id).first()
            if g:
                node.group_id = g.id
    if req.icon_data is not None:
        node.icon_data = req.icon_data

    db.commit()
    return {"status": "ok", "node": {"node_id": node.node_id, "name": node.name, "group_id": node.group_id}}


@router.delete("/nodes/{node_id}")
def delete_node(
    node_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    if current_user.role != "superadmin" and (
        current_user.role != "org_admin" or current_user.org_id != node.org_id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    telemetry_collector.mark_disconnected(node_id)
    db.delete(node)
    db.commit()
    return {"status": "ok", "message": f"Node {node_id} removed"}


@router.get("/nodes/{node_id}/sso-url")
def get_node_sso_url(
    node_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Node not found")

    if not AuthManager.can_user_access_node(db, current_user, node):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this node")

    assertion = AuthManager.create_sso_assertion(
        node_id=node.node_id,
        tunnel_secret=node.tunnel_secret,
        username=current_user.username,
        ttl_seconds=60,
    )

    client_ip = request.client.host if request.client else None
    appliance_label = node.name or node.node_id
    db.add(
        AuditLog(
            username=current_user.username,
            org_id=node.org_id,
            node_id=node.node_id,
            channel="cloudhub",
            action="NODE_SESSION_START",
            target_type="node",
            target_id=node.node_id,
            ip_address=client_ip,
            details=f"Operator '{current_user.username}' opened remote session to appliance '{appliance_label}'",
        )
    )
    db.commit()

    sso_path = f"/proxy/{node.node_id}/?sso_assertion={assertion}"
    return {
        "status": "ok",
        "node_id": node.node_id,
        "sso_path": sso_path,
        "expires_in": 60,
    }
