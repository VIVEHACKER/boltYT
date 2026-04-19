# bolt

## Commands

```
```

## Harness

This project uses GAN Harness for automated verification.

```
gan-harness verify        # L1 static checks
gan-harness verify --tier 2  # Full pipeline (L1→L2→L3)
gan-harness record list   # View eval history
```

## Rules

- Test before commit. 80%+ coverage target.
- No hardcoded secrets. Use environment variables.
- Structured error handling (no swallowed errors).
- Commit format: `<type>: <description>` (feat/fix/refactor/docs/test/chore)
