import type { ObservabilityDetail, ObservabilityWindow } from '@goferbot/data'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { ObservabilityDetailView } from '@/features/observability/components/ObservabilityDetailView'
import { getCompanionObservability } from '@/features/observability/services'
import { useQueryWithRetry } from '@/hooks/useQueryWithRetry'
import { ROUTES_REGISTER } from '@/router-register'

export const Route = createFileRoute('/_authenticated/observability/companion')({
  component: CompanionObservabilityPage,
  staticData: { meta: ROUTES_REGISTER.observabilityCompanion },
  validateSearch: (search: Record<string, unknown>): { window?: ObservabilityWindow } => {
    const w = search.window
    if (w === '1h' || w === '24h' || w === '7d') return { window: w }
    return {}
  },
})

function CompanionObservabilityPage() {
  const search = Route.useSearch()
  const [window, setWindow] = useState<ObservabilityWindow>(search.window ?? '24h')
  const fetcher = useCallback(() => getCompanionObservability(window), [window])
  const { data, loading, error, run } = useQueryWithRetry<ObservabilityDetail>(
    fetcher,
    [window],
    true,
  )

  return (
    <ObservabilityDetailView
      title="Companion 观测"
      description="过程履约（节点时延/outcome），非准确率；硬中断不出现在聊天记录"
      data={data ?? undefined}
      loading={loading}
      error={error}
      window={window}
      onWindowChange={setWindow}
      onRefresh={() => void run()}
      variant="companion"
      sectionOrder={['latency', 'nodes', 'emotion', 'cost_safety', 'slow_turns', 'retrieval']}
      sectionLabels={{
        latency: '时延分解',
        nodes: '节点 P95',
        slow_turns: '慢请求 Top N',
        retrieval: '检索（未接入）',
        emotion: '情绪分布',
        cost_safety: '成本与安全',
      }}
    />
  )
}
