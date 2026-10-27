"""Authentication and user session routes."""

import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import User, AuditLog
from backend.core.auth_manager import AuthManager
from backend.core.security_guard import security_guard

logger = logging.getLogger("cloudhub.api.auth")
router = APIRouter(prefix="/api/hub/auth", tags=["auth"])

bearer_scheme = HTTPBearer(auto_error=False)


def get_client_ip(request: Request) -> str:
    """Extract real client IP respecting proxy headers."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


def get_current_user(
    request: Request,
    auth_header: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate current authenticated user via header or cookie."""
    token = None
    if auth_header and auth_header.credentials:
        token = auth_header.credentials
    elif "ch_session" in request.cookies:
        token = request.cookies.get("ch_session")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    def lookup_user(uid: int) -> Optional[User]:
        return db.query(User).filter(User.id == uid).first()

    user = AuthManager.validate_session(token, lookup_user)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def require_roles(allowed_roles: List[str]):
    """Role-based authorization guard dependency factory."""
    def role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of roles: {allowed_roles}",
            )
        return user
    return role_checker


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    token: str
    user: dict


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=6)


@router.post("/login", response_model=LoginResponse)
def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    ip = get_client_ip(request)
    is_locked, remaining = security_guard.is_locked(ip, req.username)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account or IP locked due to too many failed attempts. Try again in {remaining} seconds.",
        )

    user = db.query(User).filter(User.username == req.username.strip()).first()
    if not user or not AuthManager.verify_password(req.password, user.password_hash):
        locked_now, rem = security_guard.record_failure(ip, req.username)
        logger.warning(
            "[security] Failed CloudHub login attempt for '%s' from %s (locked=%s)",
            req.username,
            ip,
            locked_now,
        )
        # Record failed audit log
        log = AuditLog(
            username=req.username,
            action="LOGIN_FAILED",
            target_type="auth",
            ip_address=ip,
            details=f"Failed login attempt (locked={locked_now})",
        )
        db.add(log)
        db.commit()

        if locked_now:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Account locked. Try again in {rem} seconds.",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    security_guard.record_success(ip, req.username)

    token = AuthManager.create_session(user.id, user.password_hash)

    # Set secure HttpOnly cookie
    response.set_cookie(
        key="ch_session",
        value=token,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        max_age=604800,  # 7 days
    )

    # Audit log
    db.add(
        AuditLog(
            username=user.username,
            org_id=user.org_id,
            action="LOGIN_SUCCESS",
            target_type="auth",
            ip_address=ip,
        )
    )
    db.commit()

    return {
        "token": token,
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "org_id": user.org_id,
        },
    }


@router.post("/logout")
def logout(response: Response, user: User = Depends(get_current_user)):
    response.delete_cookie("ch_session")
    return {"status": "ok", "message": "Logged out successfully"}


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    group_ids = [p.group_id for p in user.group_permissions]
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "org_id": user.org_id,
        "group_ids": group_ids,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not AuthManager.verify_password(req.old_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password",
        )

    user.password_hash = AuthManager.hash_password(req.new_password)
    db.commit()

    # Issuing new session token since old one was invalidated
    new_token = AuthManager.create_session(user.id, user.password_hash)
    return {
        "status": "ok",
        "message": "Password changed successfully. All previous sessions invalidated.",
        "token": new_token,
    }
