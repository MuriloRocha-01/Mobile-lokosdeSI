from datetime import date as date_type  # "date" sozinho seria escondido pelo campo LogOut.date
from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class UserPublic(BaseModel):
    """O que a API mostra de um usuário. Nunca inclui a senha nem o hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    is_admin: bool = False  # dono do servidor: gerencia os convidados


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=256)


class TokenResponse(BaseModel):
    refresh_token: str | None = None
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # segundos até o token expirar
    user: UserPublic


def _as_utc(value: datetime) -> datetime:
    # o SQLite devolve datas sem fuso; elas foram gravadas em UTC (a API as mostra com "Z" no fim)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]


AgendaType = Literal["tarefa", "evento", "compromisso"]
AgendaStatus = Literal["pendente", "concluido", "cancelado"]
Recurrence = Literal["none", "daily", "weekly", "monthly", "yearly"]
# Repetição de uma transação (conta fixa, assinatura...): sem diária/semanal de propósito — não fazem
# sentido pra dinheiro (e "semanal" arrastaria o conceito de dias da semana, que não existe aqui).
TransactionRecurrence = Literal["none", "monthly", "yearly"]


class AgendaLink(BaseModel):
    """O resumo de um item da agenda (é o que aparece em "Relacionado a:" numa nota)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    type: AgendaType
    date: date_type
    status: AgendaStatus


class NoteOut(BaseModel):
    """Uma nota como a API a mostra (o dono não aparece: cada pessoa só vê as suas)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    tags: list[str]
    updated_at: datetime
    created_at: datetime
    # Itens da agenda ligados a esta nota (o relacionamento "muitos para muitos" se chama agenda_items no banco).
    agenda: list[AgendaLink] = Field(default_factory=list, validation_alias="agenda_items")

    @field_validator("tags", mode="before")
    @classmethod
    def _split_tags(cls, value):
        # no banco as tags ficam em um texto só ("a,b"); aqui viram uma lista
        return [tag for tag in value.split(",") if tag] if isinstance(value, str) else value

    @field_validator("updated_at", "created_at")
    @classmethod
    def _as_utc(cls, value: datetime) -> datetime:
        # o SQLite devolve a data sem fuso; ela foi gravada em UTC
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class NoteCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    agenda_ids: list[int] = []  # criar a nota já ligada a itens da agenda


class NoteUpdate(BaseModel):
    """Atualização parcial: só o que for enviado muda."""

    title: str | None = None
    content: str | None = None
    tags: list[str] | None = None
    agenda_ids: list[int] | None = None  # substitui TODOS os vínculos com a agenda


class AttachmentOut(BaseModel):
    """Um anexo (foto ou PDF) de uma nota."""

    id: int
    file_name: str
    file_type: Literal["image", "pdf"]
    size: int
    created_at: UtcDatetime
    url: str  # caminho da API que devolve o arquivo (precisa do token de login)
    markdown: str  # como o anexo fica dentro do texto da nota


# ---------------------------------------------------------------- Agenda Pessoal


class AgendaItemOut(AgendaLink):
    """Um item da agenda. Numa rotina, cada linha é UMA ocorrência: `date` é o dia dela e `start_date` o começo da rotina."""

    time: str | None = None
    tags: list[str] = []
    note_count: int = 0  # quantas notas apontam para este item
    start_date: date_type | None = None  # dia em que o item (ou a rotina) começa
    recurrence: Recurrence = "none"
    recurrence_days: list[int] = []  # só em "weekly": 0 = segunda ... 6 = domingo
    recurrence_until: date_type | None = None
    reminder_minutes: int | None = None

    @field_validator("tags", mode="before")
    @classmethod
    def _split_tags(cls, value):
        return [tag for tag in value.split(",") if tag] if isinstance(value, str) else value

    @field_validator("recurrence_days", mode="before")
    @classmethod
    def _split_days(cls, value):
        return [int(day) for day in value.split(",") if day] if isinstance(value, str) else value


class AgendaCreate(BaseModel):
    title: str
    type: AgendaType = "tarefa"
    date: date_type
    time: str | None = None  # "HH:MM"
    status: AgendaStatus = "pendente"
    tags: list[str] = []
    recurrence: Recurrence = "none"
    recurrence_days: list[int] = []
    recurrence_until: date_type | None = None
    reminder_minutes: int | None = None


class AgendaUpdate(BaseModel):
    """Atualização parcial: só o que for enviado muda (time="" tira o horário)."""

    title: str | None = None
    type: AgendaType | None = None
    date: date_type | None = None
    time: str | None = None
    status: AgendaStatus | None = None
    tags: list[str] | None = None
    recurrence: Recurrence | None = None
    recurrence_days: list[int] | None = None
    recurrence_until: date_type | None = None  # enviar null tira o fim da rotina
    reminder_minutes: int | None = None  # enviar null tira o lembrete


class OccurrenceUpdate(BaseModel):
    done: bool


class AgendaNoteRef(BaseModel):
    """Uma nota que aponta para um item da agenda."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    updated_at: datetime


