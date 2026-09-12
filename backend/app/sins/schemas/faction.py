"""
Race / faction detection from SOTP naming conventions.

Names follow ``<Kind>_<Race>_<Name>_<FactionTag>``: e.g. ``Frigate_Cov_Akton_Regr``,
``Research_UNSC_Combat_Able_Unlock_Cole``, ``Research_Cov_Fleet_Ship_Slots_1_All``.
Player entities are the authoritative source of membership; this is the
fallback used for grouping when a name is not listed by any player.
"""
from __future__ import annotations

import re

RACE_TAGS = {"cov": "Covenant", "unsc": "UNSC", "neu": "Neutral", "none": "Neutral", "flood": "Flood"}
FACTION_TAGS = {"regr": "Regret", "regret": "Regret", "thel": "Thel", "cole": "Cole",
                "hood": "Hood", "stan": "Stanforth", "stanforth": "Stanforth", "all": "All"}

_PARTS = re.compile(r"[_\-]+")


def detect(name: str) -> tuple[str | None, str | None]:
    """Return (race, faction) guessed from an entity file stem."""
    parts = [p.lower() for p in _PARTS.split(name) if p]
    race = next((RACE_TAGS[p] for p in parts if p in RACE_TAGS), None)
    if race is None:  # CamelCase names such as AbilityUNSCRadiationMAC
        m = re.search(r"(UNSC|Cov|Flood)", name)
        race = RACE_TAGS[m.group(1).lower()] if m else None
    faction = FACTION_TAGS.get(parts[-1]) if parts else None
    if faction is None:
        faction = next((FACTION_TAGS[p] for p in reversed(parts) if p in FACTION_TAGS), None)
    if race is None and faction in ("Regret", "Thel"):
        race = "Covenant"
    if race is None and faction in ("Cole", "Hood", "Stanforth"):
        race = "UNSC"
    return race, faction


def strip_faction_suffix(name: str) -> str:
    """``Frigate_UNSC_Able_Cole`` -> ``Frigate_UNSC_Able``; used when deriving string IDs for a new entity."""
    parts = [p for p in name.split("_") if p]
    if len(parts) > 1 and parts[-1].lower() in FACTION_TAGS:
        parts = parts[:-1]
    return "_".join(parts) or name
