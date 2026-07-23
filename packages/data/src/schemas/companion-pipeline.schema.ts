import { z } from 'zod'

// ============================================================================
// Step 1: Safety Guard Schema (from inbox.route.ts L63-81)
// ============================================================================
export const conversationSafetySchema = z.object({
  safetyLevel: z.enum(['safe', 'caution', 'redirect', 'block', 'crisis']),
  category: z.enum([
    'normal',
    'emotional_dependency',
    'manipulation',
    'self_harm',
    'sexual_boundary',
    'privacy',
    'illegal',
    'medical_legal_financial',
    'other',
  ]),
  boundaryAction: z.enum(['continue', 'soft_boundary', 'redirect', 'refuse', 'crisis_support']),
  reason: z.string().trim().max(300),
  responseGuidance: z.string().trim().max(600),
  allowMemoryExtraction: z.boolean(),
})

export const fallbackSafety = {
  safetyLevel: 'caution' as const,
  category: 'other' as const,
  boundaryAction: 'soft_boundary' as const,
  reason: '安全边界判断暂时不可用，采用保守回复策略。',
  responseGuidance:
    '用温和、克制、尊重边界的方式回复；不要提供操控、伤害、违法或高风险专业建议。若涉及自伤危机：拒绝方法，表达关心，可提示希望24热线 400-161-9995 或北京心理危机干预 010-82951332。',
  allowMemoryExtraction: false,
}

// ============================================================================
// Step 2: Intent Recognition Schema (from inbox.route.ts L84-150)
// ============================================================================
export const companionIntentPrimarySchema = z.enum([
  'casual_chat',
  'emotional_support',
  'relationship_advice',
  'romantic_flirt',
  'companionship_presence',
  'roleplay',
  'life_sharing',
  'memory_update',
  'preference_setting',
  'agent_feedback',
  'conversation_repair',
  'date_or_activity_planning',
  'creative_request',
  'meta_question',
  'unclear',
])

export const conversationIntentSchema = z.object({
  primary: companionIntentPrimarySchema,
  secondary: z.array(companionIntentPrimarySchema).max(3),
  confidence: z.number().min(0).max(1),
  userNeed: z.enum([
    'be_heard',
    'be_comforted',
    'get_advice',
    'get_reply_draft',
    'play_along',
    'feel_connected',
    'set_boundary',
    'update_memory',
    'adjust_agent',
    'unknown',
  ]),
  requestedAgentAction: z.enum([
    'answer_directly',
    'comfort_first',
    'ask_follow_up',
    'draft_message',
    'analyze_situation',
    'roleplay_response',
    'remember_fact',
    'adjust_style',
    'repair_misunderstanding',
    'continue_topic',
  ]),
  relationshipSignal: z.enum([
    'neutral',
    'warming_up',
    'seeking_closeness',
    'testing_boundary',
    'feeling_hurt',
    'pulling_away',
    'dependency_risk',
    'conflict',
  ]),
  replyExpectation: z.object({
    depth: z.enum(['short', 'medium', 'deep']),
    warmth: z.enum(['low', 'medium', 'high']),
    directness: z.enum(['gentle', 'balanced', 'direct']),
    shouldAskQuestion: z.boolean(),
  }),
  shouldClarify: z.boolean(),
  clarifyingQuestion: z.string().trim().max(200).nullable(),
  promptGuidance: z.string().trim().max(600),
})

export const fallbackIntent = {
  primary: 'unclear' as const,
  secondary: [],
  confidence: 0.3,
  userNeed: 'unknown' as const,
  requestedAgentAction: 'ask_follow_up' as const,
  relationshipSignal: 'neutral' as const,
  replyExpectation: {
    depth: 'medium' as const,
    warmth: 'medium' as const,
    directness: 'gentle' as const,
    shouldAskQuestion: true,
  },
  shouldClarify: true,
  clarifyingQuestion: '你是更想让我先听你说说，还是想让我帮你一起想办法？',
  promptGuidance: '先简短承接用户，不要擅自下结论；用一个自然的问题澄清用户真正需要。',
}

// ============================================================================
// Step 3: Emotion Recognition Schema (from inbox.route.ts L153-191)
// ============================================================================
export const conversationEmotionSchema = z.object({
  primaryEmotion: z.enum([
    'neutral',
    'happy',
    'tired',
    'lonely',
    'sad',
    'anxious',
    'angry',
    'jealous',
    'embarrassed',
    'affectionate',
    'playful',
    'confused',
    'disappointed',
    'stressed',
    'hurt',
  ]),
  secondaryEmotions: z.array(z.string().trim().min(1).max(40)).max(3),
  intensity: z.number().min(0).max(1),
  valence: z.enum(['positive', 'neutral', 'negative', 'mixed']),
  arousal: z.enum(['low', 'medium', 'high']),
  needsComfort: z.boolean(),
  needsDeescalation: z.boolean(),
  needsClarification: z.boolean(),
  emotionalCue: z.string().trim().max(300),
  replyTone: z.enum([
    'light',
    'warm',
    'soft',
    'playful',
    'calm',
    'serious',
    'reassuring',
    'apologetic',
  ]),
})

