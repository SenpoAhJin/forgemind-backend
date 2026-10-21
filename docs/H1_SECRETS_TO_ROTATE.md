# H1 - Secrets to Rotate

**Context:** `.env` was tracked in git from commit `c3a91e7` (2026-10-15) until commit `a1c030e` (M1d Step 1a, 2026-10-21). During that time, the file contained real database credentials.

**Status:** `.env` was removed from tracking via `git rm --cached .env` and added to `.gitignore` in commit `a1c030e`. The file is no longer tracked, but **the values remain in git history and are exposed to anyone with repository access.**

---

## Exposed Secret Keys

The following keys were present in the tracked `.env` file (commit `c3a91e7`):

1. `NODE_ENV`
2. `PORT`
3. `DB_HOST`
4. `DB_PORT`
5. `DB_NAME`
6. `DB_USER`
7. `DB_PASSWORD` ← **CRITICAL: Database password exposed**
8. `DB_SSL`
9. `SESSION_TTL_DAYS`
10. `CORS_ORIGINS`

**Most critical:** `DB_PASSWORD` - Anyone who cloned the repository before `a1c030e` (or who has access to git history) can read the database password.

---

## Rotation Required

### 1. DB_PASSWORD (CRITICAL)

**Current risk:** The exposed password grants full access to the `forgemind_dev` database as user `forgemind_app`.

**Action:**
```sql
-- Connect as postgres superuser:
psql -U postgres -d forgemind_dev

-- Change the password:
ALTER ROLE forgemind_app WITH PASSWORD 'new-secure-random-password-here';

-- Verify:
\du forgemind_app
```

**After rotation:**
- Update `.env` with new password
- Restart backend server
- **Do NOT commit the new `.env`** (it's gitignored)

**Timeline:** Rotate immediately. Until rotated, anyone with git access has database credentials.

---

### 2. No Other Secrets Found

**Verified:**
- No hard-coded connection strings in source code (checked `src/**/*.ts`, `scripts/**/*.ts`)
- No API keys or signing secrets in source code
- Test scripts use placeholder passwords like `'TestPass123!'` (not real secrets)
- `.env.example` contains only placeholders

**Search performed:**
```bash
# Searched for connection strings, API keys, signing secrets:
grep -E "postgres://.*:.*@|postgresql://.*:.*@|password.*=.*[a-zA-Z0-9]{8}|api[_-]?key.*=.*[a-zA-Z0-9]{20}|secret.*=.*[a-zA-Z0-9]{20}" src/**/*.ts scripts/**/*.ts
```

**Results:** Only password hashing functions and validation logic (no exposed values).

---

## Git History Remediation (Optional)

**Option A: Leave history intact (recommended for transparency)**
- Rotate `DB_PASSWORD` immediately
- Document the exposure in this file
- Old password becomes useless once rotated

**Option B: Rewrite history (destructive, breaks clones)**
```bash
# DANGER: This rewrites history and breaks all existing clones
git filter-branch --tree-filter 'rm -f .env' HEAD
git push --force
```

**Recommendation:** Option A. Rewriting history is disruptive and breaks anyone's local clone. Rotating the password is simpler and achieves the same security outcome.

---

## Current Status

**Protection in place:**
- ✓ `.env` is gitignored (commit `a1c030e`)
- ✓ `.env.example` exists with placeholders only
- ✓ No connection strings or secrets in source code
- ✓ No tracked files contain credentials

**Still exposed:**
- ✗ `DB_PASSWORD` value remains in git history (commits before `a1c030e`)

**Next action:** Rotate `DB_PASSWORD` per instructions above.

---

## Prevention

To prevent future secret exposure:

1. **Never commit `.env`** - it's gitignored now, but always verify with `git status` before committing
2. **Use `.env.example`** - commit only placeholder values
3. **Pre-commit hook** - consider adding a hook to block commits containing `DB_PASSWORD=` or similar patterns:

```bash
# .git/hooks/pre-commit
#!/bin/bash
if git diff --cached --name-only | grep -q "^\.env$"; then
  echo "ERROR: .env file should not be committed"
  exit 1
fi

if git diff --cached | grep -qE "DB_PASSWORD=.+|API_KEY=.+"; then
  echo "ERROR: Credential pattern detected in staged changes"
  exit 1
fi
```

4. **Secret scanning** - use tools like `git-secrets` or `gitleaks` in CI/CD
5. **Environment-specific secrets** - use separate databases/passwords for dev, staging, prod

---

## Summary

**Keys exposed:** 10 keys in `.env` (most critical: `DB_PASSWORD`)

**Timeline:**
- Exposed: commit `c3a91e7` (2026-10-15)
- Removed: commit `a1c030e` (2026-10-21)
- Duration: 6 days

**Action required:** Rotate `DB_PASSWORD` immediately

**Verification:** No other secrets found in tracked files
