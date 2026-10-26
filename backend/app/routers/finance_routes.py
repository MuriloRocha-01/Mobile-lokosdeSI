"""Finanças pessoais: categorias, transações (receitas e despesas) e os números do painel."""

import calendar
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import begin_write, get_db
from ..models import CATEGORY_ICONS, SkippedFinanceOccurrence, InstallmentEntry, FinanceCard, FinancialProfile, Transaction, TransactionCategory, User
from ..recurrence import occurrences
from ..schemas import (
    Cashflow,
    WidgetSnapshot,
    CardShare,
    PaymentMethod,
    CategoryCreate,
    CategoryOut,
    CategoryShare,
    CategoryUpdate,
    DailyFlow,
    FinanceSummary,
    PeriodTotals,
    TransactionCreate,
    TransactionOut,
    TransactionPage,
    TransactionRecurrence,
    TransactionType,
    TransactionUpdate,
)

router = APIRouter(prefix="/finance", tags=["finance"])

def finance_today() -> date:
    return datetime.now(timezone(timedelta(hours=-3))).date()


MAX_DESCRIPTION_LENGTH = 200
MAX_CATEGORY_NAME_LENGTH = 50
MAX_RANGE_DAYS = 366
MIN_DATE = date(1970, 1, 1)
MAX_DATE = date(2100, 12, 31)
_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_CENT = Decimal("0.01")
_TYPE_LABEL = {"income": "receita", "expense": "despesa"}


# ---------------------------------------------------------------------------- utilidades


def _money(value: float) -> Decimal:
    amount = Decimal(str(value)).quantize(_CENT, rounding=ROUND_HALF_UP)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="O valor precisa ser de pelo menos R$ 0,01.")
    return amount


def _check_date(day: date) -> date:
    if not MIN_DATE <= day <= MAX_DATE:
        raise HTTPException(status_code=400, detail="A data precisa estar entre 1970 e 2100.")
    return day


def _clean_description(text: str) -> str:
    text = " ".join(text.split())
    if len(text) > MAX_DESCRIPTION_LENGTH:
        raise HTTPException(status_code=400, detail=f"A descrição pode ter até {MAX_DESCRIPTION_LENGTH} caracteres.")
    return text


def _clean_category_name(name: str) -> str:
    name = " ".join(name.split())
    if not name:
        raise HTTPException(status_code=400, detail="Dê um nome à categoria.")
    if len(name) > MAX_CATEGORY_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"O nome pode ter até {MAX_CATEGORY_NAME_LENGTH} caracteres.")
    return name


MAX_EMOJI_LENGTH = 16  # pontos de código: um emoji com ZWJ/tom de pele chega a ~11


def _looks_like_emoji(text: str) -> bool:
    """Um emoji (ou poucos) digitado no celular: nada de ASCII, letras, números, espaços ou controles.

    ZWJ (U+200D, família/profissão), seletores de variação, tons de pele e bandeiras passam. Categoria "Cn" (sem
    atribuição) também: é um emoji novo demais para as tabelas Unicode do Python deste servidor.
    """
    if not text or len(text) > MAX_EMOJI_LENGTH:
        return False
    for ch in text:
        if ch.isascii():
            return False
        if ch == "‍" or "\U000e0020" <= ch <= "\U000e007f":  # ZWJ e "tags" das bandeiras de região (🏴󠁧󠁢󠁥󠁮󠁧󠁿)
            continue
        category = unicodedata.category(ch)
        if category != "Cn" and category[0] in "LNZC":
            return False
    return True


def _check_icon(icon: str) -> str:
    """O ícone de uma categoria: uma das chaves padrão (food, salary...) ou um emoji escolhido pela pessoa."""
    icon = icon.strip()
    if icon in CATEGORY_ICONS or _looks_like_emoji(icon):
        return icon
    raise HTTPException(status_code=400, detail="Ícone inválido. Escolha um emoji (ou um dos ícones padrão).")


def _visible(user: User):
    """Categorias que esta conta enxerga: as padrão do sistema e as que ela mesma criou."""
    return or_(TransactionCategory.user_id.is_(None), TransactionCategory.user_id == user.id)


