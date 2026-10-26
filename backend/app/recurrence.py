"""Repetição dos itens da agenda (rotinas): em quais dias um item "todo dia / toda semana / todo mês / todo ano" acontece."""

import calendar
from collections.abc import Iterable
from datetime import date, timedelta

RECURRENCES = ("none", "daily", "weekly", "monthly", "yearly")
# Antecedência do lembrete, em minutos (0 = na hora). Só estes valores: o celular mostra as mesmas opções.
REMINDER_CHOICES = (0, 5, 10, 15, 30, 60, 120, 1440)

# Quanto tempo à frente um item que repete é "aberto" quando se pede um intervalo sem fim (evita laços enormes).
MAX_SPAN_DAYS = 1100


def _month_day(year: int, month: int, day: int) -> date:
    """O dia N do mês; se o mês for mais curto (31 em abril, 29/02 em ano comum), vale o último dia dele."""
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def occurrences(first: date, recurrence: str, weekdays: Iterable[int], until: date | None, start: date, end: date) -> list[date]:
    """
    Os dias entre `start` e `end` (inclusive) em que o item acontece.

    first: dia em que o item (ou a rotina) começa. weekdays: 0=segunda ... 6=domingo, usado só em "weekly"
    (vazio = o mesmo dia da semana de `first`). until: último dia da rotina (vazio = para sempre).
    """
    if recurrence == "none":
        return [first] if start <= first <= end else []
    low = max(start, first)
    high = min(end, until) if until else end
    if low > high:
        return []

    result: list[date] = []
    if recurrence in ("daily", "weekly"):
        high = min(high, low + timedelta(days=MAX_SPAN_DAYS))  # só estes andam dia a dia: o limite evita um laço enorme
        wanted = set(weekdays) or {first.weekday()}
        day = low
        while day <= high:
            if recurrence == "daily" or day.weekday() in wanted:
                result.append(day)
            day += timedelta(days=1)
    elif recurrence == "monthly":
        year, month = low.year, low.month
        while (year, month) <= (high.year, high.month):
            day = _month_day(year, month, first.day)
            if low <= day <= high:
                result.append(day)
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    elif recurrence == "yearly":
        for year in range(low.year, high.year + 1):
            day = _month_day(year, first.month, first.day)
            if low <= day <= high:
                result.append(day)
    return result


def next_occurrence(first: date, recurrence: str, weekdays: Iterable[int], until: date | None, today: date) -> date:
    """A próxima vez (a partir de hoje) em que a rotina acontece; se já acabou, o dia em que começou."""
    span = {"daily": 2, "weekly": 8, "monthly": 400, "yearly": 800}.get(recurrence, 1)
    found = occurrences(first, recurrence, weekdays, until, max(today, first), max(today, first) + timedelta(days=span))
    return found[0] if found else first
