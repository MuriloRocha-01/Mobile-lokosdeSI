from datetime import date as date_type  # "date" sozinho seria escondido pela coluna ProjectLog.date
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy import false, func, Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Table, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .database import Base

# Situações possíveis de um projeto (o que vai para o banco; o frontend mostra os rótulos).
PROJECT_STATUSES = ("em_desenvolvimento", "pausado", "concluido")

# Agenda pessoal.
AGENDA_TYPES = ("tarefa", "evento", "compromisso")
AGENDA_STATUSES = ("pendente", "concluido", "cancelado")
ATTACHMENT_TYPES = ("image", "pdf")

# Finanças.
TRANSACTION_TYPES = ("income", "expense")
# Nomes de ícone que uma categoria pode ter. São nomes "de significado" (não de uma biblioteca): cada
# aplicativo (desktop, celular) desenha o seu ícone para cada um; o que não conhecer vira uma etiqueta.
CATEGORY_ICONS = (
    "salary", "freelance", "investments", "gift",
    "food", "transport", "subscriptions", "education", "leisure", "health",
    "shopping", "home", "travel", "pets", "other",
)  # fmt: skip


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # Guardado sempre em minúsculas: a unicidade do e-mail não diferencia maiúsculas de minúsculas.
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    # Só o hash do bcrypt (já com o sal dentro). A senha em si nunca é gravada.
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # O dono do servidor (a primeira conta criada): gerencia os convidados e não tem limite de
    # espaço. As demais contas (convidados) têm todas as funções, cada uma no seu espaço.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


# Vínculo MUITOS-PARA-MUITOS entre notas e itens da agenda: uma nota pode falar de vários itens (o resumo
# da "Prova de Cálculo" e da "Lista 3") e um item pode ter várias notas. Apagar um lado apaga só o vínculo.
note_agenda_link = Table(
    "note_agenda_link",
    Base.metadata,
    Column("note_id", ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True),
    Column("agenda_item_id", ForeignKey("agenda_items.id", ondelete="CASCADE"), primary_key=True),
)


class AgendaItem(Base):
    """Uma tarefa, evento ou compromisso da Agenda Pessoal."""

    __tablename__ = "agenda_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20), default="tarefa")  # tarefa | evento | compromisso
    date: Mapped[date_type] = mapped_column(Date, index=True)
    time: Mapped[str | None] = mapped_column(String(5), default=None)  # "HH:MM"; vazio = o dia todo
    status: Mapped[str] = mapped_column(String(20), default="pendente")  # pendente | concluido | cancelado
    # Etiquetas rápidas ("Prova,Trabalho"), separadas por vírgula; mantêm a caixa de como foram digitadas.
    tags: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # Rotina: repete a partir de `date` (none | daily | weekly | monthly | yearly). Em "weekly", os dias da semana
    # ficam em `recurrence_days` ("0,2,4" = seg, qua, sex; 0 = segunda). `recurrence_until` = último dia (vazio = sem fim).
    recurrence: Mapped[str] = mapped_column(String(10), default="none", server_default=text("'none'"))
    recurrence_days: Mapped[str] = mapped_column(String(20), default="", server_default=text("''"))
    recurrence_until: Mapped[date_type | None] = mapped_column(Date, default=None)
    # Avisar no celular quantos minutos antes do horário (0 = na hora); vazio = sem lembrete. Sem horário, o aviso é às 8h.
    reminder_minutes: Mapped[int | None] = mapped_column(Integer, default=None)

    notes: Mapped[list["Note"]] = relationship(secondary=note_agenda_link, back_populates="agenda_items")


