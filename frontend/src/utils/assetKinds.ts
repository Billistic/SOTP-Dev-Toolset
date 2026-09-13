/** Asset kinds in the order nodes list them (and fan them out): meshes first, textures last. */
export const KIND_ORDER = ['mesh', 'particle', 'sound', 'music', 'brush', 'texture', 'explosion', 'texanim']
export const KIND_LABEL: Record<string, string> = {
  mesh: 'meshes', particle: 'particles', sound: 'sounds', music: 'music', brush: 'brushes', texture: 'textures', explosion: 'explosions', texanim: 'tex anims',
}
export const kindRank = (k?: string | null) => { const i = KIND_ORDER.indexOf(k ?? ''); return i < 0 ? 99 : i }