def _get_visible_category(db: Session, user: User, category_id: int) -> TransactionCategory:
    category = db.scalar(select(TransactionCategory).where(TransactionCategory.id == category_id, _visible(user)))
    if category is None:
        raise HTTPException(status_code=404, detail="Categoria não encontrada.")
    return category


def _get_own_transaction(db: Session, user: User, transaction_id: int) -> Transaction:
    transaction = db.scalar(select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user.id))
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transação não encontrada.")
    return transaction


def _clean_recurrence(recurrence: TransactionRecurrence, first: date, until: date | None) -> tuple[TransactionRecurrence, date | None]:
    """Valida a repetição de um gasto/receita fixo e devolve (tipo, último dia). Sem dias da semana: não existem pra dinheiro."""
    if recurrence == "none":
        return "none", None
    if until is not None and until < first:
        raise HTTPException(status_code=400, detail="O fim da repetição não pode ser antes do começo.")
    return recurrence, until


def _materialize_due(db: Session, user: User) -> None:
    """Lança sozinhas as ocorrências já vencidas de cada série (conta fixa, assinatura...) desta conta.

    Cada série tem uma transação-âncora (`recurrence != "none"`, `recurrence_parent_id` vazio). Rodar isso
    a cada vez que a pessoa abre as Finanças substitui um agendador: não existe nenhum nesse backend, e
    "só quando alguém olhar" já garante que a transação aparece assim que a data vence (ou depois, se o
    app ficou fechado — todas as que faltarem são criadas de uma vez).
    """
    # Leituras paralelas do painel não podem criar duas ocorrências do mesmo mês.
    begin_write(db)
    anchors = db.scalars(
        select(Transaction).where(Transaction.user_id == user.id, Transaction.recurrence != "none", Transaction.recurrence_parent_id.is_(None))
    ).all()
    if not anchors:
        db.commit()
        return
    today = finance_today()
    for anchor in anchors:
        skipped = set(db.scalars(select(SkippedFinanceOccurrence.day).where(SkippedFinanceOccurrence.parent_id == anchor.id)))
        latest_child = db.scalar(select(func.max(Transaction.date)).where(Transaction.recurrence_parent_id == anchor.id))
        latest = max(anchor.date, latest_child) if latest_child else anchor.date
        if latest >= today:
            continue
        for day in occurrences(anchor.date, anchor.recurrence, [], anchor.recurrence_until, latest + timedelta(days=1), today):
            if day in skipped:
                continue
            db.add(
                Transaction(
                    user_id=user.id,
                    description=anchor.description,
                    amount=anchor.amount,
                    date=day,
                    type=anchor.type,
                    category_id=anchor.category_id,
                    payment_method=anchor.payment_method,
                    card_id=anchor.card_id,
                    status="pending",
                    recurrence="none",
                    recurrence_parent_id=anchor.id,
                )
            )
    db.commit()


