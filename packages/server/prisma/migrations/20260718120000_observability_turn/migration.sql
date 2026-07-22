-- ObservabilityTurn (W2) — per-turn summary for Admin metrics
CREATE TABLE "observability_turns" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "post_process_ms" INTEGER,
    "flags" JSONB,
    "span_ms" JSONB,
    "span_attrs" JSONB,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observability_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "observability_turns_trace_id_key" ON "observability_turns"("trace_id");
CREATE INDEX "observability_turns_route_created_at_idx" ON "observability_turns"("route", "created_at");
CREATE INDEX "observability_turns_created_at_idx" ON "observability_turns"("created_at");
