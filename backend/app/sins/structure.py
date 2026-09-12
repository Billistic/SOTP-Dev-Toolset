"""
Structural knowledge about the Sins file format.

The game engine parses files as an ordered token stream and ignores
indentation entirely, which is why the SOTP corpus contains systematically
mis-indented blocks (``WeaponEffects`` at column 0, ``StartValue`` unindented
under ``CommandPoints``).  The tables here let the parser repair those cases
and let the validator check ``numX`` / ``xCount`` list integrity.

Everything is keyed by *base key* (the part before any ``:`` suffix).
"""
from __future__ import annotations

_LEVEL_STAT = frozenset({"StartValue", "ValueIncreasePerLevel"})
_COST = frozenset({"credits", "metal", "crystal"})
_SOUND_LIST = frozenset({"soundCount", "sound"})
_PREREQS = frozenset({"NumResearchPrerequisites", "ResearchPrerequisite",
                      "RequiredFactionNameID", "RequiredCompletedResearchSubjects"})

_WEAPON_EFFECTS = frozenset({
    "weaponType", "burstCount", "burstDelay", "fireDelay",
    "muzzleEffectName", "muzzleSoundMinRespawnTime", "muzzleSounds",
    "hitEffectName", "hitHullEffectSounds", "hitShieldsEffectSounds",
    "projectileTravelEffectName",
    "missileTravelEffectName", "missileStartTurningDistance", "missileSlowTurnRate", "missileMaxSlowTurnTime",
    "beamEffectSounds", "beamGlowTextureName", "beamCoreTextureName",
    "beamWidth", "beamGlowColor", "beamCoreColor", "beamTilingRate",
})

_WEAPON = frozenset({
    "WeaponType", "damageEnums", "DamagePerBank", "Range", "PreBuffCooldownTime",
    "CanFireAtFighter", "SynchronizedTargeting", "PointStaggerDelay", "TravelSpeed",
    "Duration", "fireConstraintType", "WeaponEffects",
})

# header key -> keys the engine reads as its children even when the file
# indents them at (or above) the header's own level.
CHILDREN_OF: dict[str, frozenset[str]] = {
    "Weapon": _WEAPON,
    "WeaponEffects": _WEAPON_EFFECTS,
    "weaponEffectsDef": _WEAPON_EFFECTS,
    "damageEnums": frozenset({"AttackType", "DamageAffectType", "DamageApplyType", "DamageType", "WeaponClassType"}),
    "muzzleSounds": _SOUND_LIST,
    "hitHullEffectSounds": _SOUND_LIST,
    "hitShieldsEffectSounds": _SOUND_LIST,
    "beamEffectSounds": _SOUND_LIST,
    "explosionSounds": _SOUND_LIST,
    "Prerequisites": _PREREQS,
    "researchPrerequisites": _PREREQS,
    "ResearchPrerequisite": frozenset({"Subject", "Level"}),
    "researchModifier": frozenset({"modifierType", "baseValue", "perLevelValue"}),
    "basePrice": _COST,
    "BaseCost": _COST,
    "PerLevelCostIncrease": _COST,
    "price": _COST,
    "researchWindowLocation": frozenset({"block", "pos"}),
    "MeshNameInfo": frozenset({"meshName", "criteriaType"}),
    "targetFilter": frozenset({"numOwnerships", "ownership", "numObjects", "object",
                               "numSpaces", "space", "numConstraints", "constraint"}),
    "effectInfo": frozenset({"effectAttachInfo", "smallEffectName", "mediumEffectName", "largeEffectName", "soundID"}),
    "effectAttachInfo": frozenset({"attachType", "abilityIndex"}),
    "weaponEffectAttachInfo": frozenset({"attachType", "abilityIndex"}),
}
for _k in ("MaxHullPoints", "MaxShieldPoints", "HullPointRestoreRate", "ShieldPointRestoreRate",
           "ArmorPointsFromExperience", "maxMitigation", "MaxAntiMatter", "AntiMatterRestoreRate",
           "CultureProtectRate", "CommandPoints", "weaponCooldownDecreasePerc", "weaponDamageIncreasePerc"):
    CHILDREN_OF[_k] = _LEVEL_STAT

