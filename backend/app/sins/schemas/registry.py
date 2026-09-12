"""
Lookup of entity-type schemas and the typed extractor for each.

Unknown entity types still parse and round-trip; they simply get the generic
schema (no typed fields) so the editor falls back to the tree view.
"""
from __future__ import annotations

from typing import Any, Callable

from ..document import Document
from .effects import ABILITY_SCHEMA, BUFF_SCHEMA, PLAYER_SCHEMA, extract_ability, extract_buff
from .fields import EntitySchema
from .research import RESEARCH_SCHEMA, extract_research
from .structures import MODULE_SCHEMAS, PLANET_SCHEMA, extract_module, extract_planet
from .units import (CAPITAL_SCHEMA, FIGHTER_SCHEMA, FRIGATE_SCHEMA, SQUAD_SCHEMA,
                    extract_squad, extract_unit)

Extractor = Callable[[Document], dict[str, Any]]

SCHEMAS: dict[str, EntitySchema] = {
    "CapitalShip": CAPITAL_SCHEMA,
    "Frigate": FRIGATE_SCHEMA,
    "Fighter": FIGHTER_SCHEMA,
    "Squad": SQUAD_SCHEMA,
    "ResearchSubject": RESEARCH_SCHEMA,
    "Planet": PLANET_SCHEMA,
    "Ability": ABILITY_SCHEMA,
    "Buff": BUFF_SCHEMA,
    "Player": PLAYER_SCHEMA,
    **MODULE_SCHEMAS,
}

EXTRACTORS: dict[str, Extractor] = {
    "CapitalShip": extract_unit,
    "Frigate": extract_unit,
    "Fighter": extract_unit,
    "Squad": extract_squad,
    "ResearchSubject": extract_research,
    "Planet": extract_planet,
    "Ability": extract_ability,
    "Buff": extract_buff,
    **{t: extract_module for t in MODULE_SCHEMAS},
}

_GENERIC = EntitySchema("*", "other")


def schema_for(entity_type: str | None) -> EntitySchema:
    return SCHEMAS.get(entity_type or "", _GENERIC)


def category_for(entity_type: str | None) -> str:
    return schema_for(entity_type).category


def extract_typed(doc: Document) -> dict[str, Any]:
    fn = EXTRACTORS.get(doc.entity_type or "")
    return fn(doc) if fn else {}


def display_name_key(entity_type: str | None) -> str:
    return schema_for(entity_type).name_key
