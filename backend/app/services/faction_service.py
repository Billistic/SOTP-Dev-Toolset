"""
Factions as the project itself defines them: one per Player entity.

SOTP names its players ``Player_<Race>_<Faction>`` and suffixes entities with a faction tag, but other mods
(and the base game: Player_Tech, Player_Psi, ...) do not. Player membership lists are therefore the source of
truth; the naming-convention guess in ``sins.schemas.faction.detect`` only fills in entities no player lists.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from ..dao.entity_dao import EntityDAO
from ..models import Entity
from ..sins.schemas.faction import detect


def player_faction(player: Entity) -> tuple[str, str | None]:
    """(faction label, race) for a Player entity: ``Player_UNSC_Cole`` -> ("Cole", "UNSC"), ``Player_Tech`` -> ("Tech", None)."""
    race, faction = detect(player.name)
    if not faction or faction == "All":
        label = player.name[len("Player_"):] if player.name.lower().startswith("player_") else player.name
        faction = label or player.name
    race = race or (player.typed_json or {}).get("player_race_type") or _tree_scalar(player.tree_json, "playerRaceType")
    return faction, race


class FactionService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)

    def factions(self, project_id: int) -> list[dict[str, Any]]:
        """Every player-defined faction with its race and member count (drives the UI's faction pickers)."""
        players = self.entities.list(project_id, entity_type="Player", limit=10_000)
        counts: dict[str, int] = defaultdict(int)
        for m in self.entities.all_members(project_id):
            counts[m.player_name] += 1
        out = []
        for p in sorted(players, key=lambda p: p.name):
            faction, race = player_faction(p)
            out.append({"faction": faction, "race": race, "player": p.name, "members": counts[p.name]})
        return out

    def assign(self, project_id: int, only: list[Entity] | None = None) -> int:
        """Set ``faction`` / ``race`` from player membership. Listed by one player -> that player's faction;
        listed by several -> the shared race (faction keeps its name-based tag, e.g. SOTP's ``All``)."""
        players = {p.name: player_faction(p) for p in self.entities.list(project_id, entity_type="Player", limit=10_000)}
        listed: dict[str, set[str]] = defaultdict(set)
        for m in self.entities.all_members(project_id):
            if m.player_name in players:
                listed[m.member_name].add(m.player_name)
        changed = 0
        for e in only if only is not None else self.entities.all_for_project(project_id):
            owners = listed.get(e.name)
            if not owners:   # unlisted: back to the naming-convention guess (also undoes a stale membership)
                race, faction = detect(e.name)
            elif len(owners) == 1:
                faction, race = players[next(iter(owners))]
            else:
                guess_race, faction = detect(e.name)
                races = {players[o][1] for o in owners}
                race = races.pop() if len(races) == 1 and None not in races else guess_race
            race = race or detect(e.name)[0]
            if (faction, race) != (e.faction, e.race):
                e.faction, e.race = faction, race
                changed += 1
        return changed


def _tree_scalar(tree: dict | None, key: str) -> str | None:
    for child in (tree or {}).get("root", []):
        if child.get("k") == key and "v" in child:
            v = child["v"]
            return v[1:-1] if v.startswith('"') else v
    return None
