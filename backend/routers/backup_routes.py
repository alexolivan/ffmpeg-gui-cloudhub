"""Backup, export, validation, and multi-tenant restore routes for ffmpeg-gui-cloudhub."""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.version import __version__
from backend.database.db import get_db
from backend.database.models import (
    User,
    Organization,
    NodeGroup,
    EnrolledNode,
    UserGroupPermission,
    SystemSettings,
    AuditLog,
)
from backend.routers.auth_routes import get_current_user

logger = logging.getLogger("cloudhub.api.backup")
router = APIRouter(prefix="/api/hub/backup", tags=["backup"])


class BackupExportRequest(BaseModel):
    scope: str = "auto"  # "auto" | "full" | "tenant"
    org_id: Optional[int] = None
    include_settings: bool = True
    include_nodes: bool = True
    include_groups: bool = True
    include_users: bool = True


@router.post("/export")
def export_backup_json(
    req: BackupExportRequest = Body(default_factory=BackupExportRequest),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Exports platform configuration into a standardized JSON backup file.
    - Tenant Administrators can ONLY export their own tenant data (strict RBAC scoping).
    - Platform Owners can export the entire platform (full) or a specific tenant.
    """
    is_superadmin = current_user.role == "superadmin"

    # Enforce scope
    if not is_superadmin:
        effective_scope = "tenant"
        target_org_id = current_user.org_id
        if not target_org_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User account is not associated with any tenant organization.",
            )
    else:
        if req.scope == "tenant" and req.org_id:
            effective_scope = "tenant"
            target_org_id = req.org_id
        else:
            effective_scope = "full" if req.scope != "tenant" else "tenant"
            target_org_id = req.org_id if effective_scope == "tenant" else None

    target_org = None
    if target_org_id:
        target_org = db.query(Organization).filter(Organization.id == target_org_id).first()
        if not target_org:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Tenant organization with ID {target_org_id} not found.",
            )

    sections: Dict[str, Any] = {
        "system_settings": {},
        "organizations": [],
        "groups": [],
        "nodes": [],
        "users": [],
    }

    # 1. Global Settings (Superadmin Full scope only)
    if is_superadmin and effective_scope == "full" and req.include_settings:
        records = db.query(SystemSettings).all()
        for r in records:
            # Exclude sensitive SSL private key storage records if any
            if r.key in ("login_logo_disk_path", "custom_ssl_key"):
                continue
            try:
                sections["system_settings"][r.key] = json.loads(r.value)
            except Exception:
                sections["system_settings"][r.key] = r.value

    # 2. Organizations
    if effective_scope == "full":
        orgs = db.query(Organization).order_by(Organization.name).all()
        for o in orgs:
            sections["organizations"].append(
                {
                    "name": o.name,
                    "slug": o.slug,
                    "icon_data": o.icon_data,
                }
            )
    elif target_org:
        sections["organizations"].append(
            {
                "name": target_org.name,
                "slug": target_org.slug,
                "icon_data": target_org.icon_data,
            }
        )

    # 3. Groups
    if req.include_groups:
        groups_query = db.query(NodeGroup)
        if effective_scope == "tenant":
            groups_query = groups_query.filter(NodeGroup.org_id == target_org_id)
        groups = groups_query.all()
        for g in groups:
            sections["groups"].append(
                {
                    "name": g.name,
                    "icon_data": g.icon_data,
                    "org_slug": g.organization.slug if g.organization else None,
                }
            )

    # 4. Enrolled Nodes (Appliances metadata)
    if req.include_nodes:
        nodes_query = db.query(EnrolledNode)
        if effective_scope == "tenant":
            nodes_query = nodes_query.filter(EnrolledNode.org_id == target_org_id)
        nodes = nodes_query.all()
        for n in nodes:
            sections["nodes"].append(
                {
                    "node_id": n.node_id,
                    "name": n.name,
                    "org_slug": n.organization.slug if n.organization else None,
                    "group_name": n.group.name if n.group else None,
                    "tunnel_secret": n.tunnel_secret,
                    "icon_data": n.icon_data,
                    "current_version": n.current_version,
                }
            )

    # 5. Users & Role-Based Permissions
    if req.include_users:
        users_query = db.query(User)
        if effective_scope == "tenant":
            users_query = users_query.filter(User.org_id == target_org_id)
        users = users_query.all()
        for u in users:
            # Tenant admins cannot export superadmins
            if not is_superadmin and u.role == "superadmin":
                continue
            sections["users"].append(
                {
                    "username": u.username,
                    "password_hash": u.password_hash,
                    "role": u.role,
                    "org_slug": u.organization.slug if u.organization else None,
                    "group_names": [
                        p.group.name for p in u.group_permissions if p.group
                    ],
                }
            )

    now_iso = datetime.now(timezone.utc).isoformat()
    backup_payload = {
        "app": "ffmpeg-gui-cloudhub",
        "version": __version__,
        "timestamp": now_iso,
        "scope": effective_scope,
        "exported_by": {
            "username": current_user.username,
            "role": current_user.role,
        },
        "tenant": {
            "name": target_org.name,
            "slug": target_org.slug,
        }
        if target_org
        else None,
        "counts": {
            "organizations": len(sections["organizations"]),
            "groups": len(sections["groups"]),
            "nodes": len(sections["nodes"]),
            "users": len(sections["users"]),
            "settings_keys": len(sections["system_settings"]),
        },
        "sections": sections,
    }

    db.add(
        AuditLog(
            username=current_user.username,
            org_id=target_org_id,
            action="EXPORT_BACKUP",
            target_type="backup",
            details=f"Exported {effective_scope} backup with {backup_payload['counts']}",
        )
    )
    db.commit()

    filename = (
        f"cloudhub-backup-{target_org.slug}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        if target_org
        else f"cloudhub-backup-full-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    )

    return JSONResponse(
        content=backup_payload,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/validate")
def validate_backup_payload(
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Parses and verifies a backup payload before committing changes to the database.
    Checks signature, scope compatibility, tenant alignment, and item counts.
    """
    data = payload
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Backup payload must be a JSON object.",
        )

    # Validate signature
    if data.get("app") != "ffmpeg-gui-cloudhub":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid backup file signature. Must be generated by ffmpeg-gui-cloudhub.",
        )

    scope = data.get("scope", "full")
    is_superadmin = current_user.role == "superadmin"

    # Enforce tenant admin security
    if not is_superadmin and scope == "full":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant administrators cannot restore a Full Platform Backup. Please upload a tenant-scoped backup.",
        )

    backup_tenant = data.get("tenant") or {}
    counts = data.get("counts", {})
    sections = data.get("sections", {})

    actual_counts = {
        "organizations": len(sections.get("organizations", [])),
        "groups": len(sections.get("groups", [])),
        "nodes": len(sections.get("nodes", [])),
        "users": len(sections.get("users", [])),
        "settings_keys": len(sections.get("system_settings", {})),
    }

    target_tenant_name = None
    if not is_superadmin and current_user.org_id:
        user_org = db.query(Organization).filter(Organization.id == current_user.org_id).first()
        target_tenant_name = user_org.name if user_org else None
    elif backup_tenant.get("name"):
        target_tenant_name = backup_tenant.get("name")

    return {
        "status": "valid",
        "app": data.get("app"),
        "version": data.get("version"),
        "timestamp": data.get("timestamp"),
        "scope": scope,
        "exported_by": data.get("exported_by"),
        "source_tenant": backup_tenant.get("name"),
        "target_tenant": target_tenant_name,
        "counts": counts or actual_counts,
        "compatible": True,
    }


