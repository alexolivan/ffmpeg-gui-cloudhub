"""Database engine, session management, and bootstrap initialization."""

import os
import logging
from typing import Generator, Optional
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

from backend.database.models import Base, User

logger = logging.getLogger("cloudhub.db")

DEFAULT_DB_PATH = os.path.abspath(
    os.environ.get("CLOUDHUB_DB_PATH", os.path.join(os.getcwd(), "cloudhub.db"))
)

DATABASE_URL = f"sqlite:///{DEFAULT_DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable SQLite foreign key constraints and WAL journal mode."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding an isolated database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db(db_engine=None) -> None:
    """Initialize database tables and bootstrap superadmin if missing."""
    target_engine = db_engine or engine
    Base.metadata.create_all(bind=target_engine)

    # Lightweight schema migrations for existing databases
    with target_engine.connect() as conn:
        from sqlalchemy import text
        try:
            conn.execute(text("ALTER TABLE audit_logs ADD COLUMN node_id VARCHAR(100)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE audit_logs ADD COLUMN channel VARCHAR(50) DEFAULT 'cloudhub'"))
            conn.commit()
        except Exception:
            pass

    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=target_engine)

    with session_factory() as session:
        existing_superadmin = (
            session.query(User).filter(User.role == "superadmin").first()
        )
        if not existing_superadmin:
            # Import here to prevent circular dependency
            from backend.core.auth_manager import AuthManager

            admin_user = os.environ.get("CLOUDHUB_ADMIN_USER", "admin").strip()
            admin_pass = os.environ.get("CLOUDHUB_ADMIN_PASSWORD", "cloudhubadmin").strip()

            password_hash = AuthManager.hash_password(admin_pass)
            superadmin = User(
                username=admin_user,
                password_hash=password_hash,
                role="superadmin",
                org_id=None,
            )
            session.add(superadmin)
            session.commit()
            logger.warning(
                "============================================================"
            )
            logger.warning(
                " [CLOUDHUB] Initial superadmin created: '%s'.", admin_user
            )
            logger.warning(
                " IMPORTANT: Change the password immediately via CLI or WebUI."
            )
            logger.warning(
                "============================================================"
            )
