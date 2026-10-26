"""Agenda Pessoal: tarefas, eventos e compromissos, com etiquetas, rotinas que se repetem e lembretes para o celular."""

import re
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import AgendaCompletion, AgendaItem, User, note_agenda_link
from ..recurrence import MAX_SPAN_DAYS, REMINDER_CHOICES, next_occurrence, occurrences
from ..schemas import AgendaCreate, AgendaItemOut, AgendaNoteRef, AgendaUpdate, OccurrenceUpdate

router = APIRouter(prefix="/agenda", tags=["agenda"])

MAX_TITLE_LENGTH = 200
MAX_TAGS = 6
MAX_TAG_LENGTH = 30
MAX_ITEMS_PER_QUERY = 3000
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _clean_title(title: str) -> str:
    title = " ".join(title.split())
    if not title:
        raise HTTPException(status_code=400, detail="Dê um título ao item.")
    if len(title) > MAX_TITLE_LENGTH:
        raise HTTPException(status_code=400, detail=f"O título pode ter até {MAX_TITLE_LENGTH} caracteres.")
    return title


def _clean_time(value: str | None) -> str | None:
    """"14:30" -> "14:30"; vazio ou None = o dia todo."""
    value = (value or "").strip()
    if not value:
        return None
    if not _TIME.match(value):
        raise HTTPException(status_code=400, detail="O horário deve estar no formato HH:MM (ex.: 14:30).")
    return value


def _clean_tags(tags: list[str]) -> str:
    """Etiquetas rápidas ("Prova", "Trabalho"): mantêm a caixa digitada, sem repetidas (ignorando maiúsculas)."""
    result: list[str] = []
    for raw in tags:
        for piece in raw.split(","):
            tag = " ".join(piece.lstrip().lstrip("#").split())
            if not tag:
                continue
            if len(tag) > MAX_TAG_LENGTH:
                raise HTTPException(status_code=400, detail=f"Cada etiqueta pode ter até {MAX_TAG_LENGTH} caracteres.")
            if tag.casefold() not in (existing.casefold() for existing in result):
                result.append(tag)
    if len(result) > MAX_TAGS:
        raise HTTPException(status_code=400, detail=f"Use no máximo {MAX_TAGS} etiquetas por item.")
    return ",".join(result)


def _clean_reminder(minutes: int | None) -> int | None:
    if minutes is not None and minutes not in REMINDER_CHOICES:
        raise HTTPException(status_code=400, detail=f"O lembrete deve ser um destes (em minutos): {', '.join(map(str, REMINDER_CHOICES))}.")
    return minutes


def _clean_repetition(recurrence: str, days: list[int], first: date, until: date | None) -> tuple[str, str, date | None]:
    """Valida a repetição e devolve (tipo, dias da semana "0,2,4", último dia)."""
    if recurrence == "none":
        return "none", "", None
    if any(day < 0 or day > 6 for day in days):
        raise HTTPException(status_code=400, detail="Os dias da semana vão de 0 (segunda) a 6 (domingo).")
    if until is not None and until < first:
        raise HTTPException(status_code=400, detail="O fim da repetição não pode ser antes do começo.")
    if recurrence == "weekly":
        days = sorted(set(days)) or [first.weekday()]
    else:
        days = []
    return recurrence, ",".join(str(day) for day in days), until


def _weekdays(item: AgendaItem) -> list[int]:
    return [int(day) for day in item.recurrence_days.split(",") if day]


def _days_of(item: AgendaItem, start: date, end: date) -> list[date]:
    return occurrences(item.date, item.recurrence, _weekdays(item), item.recurrence_until, start, end)


def _first_day(item: AgendaItem) -> date:
    """O primeiro dia em que o item acontece (numa rotina semanal, o início pode cair num dia fora dos escolhidos)."""
    found = _days_of(item, item.date, item.date + timedelta(days=MAX_SPAN_DAYS)) if item.recurrence != "none" else []
    return found[0] if found else item.date


