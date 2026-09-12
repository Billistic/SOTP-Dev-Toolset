"""Entity persistence: lookups, filtered listing and child-row replacement."""
from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import delete, func, select

from ..models import Entity, EntityField, FactionMember, Prerequisite, Reference, ResearchModifier, Weapon
from .base import BaseDAO, search_clause


class EntityDAO(BaseDAO[Entity]):
    model = Entity

    # ── lookups ─────────────────────────────────────────────────────────
    def by_name(self, project_id: int, name: str) -> Entity | None:
        return self.first(self.select().where(Entity.project_id == project_id, Entity.name == name))

    def by_names(self, project_id: int, names: Iterable[str]) -> dict[str, Entity]:
        names = list(names)
        if not names:
            return {}
        rows = self.scalars(self.select().where(Entity.project_id == project_id, Entity.name.in_(names)))
        return {e.name: e for e in rows}

    def name_index(self, project_id: int) -> dict[str, int]:
        """lower-cased name -> id for the whole project (reference resolution)."""
        rows = self.db.execute(select(Entity.name, Entity.id).where(Entity.project_id == project_id)).all()
        return {n.lower(): i for n, i in rows}

    def all_for_project(self, project_id: int) -> list[Entity]:
        return self.scalars(self.select().where(Entity.project_id == project_id).order_by(Entity.name))

    def paths_for_project(self, project_id: int) -> dict[str, Entity]:
        return {e.source_path: e for e in self.all_for_project(project_id)}

    # ── listing ─────────────────────────────────────────────────────────
    def list(self, project_id: int, *, entity_type: str | None = None, category: str | None = None,
             faction: str | None = None, race: str | None = None, search: str | None = None,
             dirty_only: bool = False, with_errors: bool = False, limit: int = 2000, offset: int = 0) -> list[Entity]:
        stmt = self.select().where(Entity.project_id == project_id)
        if entity_type:
            stmt = stmt.where(Entity.entity_type == entity_type)
        if category:
            stmt = stmt.where(Entity.category == category)
        if faction:
            stmt = stmt.where(Entity.faction == faction)
        if race:
            stmt = stmt.where(Entity.race == race)
        if search:
            stmt = stmt.where(search_clause(search, Entity.name, Entity.display_name))
        if dirty_only:
            stmt = stmt.where(Entity.is_dirty.is_(True))
        if with_errors:
            stmt = stmt.where(Entity.error_count > 0)
        return self.scalars(stmt.order_by(Entity.entity_type, Entity.name).limit(limit).offset(offset))

    def type_counts(self, project_id: int) -> list[dict[str, Any]]:
        rows = self.db.execute(
            select(Entity.entity_type, Entity.category, func.count(), func.sum(Entity.error_count))
            .where(Entity.project_id == project_id).group_by(Entity.entity_type, Entity.category)
            .order_by(Entity.category, Entity.entity_type)).all()
        return [{"entityType": t, "category": c, "count": n, "errors": int(e or 0)} for t, c, n, e in rows]

    def faction_counts(self, project_id: int) -> list[dict[str, Any]]:
        rows = self.db.execute(select(Entity.race, Entity.faction, func.count())
                               .where(Entity.project_id == project_id).group_by(Entity.race, Entity.faction)).all()
        return [{"race": r, "faction": f, "count": n} for r, f, n in rows]

    # ── children ────────────────────────────────────────────────────────
    def replace_children(self, entity: Entity, *, fields: list[EntityField], weapons: list[Weapon],
                         prerequisites: list[Prerequisite], modifiers: list[ResearchModifier],
                         references: list[Reference]) -> None:
        eid = entity.id
        for model in (EntityField, Weapon, Prerequisite, ResearchModifier, Reference):
            self.db.execute(delete(model).where(model.entity_id == eid))
        for row in (*fields, *weapons, *prerequisites, *modifiers, *references):
            row.entity_id = eid
        self.db.add_all([*fields, *weapons, *prerequisites, *modifiers, *references])
        self.db.flush()
        # the bulk delete bypassed the ORM collections; make them reload on next access
        self.db.expire(entity, ["fields", "weapons", "prerequisites", "modifiers", "references"])

    def references_out(self, entity_id: int) -> list[Reference]:
        return self.scalars(select(Reference).where(Reference.entity_id == entity_id).order_by(Reference.id))

    def references_in(self, project_id: int, name: str) -> list[tuple[Reference, Entity]]:
        stmt = (select(Reference, Entity).join(Entity, Entity.id == Reference.entity_id)
                .where(Entity.project_id == project_id, Reference.kind == "entity", Reference.target_lower == name.lower())
                .order_by(Entity.name))
        return [(r, e) for r, e in self.db.execute(stmt).all()]

    def remove(self, entity: Entity) -> None:
        self.db.delete(entity)

    # ── faction membership ──────────────────────────────────────────────
    def replace_members(self, project_id: int, player: Entity, rows: list[FactionMember]) -> None:
        self.db.execute(delete(FactionMember).where(FactionMember.player_entity_id == player.id))
        for r in rows:
            r.project_id = project_id
            r.player_entity_id = player.id
            r.player_name = player.name
        self.db.add_all(rows)

    def members_of(self, project_id: int, member_name: str) -> list[FactionMember]:
        return self.scalars(select(FactionMember).where(FactionMember.project_id == project_id,
                                                        FactionMember.member_name == member_name))

    def all_members(self, project_id: int) -> list[FactionMember]:
        return self.scalars(select(FactionMember).where(FactionMember.project_id == project_id))
