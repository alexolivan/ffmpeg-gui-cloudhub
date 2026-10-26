"""SQLAlchemy declarative models for ffmpeg-gui-cloudhub multi-tenant hierarchy."""

from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def utcnow():
    """Return timezone-aware or naive UTC datetime compatible with SQLite."""
    return datetime.now(timezone.utc)



class Organization(Base):
    """Tenant organization."""
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(150), nullable=False)
    slug = Column(String(100), unique=True, index=True, nullable=False)
    icon_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    users = relationship("User", back_populates="organization", cascade="all, delete-orphan")
    groups = relationship("NodeGroup", back_populates="organization", cascade="all, delete-orphan")
    nodes = relationship("EnrolledNode", back_populates="organization", cascade="all, delete-orphan")
    enrollment_tokens = relationship(
        "EnrollmentToken", back_populates="organization", cascade="all, delete-orphan"
    )


class NodeGroup(Base):
    """Subdivision of nodes within an organization."""
    __tablename__ = "node_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name = Column(String(150), nullable=False)
    icon_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    organization = relationship("Organization", back_populates="groups")
    nodes = relationship("EnrolledNode", back_populates="group")
    user_permissions = relationship(
        "UserGroupPermission", back_populates="group", cascade="all, delete-orphan"
    )


class User(Base):
    """CloudHub user account with role-based access control."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)  # superadmin | org_admin | group_operator
    org_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    organization = relationship("Organization", back_populates="users")
    group_permissions = relationship(
        "UserGroupPermission", back_populates="user", cascade="all, delete-orphan"
    )


class UserGroupPermission(Base):
    """Mapping table granting group_operator users access to specific NodeGroups."""
    __tablename__ = "user_group_permissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id = Column(
        Integer, ForeignKey("node_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )

    __table_args__ = (
        UniqueConstraint("user_id", "group_id", name="uq_user_group_permission"),
    )

    user = relationship("User", back_populates="group_permissions")
    group = relationship("NodeGroup", back_populates="user_permissions")


class EnrollmentToken(Base):
    """Single-use cryptographic enrollment token for provisioning edge appliances."""
    __tablename__ = "enrollment_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    token = Column(String(128), unique=True, index=True, nullable=False)
    org_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id = Column(
        Integer, ForeignKey("node_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    organization = relationship("Organization", back_populates="enrollment_tokens")
    group = relationship("NodeGroup")


class EnrolledNode(Base):
    """Edge FFmpeg-GUI appliance connected or provisioned in CloudHub."""
    __tablename__ = "enrolled_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    node_id = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(150), nullable=False)
    org_id = Column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id = Column(
        Integer, ForeignKey("node_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tunnel_secret = Column(String(128), nullable=False)
    icon_data = Column(Text, nullable=True)
    current_version = Column(String(50), nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    organization = relationship("Organization", back_populates="nodes")
    group = relationship("NodeGroup", back_populates="nodes")


class AuditLog(Base):
    """Audit log entry tracking operational changes and security events."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=utcnow, index=True, nullable=False)
    org_id = Column(Integer, nullable=True, index=True)
    username = Column(String(100), nullable=False, index=True)
    action = Column(String(100), nullable=False)
    target_type = Column(String(50), nullable=False)
    target_id = Column(String(100), nullable=True)
    ip_address = Column(String(64), nullable=True)
    details = Column(Text, nullable=True)


class SystemSettings(Base):
    """Key-value table for global CloudHub configuration."""
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