def _get_owned(db: Session, user: User, item_id: int) -> AgendaItem:
    item = db.scalar(select(AgendaItem).where(AgendaItem.id == item_id, AgendaItem.user_id == user.id))
    if item is None:
        raise HTTPException(status_code=404, detail="Item da agenda não encontrado.")
    return item


def _rows(db: Session, entries: list[tuple[AgendaItem, date]]) -> list[AgendaItemOut]:
    """As linhas da API: cada (item, dia) com quantas notas apontam para o item e, nas rotinas, se aquele dia já foi feito."""
    if not entries:
        return []
    ids = {item.id for item, _ in entries}
    counts = {
        item_id: total
        for item_id, total in db.execute(
            select(note_agenda_link.c.agenda_item_id, func.count()).where(note_agenda_link.c.agenda_item_id.in_(ids)).group_by(note_agenda_link.c.agenda_item_id)
        ).all()
    }
    done: set[tuple[int, date]] = set()
    if any(item.recurrence != "none" for item, _ in entries):
        days = [day for _, day in entries]
        done = set(
            db.execute(
                select(AgendaCompletion.item_id, AgendaCompletion.day).where(
                    AgendaCompletion.item_id.in_(ids), AgendaCompletion.day >= min(days), AgendaCompletion.day <= max(days)
                )
            ).all()
        )
    rows = []
    for item, day in entries:
        out = AgendaItemOut.model_validate(item)
        out.date = day
        out.start_date = item.date
        out.note_count = counts.get(item.id, 0)
        if item.recurrence != "none":  # numa rotina, "concluído" vale só para aquele dia
            out.status = "cancelado" if item.status == "cancelado" else ("concluido" if (item.id, day) in done else "pendente")
        rows.append(out)
    return rows


def _sort_key(entry: tuple[AgendaItem, date]):
    item, day = entry
    return (day, item.time is not None, item.time or "", item.id)


@router.get("", response_model=list[AgendaItemOut])
def list_items(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AgendaItemOut]:
    """
    Seus itens entre duas datas (inclusive), por dia e horário. As rotinas aparecem uma vez em cada dia em que acontecem.
    Sem datas, devolve todos os itens (uma rotina aparece uma vez, na próxima vez em que acontece).
    """
    single = select(AgendaItem).where(AgendaItem.user_id == user.id, AgendaItem.recurrence == "none")
    if date_from is not None:
        single = single.where(AgendaItem.date >= date_from)
    if date_to is not None:
        single = single.where(AgendaItem.date <= date_to)
    entries: list[tuple[AgendaItem, date]] = [(item, item.date) for item in db.scalars(single)]

    routines = select(AgendaItem).where(AgendaItem.user_id == user.id, AgendaItem.recurrence != "none")
    if date_to is not None:
        routines = routines.where(AgendaItem.date <= date_to)
    if date_from is not None:
        routines = routines.where((AgendaItem.recurrence_until.is_(None)) | (AgendaItem.recurrence_until >= date_from))
    for item in db.scalars(routines):
        if date_from is None and date_to is None:
            entries.append((item, next_occurrence(item.date, item.recurrence, _weekdays(item), item.recurrence_until, date.today())))
        else:
            low = date_from or item.date
            high = date_to or low + timedelta(days=365)
            entries.extend((item, day) for day in _days_of(item, low, high))

    entries.sort(key=_sort_key)
    return _rows(db, entries[:MAX_ITEMS_PER_QUERY])


@router.get("/overdue", response_model=list[AgendaItemOut])
def overdue(
    today: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AgendaItemOut]:
    """Tarefas e compromissos avulsos ainda pendentes cuja data já passou ('today' é o dia de hoje no seu computador)."""
    limit = today or date.today()
    query = (
        select(AgendaItem)
        .where(
            AgendaItem.user_id == user.id,
            AgendaItem.status == "pendente",
            AgendaItem.type.in_(("tarefa", "compromisso")),
            AgendaItem.recurrence == "none",  # rotina que ficou para trás não é "atraso": ela simplesmente acontece de novo
            AgendaItem.date < limit,
        )
        .order_by(AgendaItem.date, AgendaItem.id)
        .limit(200)
    )
    return _rows(db, [(item, item.date) for item in db.scalars(query)])


