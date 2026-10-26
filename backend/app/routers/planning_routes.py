"""Planejamento estimado: nunca lança repetições futuras nem registra pagamentos de fatura."""
import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import SavingsGoal, SkippedFinanceOccurrence, CardCycle, CategoryBudget, FinanceCard, InstallmentEntry, Transaction, TransactionCategory, User
from ..recurrence import occurrences
from ..schemas import TransactionCreate
from .finance_routes import finance_today, _total, catch_up_recurring, _check_date, _clean_description, _get_visible_category, _money, _payment, _visible

router = APIRouter(prefix="/finance/planning", tags=["planejamento"])


def month_day(day: date, offset: int, number: int = 1) -> date:
    year, month = divmod(day.year * 12 + day.month - 1 + offset, 12)
    return date(year, month + 1, min(number, calendar.monthrange(year, month + 1)[1]))


def invoice_due(day: date, cycle: CardCycle) -> date:
    # Compras até o fechamento (inclusive) entram nessa fatura.
    closing = month_day(day, 0, cycle.closing_day)
    if day > closing:
        closing = month_day(day, 1, cycle.closing_day)
    due = month_day(closing, 0, cycle.due_day)
    return month_day(closing, 1, cycle.due_day) if due <= closing else due


def own_card(db: Session, user: User, card_id: int):
    card = db.scalar(select(FinanceCard).where(FinanceCard.id == card_id, FinanceCard.user_id == user.id))
    if card is None:
        raise HTTPException(404, "Cartão não encontrado.")
    return card


class BudgetInput(BaseModel):
    amount: Decimal = Field(gt=0, le=999_999_999.99, decimal_places=2)


class CycleInput(BaseModel):
    closing_day: int = Field(ge=1, le=31)
    due_day: int = Field(ge=1, le=31)


class InstallmentsInput(TransactionCreate):
    count: int = Field(ge=2, le=120)
    # Valor real cobrado em cada parcela. Ausente: divide o total sem juros.
    installment_amount: Decimal | None = Field(default=None, gt=0, le=999_999_999.99, decimal_places=2)