class AgendaCompletion(Base):
    """Uma ocorrência de uma rotina marcada como feita (ex.: "Tomar vitamina" no dia 20). Rotinas não têm um só status."""

    __tablename__ = "agenda_completions"

    item_id: Mapped[int] = mapped_column(ForeignKey("agenda_items.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date_type] = mapped_column(Date, primary_key=True)


class Note(Base):
    """Uma anotação do Bloco de Notas (o conteúdo é Markdown)."""

    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Dono da nota: cada pessoa só enxerga as suas. Se a conta for apagada, as notas vão junto.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # texto longo, sem limite do SQLite
    # Separadas por vírgula, em minúsculas (ex: "trabalho,ideias"). A API as mostra como lista.
    tags: Mapped[str] = mapped_column(String(500), default="")
    # Sempre em UTC; a API devolve com "Z" no fim para o navegador converter para a hora local.
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    # "Relacionado a:" da nota. lazy="selectin": a lista de notas já vem com os vínculos, sem uma consulta por nota.
    agenda_items: Mapped[list[AgendaItem]] = relationship(
        secondary=note_agenda_link, back_populates="notes", lazy="selectin", order_by="AgendaItem.date"
    )
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", passive_deletes=True, order_by="Attachment.id"
    )


class Attachment(Base):
    """Foto ou PDF anexado a uma nota. O arquivo fica no HD, em NOTES_ROOT\\<file_path>."""

    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    file_path: Mapped[str] = mapped_column(String(300))  # relativo a NOTES_ROOT: "<id da nota>/<nome gerado>"
    file_type: Mapped[str] = mapped_column(String(10))  # image | pdf
    file_name: Mapped[str] = mapped_column(String(200))  # o nome original, para mostrar
    content_type: Mapped[str] = mapped_column(String(50))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    note: Mapped[Note] = relationship(back_populates="attachments")


class Project(Base):
    """Um aplicativo/sistema documentado no Hub de Projetos."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Dono do projeto: cada pessoa só enxerga os seus. Apagar a conta apaga os projetos junto.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="em_desenvolvimento")
    # Como foi digitado: "murilo/meu-app", "https://github.com/murilo/meu-app"...
    repository_url: Mapped[str] = mapped_column(String(300), default="")
    content: Mapped[str] = mapped_column(Text, default="")  # a documentação principal, em Markdown
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # Muda ao editar o projeto, adicionar/apagar um registro do changelog ou uma imagem.
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, index=True)


class ProjectLog(Base):
    """Uma linha do changelog manual de um projeto ("Adicionada tela de login")."""

    __tablename__ = "project_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    date: Mapped[date_type] = mapped_column(Date, index=True)  # o dia em que a alteração foi feita
    description: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class ProjectImage(Base):
    """Print de tela de um projeto. O arquivo fica em PROJECTS_ROOT\\<project_id>\\<stored_name>."""

    __tablename__ = "project_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    stored_name: Mapped[str] = mapped_column(String(64), unique=True)  # nome gerado (uuid + extensão)
    original_name: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(50))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class GithubCredential(Base):
    """Token de acesso pessoal (PAT) do GitHub de uma conta. Nunca fica em texto puro no banco."""

    __tablename__ = "github_credentials"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    token_encrypted: Mapped[str] = mapped_column(Text)  # Fernet (ver secretbox.py)
    login: Mapped[str] = mapped_column(String(100), default="")  # usuário do GitHub dono do token
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class VoiceGroup(Base):
    """Um "grupo" da Lounge (sala de voz/vídeo + chat): como um servidor do Discord, mas com um canal só."""

    __tablename__ = "voice_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    icon: Mapped[str] = mapped_column(String(10), default="🎧")  # um emoji, mostrado na barra lateral
    # Categoria (como as do Discord agrupando canais): vazio = fica solto no topo, sem cabeçalho.
    # Mesmo texto = mesma categoria; a barra lateral as agrupa por ordem alfabética.
    category: Mapped[str] = mapped_column(String(60), default="", server_default=text("''"))
    # Limite de gente na chamada de voz (como o "limite de usuários" do Discord): 0 = sem limite.
    capacity: Mapped[int] = mapped_column(default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Money(TypeDecorator):
    """Valor em reais guardado como CENTAVOS inteiros: as somas do banco ficam exatas (sem o erro do ponto flutuante)."""

    impl = Integer
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return int((Decimal(str(value)) * 100).to_integral_value(ROUND_HALF_UP))

    def process_result_value(self, value, dialect):
        return None if value is None else Decimal(value) / 100


class TransactionCategory(Base):
    """Motivo de uma receita ou despesa ("Salário", "Alimentação"...). As padrão (user_id vazio) valem para todos."""

    __tablename__ = "transaction_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Vazio = categoria padrão do sistema (todas as contas a veem, ninguém a altera). Preenchido = criada por essa conta.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, default=None)
    name: Mapped[str] = mapped_column(String(50))
    type: Mapped[str] = mapped_column(String(10))  # income | expense
    icon: Mapped[str] = mapped_column(String(30), default="other")  # um dos CATEGORY_ICONS, ou um emoji da própria pessoa
    color: Mapped[str] = mapped_column(String(9), default="#71717a")  # "#rrggbb"

    @property
    def is_default(self) -> bool:
        return self.user_id is None


class Transaction(Base):
    """Uma receita ou despesa. O valor é sempre positivo; se entra ou sai é o `type`."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(String(200))
    time: Mapped[str | None] = mapped_column(String(5), default=None)
    amount: Mapped[Decimal] = mapped_column(Money)
    date: Mapped[date_type] = mapped_column(Date, index=True)
    type: Mapped[str] = mapped_column(String(10), index=True)  # income | expense (igual ao da categoria)
    # Sem ondelete: apagar uma categoria que ainda tem transações é recusado pela API (a conta inteira, ao ser
    # removida, leva tudo junto porque as duas tabelas apontam para users com CASCADE).
    category_id: Mapped[int] = mapped_column(ForeignKey("transaction_categories.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    # Gasto/receita fixo (conta, assinatura...): "none" | "monthly" | "yearly". A transação com recurrence_parent_id
    # vazio É a âncora da série; cada ocorrência vencida vira uma Transaction de verdade (recurrence="none") apontando
    # para ela — sem ForeignKey de propósito (SQLite não permite ALTER TABLE adicionar FK num banco já existente; a
    # limpeza ao apagar a âncora é feita na API, em finance_routes.py).
    recurrence: Mapped[str] = mapped_column(String(10), default="none", server_default=text("'none'"))
    recurrence_until: Mapped[date_type | None] = mapped_column(Date, default=None)
    recurrence_parent_id: Mapped[int | None] = mapped_column(Integer, index=True, default=None)

    payment_method: Mapped[str | None] = mapped_column(String(20), default=None)
    card_id: Mapped[int | None] = mapped_column(ForeignKey("finance_cards.id"), index=True, default=None)
    status: Mapped[str] = mapped_column(String(10), default="settled", server_default=text("'settled'"))
    settled_at: Mapped[date_type | None] = mapped_column(Date, default=None)

    @hybrid_property
    def financial_date(self):
        return self.settled_at or self.date

    @financial_date.expression
    def financial_date(cls):
        return func.coalesce(cls.settled_at, cls.date)

    installment: Mapped["InstallmentEntry | None"] = relationship(lazy="selectin", cascade="all, delete-orphan", passive_deletes=True)

    @property
    def installment_number(self) -> int | None:
        return self.installment.number if self.installment else None

    @property
    def installment_count(self) -> int | None:
        return self.installment.count if self.installment else None

    card: Mapped["FinanceCard | None"] = relationship(lazy="joined")
    category: Mapped[TransactionCategory] = relationship(lazy="joined")


class FinancePeriod(Base):
    """Um período fechado ("Fechar o mês"): livre, não o mês do calendário — do dia seguinte ao fechamento
    anterior (ou da primeira transação, se nunca fechou nada) até o dia em que a pessoa clicou em "Fechar".
    Uma vez criado não muda mais: é um retrato permanente de um intervalo que já passou."""

    __tablename__ = "finance_periods"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    start_date: Mapped[date_type] = mapped_column(Date)
    end_date: Mapped[date_type] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Investment(Base):
    """Um valor guardado/investido ("200 reais no CDI"): nome livre, quanto, e a taxa que o banco/corretora
    informou — só para referência, nunca usada em nenhum cálculo (a taxa real muda com o tempo; quem
    atualiza é a própria pessoa, quando o banco informar um número novo)."""

    __tablename__ = "investments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    amount: Mapped[Decimal] = mapped_column(Money)
    rate_percent: Mapped[Decimal | None] = mapped_column(Money, default=None)
    rate_period: Mapped[str] = mapped_column(String(20), default="")  # "monthly" | "yearly" | "" — só rótulo
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

class FinancialProfile(Base):
    __tablename__ = "financial_profiles"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    salary_day: Mapped[int] = mapped_column(Integer)
    bills_day: Mapped[int] = mapped_column(Integer)
    cycle_day: Mapped[int] = mapped_column(Integer)
    photo: Mapped[str | None] = mapped_column(Text, default=None)


class FinanceCard(Base):
    __tablename__ = "finance_cards"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    last_four: Mapped[str] = mapped_column(String(4), default="")


class CategoryBudget(Base):
    __tablename__ = "category_budgets"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("transaction_categories.id", ondelete="CASCADE"), primary_key=True)
    amount: Mapped[Decimal] = mapped_column(Money)


class CardCycle(Base):
    __tablename__ = "card_cycles"
    card_id: Mapped[int] = mapped_column(ForeignKey("finance_cards.id", ondelete="CASCADE"), primary_key=True)
    closing_day: Mapped[int] = mapped_column(Integer)
    due_day: Mapped[int] = mapped_column(Integer)


class InstallmentEntry(Base):
    __tablename__ = "installment_entries"
    transaction_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True)
    number: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer)


class SkippedFinanceOccurrence(Base):
    __tablename__ = "skipped_finance_occurrences"
    parent_id: Mapped[int] = mapped_column(ForeignKey("transactions.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date_type] = mapped_column(Date, primary_key=True)


class SavingsGoal(Base):
    __tablename__ = "savings_goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    target: Mapped[Decimal] = mapped_column(Money)
    reserved: Mapped[Decimal] = mapped_column(Money, default=Decimal(0))


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    password_stamp: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[int] = mapped_column(Integer)
