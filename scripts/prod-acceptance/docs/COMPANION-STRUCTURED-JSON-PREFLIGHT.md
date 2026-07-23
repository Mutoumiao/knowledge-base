# Companion Structured JSON 预发抽查（D12）

完整清单（含 grep / 样本表 / 结论栏）见：

- 工作区报告：`docs/report/companion-structured-json-output-preflight-2026-07-23.md`

## 一句话

DeepSeek-like 下：无 FC/jsonSchema 400 风暴；safety 有 `stage=success`；每轮 `stage=repair`≤1；危机仍 soft_boundary + 热线。

## 最快命令

```bash
# 替换为实际日志路径
LOG=./logs/server.log
grep -E 'method=(functionCalling|jsonSchema)' "$LOG" | tail -20   # 期望空
grep -E '\[safetyNode\] stage=' "$LOG" | tail -40
grep -E 'stage=repair' "$LOG" | tail -20
```

## 通过后

Archive OpenSpec change：`companion-structured-json-output`。

关联 commit：`7b271bfa`（feat companion json_object path）。