export const fallbackEmotion = {
  primaryEmotion: 'neutral' as const,
  secondaryEmotions: [],
  intensity: 0.3,
  valence: 'neutral' as const,
  arousal: 'medium' as const,
  needsComfort: false,
  needsDeescalation: false,
  needsClarification: true,
  emotionalCue: '情绪识别暂时不可用，采用中性陪伴策略。',
  replyTone: 'warm' as const,
}

// ============================================================================
// Step 4: Relationship Stage Schema (from inbox.route.ts L193-223)
// ============================================================================
export const conversationRelationshipStageSchema = z.object({
  stage: z.enum([
    'new_connection',
    'warming_up',
    'comfortable_chat',
    'trusted_companion',
    'close_bond',
    'repairing',
    'boundary_sensitive',
    'dependency_watch',
  ]),
  displayName: z.string().trim().min(1).max(80),
  closenessScore: z.number().int().min(0).max(100),
  trustLevel: z.enum(['low', 'medium', 'high']),
  stability: z.enum(['new', 'warming', 'stable', 'deepening', 'fragile', 'repairing']),
  boundaryMode: z.enum(['open', 'warm', 'careful', 'firm']),
  intimacyPermission: z.enum(['low', 'medium', 'high']),
  pacing: z.enum(['slow_down', 'hold', 'advance_gently', 'repair_first']),
  riskSignals: z
    .array(
      z.enum([
        'low_history',
        'dependency_risk',
        'boundary_testing',
        'conflict',
        'pulling_away',
        'sexual_boundary',
        'emotional_volatility',
      ]),
    )
    .max(5),
  relationshipGuidance: z.string().trim().max(700),
})

export const fallbackRelationshipStage = {
  stage: 'new_connection' as const,
  displayName: '初识破冰',
  closenessScore: 20,
  trustLevel: 'low' as const,
  stability: 'new' as const,
  boundaryMode: 'warm' as const,
  intimacyPermission: 'low' as const,
  pacing: 'hold' as const,
  riskSignals: ['low_history' as const],
  relationshipGuidance:
    '关系还处在初识阶段，回复要自然、轻松、有边界感；不要突然使用过高亲密度，也不要把关系推进得太快。',
}

// ============================================================================
// Step 5: Route Schema (from inbox.route.ts L225-245)
// ============================================================================
export const emotionRouteSchema = z.object({
  route: z.enum([
    'light_companion',
    'warm_comfort',
    'deep_comfort',
    'playful_flirt',
    'calm_deescalation',
    'relationship_repair',
    'gentle_clarification',
    'practical_support',
    'quiet_presence',
    'memory_ack',
    'roleplay_flow',
  ]),
  responseLength: z.enum(['very_short', 'short', 'medium', 'long']),
  shouldAskQuestion: z.boolean(),
  shouldGiveAdvice: z.boolean(),
  shouldUsePetName: z.boolean(),
  shouldMirrorEmotion: z.boolean(),
  routeGuidance: z.string().trim().max(600),
})

export const fallbackEmotionRoute = {
  route: 'gentle_clarification' as const,
  responseLength: 'short' as const,
  shouldAskQuestion: true,
  shouldGiveAdvice: false,
  shouldUsePetName: false,
  shouldMirrorEmotion: false,
  routeGuidance: '先温和承接，再用一个轻问题确认用户想继续聊什么。',
}

// ============================================================================
// Step 6: Policy Schema (from inbox.route.ts L247-307)
// ============================================================================
export const replyPolicySchema = z.object({
  policy: z.enum([
    'quiet_presence',
    'warm_companion',
    'deep_empathy',
    'playful_flirt',
    'calm_boundary',
    'relationship_repair',
    'gentle_clarify',
    'practical_support',
    'roleplay_flow',
    'memory_ack',
  ]),
  sentenceBudget: z.object({
    min: z.number().int().min(1).max(8),
    max: z.number().int().min(1).max(8),
  }),
  rhythm: z.enum(['still', 'soft', 'natural', 'lively', 'focused']),
  openingMove: z.enum([
    'acknowledge',
    'comfort',
    'mirror',
    'apologize',
    'play',
    'answer',
    'clarify',
    'set_boundary',
  ]),
  allowedMoves: z
    .array(
      z.enum([
        'validate_feeling',
        'mirror_emotion',
        'offer_presence',
        'ask_one_question',
        'give_one_suggestion',
        'give_two_suggestions',
        'light_tease',
        'use_pet_name',
        'repair_misunderstanding',
        'continue_roleplay',
        'acknowledge_memory',
        'set_soft_boundary',
      ]),
    )
    .max(6),
  forbiddenMoves: z
    .array(
      z.enum([
        'lecture',
        'over_explain',
        'multiple_questions',
        'premature_advice',
        'intense_flirt',
        'diagnose_user',
        'take_sides_aggressively',
        'pressure_to_disclose',
        'promise_real_world_action',
        'expose_internal_labels',
      ]),
    )
    .max(8),
  questionLimit: z.number().int().min(0).max(2),
  adviceLimit: z.number().int().min(0).max(3),
  intimacyLevel: z.enum(['low', 'medium', 'high']),
  styleGuidance: z.string().trim().max(700),
})