@router.post("", response_model=AgendaItemOut, status_code=201)
def create_item(payload: AgendaCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AgendaItemOut:
    recurrence, days, until = _clean_repetition(payload.recurrence, payload.recurrence_days, payload.date, payload.recurrence_until)
    item = AgendaItem(
        user_id=user.id,
        title=_clean_title(payload.title),
        type=payload.type,
        date=payload.date,
        time=_clean_time(payload.time),
        status=payload.status,
        tags=_clean_tags(payload.tags),
        recurrence=recurrence,
        recurrence_days=days,
        recurrence_until=until,
        reminder_minutes=_clean_reminder(payload.reminder_minutes),
    )
    db.add(item)
    db.commit()
    return _rows(db, [(item, _first_day(item))])[0]


@router.put("/{item_id}", response_model=AgendaItemOut)
def update_item(item_id: int, payload: AgendaUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AgendaItemOut:
    """Atualização parcial: só o que for enviado muda. Numa rotina, a mudança vale para a rotina toda."""
    item = _get_owned(db, user, item_id)
    sent = payload.model_fields_set
    if payload.title is not None:
        item.title = _clean_title(payload.title)
    if payload.type is not None:
        item.type = payload.type
    if payload.date is not None:
        item.date = payload.date
    if payload.time is not None:
        item.time = _clean_time(payload.time)  # "" tira o horário
    if payload.status is not None:
        item.status = payload.status
    if payload.tags is not None:
        item.tags = _clean_tags(payload.tags)
    if "reminder_minutes" in sent:
        item.reminder_minutes = _clean_reminder(payload.reminder_minutes)  # null tira o lembrete
    if {"recurrence", "recurrence_days", "recurrence_until", "date"} & sent:
        recurrence = payload.recurrence if payload.recurrence is not None else item.recurrence
        days = payload.recurrence_days if payload.recurrence_days is not None else _weekdays(item)
        until = payload.recurrence_until if "recurrence_until" in sent else item.recurrence_until
        item.recurrence, item.recurrence_days, item.recurrence_until = _clean_repetition(recurrence, days, item.date, until)
        if item.recurrence == "none":  # deixou de ser rotina: os "feito" de cada dia não fazem mais sentido
            db.query(AgendaCompletion).filter(AgendaCompletion.item_id == item.id).delete()
    db.commit()
    return _rows(db, [(item, _first_day(item))])[0]


@router.put("/{item_id}/occurrences/{day}", response_model=AgendaItemOut)
def set_occurrence(item_id: int, day: date, payload: OccurrenceUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AgendaItemOut:
    """Marca (ou desmarca) como feita a rotina de UM dia. Para um item que não se repete, use a situação dele."""
    item = _get_owned(db, user, item_id)
    if item.recurrence == "none":
        raise HTTPException(status_code=400, detail="Esse item não se repete: mude a situação dele.")
    if not _days_of(item, day, day):
        raise HTTPException(status_code=404, detail="Essa rotina não acontece nesse dia.")
    existing = db.get(AgendaCompletion, (item.id, day))
    if payload.done and existing is None:
        db.add(AgendaCompletion(item_id=item.id, day=day))
    elif not payload.done and existing is not None:
        db.delete(existing)
    db.commit()
    return _rows(db, [(item, day)])[0]


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    """Apaga o item (numa rotina, ela inteira). As notas que apontavam para ele continuam existindo (só o vínculo some)."""
    item = _get_owned(db, user, item_id)
    db.delete(item)
    db.commit()
    return Response(status_code=204)


@router.get("/{item_id}/notes", response_model=list[AgendaNoteRef])
def notes_of_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list:
    """As suas notas ligadas a este item (a última editada primeiro)."""
    item = _get_owned(db, user, item_id)
    return sorted((note for note in item.notes if note.user_id == user.id), key=lambda note: note.updated_at, reverse=True)
