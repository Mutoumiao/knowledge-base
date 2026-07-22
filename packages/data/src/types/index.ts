import type { z } from 'zod'
import {
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserSchema,
  assignRoleRequestSchema,
  createAdminUserRequestSchema,
  createInvitationRequestSchema,
  invitationCodeSchema,
  invitationCodeTypeSchema,
  invitationListQuerySchema,
  invitationListResponseSchema,
  resetPasswordRequestSchema,
  updateAdminUserRequestSchema,
  updateUserStatusRequestSchema,
} from '../schemas/admin.schema.js'
import {
  authResponseSchema,
  loginRequestSchema,
  publicKeyResponseSchema,
  registerRequestSchema,
  updateProfileRequestSchema,
  userSchema,
} from '../schemas/auth.schema.js'
import {
  chatMessagesChunkSchema,
  chatMessagesRequestSchema,
  chatProvidersResponseSchema,
  chatSourceItemSchema,
  messageListQuerySchema,
  messageListResponseSchema,
  messageMetadataSchema,
  messageSchema,
  providerListItemSchema,
  sessionListResponseSchema,
} from '../schemas/chat.schema.js'
import { pagerRequestSchema, paginationSchema } from '../schemas/common.schema.js'
import {
  createDocumentRequestSchema,
  documentSchema,
  moveDocumentRequestSchema,
  updateDocumentRequestSchema,
} from '../schemas/document.schema.js'
import {
  createFolderRequestSchema,
  folderSchema,
  moveFolderRequestSchema,
  updateFolderRequestSchema,
} from '../schemas/folder.schema.js'
import {
  createKbRequestSchema,
  documentStatusResponseSchema,
  documentStatusSchema,
  kbDetailResponseSchema,
  kbEntrySchema,
  kbListResponseSchema,
  kbSelectorEntrySchema,
  kbSelectorResponseSchema,
  updateKbRequestSchema,
} from '../schemas/kb.schema.js'
import {
  createSessionRequestSchema,
  sessionSchema,
  updateSessionRequestSchema,
} from '../schemas/session.schema.js'
import {
  dashboardSummaryQuerySchema,
  dashboardSummarySchema,
  healthComponentSchema,
  hubCompanionSchema,
  hubHealthSchema,
  hubInventorySchema,
  hubRagSchema,
  kpiSchema,
  kpiStatusSchema,
  observabilityDetailQuerySchema,
  observabilityDetailSchema,
  observabilityMetricSchema,
  observabilitySectionSchema,
  observabilityWindowSchema,
  sectionStatusSchema,
} from '../schemas/dashboard.schema.js'
import {
  chatExplicitFeedbackSchema,
  chatMessageFeedbackRequestSchema,
  chatMessageFeedbackResponseSchema,
  observabilityRouteSchema,
  observabilitySlowTurnItemSchema,
  observabilityTurnFlagsSchema,
  observabilityTurnMinimalWriteSchema,
  observabilityTurnStatusSchema,
  observabilityTurnWriteSchema,
} from '../schemas/observability.schema.js'
import {
  appearanceConfigSchema,
  availableProvidersResponseSchema,
  type CategorySettingsMap,
  chatConfigSchema,
  companionConfigSchema,
  fetchedModelSchema,
  indexingConfigSchema,
  modelProviderSchema,
  modelSchema,
  providerPresetSchema,
  providerTypeSchema,
  ragConfigSchema,
  settingCategorySchema,
  settingsResponseSchema,
  settingsSchema,
} from '../schemas/settings.schema.js'

export type PagerRequest = z.infer<typeof pagerRequestSchema>
export type Pagination = z.infer<typeof paginationSchema>

export type LoginRequest = z.infer<typeof loginRequestSchema>
export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>
export type User = z.infer<typeof userSchema>
export type AuthResponse = z.infer<typeof authResponseSchema>
export type PublicKeyResponse = z.infer<typeof publicKeyResponseSchema>

