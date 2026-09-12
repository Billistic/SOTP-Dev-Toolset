import emblemSvg from '@/assets/emblem.svg?raw'
import logoSvg from '@/assets/logo.svg?raw'
import styles from './Brand.module.css'

/** Sins of the Prophets emblem / wordmark, coloured by the current theme (fills use currentColor). */
export function Emblem({ size = 18, className }: { size?: number; className?: string }) {
  return <span className={`${styles.svg} ${className ?? ''}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: emblemSvg }} aria-hidden />
}

export function Logo({ height = 20, className }: { height?: number; className?: string }) {
  return <span className={`${styles.svg} ${styles.logo} ${className ?? ''}`} style={{ height }} dangerouslySetInnerHTML={{ __html: logoSvg }} role="img" aria-label="Sins of the Prophets 2" />
}
