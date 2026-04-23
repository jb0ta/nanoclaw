---
name: compact
description: Manual context compaction command /compact. Summarizes the conversation so far into a compact context block, clearing token pressure while preserving working state.
---

# /compact — Manual Context Compaction

Triggered when the user sends `/compact`.

## What to do

Produce a single compact context block that captures all working state needed to continue the session without loss. Then stop — do not continue with any pending task until the user confirms they want to proceed.

## Output format

Write a markdown block with this structure:

```
## Session Snapshot — [short description of what's been happening]

### Goal
[What the user is trying to accomplish — 1–3 sentences]

### Current state
[Where things stand right now: what's done, what's in progress, what's broken]

### Decisions made
[Key decisions, rejected approaches, and why — bullet list]

### Open questions
[Unresolved ambiguities or blockers — bullet list, or "none"]

### Next step
[Exactly what should happen next]

### Environment facts
[Relevant paths, ports, service names, branch, credentials state — only what's actually needed to continue]
```

## Rules

- Be precise, not comprehensive. Include only what is needed to continue. Leave out tangents, already-resolved issues, and background context that's in the codebase.
- Use exact values: file paths, error messages, command names — not "the config file" or "the error we saw"
- If there is no meaningful state to preserve (session just started), say so in one line and stop
- Do not summarize this skill's own instructions — those are always available

## After output

Say: `Context compacted. Ready to continue.`

Wait for the user's next message.
