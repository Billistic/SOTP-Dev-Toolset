import { TabBar } from '@/components/TabBar/TabBar'
import { UpdateBanner } from '@/components/UpdateBanner/UpdateBanner'
import { EntityEditor } from '@/components/EntityEditor/EntityEditor'
import { ResearchGraphView } from '@/components/ResearchGraphView/ResearchGraphView'
import { RelationshipView } from '@/components/RelationshipView/RelationshipView'
import { StringsView } from '@/components/StringsView/StringsView'
import { AssetsView } from '@/components/AssetsView/AssetsView'
import { DiagnosticsView } from '@/components/DiagnosticsView/DiagnosticsView'
import { AnalyticsView } from '@/components/AnalyticsView/AnalyticsView'
import { BalanceView } from '@/components/BalanceView/BalanceView'
import { ProjectView } from '@/components/ProjectView/ProjectView'
import { WelcomeView } from '@/components/WelcomeView/WelcomeView'
import { tabId, useUiStore } from '@/store/useUiStore'
import styles from './EditorArea.module.css'

export function EditorArea() {
  const tabs = useUiStore((s) => s.tabs)
  const activeTab = useUiStore((s) => s.activeTab)
  const tab = tabs.find((t) => tabId(t) === activeTab)

  return (
    <div className={styles.root}>
      <TabBar />
      <UpdateBanner />
      <div className={styles.content}>
        {!tab && <WelcomeView />}
        {tab?.kind === 'entity' && <EntityEditor key={tab.name} name={tab.name} />}
        {tab?.kind === 'view' && tab.view === 'research' && <ResearchGraphView />}
        {tab?.kind === 'view' && tab.view === 'relationships' && <RelationshipView />}
        {tab?.kind === 'view' && tab.view === 'strings' && <StringsView />}
        {tab?.kind === 'view' && tab.view === 'assets' && <AssetsView />}
        {tab?.kind === 'view' && tab.view === 'diagnostics' && <DiagnosticsView />}
        {tab?.kind === 'view' && tab.view === 'analytics' && <AnalyticsView />}
        {tab?.kind === 'view' && tab.view === 'balance' && <BalanceView />}
        {tab?.kind === 'view' && tab.view === 'project' && <ProjectView />}
      </div>
    </div>
  )
}