# ---------------------------------------------------------------- Hub de Projetos

ProjectStatus = Literal["em_desenvolvimento", "pausado", "concluido"]


class ProjectSummary(BaseModel):
    """O que a grade de cartões precisa (sem a documentação, que pode ser enorme)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: ProjectStatus
    repository_url: str
    updated_at: UtcDatetime
    log_count: int = 0
    image_count: int = 0


class ProjectOut(ProjectSummary):
    content: str
    created_at: UtcDatetime


class ProjectCreate(BaseModel):
    name: str
    status: ProjectStatus = "em_desenvolvimento"
    repository_url: str = ""
    content: str = ""


class ProjectUpdate(BaseModel):
    """Atualização parcial: só o que for enviado muda."""

    name: str | None = None
    status: ProjectStatus | None = None
    repository_url: str | None = None
    content: str | None = None


class LogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    description: str


class LogCreate(BaseModel):
    description: str
    date: date_type | None = None  # sem data = hoje


class ImageOut(BaseModel):
    id: int
    name: str
    content_type: str
    size: int
    created_at: UtcDatetime
    url: str  # caminho local da API que devolve o arquivo (precisa do token de login)
    markdown: str  # pronto para colar na documentação: ![nome](url)


# ---------------------------------------------------------------- Integração com o GitHub


class GithubTokenIn(BaseModel):
    token: str


class GithubStatus(BaseModel):
    """Situação do token. O token em si NUNCA sai do servidor."""

    configured: bool  # há um token salvo e ele pode ser lido neste computador
    login: str | None = None  # dono do token no GitHub
    unreadable: bool = False  # há um token salvo, mas de outro computador: precisa ser salvo de novo


class GithubCommit(BaseModel):
    sha: str
    short_sha: str
    message: str  # primeira linha da mensagem do commit
    date: str  # ISO 8601 (UTC), como o GitHub devolve
    author: str
    url: str


class GithubCommits(BaseModel):
    repository: str  # "dono/nome"
    commits: list[GithubCommit]


class GithubBranch(BaseModel):
    name: str
    sha: str
    protected: bool = False


class GithubBranches(BaseModel):
    repository: str
    branches: list[GithubBranch]


class GithubPullRequest(BaseModel):
    number: int
    title: str
    author: str
    state: str  # "open" | "closed" | "merged"
    draft: bool = False
    url: str
    created_at: str  # ISO 8601 (UTC)
    updated_at: str


class GithubPullRequests(BaseModel):
    repository: str
    pull_requests: list[GithubPullRequest]


class GithubStats(BaseModel):
    repository: str
    url: str
    description: str | None = None
    private: bool
    language: str | None = None  # linguagem principal (None se o GitHub não detectou)
    stars: int
    forks: int
    open_issues: int  # issues abertas (sem pull requests, se o GitHub permitiu contar assim)
    issues_include_pull_requests: bool = False  # True se só deu para usar a contagem geral do GitHub


# ---------------------------------------------------------------- Convidados (só o dono do servidor)


class GuestOut(BaseModel):
    id: int
    name: str
    email: str
    is_admin: bool
    created_at: UtcDatetime
    storage_bytes: int | None = None  # espaço usado na pasta do convidado
    storage_limit: int | None = None  # limite por convidado
    folder: str | None = None  # onde os arquivos dele ficam no HD


# ------------------------------------------------------------------------- finanças

PaymentMethod = Literal["credit_card", "debit_card", "cash", "pix", "meal_voucher"]


class CardCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    last_four: str = Field(default="", pattern=r"^(?:[0-9]{4})?$")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = " ".join(value.split())
        if not value:
            raise ValueError("Informe o nome do cartão.")
        return value


class CardOut(CardCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int


class CardBalance(CardOut):
    income: float
    expense: float
    balance: float


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    salary_day: int = Field(ge=1, le=31)
    bills_day: int = Field(ge=1, le=31)
    cycle_day: int = Field(ge=1, le=31)
    photo: str | None = Field(default=None, max_length=350_000)
    card: CardCreate | None = None


class ProfileOut(BaseModel):
    name: str
    salary_day: int
    bills_day: int
    cycle_day: int
    photo: str | None


TransactionType = Literal["income", "expense"]
_HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: TransactionType
    icon: str
    color: str
    is_default: bool  # categoria padrão do sistema: não pode ser alterada nem apagada


class CategoryCreate(BaseModel):
    name: str
    type: TransactionType
    icon: str = Field(default="other", max_length=64)  # chave padrão (food...) ou um emoji; o limite fino é em _check_icon
    color: str = Field(default="#71717a", pattern=_HEX_COLOR)


class CategoryUpdate(BaseModel):
    name: str | None = None
    icon: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, pattern=_HEX_COLOR)


class TransactionOut(BaseModel):
    status: Literal["pending", "settled"] = "settled"
    settled_at: date_type | None = None
    installment_number: int | None = None
    installment_count: int | None = None
    time: str | None = Field(default=None, pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    model_config = ConfigDict(from_attributes=True)

    id: int
    description: str
    amount: float
    date: date_type
    type: TransactionType
    category_id: int
    category: CategoryOut
    payment_method: PaymentMethod | None = None
    card_id: int | None = None
    card: CardOut | None = None
    created_at: UtcDatetime
    recurrence: TransactionRecurrence = "none"
    recurrence_until: date_type | None = None
    # Preenchido só nas ocorrências geradas automaticamente: aponta para a transação-âncora da série.
    recurrence_parent_id: int | None = None


class TransactionCreate(BaseModel):
    status: Literal["pending", "settled"] | None = None
    time: str | None = Field(default=None, pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    # Vazio = usa o nome da categoria (no celular o motivo costuma bastar).
    description: str = ""
    amount: float = Field(gt=0, le=999_999_999.99)
    date: date_type | None = None  # vazio = hoje
    type: TransactionType
    category_id: int
    payment_method: PaymentMethod | None = None
    card_id: int | None = None
    # "monthly"/"yearly" faz desta transação a âncora de uma série (ver GET /finance/transactions).
    recurrence: TransactionRecurrence = "none"
    recurrence_until: date_type | None = None  # vazio = sem fim


class TransactionUpdate(BaseModel):
    status: Literal["pending", "settled"] | None = None
    time: str | None = Field(default=None, pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    payment_method: PaymentMethod | None = None
    card_id: int | None = None
    description: str | None = None
    amount: float | None = Field(default=None, gt=0, le=999_999_999.99)
    date: date_type | None = None
    type: TransactionType | None = None
    category_id: int | None = None
    recurrence: TransactionRecurrence | None = None
    recurrence_until: date_type | None = None  # enviar null tira o fim da repetição


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int  # quantas existem com esses filtros (para paginar)


class DailyFlow(BaseModel):
    date: date_type
    income: float
    expense: float


class CategoryShare(BaseModel):
    category_id: int
    name: str
    icon: str
    color: str
    total: float
    percent: float  # do total de despesas do mês


class PeriodTotals(BaseModel):
    income: float
    expense: float
    balance: float  # receitas - despesas do período


class CardShare(BaseModel):
    card_id: int
    name: str
    last_four: str
    total: float
    percent: float


class FinanceSummary(BaseModel):
    start: date_type | None = None
    end: date_type | None = None
    expenses_by_card: list[CardShare] = []
    month: str  # "2026-09"
    income: float
    expense: float
    month_balance: float  # receitas - despesas do mês (o que sobrou/faltou)
    balance: float  # saldo ACUMULADO de todas as transações até o fim do mês
    savings_rate: float | None  # % da receita que sobrou; vazio se não houve receita
    # Variação (%) em relação ao mês anterior; vazio quando o mês anterior não tem base de comparação.
    income_change: float | None
    expense_change: float | None
    balance_change: float | None
    savings_change: float | None
    previous: PeriodTotals
    transaction_count: int
    daily: list[DailyFlow]  # um item por dia do mês, com zeros nos dias sem movimento
    expenses_by_category: list[CategoryShare]


class Cashflow(BaseModel):
    start: date_type
    end: date_type
    income: float
    expense: float
    days: list[DailyFlow]  # um item por dia, do mais antigo ao mais recente


# ------------------------------------------------------------------ Lounge (grupos de voz/chat)


class VoiceGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    icon: str
    category: str
    capacity: int


class VoiceGroupCreate(BaseModel):
    name: str
    icon: str = "🎧"
    category: str = ""
    capacity: int = 0


class VoiceGroupUpdate(BaseModel):
    name: str | None = None
    icon: str | None = None
    category: str | None = None
    capacity: int | None = None


class InvitableUser(BaseModel):
    """Alguém que já tem conta neste servidor, para escolher a quem convidar para um grupo."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class MemberOut(BaseModel):
    """Todo mundo que já tem conta neste servidor (você incluído), com quem está com o app aberto agora."""

    id: int
    name: str
    online: bool
    is_self: bool


class CallInvite(BaseModel):
    user_id: int

class WidgetSnapshot(BaseModel):
    month: str
    balance: float
    income: float
    expense: float
    recent: list[TransactionOut]
    days: list[DailyFlow]
