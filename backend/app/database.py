"""Banco de dados com SQLAlchemy: SQLite (um arquivo, database.db) ou Postgres (DATABASE_URL)."""

from collections.abc import Iterator
from pathlib import Path
import sqlite3
from datetime import datetime, timezone

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import DATABASE_FILE, DATABASE_URL


class Base(DeclarativeBase):
    pass


IS_SQLITE = not DATABASE_URL

if IS_SQLITE:
    # check_same_thread=False: o FastAPI atende cada requisição em uma thread diferente.
    engine = create_engine(
        URL.create("sqlite", database=str(DATABASE_FILE)),
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")  # espera até 5 s em vez de falhar se o arquivo estiver ocupado
        # O modo do diário fica no padrão (DELETE) de propósito: no WAL o banco viraria três arquivos
        # (.db, -wal e -shm) e dados recentes ficariam fora do .db, o que é ruim para um HD que se
        # leva de um PC a outro e pode ser desconectado a qualquer momento.
        cursor.close()
else:
    # Postgres hospedado (Supabase etc.): pool pequeno e reconexão automática, pois o plano gratuito
    # derruba conexões ociosas.
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5, max_overflow=5, pool_recycle=240)


def begin_write(db: Session) -> None:
    """Abre uma seção crítica de escrita: duas requisições simultâneas não passam juntas por aqui.

    SQLite: BEGIN IMMEDIATE (trava de escrita do arquivo). Postgres: trava consultiva da transação,
    liberada no commit/rollback.
    """
    if IS_SQLITE:
        db.execute(text("BEGIN IMMEDIATE"))
    else:
        db.execute(text("SELECT pg_advisory_xact_lock(7340211)"))

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """Dependência do FastAPI: uma sessão por requisição, sempre fechada no final."""
    with SessionLocal() as db:
        yield db


def init_db() -> None:
    """Cria o database.db e as tabelas se ainda não existirem."""
    from . import models  # noqa: F401  (importar registra as tabelas em Base.metadata)

    if IS_SQLITE and not Path(DATABASE_FILE.anchor).exists():
        raise RuntimeError(
            f"A unidade {DATABASE_FILE.anchor} não foi encontrada. "
            "Conecte o HD ou ajuste a variável DATA_ROOT (ou DATABASE_FILE)."
        )
    if IS_SQLITE:
        DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
    backup_before_mobile_migration()
    try:
        Base.metadata.create_all(engine)
    except OperationalError as exc:
        raise RuntimeError(
            f"Não foi possível criar/abrir o banco de dados ({DATABASE_FILE if IS_SQLITE else 'Postgres'}). "
            "Confira se há permissão para criar arquivos nessa pasta (na raiz de um disco o Windows "
            f"costuma permitir só pastas). Detalhe: {exc.orig}"
        ) from exc
    _migrate()
    seed_categories()
    seed_voice_groups()


# As categorias que já vêm cadastradas (nome, tipo, ícone, cor). Valem para todas as contas.
DEFAULT_CATEGORIES = (
    ("Salário", "income", "salary", "#22c55e"),
    ("Freelance", "income", "freelance", "#14b8a6"),
    ("Alimentação", "expense", "food", "#f97316"),
    ("Locomoção/Transporte", "expense", "transport", "#3b82f6"),
    ("Assinaturas", "expense", "subscriptions", "#a855f7"),
    ("Educação", "expense", "education", "#eab308"),
    ("Lazer", "expense", "leisure", "#ec4899"),
    ("Saúde", "expense", "health", "#ef4444"),
)


def seed_categories() -> None:
    """Cadastra as categorias padrão, mas só se a tabela estiver VAZIA (nunca mexe no que o usuário já tem)."""
    from sqlalchemy import func, select

    from .models import TransactionCategory

    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(TransactionCategory)):
            return
        db.add_all(
            TransactionCategory(user_id=None, name=name, type=type_, icon=icon, color=color)
            for name, type_, icon, color in DEFAULT_CATEGORIES
        )
        db.commit()


def seed_voice_groups() -> None:
    """Cria o grupo "Geral", mas só se ainda não houver nenhum grupo (nunca mexe no que já existe)."""
    from sqlalchemy import func, select

    from .models import VoiceGroup

    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(VoiceGroup)):
            return
        db.add(VoiceGroup(name="Geral", icon="🎧"))
        db.commit()


