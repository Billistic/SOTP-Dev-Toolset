import { ArrowRight, ExternalLink } from 'lucide-react'
import { useUiStore } from '@/store/useUiStore'
import { fmtNum, fmtPct, humanKey } from '@/utils/format'
import type { Recommendation } from '@/types/api'
import styles from './RecommendationCard.module.css'

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const openEntity = useUiStore((s) => s.openEntity)
  return (
    <article className={styles.card} data-severity={rec.severity} data-direction={rec.direction}>
      <header className={styles.head}>
        <button className={styles.name} onClick={() => openEntity(rec.entity)} title={rec.displayName ?? ''}>{rec.entity} <ExternalLink size={12} /></button>
        <span className={styles.badge}>{rec.direction}</span>
      </header>
      <div className={styles.meta}>
        <span>{rec.entityType} · {rec.faction ?? 'shared'}</span>
        <span className="muted">peers: {rec.group}</span>
      </div>
      <div className={styles.metric}>
        <span className={styles.label}>{rec.label}</span>
        <span className={styles.value}>{fmtNum(rec.value, 4)}</span>
        <span className="muted">vs median {fmtNum(rec.median, 4)}</span>
        <span className={styles.z}>z {rec.z > 0 ? '+' : ''}{rec.z}</span>
      </div>
      {rec.levers.length > 0 && (
        <ul className={styles.levers}>
          {rec.levers.map((l) => (
            <li key={l.lever} className={styles.lever} title={l.hint}>
              <span className={styles.leverName}>{humanKey(l.lever)}</span>
              <span className={styles.leverVals}>{fmtNum(l.current, 3)} <ArrowRight size={11} /> {fmtNum(l.target, 3)}</span>
              <span className={styles.pct} data-neg={(l.changePct ?? 0) < 0 || undefined}>{fmtPct(l.changePct)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
