import { z } from 'zod'
import { AppException } from './lib/app-error.js'

const optionalNonEmptyString = z.preprocess(
  (val) => (val === '' ? undefined : val),
  z.string().optional(),
)

const envSchema = z.object({
  // === 基础 ===
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3100),
  API_PREFIX: z.string().default('api'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // === 数据库（Shared，单一来源：根目录 .env） ===
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),
  TEST_DATABASE_ADMIN_URL: optionalNonEmptyString,

  // === 缓存/队列（Shared，单一来源：根目录 .env） ===
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: optionalNonEmptyString,

  // === 认证 ===
  JWT_SECRET: z.string().min(16, 'JWT_SECRET 至少 16 字符'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET 至少 16 字符'),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'JWT_EXPIRES_IN 格式无效，预期如 15m、2h、7d')
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(/^\d+[smhd]$/, 'JWT_REFRESH_EXPIRES_IN 格式无效，预期如 15m、2h、7d')
    .default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(31).default(12),
  TEST_INVITATION_CODES: optionalNonEmptyString,
  CAPTCHA_ENABLED: z
    .preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())
    .default(false),
  CAPTCHA_WHITELIST_ORIGINS: optionalNonEmptyString,

  // === 配置加密 ===
  SETTINGS_ENCRYPTION_KEY: optionalNonEmptyString,

  // === 存储（MinIO/S3） ===
  MINIO_ENDPOINT: optionalNonEmptyString,
  MINIO_PORT: z.coerce.number().int().positive().optional(),
  MINIO_ACCESS_KEY: optionalNonEmptyString,
  MINIO_SECRET_KEY: optionalNonEmptyString,
  MINIO_BUCKET: optionalNonEmptyString,
  MINIO_REGION: optionalNonEmptyString,

  // === Elasticsearch ===
  ELASTICSEARCH_NODE: optionalNonEmptyString,
  ELASTICSEARCH_API_KEY: optionalNonEmptyString,
  ELASTICSEARCH_USERNAME: optionalNonEmptyString,
  ELASTICSEARCH_PASSWORD: optionalNonEmptyString,
  ELASTICSEARCH_INDEX: optionalNonEmptyString,

  // === Knowledge AI Service (Python, internal) ===
  /** Canonical base URL for Nest → Knowledge AI. */
  KNOWLEDGE_AI_BASE_URL: optionalNonEmptyString,
  /** @deprecated Use KNOWLEDGE_AI_BASE_URL. Kept as fallback alias. */
  KNOWLEDGE_AI_URL: optionalNonEmptyString,
  KNOWLEDGE_AI_SERVICE_TOKEN: optionalNonEmptyString,
  KNOWLEDGE_AI_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  KNOWLEDGE_AI_GENERATION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

  // === 安全 ===
  SSRF_ALLOWED_HOSTNAMES: optionalNonEmptyString,
  CORS_ORIGIN: optionalNonEmptyString,

  // === 队列 ===
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // === 元数据安全 ===
  METADATA_ALLOWED_KEYS: z
    .string()
    .default(
      'year,status,type,category,source,language,author,priority,department,project,tags,version',
    ),

  // === 实例级开关 ===
  RERANK_EAGER_LOAD: z
    .preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())
    .default(false),

  // === 观测 / Langfuse（可选；未配置不阻断启动；业务侧仍可读 process.env）===
  LANGFUSE_PUBLIC_KEY: optionalNonEmptyString,
  LANGFUSE_SECRET_KEY: optionalNonEmptyString,
  LANGFUSE_HOST: optionalNonEmptyString,
  LANGFUSE_EXPORT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  TRACE_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  TRACE_FORCE_CHAT_E2E_MS: z.coerce.number().int().positive().optional(),
  TRACE_FORCE_CHAT_KA_MS: z.coerce.number().int().positive().optional(),
  TRACE_FORCE_COMPANION_E2E_MS: z.coerce.number().int().positive().optional(),
  TRACE_FORCE_COMPANION_GENERATE_MS: z.coerce.number().int().positive().optional(),
  OBS_TURN_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  OBS_SLOW_TOP_N: z.coerce.number().int().positive().optional(),
  OBS_SSE_EXPOSE_TRACE_ID: z
    .preprocess((val) => val === 'true' || val === '1' || val === true, z.boolean())
    .optional(),
  OBS_IMPLICIT_REJECT_ENABLED: z
    .preprocess((val) => {
      if (val === undefined || val === '') return undefined
      return val === 'true' || val === '1' || val === true
    }, z.boolean().optional())
    .optional(),
  OBS_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().optional(),

  // === 初始超级管理员 ===
  SUPER_ADMIN_EMAIL: z.string().email('SUPER_ADMIN_EMAIL 必须是合法邮箱').optional(),
  SUPER_ADMIN_PASSWORD: z
    .union([
      z
        .string()
        .regex(
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
          'SUPER_ADMIN_PASSWORD 至少 8 字符，必须包含大小写字母和数字',
        ),
      z.literal(''),
    ])
    .optional(),
})

export type Env = z.infer<typeof envSchema>

/** Well-known insecure defaults that MUST NOT ship in production. */
const WEAK_KNOWLEDGE_AI_TOKENS = new Set([
  'dev-token-change-me',
  'change-me',
  'change-me-in-dev',
  'test-service-token',
  'secret',
  'token',
])

export function validateEnv(config?: Record<string, unknown>): Env {
  try {
    const source = config ?? process.env
    const env = envSchema.parse(source)

    if (env.NODE_ENV === 'production') {
      const token = env.KNOWLEDGE_AI_SERVICE_TOKEN?.trim() ?? ''
      if (!token) {
        throw new AppException(
          'CONFIG_VALIDATION_ERROR',
          '启动配置校验失败: production 必须设置 KNOWLEDGE_AI_SERVICE_TOKEN',
          500,
        )
      }
      if (WEAK_KNOWLEDGE_AI_TOKENS.has(token) || token.length < 16) {
        throw new AppException(
          'CONFIG_VALIDATION_ERROR',
          '启动配置校验失败: production 禁止使用弱/默认 KNOWLEDGE_AI_SERVICE_TOKEN（长度≥16 且非 dev 默认值）',
          500,
        )
      }
    }

    return env
  } catch (err) {
    if (err instanceof AppException) throw err
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new AppException('CONFIG_VALIDATION_ERROR', `启动配置校验失败: ${issues}`, 500)
    }
    throw err
  }
}