# count key -> the repeated item key it governs.  Mined from the corpus and
# checked by hand; used for list-integrity validation and count re-sync.
COUNT_PAIRS: dict[str, str] = {
    "soundCount": "sound", "NumSoundsFor": "SoundID",
    "numTextures": "textureName", "textureNameCount": "textureName", "numFarStarIconCloudTextureNames": "textureName",
    "numAttachedEmitters": "attachedEmitterName",
    "NumResearchPrerequisites": "ResearchPrerequisite",
    "researchFloatModifiers": "researchModifier", "researchBoolModifiers": "researchModifier",
    "stageCount": "stage", "MeshNameInfoCount": "MeshNameInfo", "NumWeapons": "Weapon",
    "NumEmitters": "EmitterType", "NumAffectors": "AffectorType",
    "orbitBodyTypeCount": "orbitBodyType", "count": "entityDefName", "blockCount": "block",
    "meshInfoCount": "meshInfo", "coloredSkyboxMeshInfoCount": "meshInfo", "deepSpaceSkyboxMeshInfoCount": "meshInfo",
    "skyboxScalarsCount": "skyboxScalars", "clusterCount": "cluster", "clumpCount": "clump",
    "meshNameCount": "meshName", "meshGroupCount": "meshGroup",
    "numFinishConditions": "finishCondition", "numInstantActions": "instantAction",
    "numPeriodicActions": "periodicAction", "numOverTimeActions": "OverTimeAction",
    "numEntityModifiers": "entityModifier", "numEntityBoolModifiers": "entityBoolModifier",
    "subExplosionCount": "subExplosion", "explosionEffectDefCount": "explosionEffectDef",
    "explosionEffectGroupCount": "explosionEffectGroup",
    "startupMusicThemeCount": "musicTheme", "neutralMusicThemeCount": "musicTheme",
    "scareThemeCount": "musicTheme", "announcementCount": "musicTheme", "musicThemeCount": "musicTheme",
    "fleetIconCount": "fleetIcon", "nameCount": "name", "numResearchFields": "field",
    "requiredShipCount": "requiredShip", "randomShipCount": "randomShip",
    "numOwnerships": "ownership", "numObjects": "object", "numSpaces": "space", "numConstraints": "constraint",
    "numRandomMeshNamesLarge": "randomMeshName", "numRandomMeshNamesSmall": "randomMeshName",
    "numSpecificDebris": "specificDebrisMeshName",
    "templateCount": "template", "numEffects": "effect", "numMusic": "music",
    "brushCount": "brush", "brushFileCount": "brushFile", "entityNameCount": "entityName",
    "fileCount": "fileName", "meshFileCount": "meshFileName", "textureGroupCount": "textureGroup",
    "starTypeCount": "starType", "planetTypeCount": "planetType", "planetItemTypeCount": "planetItemType",
    "playerTypeCount": "playerType", "planetItemsTemplateCount": "planetItemsTemplate",
    "NumStrings": "StringInfo", "pictureCount": "pictureBrush", "tipCount": "tip",
    "numHalos": "halo", "numProperties": "properties", "rebellionInfoCount": "rebellionInfo",
    "NumCriticalHitEffectNames": "EffectName", "NumCriticalHitEffectSoundIDs": "SoundID",
    "NumPersistentHullDamageEffects": "Definition", "planetBaseAllegianceAtDistanceCount": "allegiance",
}

# Keys that are lists by nature: their paths always carry an index so a
# path stays stable when a second item is added.
REPEATABLE: frozenset[str] = frozenset(set(COUNT_PAIRS.values()) | {
    "EmitterContents", "AffectorContents", "Page",
})

# Indexed keys whose suffix is a level number: Level:0 .. Level:N.
LEVEL_KEY = "Level"


def is_count_key(base_key: str) -> bool:
    return base_key in COUNT_PAIRS


def item_key_for(count_key: str) -> str | None:
    return COUNT_PAIRS.get(count_key)
