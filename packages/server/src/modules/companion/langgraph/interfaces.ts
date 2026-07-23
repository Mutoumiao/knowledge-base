export type SafetyResult = {
  safetyLevel: 'safe' | 'caution' | 'redirect' | 'block' | 'crisis'
  category:
    | 'normal'
    | 'emotional_dependency'
    | 'manipulation'
    | 'self_harm'
    | 'sexual_boundary'
    | 'privacy'
    | 'illegal'
    | 'medical_legal_financial'
    | 'other'
  boundaryAction: 'continue' | 'soft_boundary' | 'redirect' | 'refuse' | 'crisis_support'
  reason: string
  responseGuidance: string
  allowMemoryExtraction: boolean
}

export type IntentResult = {
  primary: IntentPrimary
  secondary: IntentPrimary[]
  confidence: number
  userNeed: UserNeed
  requestedAgentAction: RequestedAgentAction
  relationshipSignal: RelationshipSignal
  replyExpectation: ReplyExpectation
  shouldClarify: boolean
  clarifyingQuestion: string | null
  promptGuidance: string
}

export type IntentPrimary =
  | 'casual_chat'
  | 'emotional_support'
  | 'relationship_advice'
  | 'romantic_flirt'
  | 'companionship_presence'
  | 'roleplay'
  | 'life_sharing'
  | 'memory_update'
  | 'preference_setting'
  | 'agent_feedback'
  | 'conversation_repair'
  | 'date_or_activity_planning'
  | 'creative_request'
  | 'meta_question'
  | 'unclear'

export type UserNeed =
  | 'be_heard'
  | 'be_comforted'
  | 'get_advice'
  | 'get_reply_draft'
  | 'play_along'
  | 'feel_connected'
  | 'set_boundary'
  | 'update_memory'
  | 'adjust_agent'
  | 'unknown'

export type RequestedAgentAction =
  | 'answer_directly'
  | 'comfort_first'
  | 'ask_follow_up'
  | 'draft_message'
  | 'analyze_situation'
  | 'roleplay_response'
  | 'remember_fact'
  | 'adjust_style'
  | 'repair_misunderstanding'
  | 'continue_topic'

export type RelationshipSignal =
  | 'neutral'
  | 'warming_up'
  | 'seeking_closeness'
  | 'testing_boundary'
  | 'feeling_hurt'
  | 'pulling_away'
  | 'dependency_risk'
  | 'conflict'

export type ReplyExpectation = {
  depth: 'short' | 'medium' | 'deep'
  warmth: 'low' | 'medium' | 'high'
  directness: 'gentle' | 'balanced' | 'direct'
  shouldAskQuestion: boolean
}

export type EmotionResult = {
  primaryEmotion: EmotionPrimary
  secondaryEmotions: string[]
  intensity: number
  valence: 'positive' | 'neutral' | 'negative' | 'mixed'
  arousal: 'low' | 'medium' | 'high'
  needsComfort: boolean
  needsDeescalation: boolean
  needsClarification: boolean
  emotionalCue: string
  replyTone: ReplyTone
}

export type EmotionPrimary =
  | 'neutral'
  | 'happy'
  | 'tired'
  | 'lonely'
  | 'sad'
  | 'anxious'
  | 'angry'
  | 'jealous'
  | 'embarrassed'
  | 'affectionate'
  | 'playful'
  | 'confused'
  | 'disappointed'
  | 'stressed'
  | 'hurt'

export type ReplyTone =
  | 'light'
  | 'warm'
  | 'soft'
  | 'playful'
  | 'calm'
  | 'serious'
  | 'reassuring'
  | 'apologetic'

export type RelationshipResult = {
  stage: RelationshipStage
  displayName: string
  closenessScore: number
  trustLevel: 'low' | 'medium' | 'high'
  stability: 'new' | 'warming' | 'stable' | 'deepening' | 'fragile' | 'repairing'
  boundaryMode: 'open' | 'warm' | 'careful' | 'firm'
  intimacyPermission: 'low' | 'medium' | 'high'
  pacing: 'slow_down' | 'hold' | 'advance_gently' | 'repair_first'
  riskSignals: RiskSignal[]
  relationshipGuidance: string
}

export type RelationshipStage =
  | 'new_connection'
  | 'warming_up'
  | 'comfortable_chat'
  | 'trusted_companion'
  | 'close_bond'
  | 'repairing'
  | 'boundary_sensitive'
  | 'dependency_watch'

export type RiskSignal =
  | 'low_history'
  | 'dependency_risk'
  | 'boundary_testing'
  | 'conflict'
  | 'pulling_away'
  | 'sexual_boundary'
  | 'emotional_volatility'

export type RouteResult = {
  route: RouteName
  responseLength: 'very_short' | 'short' | 'medium' | 'long'
  shouldAskQuestion: boolean
  shouldGiveAdvice: boolean
  shouldUsePetName: boolean
  shouldMirrorEmotion: boolean
  routeGuidance: string
}

export type RouteName =
  | 'light_companion'
  | 'warm_comfort'
  | 'deep_comfort'
  | 'playful_flirt'
  | 'calm_deescalation'
  | 'relationship_repair'
  | 'gentle_clarification'
  | 'practical_support'
  | 'quiet_presence'
  | 'memory_ack'
  | 'roleplay_flow'

