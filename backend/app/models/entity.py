"""
Entity tables.

``Entity`` keeps the lossless tree (``tree_json``) and the typed stat row
(``typed_json``).  ``EntityField`` flattens every scalar so any field can be
queried/aggregated with plain SQL — the backbone of the analytics layer.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base
from .project import utcnow


class Entity(Base):
    __tablename__ = "entities"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_entity_name"),
                      Index("ix_entity_type_faction", "project_id", "entity_type", "faction"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    race: Mapped[str | None] = mapped_column(String(30), index=True)
    faction: Mapped[str | None] = mapped_column(String(30), index=True)
    role: Mapped[str | None] = mapped_column(String(60), index=True)      # frigateRoleType / statCountType etc.
    display_name: Mapped[str | None] = mapped_column(String(300))

    source_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    fmt: Mapped[str | None] = mapped_column(String(8))
    archive_version: Mapped[int | None] = mapped_column(Integer)
    line_count: Mapped[int] = mapped_column(Integer, default=0)

    tree_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    typed_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    is_dirty: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)     # edited in DB, not yet written
    source_missing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    warning_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    written_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    fields: Mapped[list["EntityField"]] = relationship(back_populates="entity", cascade="all, delete-orphan", passive_deletes=True)
    weapons: Mapped[list["Weapon"]] = relationship(back_populates="entity", cascade="all, delete-orphan", passive_deletes=True)
    prerequisites: Mapped[list["Prerequisite"]] = relationship(back_populates="entity", cascade="all, delete-orphan", passive_deletes=True)
    modifiers: Mapped[list["ResearchModifier"]] = relationship(back_populates="entity", cascade="all, delete-orphan", passive_deletes=True)
    references: Mapped[list["Reference"]] = relationship(back_populates="entity", cascade="all, delete-orphan",
                                                         passive_deletes=True, foreign_keys="Reference.entity_id")

    def summary(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "entityType": self.entity_type, "category": self.category,
                "race": self.race, "faction": self.faction, "role": self.role, "displayName": self.display_name,
                "sourcePath": self.source_path, "isDirty": self.is_dirty, "sourceMissing": self.source_missing,
                "errorCount": self.error_count, "warningCount": self.warning_count,
                "updatedAt": self.updated_at.isoformat() if self.updated_at else None}


class EntityField(Base):
    __tablename__ = "entity_fields"
    __table_args__ = (Index("ix_field_key", "key"), Index("ix_field_entity_path", "entity_id", "path"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)          # base key without :suffix
    value_text: Mapped[str] = mapped_column(Text, nullable=False)          # raw token
    value_num: Mapped[float | None] = mapped_column(Float)                 # numeric view when applicable
    value_kind: Mapped[str] = mapped_column(String(10), nullable=False)

    entity: Mapped[Entity] = relationship(back_populates="fields")


class Weapon(Base):
    __tablename__ = "weapons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    weapon_index: Mapped[int] = mapped_column(Integer, nullable=False)
    weapon_type: Mapped[str | None] = mapped_column(String(30))
    attack_type: Mapped[str | None] = mapped_column(String(30), index=True)
    damage_affect_type: Mapped[str | None] = mapped_column(String(40))
    damage_apply_type: Mapped[str | None] = mapped_column(String(30))
    damage_type: Mapped[str | None] = mapped_column(String(30))
    weapon_class: Mapped[str | None] = mapped_column(String(40), index=True)
    damage_front: Mapped[float] = mapped_column(Float, default=0.0)
    damage_back: Mapped[float] = mapped_column(Float, default=0.0)
    damage_left: Mapped[float] = mapped_column(Float, default=0.0)
    damage_right: Mapped[float] = mapped_column(Float, default=0.0)
    range: Mapped[float | None] = mapped_column(Float)
    cooldown: Mapped[float | None] = mapped_column(Float)
    travel_speed: Mapped[float | None] = mapped_column(Float)
    duration: Mapped[float | None] = mapped_column(Float)
    point_stagger_delay: Mapped[float | None] = mapped_column(Float)
    can_fire_at_fighter: Mapped[bool] = mapped_column(Boolean, default=False)
    synchronized_targeting: Mapped[bool] = mapped_column(Boolean, default=False)
    fire_constraint: Mapped[str | None] = mapped_column(String(40))
    burst_count: Mapped[int] = mapped_column(Integer, default=1)
    burst_delay: Mapped[float | None] = mapped_column(Float)
    fire_delay: Mapped[float | None] = mapped_column(Float)
    muzzle_effect: Mapped[str | None] = mapped_column(String(120))
    hit_effect: Mapped[str | None] = mapped_column(String(120))
    travel_effect: Mapped[str | None] = mapped_column(String(120))
    dps_best_bank: Mapped[float] = mapped_column(Float, default=0.0)
    dps_all_banks: Mapped[float] = mapped_column(Float, default=0.0)

    entity: Mapped[Entity] = relationship(back_populates="weapons")

    def to_dict(self) -> dict[str, Any]:
        return {c.name: getattr(self, c.name) for c in self.__table__.columns if c.name not in ("id",)}


class Prerequisite(Base):
    __tablename__ = "prerequisites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    level: Mapped[int] = mapped_column(Integer, default=0)

    entity: Mapped[Entity] = relationship(back_populates="prerequisites")


class ResearchModifier(Base):
    __tablename__ = "research_modifiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    modifier_type: Mapped[str | None] = mapped_column(String(80), index=True)
    base_value: Mapped[float | None] = mapped_column(Float)
    per_level_value: Mapped[float | None] = mapped_column(Float)
    is_bool: Mapped[bool] = mapped_column(Boolean, default=False)

    entity: Mapped[Entity] = relationship(back_populates="modifiers")


class Reference(Base):
    """One outgoing reference from an entity field to something else."""
    __tablename__ = "entity_references"
    __table_args__ = (Index("ix_ref_target", "kind", "target_lower"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    target: Mapped[str] = mapped_column(String(300), nullable=False)
    target_lower: Mapped[str] = mapped_column(String(300), nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resolved_source: Mapped[str | None] = mapped_column(String(10))       # mod | vanilla
    target_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)

    entity: Mapped[Entity] = relationship(back_populates="references", foreign_keys=[entity_id])

    def to_dict(self) -> dict[str, Any]:
        return {"path": self.path, "key": self.key, "kind": self.kind, "target": self.target,
                "resolved": self.resolved, "resolvedSource": self.resolved_source, "targetEntityId": self.target_entity_id}


class FactionMember(Base):
    """Membership of an entity in a Player's build/research lists."""
    __tablename__ = "faction_members"
    __table_args__ = (Index("ix_member_name", "project_id", "member_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    player_entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    player_name: Mapped[str] = mapped_column(String(200), nullable=False)
    slot: Mapped[str] = mapped_column(String(20), nullable=False)
    page: Mapped[str | None] = mapped_column(String(20))
    ordinal: Mapped[int] = mapped_column(Integer, default=0)
    member_name: Mapped[str] = mapped_column(String(200), nullable=False)
    member_entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="SET NULL"), index=True)
