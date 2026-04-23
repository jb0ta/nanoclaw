---
name: systematic-debugging
description: When debugging any bug or crash, follow a disciplined evidence-first process. Characterize the failure, collect evidence, form ranked hypotheses, and fix one thing at a time. Never guess.
---

# Systematic Debugging

When you encounter a bug, crash, or unexpected behavior, follow this process every time — no shortcuts.

## Step 1 — Characterize the failure

Before touching any code:

- State exactly what is failing: error message, stack trace, wrong output, wrong behavior
- State what was expected vs. what actually happened
- Identify the smallest reproducible case if one exists
- Note when it started (last working commit, recent change, always broken)

Do not proceed until you can clearly articulate the failure in one or two sentences.

## Step 2 — Collect evidence

Read before you reason. Gather:

- Relevant logs, stack traces, error codes — full text, not truncated
- The actual code path that runs (read the files; do not rely on memory)
- Environment facts: versions, env vars, file state, network state — whatever is relevant to this failure
- Any recent changes that could have introduced the bug (git log, git diff)

Do not form hypotheses yet. Collect first.

## Step 3 — Form ranked hypotheses

Write out at least two candidate causes, ordered by probability. For each:

- What evidence supports it
- What evidence would rule it out
- How to test it cheaply (log, assert, read a file — not a full fix)

Pick the most probable hypothesis first.

## Step 4 — Test one hypothesis at a time

- Add a targeted diagnostic (log, assertion, minimal reproduction) to confirm or rule out the top hypothesis
- If confirmed → proceed to fix
- If ruled out → move to the next hypothesis and repeat
- Never combine diagnostics for multiple hypotheses in the same change

## Step 5 — Fix

Once the root cause is confirmed:

- Make the minimal change that addresses the root cause
- Do not refactor surrounding code or fix unrelated issues in the same change
- Verify the fix against the original failure and any related cases
- Remove diagnostic instrumentation before committing

## Rules

- **Never guess.** "This might be X" is not a hypothesis. A hypothesis has evidence and a falsification path.
- **Never fix without confirming the cause.** A fix that works for unknown reasons is a future bug.
- **One fix at a time.** Multiple simultaneous changes make it impossible to know which one worked.
- **Reproduce before fixing.** If you can't reproduce the failure, you can't verify the fix.
- **Read the actual error.** Do not paraphrase stack traces or error messages — use the exact text when forming hypotheses.