@router.put("/budgets/{category_id}")
def save_budget(category_id: int, payload: BudgetInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    category = _get_visible_category(db, user, category_id)
    if category.type != "expense":
        raise HTTPException(400, "Escolha uma categoria de despesa.")
    row = db.get(CategoryBudget, (user.id, category_id))
    if row is None:
        row = CategoryBudget(user_id=user.id, category_id=category_id)
        db.add(row)
    row.amount = payload.amount
    db.commit()
    return {"amount": float(row.amount)}


@router.delete("/budgets/{category_id}", status_code=204)
def delete_budget(category_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(CategoryBudget, (user.id, category_id))
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


@router.put("/cards/{card_id}")
def save_cycle(card_id: int, payload: CycleInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    own_card(db, user, card_id)
    row = db.get(CardCycle, card_id)
    if row is None:
        row = CardCycle(card_id=card_id)
        db.add(row)
    row.closing_day, row.due_day = payload.closing_day, payload.due_day
    db.commit()
    return payload


@router.post("/installments", status_code=201)
def add_installments(payload: InstallmentsInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.type != "expense" or payload.recurrence != "none":
        raise HTTPException(400, "Parcelas são despesas sem repetição automática.")
    category = _get_visible_category(db, user, payload.category_id)
    if category.type != "expense":
        raise HTTPException(400, "Escolha uma categoria de despesa.")
    card = _payment(db, user, payload.payment_method, payload.card_id)
    first = _check_date(payload.date or finance_today())
    _check_date(month_day(first, payload.count - 1, first.day))
    cycle = db.get(CardCycle, card.id) if card and payload.payment_method == "credit_card" else None
    if cycle and first != month_day(first, 0, cycle.due_day):
        raise HTTPException(400, f"A primeira parcela deste cartão deve vencer no dia {cycle.due_day} (ou no último dia de um mês mais curto). Ajuste a data.")
    principal = int(_money(payload.amount) * 100)
    total = int(payload.installment_amount * 100) * payload.count if payload.installment_amount is not None else principal
    if total < principal or total > 99_999_999_999:
        raise HTTPException(400, "O total das parcelas precisa ser igual ou maior que o valor da compra e respeitar o limite de valor.")
    base, remainder = divmod(total, payload.count)
    if base < 1:
        raise HTTPException(400, "Cada parcela precisa ter pelo menos R$ 0,01.")
    description = _clean_description(payload.description) or category.name
    if len(description) > 175:
        raise HTTPException(400, "Use até 175 caracteres na descrição da compra parcelada.")
    ids = []
    for index in range(payload.count):
        row = Transaction(user_id=user.id, description=f"{description} · Parcela {index + 1}/{payload.count}",
                          amount=Decimal(base + (1 if index < remainder else 0)) / 100,
                          date=month_day(first, index, first.day), time=payload.time, type="expense",
                          category_id=category.id, payment_method=payload.payment_method, card=card, recurrence="none", status="pending")
        db.add(row)
        db.flush()
        db.add(InstallmentEntry(transaction_id=row.id, number=index + 1, count=payload.count))
        ids.append(row.id)
    db.commit()
    return {"ids": ids, "total": total / 100, "interest": (total - principal) / 100}


def planned_rows(db: Session, user: User, end: date):
    """Ocorrências projetadas só em memória; uma ocorrência já editada não é duplicada."""
    rows = list(db.scalars(select(Transaction).where(Transaction.user_id == user.id, ((Transaction.date <= end) | (Transaction.status == "settled")))))
    anchors = [row for row in rows if row.recurrence != "none" and row.recurrence_parent_id is None]
    # Toda ocorrência materializada pertence a um mês/ano da série, mesmo se mudou de dia.
    seen = {(row.recurrence_parent_id, row.date.strftime("%Y-%m")) for row in rows if row.recurrence_parent_id}
    suppressed = set(db.execute(select(SkippedFinanceOccurrence.parent_id, SkippedFinanceOccurrence.day).join(Transaction, Transaction.id == SkippedFinanceOccurrence.parent_id).where(Transaction.user_id == user.id)).all())
    result = [(row, row.date, False) for row in rows]
    for anchor in anchors:
        for day in occurrences(anchor.date, anchor.recurrence, [], anchor.recurrence_until, anchor.date + timedelta(days=1), end):
            if (anchor.id, day.strftime("%Y-%m")) not in seen and (anchor.id, day) not in suppressed:
                result.append((anchor, day, True))
    return result


@router.get("")
def planning(today: date, months: int = Query(default=6, ge=1, le=12), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_date(today)
    end = _check_date(month_day(today, months) - timedelta(days=1))
    cards = list(db.scalars(select(FinanceCard).where(FinanceCard.user_id == user.id)))
    cycles = {row.card_id: row for row in db.scalars(select(CardCycle).join(FinanceCard).where(FinanceCard.user_id == user.id))}
    installment_ids = set(db.scalars(select(InstallmentEntry.transaction_id).join(Transaction).where(Transaction.user_id == user.id)))
    budgets = {row.category_id: row.amount for row in db.scalars(select(CategoryBudget).where(CategoryBudget.user_id == user.id))}
    rows = planned_rows(db, user, end)
    monthly = {month_day(today, n).strftime("%Y-%m"): {"income": Decimal(0), "expense": Decimal(0)} for n in range(months)}
    spent = {}
    invoices = {}
    opening = Decimal(0)
    overdue = {"income": Decimal(0), "expense": Decimal(0)}
    for row, day, projected in rows:
        # Parcelas usam a data de vencimento informada; compras avulsas usam o ciclo do cartão.
        credit = row.payment_method == "credit_card" and row.type == "expense"
        cycle = cycles.get(row.card_id)
        due = (month_day(day, 0, cycle.due_day) if row.id in installment_ids else invoice_due(day, cycle)) if credit and cycle else day
        signed = row.amount if row.type == "income" else -row.amount
        if not projected and row.status == "settled":
            if row.financial_date <= today:
                opening += signed
        else:
            bucket = max(due, today).strftime("%Y-%m")
            if bucket in monthly:
                monthly[bucket][row.type] += row.amount
            if due < today:
                overdue[row.type] += row.amount
        if row.type == "expense" and row.financial_date.strftime("%Y-%m") == today.strftime("%Y-%m") and row.financial_date <= today and not projected and row.status == "settled":
            spent[row.category_id] = spent.get(row.category_id, Decimal(0)) + row.amount
        if credit and cycle and due.strftime("%Y-%m") in monthly:
            key = (row.card_id, due.strftime("%Y-%m"))
            invoice = invoices.setdefault(key, {"card_id": row.card_id, "month": key[1], "due": month_day(due, 0, cycle.due_day), "total": Decimal(0), "items": []})
            invoice["total"] += row.amount
            invoice["items"].append({"id": None if projected else row.id, "description": row.description, "date": day, "amount": float(row.amount), "projected": projected, "status": "pending" if projected else row.status})
    balance = opening
    forecast = []
    for month, values in monthly.items():
        balance += values["income"] - values["expense"]
        forecast.append({"month": month, "income": float(values["income"]), "expense": float(values["expense"]), "balance": float(balance)})
    categories = list(db.scalars(select(TransactionCategory).where(_visible(user), TransactionCategory.type == "expense")))
    return {
        "today": today, "opening": float(opening), "overdue": {k: float(v) for k, v in overdue.items()}, "forecast": forecast,
        "budgets": [{"category_id": c.id, "name": c.name, "icon": c.icon, "color": c.color, "limit": float(budgets[c.id]) if c.id in budgets else None, "spent": float(spent.get(c.id, 0))} for c in categories],
        "cards": [{"id": c.id, "name": c.name, "last_four": c.last_four, "closing_day": cycles[c.id].closing_day if c.id in cycles else None, "due_day": cycles[c.id].due_day if c.id in cycles else None} for c in cards],
        "invoices": [{**v, "total": float(v["total"])} for v in invoices.values()],
    }

class GoalInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    target: Decimal = Field(gt=0, le=999_999_999.99, decimal_places=2)
    reserved: Decimal = Field(default=0, ge=0, le=999_999_999.99, decimal_places=2)


def goal_output(row):
    return {"id": row.id, "name": row.name, "target": float(row.target), "reserved": float(row.reserved)}


@router.get("/overview")
def overview(today: date, user: User = Depends(get_current_user), db: Session = Depends(get_db), _: None = Depends(catch_up_recurring)):
    _check_date(today)
    goals = list(db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user.id).order_by(SavingsGoal.id)))
    reserved = sum((row.reserved for row in goals), Decimal(0))
    balance = _total(db, user, "income", end=today) - _total(db, user, "expense", end=today)
    totals = {"income": Decimal(0), "expense": Decimal(0)}
    for kind, amount in db.execute(select(Transaction.type, func.sum(Transaction.amount)).where(Transaction.user_id == user.id, Transaction.status == "pending").group_by(Transaction.type)):
        totals[kind] = amount
    subscriptions = []
    monthly = Decimal(0)
    for row in db.scalars(select(Transaction).where(Transaction.user_id == user.id, Transaction.type == "expense", Transaction.recurrence != "none", Transaction.recurrence_parent_id.is_(None), (Transaction.recurrence_until.is_(None) | (Transaction.recurrence_until >= today))).order_by(Transaction.description)):
        value = row.amount / 12 if row.recurrence == "yearly" else row.amount
        monthly += value
        subscriptions.append({"id": row.id, "name": row.description, "amount": float(row.amount), "recurrence": row.recurrence, "monthly": float(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)), "annual": float((value * 12).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)), "until": row.recurrence_until, "starts": row.date})
    return {"balance": float(balance), "reserved": float(reserved), "available": float(balance-reserved), "goals": [goal_output(row) for row in goals], "pending": {k: float(v) for k,v in totals.items()}, "subscriptions": subscriptions, "monthly": float(monthly.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)), "annual": float((monthly*12).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))}


