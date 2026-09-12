/** Keyboard helpers shared by inline editors. */
export const isEnter = (e: React.KeyboardEvent) => e.key === 'Enter' || e.key === 'Return' || e.keyCode === 13
export const isEscape = (e: React.KeyboardEvent) => e.key === 'Escape' || e.key === 'Esc'
