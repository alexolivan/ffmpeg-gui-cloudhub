"""Emergency administrative and rescue CLI for ffmpeg-gui-cloudhub."""

import sys
import argparse
from sqlalchemy.orm import Session

from backend.version import __version__
from backend.database.version import DB_SCHEMA_VERSION
from backend.database.db import SessionLocal, init_db
from backend.database.models import User
from backend.core.auth_manager import AuthManager
from backend.core.security_guard import security_guard


def reset_admin_password(db: Session, username: str, new_password: str) -> bool:
    """Reset password for a user and clear any active security lockouts."""
    user = db.query(User).filter(User.username == username.strip()).first()
    if not user:
        print(f"[-] Error: User '{username}' does not exist.")
        return False

    if len(new_password) < 6:
        print("[-] Error: Password must be at least 6 characters.")
        return False

    user.password_hash = AuthManager.hash_password(new_password)
    db.commit()

    cleared = security_guard.reset_lockouts(username=username)
    print(f"[+] Successfully updated password for '{username}'.")
    if cleared > 0:
        print(f"[+] Cleared {cleared} security lockout record(s) for '{username}'.")
    return True


def create_superadmin(db: Session, username: str, password: str) -> bool:
    """Create a new superadmin user."""
    existing = db.query(User).filter(User.username == username.strip()).first()
    if existing:
        print(f"[-] Error: User '{username}' already exists.")
        return False

    if len(password) < 6:
        print("[-] Error: Password must be at least 6 characters.")
        return False

    new_user = User(
        username=username.strip(),
        password_hash=AuthManager.hash_password(password),
        role="superadmin",
        org_id=None,
    )
    db.add(new_user)
    db.commit()
    print(f"[+] Superadmin '{username}' created successfully.")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Administrative CLI for ffmpeg-gui-cloudhub"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # show-version
    subparsers.add_parser("show-version", help="Print CloudHub backend and DB versions")

    # init-db
    subparsers.add_parser("init-db", help="Initialize database tables and bootstrap admin")

    # reset-admin-password
    pwd_parser = subparsers.add_parser(
        "reset-admin-password", help="Reset password for an administrative user"
    )
    pwd_parser.add_argument("--user", required=True, help="Username to reset")
    pwd_parser.add_argument("--password", required=True, help="New password")

    # create-superadmin
    admin_parser = subparsers.add_parser(
        "create-superadmin", help="Create a new superadmin account"
    )
    admin_parser.add_argument("--user", required=True, help="Username")
    admin_parser.add_argument("--password", required=True, help="Password")

    args = parser.parse_args()

    if args.command == "show-version":
        print(f"ffmpeg-gui-cloudhub v{__version__} (DB Schema: v{DB_SCHEMA_VERSION})")
        sys.exit(0)

    # Initialize DB schema before running DB commands
    init_db()

    with SessionLocal() as db:
        if args.command == "init-db":
            print("[+] Database initialized successfully.")
            sys.exit(0)
        elif args.command == "reset-admin-password":
            ok = reset_admin_password(db, args.user, args.password)
            sys.exit(0 if ok else 1)
        elif args.command == "create-superadmin":
            ok = create_superadmin(db, args.user, args.password)
            sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
