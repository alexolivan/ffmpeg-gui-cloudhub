"""Database engine, session management, and bootstrap initialization."""

import os
import logging
from typing import Generator, Optional
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session

from backend.database.models import Base, User

logger = logging.getLogger("cloudhub.db")


def _resolve_database_path() -> str:
    """Resolve database path, placing it in data/ and migrating legacy root db if present."""
    custom_path = os.environ.get("CLOUDHUB_DB_PATH")
    if custom_path:
        return os.path.abspath(custom_path)

    # Base directory is project root (parent of backend/)
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    root_dir = os.path.dirname(backend_dir)
    data_dir = os.path.join(root_dir, "data")
    os.makedirs(data_dir, exist_ok=True)

    target_path = os.path.join(data_dir, "cloudhub.db")
    legacy_path = os.path.join(root_dir, "cloudhub.db")

    # If legacy database exists in root and target does not exist, migrate it cleanly
    if os.path.isfile(legacy_path) and not os.path.isfile(target_path):
        try:
            import shutil
            shutil.move(legacy_path, target_path)
            for ext in ("-wal", "-shm"):
                leg_aux = legacy_path + ext
                tgt_aux = target_path + ext
                if os.path.isfile(leg_aux):
                    shutil.move(leg_aux, tgt_aux)
            logger.info("Migrated legacy database from %s to %s", legacy_path, target_path)
        except Exception as e:
            logger.warning("Failed to migrate legacy database to data/ dir: %s", e)

    return os.path.abspath(target_path)


DEFAULT_DB_PATH = _resolve_database_path()

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
        try:
            conn.execute(text("ALTER TABLE enrolled_nodes ADD COLUMN is_unlinked BOOLEAN DEFAULT 0"))
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