def write_goal(payload: GoalInput, user: User, db: Session, goal_id: int | None = None):
    name = ' '.join(payload.name.split())
    if not name:
        raise HTTPException(400, "Informe o nome da meta.")
    if payload.reserved > payload.target:
        raise HTTPException(400, "A reserva não pode ultrapassar o valor da meta.")
    # Serializa saldo + reserva: duas requisições não separam o mesmo dinheiro.
    db.execute(text("BEGIN IMMEDIATE"))
    row = db.scalar(select(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id)) if goal_id else None
    if goal_id and row is None:
        raise HTTPException(404, "Meta não encontrada.")
    old = row.reserved if row else Decimal(0)
    reserved = db.scalar(select(func.sum(SavingsGoal.reserved)).where(SavingsGoal.user_id == user.id)) or Decimal(0)
    balance = _total(db, user, "income", end=finance_today()) - _total(db, user, "expense", end=finance_today())
    if payload.reserved > old and payload.reserved - old > balance - reserved:
        raise HTTPException(409, "Saldo livre insuficiente. Confirme seus recebimentos ou diminua o valor reservado.")
    if row is None:
        row = SavingsGoal(user_id=user.id)
        db.add(row)
    row.name, row.target, row.reserved = name, payload.target, payload.reserved
    db.commit()
    return goal_output(row)


@router.post("/goals", status_code=201)
def create_goal(payload: GoalInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return write_goal(payload, user, db)


@router.put("/goals/{goal_id}")
def update_goal(goal_id: int, payload: GoalInput, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return write_goal(payload, user, db, goal_id)


@router.delete("/goals/{goal_id}", status_code=204)
def remove_goal(goal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.scalar(select(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id))
    if row is None:
        raise HTTPException(404, "Meta não encontrada.")
    db.delete(row)
    db.commit()
    return Response(status_code=204)