def _migrate() -> None:
    """Ajusta um banco criado por uma versão antiga (o create_all só cria tabelas, não altera as existentes)."""
    if engine.dialect.name != "sqlite":  # Postgres começa já no esquema atual, criado pelo create_all
        return
    with engine.begin() as conn:
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)")}
        if "is_admin" not in columns:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT 0")
        notes = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(notes)")}
        if notes and "created_at" not in notes:  # notas de antes da Agenda: a criação vira a última edição
            conn.exec_driver_sql("ALTER TABLE notes ADD COLUMN created_at DATETIME")
            conn.exec_driver_sql("UPDATE notes SET created_at = updated_at")
        agenda = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(agenda_items)")}
        if agenda:  # itens criados antes das rotinas e dos lembretes ganham as colunas novas (sem repetição, sem lembrete)
            if "recurrence" not in agenda:
                conn.exec_driver_sql("ALTER TABLE agenda_items ADD COLUMN recurrence VARCHAR(10) NOT NULL DEFAULT 'none'")
            if "recurrence_days" not in agenda:
                conn.exec_driver_sql("ALTER TABLE agenda_items ADD COLUMN recurrence_days VARCHAR(20) NOT NULL DEFAULT ''")
            if "recurrence_until" not in agenda:
                conn.exec_driver_sql("ALTER TABLE agenda_items ADD COLUMN recurrence_until DATE")
            if "reminder_minutes" not in agenda:
                conn.exec_driver_sql("ALTER TABLE agenda_items ADD COLUMN reminder_minutes INTEGER")
        # Sem nenhum dono, a conta mais antiga (a primeira, criada antes dos convidados existirem) vira o dono.
        if conn.exec_driver_sql("SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1").first() is None:
            conn.exec_driver_sql("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)")
        voice_groups = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(voice_groups)")}
        if voice_groups and "category" not in voice_groups:  # grupos de antes das categorias ficam soltos no topo
            conn.exec_driver_sql("ALTER TABLE voice_groups ADD COLUMN category VARCHAR(60) NOT NULL DEFAULT ''")
        if voice_groups and "capacity" not in voice_groups:  # grupos de antes do limite de gente ficam sem limite (0)
            conn.exec_driver_sql("ALTER TABLE voice_groups ADD COLUMN capacity INTEGER NOT NULL DEFAULT 0")
        if voice_groups and "created_at" not in voice_groups:  # grupos de antes desta coluna existir
            conn.exec_driver_sql("ALTER TABLE voice_groups ADD COLUMN created_at DATETIME")
            conn.exec_driver_sql("UPDATE voice_groups SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL")
        transactions = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(transactions)")}
        if transactions and "recurrence" not in transactions:  # transações de antes dos gastos fixos não se repetem
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN recurrence VARCHAR(10) NOT NULL DEFAULT 'none'")
        if transactions and "recurrence_until" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN recurrence_until DATE")
        if transactions and "recurrence_parent_id" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN recurrence_parent_id INTEGER")
        if transactions and "time" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN time VARCHAR(5)")
        if transactions and "payment_method" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN payment_method VARCHAR(20)")
        if transactions and "card_id" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN card_id INTEGER")
            conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_transactions_card_id ON transactions(card_id)")
        if transactions and "status" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'settled'")
            if "date" in transactions:
                conn.exec_driver_sql("UPDATE transactions SET status = 'pending' WHERE date > date('now', '-3 hours')")
        if transactions and "settled_at" not in transactions:
            conn.exec_driver_sql("ALTER TABLE transactions ADD COLUMN settled_at DATE")
            if "date" in transactions:
                conn.exec_driver_sql("UPDATE transactions SET settled_at = date WHERE status = 'settled'")
        # Tabela só das exclusões do backup (função removida): apaga se ainda existir de uma versão antiga.
        conn.exec_driver_sql("DROP TABLE IF EXISTS user_settings")


def backup_before_mobile_migration() -> None:
    """Guarda o banco antigo antes das migrações de cartões e horário."""
    if not IS_SQLITE or not DATABASE_FILE.is_file():
        return
    with sqlite3.connect(str(DATABASE_FILE)) as source:
        columns = {row[1] for row in source.execute('PRAGMA table_info(transactions)')}
        if not columns or {'card_id', 'time', 'status', 'settled_at'} <= columns:
            return
        target = DATABASE_FILE.with_name('before-mobile-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '.db')
        with sqlite3.connect(str(target)) as backup:
            source.backup(backup)