export type KbEntry = z.infer<typeof kbEntrySchema>
export type CreateKbRequest = z.infer<typeof createKbRequestSchema>
export type UpdateKbRequest = z.infer<typeof updateKbRequestSchema>
export type KbListResponse = z.infer<typeof kbListResponseSchema>
export type KbSelectorEntry = z.infer<typeof kbSelectorEntrySchema>
export type KbSelectorResponse = z.infer<typeof kbSelectorResponseSchema>
export type KbDetailResponse = z.infer<typeof kbDetailResponseSchema>
export type DocumentStatus = z.infer<typeof documentStatusSchema>
export type DocumentStatusResponse = z.infer<typeof documentStatusResponseSchema>

export type Message = z.infer<typeof messageSchema>
export type ChatSourceItem = z.infer<typeof chatSourceItemSchema>
export type MessageMetadata = z.infer<typeof messageMetadataSchema>

export type ObservabilityWindow = z.infer<typeof observabilityWindowSchema>
export type KpiStatus = z.infer<typeof kpiStatusSchema>
export type SectionStatus = z.infer<typeof sectionStatusSchema>
export type Kpi = z.infer<typeof kpiSchema>
export type HealthComponent = z.infer<typeof healthComponentSchema>
export type HubHealth = z.infer<typeof hubHealthSchema>
export type HubRag = z.infer<typeof hubRagSchema>
export type HubCompanion = z.infer<typeof hubCompanionSchema>
export type HubInventory = z.infer<typeof hubInventorySchema>
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>
export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>
export type ObservabilityMetric = z.infer<typeof observabilityMetricSchema>
export type ObservabilitySection = z.infer<typeof observabilitySectionSchema>
export type ObservabilityDetail = z.infer<typeof observabilityDetailSchema>
export type ObservabilityDetailQuery = z.infer<typeof observabilityDetailQuerySchema>
export type ObservabilityRoute = z.infer<typeof observabilityRouteSchema>
export type ObservabilityTurnStatus = z.infer<typeof observabilityTurnStatusSchema>
export type ObservabilityTurnFlags = z.infer<typeof observabilityTurnFlagsSchema>
export type ObservabilityTurnWrite = z.infer<typeof observabilityTurnWriteSchema>
export type ObservabilityTurnMinimalWrite = z.infer<typeof observabilityTurnMinimalWriteSchema>
export type ObservabilitySlowTurnItem = z.infer<typeof observabilitySlowTurnItemSchema>
export type ChatExplicitFeedback = z.infer<typeof chatExplicitFeedbackSchema>
export type ChatMessageFeedbackRequest = z.infer<typeof chatMessageFeedbackRequestSchema>
export type ChatMessageFeedbackResponse = z.infer<typeof chatMessageFeedbackResponseSchema>
export type Session = z.infer<typeof sessionSchema>
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>
export type MessageListResponse = z.infer<typeof messageListResponseSchema>
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>
export type ProviderListItem = z.infer<typeof providerListItemSchema>
export type ChatProvidersResponse = z.infer<typeof chatProvidersResponseSchema>
export type ChatMessagesRequest = z.infer<typeof chatMessagesRequestSchema>
export type ChatMessagesChunk = z.infer<typeof chatMessagesChunkSchema>
export type MessageListQuery = z.infer<typeof messageListQuerySchema>

export type Document = z.infer<typeof documentSchema>
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>
export type MoveDocumentRequest = z.infer<typeof moveDocumentRequestSchema>

export type Folder = z.infer<typeof folderSchema>
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>
export type UpdateFolderRequest = z.infer<typeof updateFolderRequestSchema>
export type MoveFolderRequest = z.infer<typeof moveFolderRequestSchema>

export type AdminUser = z.infer<typeof adminUserSchema>
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>
export type UpdateUserStatusRequest = z.infer<typeof updateUserStatusRequestSchema>
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>
export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>
export type UpdateAdminUserRequest = z.infer<typeof updateAdminUserRequestSchema>
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>
export type AssignRoleRequest = z.infer<typeof assignRoleRequestSchema>
export type InvitationCodeType = z.infer<typeof invitationCodeTypeSchema>
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>
export type InvitationCode = z.infer<typeof invitationCodeSchema>
export type InvitationListQuery = z.infer<typeof invitationListQuerySchema>
export type InvitationListResponse = z.infer<typeof invitationListResponseSchema>

