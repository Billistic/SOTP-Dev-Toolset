"""Shared DAO plumbing: every DAO wraps one SQLAlchemy session."""
from __future__ import annotations

from typing import Generic, Iterable, TypeVar

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import Session

T = TypeVar("T")


class BaseDAO(Generic[T]):
    model: type[T]

    def __init__(self, db: Session):
        self.db = db

    def get(self, id_: int) -> T | None:
        return self.db.get(self.model, id_)

    def add(self, obj: T) -> T:
        self.db.add(obj)
        return obj

    def add_all(self, objs: Iterable[T]) -> None:
        self.db.add_all(list(objs))

    def delete_where(self, *criteria) -> int:
        result = self.db.execute(delete(self.model).where(*criteria))
        return result.rowcount or 0

    def scalars(self, stmt) -> list:
        return list(self.db.scalars(stmt))

    def first(self, stmt):
        return self.db.scalars(stmt).first()

    def commit(self) -> None:
        self.db.commit()

    def flush(self) -> None:
        self.db.flush()

    def select(self):
        return select(self.model)


def search_clause(search: str, *columns):
    """Every whitespace-separated word must appear (case-insensitively) in at least one of ``columns``."""
    words = [w for w in search.split() if w]
    return and_(*[or_(*[c.ilike(f"%{w}%") for c in columns]) for w in words]) if words else True
