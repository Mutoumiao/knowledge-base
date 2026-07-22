import type {
  Kpi,
  ObservabilityDetail,
  ObservabilitySection,
  ObservabilityWindow,
} from '@goferbot/data'
import { Link } from '@tanstack/react-router'
import { Alert, Button, Empty, Segmented, Table, Tooltip, Typography } from 'antd'
import { ArrowLeft, ExternalLink, Gauge, Layers, RefreshCw, Timer } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { KpiCard } from '@/features/dashboard/components/KpiCard'
import '@/features/dashboard/obs-console.css'

const { Text } = Typography

export interface ObservabilityDetailViewProps {
  title: string
  description?: string
  data?: ObservabilityDetail
  loading?: boolean
  error?: string | null
  window?: ObservabilityWindow
  onWindowChange?: (w: ObservabilityWindow) => void
  onRefresh?: () => void
  sectionOrder: string[]
  sectionLabels: Record<string, string>
  /** rag | companion — 顶栏色带与文案语气 */
  variant?: 'rag' | 'companion'
}

type Metric = ObservabilitySection['metrics'][number]

function sectionStatusClass(status: string): string {
  if (status === 'ready') return 'obs-status--ready'
  if (status === 'partial') return 'obs-status--partial'
  if (status === 'insufficient_samples') return 'obs-status--insufficient'
  return 'obs-status--pending'
}

function sectionStatusLabel(status: string): string {
  if (status === 'ready') return '就绪'
  if (status === 'partial') return '部分'
  if (status === 'insufficient_samples') return '样本不足'
  return '待埋点'
}

function formatMetricValue(value?: number, unit?: string): string {
  if (value == null) return '—'
  if (unit === 'ratio') return `${(value * 100).toFixed(1)}%`
  if (unit === 'ms') return `${Math.round(value)} ms`
  if (unit === 'tokens' || unit === 'count') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1)
  }
  return String(value)
}

function humanizeKey(key: string): string {
  const map: Record<string, string> = {
    empty_rate: '空结果率',
    degraded_rate: '降级率',
    index_failure_count: '索引失败数',
    p95_e2e_ms: '端到端 P95',
    p95_knowledge_ai_ms: 'Knowledge AI P95',
    p95_latency_ms: '端到端 P95',
    p95_generate_ms: 'generate P95',
    token_cost: '平均 Token',
    quality_fail_rate: 'Quality fail 率',
    safety_hard_stop_rate: '安全硬中断率',
    negative_feedback_rate: '负反馈率',
    postgres: 'PostgreSQL',
    redis: 'Redis',
    minio: 'MinIO',
    'knowledge-ai': 'Knowledge AI',
  }
  if (map[key]) return map[key]
  // node_generate_p95 → generate
  const node = key.match(/^node_(.+)_p95$/)
  if (node) return node[1]
  return key.replace(/_/g, ' ')
}

function kpiFormat(kpi: Kpi): 'ratio' | 'count' | 'ms' {
  if (kpi.unit === 'ms') return 'ms'
  if (kpi.unit === 'tokens' || kpi.unit === 'count') return 'count'
  const k = (kpi.key ?? '').toLowerCase()
  if (k.includes('latency') || k.includes('ms') || k.includes('generate')) return 'ms'
  if (k.includes('count') || k.includes('token') || k.includes('memory')) return 'count'
  return 'ratio'
}

function metricDisplayName(m: Metric): string {
  return m.label ?? humanizeKey(m.key)
}