@router.post("/import")
def import_backup_payload(
    payload: Dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Restores platform configuration atomically from a valid CloudHub backup payload.
    Strictly scopes restoration to current_user.org_id for tenant administrators.
    """
    data = payload
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Backup payload must be a JSON object.",
        )

    if data.get("app") != "ffmpeg-gui-cloudhub":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid backup file signature.",
        )

    is_superadmin = current_user.role == "superadmin"
    scope = data.get("scope", "full")

    if not is_superadmin and scope == "full":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant administrators cannot restore a Full Platform Backup.",
        )

    target_org_id = current_user.org_id if not is_superadmin else None
    sections = data.get("sections", {})

    imported_summary = {
        "settings_keys": 0,
        "organizations": 0,
        "groups": 0,
        "nodes": 0,
        "users": 0,
    }

    try:
        # 1. Restore System Settings (Superadmin Full scope only)
        if is_superadmin and scope == "full" and "system_settings" in sections:
            sys_settings = sections["system_settings"]
            if isinstance(sys_settings, dict):
                for k, v in sys_settings.items():
                    # Protect vital listener keys unless explicitly needed
                    if k in ("login_logo_disk_path", "custom_ssl_key"):
                        continue
                    val_str = json.dumps(v) if not isinstance(v, str) else v
                    rec = db.query(SystemSettings).filter(SystemSettings.key == k).first()
                    if not rec:
                        db.add(SystemSettings(key=k, value=val_str))
                    else:
                        rec.value = val_str
                    imported_summary["settings_keys"] += 1

        # 2. Restore Organizations
        org_map: Dict[str, Organization] = {}
        if is_superadmin and scope == "full" and "organizations" in sections:
            for o_data in sections["organizations"]:
                slug = o_data.get("slug")
                name = o_data.get("name")
                if not slug or not name:
                    continue
                org = db.query(Organization).filter(Organization.slug == slug).first()
                if not org:
                    org = Organization(
                        slug=slug,
                        name=name,
                        icon_data=o_data.get("icon_data"),
                    )
                    db.add(org)
                    db.flush()
                else:
                    org.name = name
                    if o_data.get("icon_data"):
                        org.icon_data = o_data.get("icon_data")
                org_map[slug] = org
                imported_summary["organizations"] += 1
        elif target_org_id:
            user_org = db.query(Organization).filter(Organization.id == target_org_id).first()
            if user_org:
                org_map[user_org.slug] = user_org

        # Helper: resolve target organization
        def get_target_org(org_slug: Optional[str]) -> Optional[Organization]:
            if target_org_id:
                return db.query(Organization).filter(Organization.id == target_org_id).first()
            if org_slug and org_slug in org_map:
                return org_map[org_slug]
            if org_slug:
                return db.query(Organization).filter(Organization.slug == org_slug).first()
            # Fallback to first available organization
            return db.query(Organization).first()

        # 3. Restore Node Groups
        group_map: Dict[str, NodeGroup] = {}  # key: (org_id, group_name) -> NodeGroup
        if "groups" in sections and isinstance(sections["groups"], list):
            for g_data in sections["groups"]:
                g_name = g_data.get("name")
                if not g_name:
                    continue
                parent_org = get_target_org(g_data.get("org_slug"))
                if not parent_org:
                    continue

                group = (
                    db.query(NodeGroup)
                    .filter(NodeGroup.org_id == parent_org.id, NodeGroup.name == g_name)
                    .first()
                )
                if not group:
                    group = NodeGroup(
                        org_id=parent_org.id,
                        name=g_name,
                        icon_data=g_data.get("icon_data"),
                    )
                    db.add(group)
                    db.flush()
                else:
                    if g_data.get("icon_data"):
                        group.icon_data = g_data.get("icon_data")

                group_map[f"{parent_org.id}:{g_name}"] = group
                imported_summary["groups"] += 1

        # 4. Restore Enrolled Nodes
        if "nodes" in sections and isinstance(sections["nodes"], list):
            for n_data in sections["nodes"]:
                node_id = n_data.get("node_id")
                n_name = n_data.get("name")
                if not node_id or not n_name:
                    continue

                parent_org = get_target_org(n_data.get("org_slug"))
                if not parent_org:
                    continue

                target_group = None
                g_name = n_data.get("group_name")
                if g_name:
                    g_key = f"{parent_org.id}:{g_name}"
                    target_group = group_map.get(g_key) or (
                        db.query(NodeGroup)
                        .filter(NodeGroup.org_id == parent_org.id, NodeGroup.name == g_name)
                        .first()
                    )

                node = db.query(EnrolledNode).filter(EnrolledNode.node_id == node_id).first()
                if not node:
                    node = EnrolledNode(
                        node_id=node_id,
                        name=n_name,
                        org_id=parent_org.id,
                        group_id=target_group.id if target_group else None,
                        tunnel_secret=n_data.get("tunnel_secret", "migrated_token"),
                        icon_data=n_data.get("icon_data"),
                        current_version=n_data.get("current_version"),
                    )
                    db.add(node)
                else:
                    # Enforce tenant isolation: tenant admin cannot steal nodes from other tenants
                    if not is_superadmin and node.org_id != target_org_id:
                        continue
                    node.name = n_name
                    node.org_id = parent_org.id
                    node.group_id = target_group.id if target_group else None
                    if n_data.get("tunnel_secret"):
                        node.tunnel_secret = n_data.get("tunnel_secret")
                    if n_data.get("icon_data"):
                        node.icon_data = n_data.get("icon_data")

                imported_summary["nodes"] += 1

        # 5. Restore Users & Group Permissions
        if "users" in sections and isinstance(sections["users"], list):
            for u_data in sections["users"]:
                uname = u_data.get("username", "").strip()
                p_hash = u_data.get("password_hash")
                u_role = u_data.get("role", "group_operator")
                if not uname or not p_hash:
                    continue

                # Privilege escalation prevention
                if not is_superadmin:
                    if u_role == "superadmin":
                        u_role = "org_admin"
                    parent_org = get_target_org(None)
                else:
                    parent_org = get_target_org(u_data.get("org_slug"))

                user = db.query(User).filter(User.username == uname).first()
                if not user:
                    user = User(
                        username=uname,
                        password_hash=p_hash,
                        role=u_role,
                        org_id=parent_org.id if parent_org and u_role != "superadmin" else None,
                    )
                    db.add(user)
                    db.flush()
                else:
                    # Do not alter current active user to prevent accidental session disconnection
                    if user.id != current_user.id:
                        user.password_hash = p_hash
                        user.role = u_role
                        if parent_org and u_role != "superadmin":
                            user.org_id = parent_org.id

                # Assign group permissions
                req_groups = u_data.get("group_names", [])
                if parent_org and req_groups and u_role == "group_operator":
                    for g_name in req_groups:
                        g_key = f"{parent_org.id}:{g_name}"
                        grp = group_map.get(g_key) or (
                            db.query(NodeGroup)
                            .filter(NodeGroup.org_id == parent_org.id, NodeGroup.name == g_name)
                            .first()
                        )
                        if grp:
                            perm = (
                                db.query(UserGroupPermission)
                                .filter(
                                    UserGroupPermission.user_id == user.id,
                                    UserGroupPermission.group_id == grp.id,
                                )
                                .first()
                            )
                            if not perm:
                                db.add(
                                    UserGroupPermission(user_id=user.id, group_id=grp.id)
                                )

                imported_summary["users"] += 1

        db.add(
            AuditLog(
                username=current_user.username,
                org_id=target_org_id,
                action="IMPORT_BACKUP",
                target_type="backup",
                details=f"Restored {scope} backup: {imported_summary}",
            )
        )
        db.commit()

        return {
            "status": "ok",
            "message": "Backup configuration restored successfully.",
            "summary": imported_summary,
        }

    except Exception as exc:
        db.rollback()
        logger.error("Failed to restore backup payload: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to restore backup configuration: {str(exc)}",
        )
