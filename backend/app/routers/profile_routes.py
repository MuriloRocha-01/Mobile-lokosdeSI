"""Perfil financeiro e cartões pertencentes à conta autenticada."""
import base64
import binascii
import io
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import FinanceCard, FinancialProfile, Transaction, User
from ..schemas import CardBalance, CardCreate, CardOut, ProfileIn, ProfileOut
from .finance_routes import catch_up_recurring, finance_today

router = APIRouter(tags=["perfil"])


def clean_photo(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        prefix, encoded = value.split(",", 1)
        if prefix not in ("data:image/jpeg;base64", "data:image/png;base64"):
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 250_000:
            raise ValueError()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in ("JPEG", "PNG") or max(image.size) > 1024:
                raise ValueError()
            image.load()
            image.thumbnail((256, 256))
            output = io.BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
    except (ValueError, binascii.Error, OSError, UnidentifiedImageError, Image.DecompressionBombError):
        raise HTTPException(400, "Foto inválida. Escolha uma imagem de perfil menor.")


def profile_out(user: User, profile: FinancialProfile) -> ProfileOut:
    return ProfileOut(name=user.name, salary_day=profile.salary_day, bills_day=profile.bills_day, cycle_day=profile.cycle_day, photo=profile.photo)


@router.get("/auth/profile", response_model=ProfileOut | None)
def get_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(FinancialProfile, user.id)
    return profile_out(user, profile) if profile else None


def add_card(payload: CardCreate, user: User, db: Session) -> FinanceCard:
    existing = db.scalar(select(FinanceCard).where(FinanceCard.user_id == user.id, func.lower(FinanceCard.name) == payload.name.lower(), FinanceCard.last_four == payload.last_four))
    if existing:
        return existing
    card = FinanceCard(user_id=user.id, name=payload.name, last_four=payload.last_four)
    db.add(card)
    db.flush()
    return card


@router.put("/auth/profile", response_model=ProfileOut)
def save_profile(payload: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = " ".join(payload.name.split())
    if not name:
        raise HTTPException(400, "Informe seu nome.")
    photo = clean_photo(payload.photo)
    profile = db.get(FinancialProfile, user.id)
    if profile is None:
        profile = FinancialProfile(user_id=user.id)
        db.add(profile)
    user.name = name
    profile.salary_day, profile.bills_day, profile.cycle_day = payload.salary_day, payload.bills_day, payload.cycle_day
    profile.photo = photo
    if payload.card:
        add_card(payload.card, user, db)
    db.commit()
    return profile_out(user, profile)


@router.get("/finance/cards", response_model=list[CardBalance])
def cards(today: date | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db), _: None = Depends(catch_up_recurring)):
    sums = db.execute(select(Transaction.card_id, Transaction.type, func.sum(Transaction.amount)).where(Transaction.user_id == user.id, Transaction.status == "settled", Transaction.card_id.is_not(None), Transaction.financial_date <= (today or finance_today())).group_by(Transaction.card_id, Transaction.type)).all()
    totals = {(card_id, kind): float(total) for card_id, kind, total in sums}
    result = []
    for card in db.scalars(select(FinanceCard).where(FinanceCard.user_id == user.id).order_by(FinanceCard.id)):
        income, expense = totals.get((card.id, "income"), 0), totals.get((card.id, "expense"), 0)
        result.append(CardBalance(id=card.id, name=card.name, last_four=card.last_four, income=income, expense=expense, balance=round(income-expense, 2)))
    return result


@router.post("/finance/cards", response_model=CardOut, status_code=201)
def create_card(payload: CardCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    card = add_card(payload, user, db)
    db.commit()
    return card