export const fallbackReplyPolicy = {
  policy: 'gentle_clarify' as const,
  sentenceBudget: {
    min: 1,
    max: 3,
  },
  rhythm: 'soft' as const,
  openingMove: 'acknowledge' as const,
  allowedMoves: ['validate_feeling' as const, 'ask_one_question' as const],
  forbiddenMoves: [
    'lecture' as const,
    'over_explain' as const,
    'multiple_questions' as const,
    'premature_advice' as const,
    'diagnose_user' as const,
    'expose_internal_labels' as const,
  ],
  questionLimit: 1,
  adviceLimit: 0,
  intimacyLevel: 'medium' as const,
  styleGuidance: '先轻轻接住用户，再只问一个低压力问题；不要讲大道理，不要连续追问。',
}

// ============================================================================
// Step 8: Quality Guard Schema (from inbox.route.ts L309-336)
// ============================================================================
export const replyQualityGuardSchema = z.object({
  status: z.enum(['pass', 'warn', 'fail']),
  score: z.number().min(0).max(1),
  sentenceCount: z.number().int().min(0),
  questionCount: z.number().int().min(0),
  adviceCount: z.number().int().min(0),
  violations: z
    .array(
      z.object({
        code: z.enum([
          'too_many_sentences',
          'too_many_questions',
          'too_many_suggestions',
          'internal_label_leak',
          'breaks_immersion',
          'forbidden_lecture',
          'forbidden_over_explain',
          'forbidden_premature_advice',
          'forbidden_intense_flirt',
          'forbidden_diagnosis',
          'forbidden_aggressive_siding',
          'forbidden_pressure',
          'forbidden_real_world_promise',
        ]),
        severity: z.enum(['low', 'medium', 'high']),
        evidence: z.string().trim().max(160),
      }),
    )
    .max(12),
})

export const fallbackReplyQualityGuard = {
  status: 'warn' as const,
  score: 0.7,
  sentenceCount: 0,
  questionCount: 0,
  adviceCount: 0,
  violations: [
    {
      code: 'internal_label_leak' as const,
      severity: 'low' as const,
      evidence: '回复质量检测未获得可分析文本，采用保守记录。',
    },
  ],
}

// ============================================================================
// Step 9a: Memory Candidate Schema (from inbox.route.ts L447-470)
// ============================================================================
export const agentMemoryCandidateSchema = z.object({
  shouldExtract: z.boolean(),
  confidence: z.number().min(0).max(1),
  category: z.enum([
    'preference',
    'boundary',
    'relationship_goal',
    'conversation_style',
    'important_fact',
    'identity_profile',
    'temporary_emotion',
    'small_talk',
    'assistant_generated',
    'duplicate',
    'unsafe',
    'unclear',
  ]),
  stability: z.enum(['stable', 'likely_stable', 'temporary', 'unclear']),
  importance: z.number().int().min(0).max(5),
  reason: z.string().trim().max(300),
  candidateFacts: z.array(z.string().trim().min(1).max(120)).max(3),
})

// ============================================================================
// Step 9b: Memory Extraction Schema (from inbox.route.ts L437-445)
// ============================================================================
export const agentMemoryExtractionSchema = z.object({
  memories: z
    .array(
      z.object({
        type: z.enum([
          'preference',
          'boundary',
          'relationship_goal',
          'conversation_style',
          'important_fact',
        ]),
        content: z.string().trim().min(1).max(500),
        importance: z.number().int().min(1).max(5),
      }),
    )
    .max(2),
})

// ============================================================================
// Conversation Summary Schema
// ============================================================================
export const conversationSummarySchema = z.object({
  text: z.string().max(1600),
  updatedAt: z.date(),
})

// ============================================================================
// Memory Injection Limit Constants (from inbox.route.ts L57-61)
// ============================================================================
export const MEMORY_INJECTION_LIMIT = 12
export const MEMORY_EXTRACTION_LIMIT = 2
export const MESSAGE_FEEDBACK_INJECTION_LIMIT = 8
export const RECENT_MESSAGE_LIMIT = 18
export const INITIAL_HISTORY_LIMIT = 40

// ============================================================================
// Keyword Fallback for Memory (TR-6.3)
// ============================================================================
export const MEMORY_KEYWORD_REGEX =
  /记住|请记住|希望你记住|以后|下次|下一次|别再|不要再|我喜欢|我不喜欢|我的习惯|我的边界|我希望你/i