def catch_up_recurring(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Dependência: lança o que estiver vencido antes de qualquer leitura de dinheiro (lista, resumo, fluxo)."""
    _materialize_due(db, user)


# ---------------------------------------------------------------------------- categorias


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    type: TransactionType | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TransactionCategory]:
    """As categorias que você pode usar (receitas primeiro), as padrão e as suas."""
    query = select(TransactionCategory).where(_visible(user))
    if type is not None:
        query = query.where(TransactionCategory.type == type)
    return list(db.scalars(query.order_by(TransactionCategory.type.desc(), TransactionCategory.id)))


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TransactionCategory:
    name = _clean_category_name(payload.name)
    _name_is_free(db, user, name, payload.type)
    category = TransactionCategory(user_id=user.id, name=name, type=payload.type, icon=_check_icon(payload.icon), color=payload.color.lower())
    db.add(category)
    db.commit()
    return category


def _name_is_free(db: Session, user: User, name: str, type_: str, ignore_id: int | None = None) -> None:
    query = select(TransactionCategory.id).where(
        _visible(user), TransactionCategory.type == type_, func.lower(TransactionCategory.name) == name.lower()
    )
    if ignore_id is not None:
        query = query.where(TransactionCategory.id != ignore_id)
    if db.scalar(query) is not None:
        raise HTTPException(status_code=409, detail=f"Já existe uma categoria de {_TYPE_LABEL[type_]} chamada “{name}”.")


def _get_own_category(db: Session, user: User, category_id: int) -> TransactionCategory:
    category = _get_visible_category(db, user, category_id)
    if category.user_id is None:
        raise HTTPException(status_code=403, detail="As categorias padrão não podem ser alteradas nem apagadas.")
    return category


@router.put("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, payload: CategoryUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TransactionCategory:
    category = _get_own_category(db, user, category_id)
    if payload.name is not None:
        name = _clean_category_name(payload.name)
        _name_is_free(db, user, name, category.type, ignore_id=category.id)
        category.name = name
    if payload.icon is not None:
        category.icon = _check_icon(payload.icon)
    if payload.color is not None:
        category.color = payload.color.lower()
    db.commit()
    return category


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    category = _get_own_category(db, user, category_id)
    used = db.scalar(select(func.count()).select_from(Transaction).where(Transaction.category_id == category.id))
    if used:
        raise HTTPException(status_code=409, detail=f"Essa categoria tem {used} transação(ões). Mude ou apague essas transações antes.")
    db.delete(category)
    db.commit()
    return Response(status_code=204)


def _payment(db: Session, user: User, method: str | None, card_id: int | None):
    if method in ("cash", None):
        if card_id is not None:
            raise HTTPException(400, "Dinheiro ou forma não informada não pode ter cartão.")
        return None
    if method in ("credit_card", "debit_card", "meal_voucher") and card_id is None:
        raise HTTPException(400, "Selecione o cartão para esta forma de pagamento.")
    if card_id is None:
        return None
    card = db.scalar(select(FinanceCard).where(FinanceCard.id == card_id, FinanceCard.user_id == user.id))
    if card is None:
        raise HTTPException(404, "Cartão não encontrado.")
    return card


def _filters(type=None, category_id=None, payment_method=None, card_id=None):
    conditions = []
    for column, value in ((Transaction.type, type), (Transaction.category_id, category_id), (Transaction.payment_method, payment_method), (Transaction.card_id, card_id)):
        if value is not None:
            conditions.append(column == value)
    return conditions


def _cycle_range(today: date, day: int):
    def boundary(year, month):
        return date(year, month, min(day, calendar.monthrange(year, month)[1]))
    start = boundary(today.year, today.month)
    if start > today:
        previous = today.replace(day=1) - timedelta(days=1)
        start = boundary(previous.year, previous.month)
    following = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start, boundary(following.year, following.month) - timedelta(days=1)


# ---------------------------------------------------------------------------- transações


@router.get("/transactions", response_model=TransactionPage)
def list_transactions(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    type: TransactionType | None = None,
    category_id: int | None = None,
    payment_method: PaymentMethod | None = None,
    card_id: int | None = None,
    status: str | None = Query(default=None, pattern="^(pending|settled)$"),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _: None = Depends(catch_up_recurring),
) -> TransactionPage:
    """Suas transações, da mais recente para a mais antiga, com filtros opcionais e paginação."""
    day_column = Transaction.financial_date if status == "settled" else Transaction.date
    conditions = [Transaction.user_id == user.id]
    if status is not None:
        conditions.append(Transaction.status == status)
    if date_from is not None:
        conditions.append(day_column >= date_from)
    if date_to is not None:
        conditions.append(day_column <= date_to)
    if type is not None:
        conditions.append(Transaction.type == type)
    if category_id is not None:
        conditions.append(Transaction.category_id == category_id)
    conditions.extend(_filters(payment_method=payment_method, card_id=card_id))
    if q and q.strip():
        conditions.append(Transaction.description.contains(q.strip(), autoescape=True))
    total = db.scalar(select(func.count()).select_from(Transaction).where(*conditions)) or 0
    rows = db.scalars(select(Transaction).where(*conditions).order_by(day_column.desc(), Transaction.id.desc()).limit(limit).offset(offset))
    return TransactionPage(items=[TransactionOut.model_validate(row) for row in rows], total=total)


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Transaction:
    category = _get_visible_category(db, user, payload.category_id)
    if category.type != payload.type:
        raise HTTPException(status_code=400, detail=f"“{category.name}” é uma categoria de {_TYPE_LABEL[category.type]}.")
    when = _check_date(payload.date or finance_today())
    recurrence, until = _clean_recurrence(payload.recurrence, when, payload.recurrence_until)
    card = _payment(db, user, payload.payment_method, payload.card_id)
    status = payload.status or ("pending" if when > finance_today() or payload.payment_method == "credit_card" else "settled")
    transaction = Transaction(
        status=status,
        settled_at=min(when, finance_today()) if status == "settled" else None,
        time=payload.time,
        payment_method=payload.payment_method,
        card=card,
        user_id=user.id,
        description=_clean_description(payload.description) or category.name,
        amount=_money(payload.amount),
        date=when,
        type=payload.type,
        category_id=category.id,
        recurrence=recurrence,
        recurrence_until=until,
    )
    db.add(transaction)
    db.commit()
    return transaction


@router.get("/transactions/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Transaction:
    return _get_own_transaction(db, user, transaction_id)


@router.put("/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(transaction_id: int, payload: TransactionUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Transaction:
    """Atualização parcial: só o que for enviado muda. Trocar o tipo exige uma categoria do novo tipo."""
    transaction = _get_own_transaction(db, user, transaction_id)
    sent = payload.model_fields_set
    method = payload.payment_method if "payment_method" in sent else transaction.payment_method
    card_id = payload.card_id if "card_id" in sent else transaction.card_id
    card = _payment(db, user, method, card_id)
    new_type = payload.type or transaction.type
    if db.get(InstallmentEntry, transaction.id) and (new_type != "expense" or (payload.recurrence and payload.recurrence != "none")):
        raise HTTPException(400, "Uma parcela deve continuar como despesa sem repetição automática.")
    category = _get_visible_category(db, user, payload.category_id if payload.category_id is not None else transaction.category_id)
    if category.type != new_type:
        raise HTTPException(status_code=400, detail=f"“{category.name}” é uma categoria de {_TYPE_LABEL[category.type]}.")
    if payload.description is not None:
        transaction.description = _clean_description(payload.description) or category.name
    if payload.amount is not None:
        transaction.amount = _money(payload.amount)
    if payload.date is not None:
        transaction.date = _check_date(payload.date)
    if "time" in sent:
        transaction.time = payload.time
    if payload.status is not None and payload.status != transaction.status:
        transaction.status = payload.status
        transaction.settled_at = finance_today() if payload.status == "settled" else None
    transaction.payment_method = method
    transaction.card = card
    transaction.type = new_type
    transaction.category = category  # (e não só o category_id: a resposta precisa trazer a categoria NOVA)
    if {"recurrence", "recurrence_until"} & sent:
        if transaction.recurrence_parent_id is not None:
            raise HTTPException(status_code=400, detail="Essa transação foi lançada automaticamente por uma repetição. Mude a repetição na transação original.")
        recurrence = payload.recurrence if payload.recurrence is not None else transaction.recurrence
        until = payload.recurrence_until if "recurrence_until" in sent else transaction.recurrence_until
        transaction.recurrence, transaction.recurrence_until = _clean_recurrence(recurrence, transaction.date, until)
    db.commit()
    return transaction


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    transaction = _get_own_transaction(db, user, transaction_id)
    if transaction.recurrence_parent_id is not None:
        if db.get(SkippedFinanceOccurrence, (transaction.recurrence_parent_id, transaction.date)) is None:
            db.add(SkippedFinanceOccurrence(parent_id=transaction.recurrence_parent_id, day=transaction.date))
    # Apagar a âncora de uma série não pode levar junto o que já foi gasto de verdade: solta as ocorrências
    # geradas por ela (viram transações avulsas, como se tivessem sido lançadas na mão).
    db.query(Transaction).filter(Transaction.recurrence_parent_id == transaction.id).update({"recurrence_parent_id": None})
    db.delete(transaction)
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------------------- números do painel


def _per_day(db: Session, user: User, start: date, end: date, filters=(), status="settled", by_settlement=True) -> dict[date, dict[str, Decimal]]:
    day_column = Transaction.financial_date if by_settlement else Transaction.date
    conditions = [Transaction.user_id == user.id, day_column >= start, day_column <= end, *filters]
    if status:
        conditions.append(Transaction.status == status)
    rows = db.execute(select(day_column, Transaction.type, func.sum(Transaction.amount)).where(*conditions).group_by(day_column, Transaction.type)).all()
    days = {}
    for day, kind, total in rows:
        days.setdefault(day, {"income": Decimal(0), "expense": Decimal(0)})[kind] = total
    return days


def _flow(per_day: dict[date, dict[str, Decimal]], start: date, end: date) -> list[DailyFlow]:
    """Um item por dia (com zeros nos dias sem movimento), do mais antigo ao mais recente."""
    result = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        values = per_day.get(day, {})
        result.append(DailyFlow(date=day, income=float(values.get("income", 0)), expense=float(values.get("expense", 0))))
    return result


def _total(db: Session, user: User, type_: str, start: date | None = None, end: date | None = None, filters=()) -> Decimal:
    conditions = [Transaction.user_id == user.id, Transaction.status == "settled", Transaction.type == type_, *filters]
    if start is not None:
        conditions.append(Transaction.financial_date >= start)
    if end is not None:
        conditions.append(Transaction.financial_date <= end)
    return db.scalar(select(func.coalesce(func.sum(Transaction.amount), 0)).where(*conditions)) or Decimal(0)


def _change(current: Decimal, previous: Decimal) -> float | None:
    """Variação em % de um valor em relação ao anterior; sem base de comparação (anterior zero) não há %."""
    if previous == 0:
        return None
    return round(float((current - previous) / abs(previous) * 100), 1)


def _month_range(month: str | None) -> tuple[date, date]:
    if month is None:
        today = finance_today()
        year, number = today.year, today.month
    else:
        match = _MONTH.match(month)
        if not match:
            raise HTTPException(status_code=400, detail="Use o mês no formato AAAA-MM (ex.: 2026-09).")
        year, number = int(match.group(1)), int(match.group(2))
    return date(year, number, 1), date(year, number, calendar.monthrange(year, number)[1])


@router.get("/summary", response_model=FinanceSummary)
def summary(
    month: str | None = Query(default=None, description="AAAA-MM; vazio = o mês atual"),
    cycle: bool = False,
    today: date | None = None,
    card_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _: None = Depends(catch_up_recurring),
) -> FinanceSummary:
    """Os números do mês: receitas, despesas, saldo, comparação com o mês anterior e o movimento dia a dia."""
    start, end = _month_range(month)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end.replace(day=1)

    if cycle:
        profile = db.get(FinancialProfile, user.id)
        start, end = _cycle_range(_check_date(today or finance_today()), profile.cycle_day if profile else 1)
        prev_start, prev_end = _cycle_range(start - timedelta(days=1), profile.cycle_day if profile else 1)
    filters = _filters(card_id=card_id)
    per_day = _per_day(db, user, start, end, filters)
    income = sum((d["income"] for d in per_day.values()), Decimal(0))
    expense = sum((d["expense"] for d in per_day.values()), Decimal(0))
    month_balance = income - expense

    prev_income = _total(db, user, "income", prev_start, prev_end, filters)
    prev_expense = _total(db, user, "expense", prev_start, prev_end, filters)
    prev_month_balance = prev_income - prev_expense
    # Saldo acumulado: tudo o que já entrou menos tudo o que já saiu, até o fim do mês (e até o fim do anterior).
    balance = _total(db, user, "income", end=end, filters=filters) - _total(db, user, "expense", end=end, filters=filters)
    prev_balance = _total(db, user, "income", end=prev_end, filters=filters) - _total(db, user, "expense", end=prev_end, filters=filters)

    shares = db.execute(
        select(TransactionCategory.id, TransactionCategory.name, TransactionCategory.icon, TransactionCategory.color, func.sum(Transaction.amount).label("total"))
        .join(TransactionCategory, Transaction.category_id == TransactionCategory.id)
        .where(Transaction.user_id == user.id, Transaction.status == "settled", Transaction.type == "expense", Transaction.financial_date >= start, Transaction.financial_date <= end, *filters)
        .group_by(TransactionCategory.id)
        .order_by(func.sum(Transaction.amount).desc())
    ).all()

    count = db.scalar(select(func.count()).select_from(Transaction).where(Transaction.user_id == user.id, Transaction.status == "settled", Transaction.financial_date >= start, Transaction.financial_date <= end, *filters)) or 0
    prev_rate = (prev_month_balance / prev_income * 100) if prev_income else None
    rate = (month_balance / income * 100) if income else None

    card_shares = db.execute(select(FinanceCard.id, FinanceCard.name, FinanceCard.last_four, func.sum(Transaction.amount).label("total")).join(FinanceCard, Transaction.card_id == FinanceCard.id).where(Transaction.user_id == user.id, Transaction.status == "settled", Transaction.type == "expense", Transaction.financial_date >= start, Transaction.financial_date <= end, *filters).group_by(FinanceCard.id).order_by(func.sum(Transaction.amount).desc())).all()
    return FinanceSummary(
        start=start, end=end,
        expenses_by_card=[CardShare(card_id=row.id, name=row.name, last_four=row.last_four, total=float(row.total), percent=round(float(row.total / expense * 100), 1) if expense else 0) for row in card_shares],
        month=f"{start.year:04d}-{start.month:02d}",
        income=float(income),
        expense=float(expense),
        month_balance=float(month_balance),
        balance=float(balance),
        savings_rate=round(float(rate), 1) if rate is not None else None,
        income_change=_change(income, prev_income),
        expense_change=_change(expense, prev_expense),
        balance_change=_change(balance, prev_balance),
        savings_change=_change(month_balance, prev_month_balance),
        previous=PeriodTotals(income=float(prev_income), expense=float(prev_expense), balance=float(prev_month_balance)),
        transaction_count=count,
        daily=_flow(per_day, start, end),
        expenses_by_category=[
            CategoryShare(
                category_id=row.id,
                name=row.name,
                icon=row.icon,
                color=row.color,
                total=float(row.total),
                percent=round(float(row.total / expense * 100), 1) if expense else 0.0,
            )
            for row in shares
        ],
    )


@router.get("/cashflow", response_model=Cashflow)
def cashflow(
    status: str = Query(default="settled", pattern="^(all|pending|settled)$"),
    by_settlement: bool = True,
    days: int = Query(default=30, ge=1, le=366),
    today: date | None = Query(default=None, description="O dia de hoje no seu computador/celular; vazio = o do servidor"),
    start: date | None = Query(default=None, description="Início de um período qualquer (use junto com 'end')"),
    end: date | None = Query(default=None, description="Fim do período, inclusive (no máximo 366 dias depois do início)"),
    type: TransactionType | None = None,
    category_id: int | None = None,
    payment_method: PaymentMethod | None = None,
    card_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _: None = Depends(catch_up_recurring),
) -> Cashflow:
    """Receitas e despesas de cada dia, para o gráfico: os últimos N dias (até hoje) ou um período qualquer (start..end)."""
    if start is not None or end is not None:
        if start is None or end is None:
            raise HTTPException(status_code=400, detail="Informe o início e o fim do período.")
        if start > end:
            raise HTTPException(status_code=400, detail="O início não pode ser depois do fim.")
        if (end - start).days + 1 > MAX_RANGE_DAYS:
            raise HTTPException(status_code=400, detail=f"O período pode ter no máximo {MAX_RANGE_DAYS} dias.")
        _check_date(start)
        _check_date(end)
    else:
        end = today or finance_today()
        start = end - timedelta(days=days - 1)
    per_day = _per_day(db, user, start, end, _filters(type, category_id, payment_method, card_id), status=None if status == "all" else status, by_settlement=by_settlement)
    flow = _flow(per_day, start, end)
    return Cashflow(start=start, end=end, income=sum(d.income for d in flow), expense=sum(d.expense for d in flow), days=flow)


@router.get('/widget', response_model=WidgetSnapshot)
def widget_snapshot(today: date, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = _check_date(today)
    catch_up_recurring(user=user, db=db)
    start = today.replace(day=1)
    end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    recent = list(db.scalars(select(Transaction).where(Transaction.user_id == user.id, Transaction.status == "settled", Transaction.type == 'expense', Transaction.financial_date >= start, Transaction.financial_date <= today).order_by(Transaction.financial_date.desc(), Transaction.time.desc().nullslast(), Transaction.id.desc()).limit(5)))
    return WidgetSnapshot(month=today.strftime('%Y-%m'), balance=float(_total(db,user,'income',end=today)-_total(db,user,'expense',end=today)), income=float(_total(db,user,'income',start,today)), expense=float(_total(db,user,'expense',start,today)), recent=[TransactionOut.model_validate(t) for t in recent], days=_flow(_per_day(db,user,start,end),start,end))