/** 比率：横向条 + 百分比，不适合无上下文的 tile 网格 */
function RateBarsPanel({ section }: { section: ObservabilitySection }) {
  const ratios = section.metrics.filter((m) => m.unit === 'ratio' || m.key.includes('rate'))
  const others = section.metrics.filter((m) => !ratios.includes(m))

  return (
    <div className="space-y-3">
      {section.note && !section.note.trimStart().startsWith('[') && (
        <p className="obs-section-hint">{section.note}</p>
      )}
      <div className="obs-rate-list">
        {ratios.map((m) => {
          const raw = typeof m.value === 'number' ? m.value : null
          const ready = m.status === 'ready' && raw != null
          const pct = ready && raw != null ? Math.min(100, Math.max(0, raw * 100)) : 0
          return (
            <div key={m.key} className="obs-rate-row">
              <div className="obs-rate-row__head">
                <span className="obs-rate-row__label">{metricDisplayName(m)}</span>
                <span className={`obs-status ${sectionStatusClass(m.status)}`}>
                  <span className="obs-status__dot" aria-hidden />
                  {sectionStatusLabel(m.status)}
                </span>
              </div>
              <div className="obs-rate-row__track" aria-hidden={!ready}>
                <div
                  className={`obs-rate-row__fill ${pct >= 30 ? 'obs-rate-row__fill--warn' : ''}`}
                  style={{ width: ready ? `${pct}%` : '0%' }}
                />
              </div>
              <div className="obs-rate-row__foot">
                <span className="obs-mono obs-rate-row__value">
                  {ready ? `${pct.toFixed(1)}%` : '—'}
                </span>
                {m.note && <span className="obs-rate-row__note">{m.note}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {others.length > 0 && (
        <div className="obs-stat-strip">
          {others.map((m) => (
            <div key={m.key} className="obs-stat-cell">
              <div className="obs-stat-cell__label">{metricDisplayName(m)}</div>
              <div className="obs-stat-cell__value obs-mono">
                {formatMetricValue(m.value, m.unit)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 时延：大字对比条，非卡片墙 */
function LatencyStripPanel({ section }: { section: ObservabilitySection }) {
  const items = section.metrics
  const readyValues = items
    .filter((m) => m.status === 'ready' && typeof m.value === 'number')
    .map((m) => m.value as number)
  const max = Math.max(1, ...readyValues)

  return (
    <div className="space-y-3">
      {section.note && <p className="obs-section-hint">{section.note}</p>}
      <div className="obs-latency-grid">
        {items.map((m) => {
          const raw = typeof m.value === 'number' ? m.value : null
          const ready = m.status === 'ready' && raw != null
          const w = ready && raw != null ? Math.max(4, (raw / max) * 100) : 0
          return (
            <div key={m.key} className="obs-latency-card">
              <div className="obs-latency-card__icon" aria-hidden>
                <Timer size={14} strokeWidth={2.25} />
              </div>
              <div className="obs-latency-card__body">
                <div className="obs-latency-card__label">{metricDisplayName(m)}</div>
                <div className="obs-latency-card__value obs-mono">
                  {ready && raw != null ? Math.round(raw) : '—'}
                  {ready && <span className="obs-latency-card__unit">ms</span>}
                </div>
                <div className="obs-latency-card__bar">
                  <div className="obs-latency-card__bar-fill" style={{ width: `${w}%` }} />
                </div>
                {m.note && <div className="obs-latency-card__note">{m.note}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 单计数：索引失败等 */
function CountStatPanel({ section }: { section: ObservabilitySection }) {
  const m = section.metrics[0]
  if (!m) {
    return <p className="obs-section-hint">{section.note ?? '暂无数据'}</p>
  }
  const ready = m.status === 'ready' && m.value != null
  return (
    <div className="obs-count-hero">
      <div>
        <div className="obs-count-hero__label">{metricDisplayName(m)}</div>
        <div className="obs-count-hero__value obs-mono">{ready ? m.value : '—'}</div>
        {section.note && <p className="obs-section-hint mt-2! mb-0!">{section.note}</p>}
      </div>
      <span className={`obs-status ${sectionStatusClass(m.status)}`}>
        <span className="obs-status__dot" aria-hidden />
        {sectionStatusLabel(m.status)}
      </span>
    </div>
  )
}

/** 节点 P95：排序表 + 相对条 */
function NodesTablePanel({ section }: { section: ObservabilitySection }) {
  if (section.metrics.length === 0) {
    return <p className="obs-section-hint">{section.note ?? '暂无节点 span 样本'}</p>
  }
  const sorted = [...section.metrics].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const max = Math.max(1, ...sorted.map((m) => m.value ?? 0))

  return (
    <div className="space-y-3">
      {section.note && <p className="obs-section-hint">{section.note}</p>}
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        className="obs-data-table"
        dataSource={sorted}
        columns={[
          {
            title: '节点',
            key: 'name',
            render: (_: unknown, m: Metric) => (
              <span className="obs-mono text-xs font-medium">{metricDisplayName(m)}</span>
            ),
          },
          {
            title: 'P95',
            dataIndex: 'value',
            width: 100,
            align: 'right',
            render: (v?: number) => (
              <span className="obs-mono font-semibold">
                {v == null ? '—' : `${Math.round(v)} ms`}
              </span>
            ),
          },
          {
            title: '相对',
            key: 'bar',
            width: 160,
            render: (_: unknown, m: Metric) => {
              const pct = m.value != null ? (m.value / max) * 100 : 0
              return (
                <div className="obs-mini-bar" aria-hidden>
                  <div className="obs-mini-bar__fill" style={{ width: `${pct}%` }} />
                </div>
              )
            },
          },
        ]}
      />
    </div>
  )
}

/** 情绪分布：占比条 */
function EmotionDistPanel({ section }: { section: ObservabilitySection }) {
  if (section.metrics.length === 0) {
    return <p className="obs-section-hint">{section.note ?? '暂无情绪样本'}</p>
  }
  const total = section.metrics.reduce((s, m) => s + (m.value ?? 0), 0) || 1
  const sorted = [...section.metrics].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

  return (
    <div className="space-y-3">
      {section.note && <p className="obs-section-hint">{section.note}</p>}
      <div className="obs-dist-list">
        {sorted.map((m) => {
          const n = m.value ?? 0
          const pct = (n / total) * 100
          return (
            <div key={m.key} className="obs-dist-row">
              <span className="obs-dist-row__name">{metricDisplayName(m)}</span>
              <div className="obs-dist-row__track">
                <div className="obs-dist-row__fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="obs-dist-row__meta obs-mono">
                {n}
                <span className="obs-dist-row__pct"> {pct.toFixed(0)}%</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 依赖健康：芯片列表，value=探测时延 */
function HealthDepsPanel({ section }: { section: ObservabilitySection }) {
  return (
    <div className="space-y-3">
      {section.note && <p className="obs-section-hint">{section.note}</p>}
      <div className="obs-health__row">
        {section.metrics.map((m) => {
          const down = m.note === 'down' || m.note === 'error' || m.status === 'partial'
          return (
            <div key={m.key} className={`obs-chip ${down ? 'obs-chip--alert' : ''}`}>
              <span className={`obs-status ${down ? 'obs-status--down' : 'obs-status--ready'}`}>
                <span className="obs-status__dot" aria-hidden />
                {m.note ?? sectionStatusLabel(m.status)}
              </span>
              <span className="obs-chip__name">{metricDisplayName(m)}</span>
              {m.value != null && <span className="obs-chip__lat">{Math.round(m.value)} ms</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 成本与安全：混合 KPI 行 */
function MixedKpiRowPanel({ section }: { section: ObservabilitySection }) {
  return (
    <div className="space-y-3">
      {section.note && <p className="obs-section-hint">{section.note}</p>}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {section.metrics.map((m) => {
          const asKpi: Kpi = {
            key: m.key,
            status: m.status as Kpi['status'],
            value: m.value,
            unit: m.unit,
            note: m.note,
          }
          return (
            <KpiCard
              key={m.key}
              title={metricDisplayName(m)}
              kpi={asKpi}
              format={m.unit === 'ms' ? 'ms' : m.unit === 'ratio' ? 'ratio' : 'count'}
              description={m.note}
            />
          )
        })}
      </div>
    </div>
  )
}

function SlowTurnsPanel({ section }: { section: ObservabilitySection }) {
  if (section.metrics.length === 0) {
    return <p className="obs-section-hint">{section.note ?? '暂无 W2 慢样本'}</p>
  }

  const rows = section.metrics.map((m, i) => ({
    key: m.key,
    rank: m.label ?? `#${i + 1}`,
    latencyMs: m.value,
    traceId: m.key,
    meta: m.note,
    href: m.href ?? null,
  }))

  return (
    <div className="space-y-3">
      {section.note && !section.note.trimStart().startsWith('[') && (
        <p className="obs-section-hint">{section.note}</p>
      )}
      <Table
        size="small"
        pagination={false}
        scroll={{ x: true }}
        className="obs-data-table"
        dataSource={rows}
        columns={[
          { title: '#', dataIndex: 'rank', width: 52 },
          {
            title: '时延',
            dataIndex: 'latencyMs',
            width: 96,
            align: 'right',
            render: (v: number | undefined) => (
              <span className="obs-mono font-semibold">{formatMetricValue(v, 'ms')}</span>
            ),
          },
          {
            title: 'traceId',
            dataIndex: 'traceId',
            render: (id: string) => (
              <Text code copyable={{ text: id }} className="text-xs!">
                {id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id}
              </Text>
            ),
          },
          {
            title: '元数据',
            dataIndex: 'meta',
            ellipsis: true,
            render: (t?: string) => (
              <span className="text-xs" style={{ color: 'var(--obs-muted)' }}>
                {t ?? '—'}
              </span>
            ),
          },
          {
            title: 'Langfuse',
            dataIndex: 'href',
            width: 96,
            render: (href: string | null) =>
              href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium"
                >
                  打开 <ExternalLink size={12} />
                </a>
              ) : (
                <span className="text-xs" style={{ color: 'var(--obs-faint)' }}>
                  —
                </span>
              ),
          },
        ]}
      />
    </div>
  )
}

function PendingCallout({ note }: { note?: string }) {
  return (
    <div className="obs-pending-callout">
      <Gauge size={16} strokeWidth={2} className="shrink-0 opacity-70" />
      <p className="m-0 text-sm leading-relaxed" style={{ color: 'var(--obs-muted)' }}>
        {note ?? '该分块尚未接入真实数据源，不展示虚构指标。'}
      </p>
    </div>
  )
}

/**
 * 按 section 语义选择展示形态，避免一律 metric-tile。
 */
function SectionBody({
  sectionKey,
  section,
}: {
  sectionKey: string
  section: ObservabilitySection
}) {
  if (section.status === 'pending_instrumentation' && section.metrics.length === 0) {
    return <PendingCallout note={section.note} />
  }

  switch (sectionKey) {
    case 'slow_turns':
      return <SlowTurnsPanel section={section} />
    case 'nodes':
      return <NodesTablePanel section={section} />
    case 'emotion':
      return <EmotionDistPanel section={section} />
    case 'quality_deps':
      return <HealthDepsPanel section={section} />
    case 'latency':
      return <LatencyStripPanel section={section} />
    case 'index':
      return <CountStatPanel section={section} />
    case 'retrieve':
      return <RateBarsPanel section={section} />
    case 'cost_safety':
      return <MixedKpiRowPanel section={section} />
    case 'retrieval':
      // Companion 故意不接检索：紧凑 callout，不假装成指标墙
      return <PendingCallout note={section.note} />
    default: {
      // 回退：按 unit 推断
      const allRatio = section.metrics.every((m) => m.unit === 'ratio' || m.key.includes('rate'))
      if (allRatio && section.metrics.length > 0) {
        return <RateBarsPanel section={section} />
      }
      const allMs = section.metrics.every((m) => m.unit === 'ms')
      if (allMs && section.metrics.length > 0) {
        return <LatencyStripPanel section={section} />
      }
      return <MixedKpiRowPanel section={section} />
    }
  }
}

function sectionKindHint(key: string): string | null {
  const hints: Record<string, string> = {
    index: 'count',
    retrieve: 'rate',
    latency: 'latency',
    nodes: 'table',
    emotion: 'dist',
    slow_turns: 'table',
    quality_deps: 'health',
    cost_safety: 'kpi',
    retrieval: 'n/a',
  }
  return hints[key] ?? null
}

export function ObservabilityDetailView({
  title,
  description,
  data,
  loading,
  error,
  window = '24h',
  onWindowChange,
  onRefresh,
  sectionOrder,
  sectionLabels,
  variant = 'rag',
}: ObservabilityDetailViewProps) {
  const panelMod = variant === 'companion' ? 'obs-panel--companion' : 'obs-panel--rag'
  const badgeMod = variant === 'companion' ? 'obs-panel__badge--companion' : 'obs-panel__badge--rag'

  return (
    <div className="obs-console space-y-5">
      <PageHeader
        title={title}
        description={description}
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/dashboard">
              <Button icon={<ArrowLeft size={14} />}>返回控制台</Button>
            </Link>
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
          action={
            <Button size="small" type="primary" onClick={onRefresh}>
              重试
            </Button>
          }
        />
      )}

      <div aria-busy={loading || undefined} className="space-y-5">
        {data?.kpis && data.kpis.length > 0 && (
          <section className={`obs-panel ${panelMod} obs-rise`}>
            <div className="obs-panel__head">
              <h2 className="obs-panel__title">
                <Layers size={14} />
                黄金指标
              </h2>
              <span className={`obs-panel__badge ${badgeMod}`}>
                {data.kpis.length} KPIs · 非准确率
              </span>
            </div>
            <div className="obs-panel__body">
              <p className="obs-section-hint mb-3!">
                顶栏为可聚合黄金信号；下方分块按数据类型分形态展示（比率 / 时延 / 分布 / 表）。
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {data.kpis.map((kpi, idx) => (
                  <KpiCard
                    key={kpi.key ?? idx}
                    title={kpi.label ?? kpi.key ?? `KPI ${idx + 1}`}
                    kpi={kpi}
                    format={kpiFormat(kpi)}
                    description={kpi.note}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="space-y-3">
          {sectionOrder.map((key, i) => {
            const section = data?.sections?.[key]
            const kind = sectionKindHint(key)
            return (
              <section key={key} className={`obs-panel obs-rise obs-rise-${Math.min(i + 1, 4)}`}>
                <div className="obs-panel__head">
                  <h3 className="obs-panel__title m-0">
                    {sectionLabels[key] ?? key}
                    {kind && (
                      <Tooltip title="本分块展示形态由指标语义决定">
                        <span className="obs-panel__badge">{kind}</span>
                      </Tooltip>
                    )}
                  </h3>
                  {section && (
                    <span className={`obs-status ${sectionStatusClass(section.status)}`}>
                      <span className="obs-status__dot" aria-hidden />
                      {sectionStatusLabel(section.status)}
                    </span>
                  )}
                </div>
                <div className="obs-panel__body">
                  {!section ? (
                    <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <SectionBody sectionKey={key} section={section} />
                  )}
                </div>
              </section>
            )
          })}
        </div>

        <div className="obs-meta">
          <span>
            {data?.generatedAt
              ? `生成于 ${new Date(data.generatedAt).toLocaleString()}`
              : '等待聚合…'}
          </span>
          <span>窗口 {data?.window ?? window}</span>
        </div>
      </div>
    </div>
  )
}