export type PolicyResult = {
  policy: PolicyName
  sentenceBudget: { min: number; max: number }
  rhythm: 'still' | 'soft' | 'natural' | 'lively' | 'focused'
  openingMove: OpeningMove
  allowedMoves: AllowedMove[]
  forbiddenMoves: ForbiddenMove[]
  questionLimit: number
  adviceLimit: number
  intimacyLevel: 'low' | 'medium' | 'high'
  styleGuidance: string
}

export type PolicyName =
  | 'quiet_presence'
  | 'warm_companion'
  | 'deep_empathy'
  | 'playful_flirt'
  | 'calm_boundary'
  | 'relationship_repair'
  | 'gentle_clarify'
  | 'practical_support'
  | 'roleplay_flow'
  | 'memory_ack'

export type OpeningMove =
  | 'acknowledge'
  | 'comfort'
  | 'mirror'
  | 'apologize'
  | 'play'
  | 'answer'
  | 'clarify'
  | 'set_boundary'

export type AllowedMove =
  | 'validate_feeling'
  | 'mirror_emotion'
  | 'offer_presence'
  | 'ask_one_question'
  | 'give_one_suggestion'
  | 'give_two_suggestions'
  | 'light_tease'
  | 'use_pet_name'
  | 'repair_misunderstanding'
  | 'continue_roleplay'
  | 'acknowledge_memory'
  | 'set_soft_boundary'

export type ForbiddenMove =
  | 'lecture'
  | 'over_explain'
  | 'multiple_questions'
  | 'premature_advice'
  | 'intense_flirt'
  | 'diagnose_user'
  | 'take_sides_aggressively'
  | 'pressure_to_disclose'
  | 'promise_real_world_action'
  | 'expose_internal_labels'

export type QualityGuardResult = {
  status: 'pass' | 'warn' | 'fail'
  score: number
  sentenceCount: number
  questionCount: number
  adviceCount: number
  violations: Violation[]
}

export type Violation = {
  code: ViolationCode
  severity: 'low' | 'medium' | 'high'
  evidence: string
}

export type ViolationCode =
  | 'too_many_sentences'
  | 'too_many_questions'
  | 'too_many_suggestions'
  | 'internal_label_leak'
  | 'breaks_immersion'
  | 'forbidden_lecture'
  | 'forbidden_over_explain'
  | 'forbidden_premature_advice'
  | 'forbidden_intense_flirt'
  | 'forbidden_diagnosis'
  | 'forbidden_aggressive_siding'
  | 'forbidden_pressure'
  | 'forbidden_real_world_promise'

export type MemoryCategory =
  | 'preference'
  | 'boundary'
  | 'relationship_goal'
  | 'conversation_style'
  | 'important_fact'
  | 'identity_profile'
  | 'temporary_emotion'
  | 'small_talk'
  | 'assistant_generated'
  | 'duplicate'
  | 'unsafe'
  | 'unclear'

export type MemoryCandidate = {
  shouldExtract: boolean
  confidence: number
  category: MemoryCategory
  stability: 'stable' | 'likely_stable' | 'temporary' | 'unclear'
  importance: number
  reason: string
  candidateFacts: string[]
}

export type MemoryItem = {
  type: 'preference' | 'boundary' | 'relationship_goal' | 'conversation_style' | 'important_fact'
  content: string
  importance: number
}

export type MemoryExtraction = {
  memories: MemoryItem[]
}

export type ConversationSummary = {
  text: string
  updatedAt: Date
}

export type TokenSink = (delta: string) => void

/** 节点级 structured 三态（O11）；仅 outcome/reason，不存 raw */
export type StructuredStageRecord = {
  outcome: 'success' | 'coerced' | 'fallback'
  reason?: string
}

export interface NodeExecutionContext {
  userId: string
  companionId: string
  conversationId: string
  companionName: string
  companionPersonality?: string
  companionTone?: string
  companionBoundaries?: string
  companionGuardrails?: string
  /** 持久化的多节 defaultPrompt，进入 generate 注入链 */
  companionDefaultPrompt?: string
  signal?: AbortSignal
  /**
   * 整轮图共享的 structured repair 预算（D10）。
   * 由 graph.stream 注入；可变字段 used 跨节点累计。
   */
  structuredRepairBudget?: { used: number; budget: number }
  /**
   * 整轮图共享的 structured 三态结局（O11）。
   * 由 SharedNodeFactory.invokeStructured 写入；stream 收尾挂 spanAttrs。
   */
  structuredStages?: Record<string, StructuredStageRecord>
}

export interface CompanionState {
  userId: string
  companionId: string
  conversationId: string
  userMessage: string
  safety?: SafetyResult
  intent?: IntentResult
  emotion?: EmotionResult
  relationship?: RelationshipResult
  route?: RouteResult
  policy?: PolicyResult
  quality?: QualityGuardResult
  memoryCandidate?: MemoryCandidate
  extractedMemories?: MemoryItem[]
  summary?: ConversationSummary
  assistantReply?: string
  partialTokens?: string
  existingMemories?: Array<{
    id: string
    type: string
    content: string
    importance: number
  }>
  recentMessages?: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: Date
  }>
  /**
   * 会话累计消息数（含本轮已落库的用户消息）。
   * 供 relationship 等节点判断关系推进节奏；不得用 recentMessages.length 代替（窗口有上限）。
   */
  messageCount?: number
  feedbacks?: Array<{
    rating: 'positive' | 'negative'
    reason?: string
  }>
  lastFallback?: string
}