export type Settings = z.infer<typeof settingsSchema>
export type SettingsResponse = z.infer<typeof settingsResponseSchema>
export type ProviderType = z.infer<typeof providerTypeSchema>
export type Model = z.infer<typeof modelSchema>
export type ModelProvider = z.infer<typeof modelProviderSchema>
export type FetchedModel = z.infer<typeof fetchedModelSchema>
export type ProviderPreset = z.infer<typeof providerPresetSchema>
export type ChatSettings = z.infer<typeof chatConfigSchema>
export type RagSettings = z.infer<typeof ragConfigSchema>
export type CompanionSettings = z.infer<typeof companionConfigSchema>
export type IndexingSettings = z.infer<typeof indexingConfigSchema>
export type AppearanceSettings = z.infer<typeof appearanceConfigSchema>
export type SettingCategory = z.infer<typeof settingCategorySchema>
export type AvailableProvidersResponse = z.infer<typeof availableProvidersResponseSchema>

export {
  ADMIN_ACCESS_COOKIE,
  ADMIN_REFRESH_COOKIE,
  AuthApp,
  getCookieNamesForApp,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type PermissionCode,
  ROLE_PERMISSIONS,
  WEB_ACCESS_COOKIE,
  WEB_REFRESH_COOKIE,
} from '../constants/index.js'
export type { CategorySettingsMap }

export {
  adminUserListQuerySchema,
  adminUserListResponseSchema,
  adminUserSchema,
  appearanceConfigSchema,
  assignRoleRequestSchema,
  authResponseSchema,
  availableProvidersResponseSchema,
  chatConfigSchema,
  chatMessagesChunkSchema,
  chatMessagesRequestSchema,
  chatProvidersResponseSchema,
  companionConfigSchema,
  createAdminUserRequestSchema,
  createDocumentRequestSchema,
  createFolderRequestSchema,
  createInvitationRequestSchema,
  createKbRequestSchema,
  createSessionRequestSchema,
  documentSchema,
  documentStatusResponseSchema,
  documentStatusSchema,
  fetchedModelSchema,
  folderSchema,
  indexingConfigSchema,
  invitationCodeSchema,
  invitationCodeTypeSchema,
  invitationListQuerySchema,
  invitationListResponseSchema,
  kbDetailResponseSchema,
  kbEntrySchema,
  kbListResponseSchema,
  kbSelectorEntrySchema,
  kbSelectorResponseSchema,
  loginRequestSchema,
  messageListQuerySchema,
  messageListResponseSchema,
  messageSchema,
  modelProviderSchema,
  modelSchema,
  moveDocumentRequestSchema,
  moveFolderRequestSchema,
  pagerRequestSchema,
  paginationSchema,
  providerListItemSchema,
  providerPresetSchema,
  providerTypeSchema,
  publicKeyResponseSchema,
  ragConfigSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  sessionListResponseSchema,
  sessionSchema,
  settingCategorySchema,
  settingsResponseSchema,
  settingsSchema,
  updateAdminUserRequestSchema,
  updateDocumentRequestSchema,
  updateFolderRequestSchema,
  updateKbRequestSchema,
  updateProfileRequestSchema,
  updateSessionRequestSchema,
  updateUserStatusRequestSchema,
  userSchema,
}

export {
  chatExplicitFeedbackSchema,
  chatMessageFeedbackRequestSchema,
  chatMessageFeedbackResponseSchema,
  observabilityRouteSchema,
  observabilitySlowTurnItemSchema,
  observabilityTurnFlagsSchema,
  observabilityTurnMinimalWriteSchema,
  observabilityTurnStatusSchema,
  observabilityTurnWriteSchema,
} from '../schemas/observability.schema.js'

export {
  dashboardSummaryQuerySchema,
  dashboardSummarySchema,
  hubCompanionSchema,
  hubRagSchema,
  kpiSchema,
  observabilityDetailQuerySchema,
  observabilityDetailSchema,
  observabilityWindowSchema,
} from '../schemas/dashboard.schema.js'
