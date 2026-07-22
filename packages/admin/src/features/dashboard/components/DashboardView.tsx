import type { DashboardSummary, ObservabilityWindow } from '@goferbot/data'
import { Alert, Button, Col, Row, Segmented } from 'antd'
import { ExternalLink, Radar, RefreshCw, Sparkles } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { PageHeader } from '@/components/common/PageHeader'
import { PERMISSIONS } from '@/constants/permissions'
import { useAuthStore } from '@/stores/auth'
import '../obs-console.css'
import { HealthBar } from './HealthBar'
import { InventoryStrip } from './InventoryStrip'
import { KpiCard } from './KpiCard'

export interface DashboardViewProps {
  data?: DashboardSummary
  loading?: boolean
  error?: string | null
  window?: ObservabilityWindow
  onWindowChange?: (w: ObservabilityWindow) => void
  onRefresh?: () => void
}

export function DashboardView({
  data,
  loading,
  error,
  window = '24h',
  onWindowChange,
  onRefresh,
}: DashboardViewProps) {
  const permissions = useAuthStore((s) => s.user?.permissions ?? [])
  const canMetrics = permissions.includes(PERMISSIONS.SYSTEM_METRICS)

  return (
    <div className="obs-console space-y-5">
      <PageHeader
        title="控制台"
        description="系统健康与 RAG / Companion 黄金观测指标（非经营增长看板）"
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={window}
              onChange={(v) => onWindowChange?.(v as ObservabilityWindow)}
              options={[
                { label: '1 小时', value: '1h' },
                { label: '24 小时', value: '24h' },
                { label: '7 天', value: '7d' },
              ]}
            />
            <Button icon={<RefreshCw size={14} />} onClick={onRefresh} loading={loading}>
              刷新
            </Button>
          </div>
        }
      />

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          description="聚合接口失败时不会用假数据顶替。请检查后端服务后重试。"
          action={
            <Button size="small" type="primary" onClick={onRefresh}>
              重试
            </Button>
          }
        />
      )}

      <div aria-busy={loading || undefined} className="space-y-5">
        <HealthBar health={data?.health} />

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <section className="obs-panel obs-panel--rag obs-rise obs-rise-2 h-full">
              <div className="obs-panel__head">
                <h3 className="obs-panel__title m-0">
                  <Radar size={14} strokeWidth={2.25} />
                  RAG
                  <span className="obs-panel__badge obs-panel__badge--rag">retrieval</span>
                </h3>
                {canMetrics && (
                  <Link
                    to="/observability/rag"
                    search={{ window }}
                    className="obs-panel__link"
                  >
                    查看详情 <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <div className="obs-panel__body">
                <Row gutter={[10, 10]}>
                  <Col xs={24} sm={8}>
                    <KpiCard title="空结果率" kpi={data?.rag.emptyRate} format="ratio" />
                  </Col>
                  <Col xs={24} sm={8}>
                    <KpiCard title="降级率" kpi={data?.rag.degradedRate} format="ratio" />
                  </Col>
                  <Col xs={24} sm={8}>
                    <KpiCard title="索引失败" kpi={data?.rag.indexFailureCount} format="count" />
                  </Col>
                  {data?.rag.p95LatencyMs && (
                    <Col xs={24} sm={8}>
                      <KpiCard
                        title="Chat e2e P95"
                        kpi={data.rag.p95LatencyMs}
                        format="ms"
                        description="非准确率"
                      />
                    </Col>
                  )}
                  {data?.rag.contractSuccessRate && (
                    <Col xs={24} sm={8}>
                      <KpiCard
                        title="契约成功率"
                        kpi={data.rag.contractSuccessRate}
                        format="ratio"
                        description="非准确率"
                      />
                    </Col>
                  )}
                </Row>
              </div>
            </section>
          </Col>

          <Col xs={24} lg={12}>
            <section className="obs-panel obs-panel--companion obs-rise obs-rise-3 h-full">
              <div className="obs-panel__head">
                <h3 className="obs-panel__title m-0">
                  <Sparkles size={14} strokeWidth={2.25} />
                  Companion
                  <span className="obs-panel__badge obs-panel__badge--companion">pipeline</span>
                </h3>
                {canMetrics && (
                  <Link
                    to="/observability/companion"
                    search={{ window }}
                    className="obs-panel__link"
                  >
                    查看详情 <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <div className="obs-panel__body">
                <Row gutter={[10, 10]}>
                  <Col xs={24} sm={12}>
                    <KpiCard
                      title="端到端 P95"
                      kpi={data?.companion.p95LatencyMs}
                      format="ms"
                      description="过程履约，非准确率"
                    />
                  </Col>
                  <Col xs={24} sm={12}>
                    <KpiCard
                      title="Quality fail"
                      kpi={data?.companion.qualityFailRate}
                      format="ratio"
                      description="观测型：不表示主回复被丢弃"
                    />
                  </Col>
                  <Col xs={24} sm={12}>
                    <KpiCard
                      title="硬中断率"
                      kpi={data?.companion.safetyHardStopRate}
                      format="ratio"
                      description="不出现在聊天记录；侧信道事件聚合"
                    />
                  </Col>
                  <Col xs={24} sm={12}>
                    <KpiCard
                      title="负反馈率"
                      kpi={data?.companion.negativeFeedbackRate}
                      format="ratio"
                      description="negative / feedbackCount"
                    />
                  </Col>
                </Row>
              </div>
            </section>
          </Col>
        </Row>

        <InventoryStrip inventory={data?.inventory} />

        <div className="obs-meta">
          <span>
            {data?.generatedAt
              ? `生成于 ${new Date(data.generatedAt).toLocaleString()}`
              : '等待聚合…'}
          </span>
          <span>窗口 {data?.window ?? window} · live aggregate</span>
        </div>
      </div>
    </div>
  )
}
