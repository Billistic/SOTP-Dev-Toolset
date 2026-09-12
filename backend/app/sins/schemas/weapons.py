"""
Field schema and starter templates for ``Weapon`` blocks.

Every one of the 446 weapons in the corpus carries the same 15 top-level keys;
``WeaponEffects`` varies by ``weaponType`` (Projectile / Missile / Beam), which
``FieldSpec.when`` records so the editor can hide the irrelevant variant.
Paths are relative to the weapon block (``Weapon[i].<path>``).
"""
from __future__ import annotations

from .fields import FieldSpec

_F = FieldSpec

WEAPON_FIELDS: list[FieldSpec] = [
    # identity
    _F("WeaponType", "Weapon type", "Identity", "enum", enum="WeaponType", help="Projectile, Missile or Beam; must match WeaponEffects.weaponType"),
    _F("damageEnums.AttackType", "Attack type", "Identity", "enum", enum="AttackType", balance=True, help="Which armour class it is tuned against"),
    _F("damageEnums.WeaponClassType", "Weapon class", "Identity", "enum", enum="WeaponClassType"),
    _F("damageEnums.DamageType", "Damage type", "Identity", "enum", enum="DamageType"),
    _F("damageEnums.DamageAffectType", "Affects", "Identity", "enum", enum="DamageAffectType"),
    _F("damageEnums.DamageApplyType", "Apply type", "Identity", "enum", enum="DamageApplyType"),
    _F("fireConstraintType", "Fire constraint", "Identity", "enum", enum="fireConstraintType"),
    # damage
    _F("DamagePerBank:FRONT", "Front bank", "Damage", "float", balance=True),
    _F("DamagePerBank:BACK", "Back bank", "Damage", "float", balance=True),
    _F("DamagePerBank:LEFT", "Left bank", "Damage", "float", balance=True),
    _F("DamagePerBank:RIGHT", "Right bank", "Damage", "float", balance=True),
    # range & timing
    _F("Range", "Range", "Range & timing", "float", balance=True),
    _F("PreBuffCooldownTime", "Cooldown", "Range & timing", "float", unit="s", balance=True),
    _F("PointStaggerDelay", "Point stagger", "Range & timing", "float", unit="s"),
    _F("TravelSpeed", "Travel speed", "Range & timing", "float"),
    _F("Duration", "Duration", "Range & timing", "float", unit="s"),
    _F("CanFireAtFighter", "Can fire at fighters", "Range & timing", "bool", balance=True),
    _F("SynchronizedTargeting", "Synchronised targeting", "Range & timing", "bool"),
    # effects (common)
    _F("WeaponEffects.weaponType", "Effects type", "Effects", "enum", enum="weaponType", help="Should equal WeaponType"),
    _F("WeaponEffects.burstCount", "Burst count", "Effects", "int", balance=True),
    _F("WeaponEffects.burstDelay", "Burst delay", "Effects", "float", unit="s"),
    _F("WeaponEffects.fireDelay", "Fire delay", "Effects", "float", unit="s"),
    _F("WeaponEffects.muzzleEffectName", "Muzzle effect", "Effects", "ref", ref="particle"),
    _F("WeaponEffects.hitEffectName", "Hit effect", "Effects", "ref", ref="particle"),
    _F("WeaponEffects.muzzleSoundMinRespawnTime", "Muzzle sound respawn", "Effects", "float", unit="s"),
    # effects (per type)
    _F("WeaponEffects.projectileTravelEffectName", "Travel effect", "Effects", "ref", ref="particle", when="Projectile"),
    _F("WeaponEffects.missileTravelEffectName", "Travel effect", "Effects", "ref", ref="particle", when="Missile"),
    _F("WeaponEffects.missileStartTurningDistance", "Start turning distance", "Effects", "float", when="Missile"),
    _F("WeaponEffects.missileSlowTurnRate", "Slow turn rate", "Effects", "float", when="Missile"),
    _F("WeaponEffects.missileMaxSlowTurnTime", "Max slow-turn time", "Effects", "float", unit="s", when="Missile"),
    _F("WeaponEffects.beamGlowTextureName", "Beam glow texture", "Effects", "ref", ref="texture", when="Beam"),
    _F("WeaponEffects.beamCoreTextureName", "Beam core texture", "Effects", "ref", ref="texture", when="Beam"),
    _F("WeaponEffects.beamWidth", "Beam width", "Effects", "float", when="Beam"),
    _F("WeaponEffects.beamGlowColor", "Beam glow colour", "Effects", "color", when="Beam"),
    _F("WeaponEffects.beamCoreColor", "Beam core colour", "Effects", "color", when="Beam"),
    _F("WeaponEffects.beamTilingRate", "Beam tiling rate", "Effects", "float", when="Beam"),
]

# sound lists inside WeaponEffects: block key -> label (+ which weapon types carry it)
WEAPON_SOUND_LISTS: list[tuple[str, str, str | None]] = [
    ("muzzleSounds", "Muzzle sounds", None),
    ("hitHullEffectSounds", "Hull impact sounds", None),
    ("hitShieldsEffectSounds", "Shield impact sounds", None),
    ("beamEffectSounds", "Beam loop sounds", "Beam"),
]

_COMMON_HEAD = '''Weapon
\tWeaponType "{wtype}"
\tdamageEnums
\t\tAttackType "ANTIMEDIUM"
\t\tDamageAffectType "AFFECTS_SHIELDS_AND_HULL"
\t\tDamageApplyType "BACKLOADED"
\t\tDamageType "PHYSICAL"
\t\tWeaponClassType "{wclass}"
\tDamagePerBank:FRONT 10.0
\tDamagePerBank:BACK 0.0
\tDamagePerBank:LEFT 0.0
\tDamagePerBank:RIGHT 0.0
\tRange 6000.0
\tPreBuffCooldownTime 5.0
\tCanFireAtFighter FALSE
\tSynchronizedTargeting FALSE
\tPointStaggerDelay 0.1
\tTravelSpeed {speed}
\tDuration 1.0
\tfireConstraintType "CanAlwaysFire"
\tWeaponEffects
\t\tweaponType "{wtype}"
\t\tburstCount 1
\t\tburstDelay 0.0
\t\tfireDelay 0.0
\t\tmuzzleEffectName ""
\t\tmuzzleSoundMinRespawnTime 0.1
\t\tmuzzleSounds
\t\t\tsoundCount 0
\t\thitEffectName ""
\t\thitHullEffectSounds
\t\t\tsoundCount 0
\t\thitShieldsEffectSounds
\t\t\tsoundCount 0
'''

WEAPON_TEMPLATES: dict[str, str] = {
    "Projectile": _COMMON_HEAD.format(wtype="Projectile", wclass="DART", speed="3000.0")
    + '\t\tprojectileTravelEffectName ""\n',
    "Missile": _COMMON_HEAD.format(wtype="Missile", wclass="MISSILE", speed="2000.0")
    + '\t\tmissileTravelEffectName ""\n\t\tmissileStartTurningDistance 200.0\n\t\tmissileSlowTurnRate 0.5\n\t\tmissileMaxSlowTurnTime 2.0\n',
    "Beam": _COMMON_HEAD.format(wtype="Beam", wclass="LASERPSI", speed="0.0")
    + '\t\tbeamEffectSounds\n\t\t\tsoundCount 0\n\t\tbeamGlowTextureName ""\n\t\tbeamCoreTextureName ""\n'
    + '\t\tbeamWidth 20.0\n\t\tbeamGlowColor ffffffff\n\t\tbeamCoreColor ffffffff\n\t\tbeamTilingRate 1.0\n',
}
