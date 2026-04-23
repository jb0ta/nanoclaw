---
name: varlock
description: When handling secrets, tokens, API keys, or credentials: never expose raw values, always redact with ***, check .gitignore before git operations, never pass secrets via -e flags or inline env vars.
---

# Varlock — Secret Handling Protocol

Any time you work with secrets, tokens, API keys, credentials, or environment variables that may contain sensitive values, apply these rules without exception.

## Never expose raw values

- Never `cat`, `echo`, `print`, or display the contents of `.env`, `.env.*`, credential files, or any file that may contain secrets
- Never log, paste, or quote raw secret values in responses, tool outputs, or reasoning
- If you need to show that a variable exists or has a value, redact it: `ANTHROPIC_API_KEY=sk-ant-***`
- If a tool result contains what appears to be a raw secret, redact it before including it in your response

## Redaction format

Always use `***` for the redacted portion. Examples:

```
ANTHROPIC_API_KEY=sk-ant-***
CLAUDE_CODE_OAUTH_TOKEN=***
DATABASE_URL=postgres://user:***@host/db
```

## Never pass secrets as inline flags

- Never construct commands with `-e KEY=VALUE`, `--env KEY=VALUE`, or `export KEY=value` where VALUE is a literal secret
- Use env files (`--env-file .env`) or secret management tooling instead
- If you must reference a variable inline, use the variable name: `$ANTHROPIC_API_KEY`, not the value

## Before any git operation

Check that secret-bearing files are gitignored before staging, committing, or pushing:

```bash
# Verify .env is ignored before git add
git check-ignore -v .env

# Check what would be staged
git status --short
```

If a secret-bearing file is not in `.gitignore`, stop and add it before proceeding. Never stage or commit `.env`, `.env.local`, `.env.*`, credential JSON files, or private key files.

## Scanning for accidental exposure

Before committing, if you've made changes near credential handling:

```bash
# Check staged diff for anything that looks like a secret
git diff --cached | grep -iE '(api_key|token|secret|password|credential)\s*=\s*["\x27]?[A-Za-z0-9+/]{16,}'
```

If a hit appears, stop. Do not commit. Redact or remove the value, then re-verify.

## Summary rules

1. Never display raw secret values — always redact with `***`
2. Never pass secrets as inline `-e KEY=VALUE` flags
3. Always check `.gitignore` before git ops on files that may contain secrets
4. Stop and flag if a tool output contains what appears to be an unexpectedly exposed secret
