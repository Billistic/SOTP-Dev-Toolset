"""Queries over the flattened ``entity_fields`` table (analytics backbone)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import distinct, func, select

from ..models import Entity, EntityField
from .base import BaseDAO


class FieldDAO(BaseDAO[EntityField]):
    model = EntityField

    def numeric_values(self, project_id: int, entity_type: str, path: str, *, faction: str | None = None,
                       role: str | None = None) -> list[tuple[str, str | None, str | None, float]]:
        """(entity name, faction, role, value) for a numeric field across one entity type."""
        stmt = (select(Entity.name, Entity.faction, Entity.role, EntityField.value_num)
                .join(Entity, Entity.id == EntityField.entity_id)
                .where(Entity.project_id == project_id, Entity.entity_type == entity_type,
                       EntityField.path == path, EntityField.value_num.is_not(None)))
        if faction:
            stmt = stmt.where(Entity.faction == faction)
        if role:
            stmt = stmt.where(Entity.role == role)
        return [tuple(r) for r in self.db.execute(stmt).all()]

    def field_catalog(self, project_id: int, entity_type: str) -> list[dict[str, Any]]:
        """Every path seen for a type with counts and numeric coverage."""
        stmt = (select(EntityField.path, EntityField.key, func.count(), func.count(EntityField.value_num),
                       func.min(EntityField.value_num), func.max(EntityField.value_num), func.avg(EntityField.value_num))
                .join(Entity, Entity.id == EntityField.entity_id)
                .where(Entity.project_id == project_id, Entity.entity_type == entity_type)
                .group_by(EntityField.path, EntityField.key).order_by(EntityField.path))
        return [{"path": p, "key": k, "count": n, "numericCount": nn, "min": mn, "max": mx, "mean": av}
                for p, k, n, nn, mn, mx, av in self.db.execute(stmt).all()]

    def distinct_values(self, project_id: int, key: str, entity_type: str | None = None, limit: int = 200) -> list[str]:
        stmt = (select(distinct(EntityField.value_text)).join(Entity, Entity.id == EntityField.entity_id)
                .where(Entity.project_id == project_id, EntityField.key == key))
        if entity_type:
            stmt = stmt.where(Entity.entity_type == entity_type)
        return [v for (v,) in self.db.execute(stmt.order_by(EntityField.value_text).limit(limit)).all()]

    def values_for_entity(self, entity_id: int) -> list[EntityField]:
        return self.scalars(self.select().where(EntityField.entity_id == entity_id).order_by(EntityField.id))
