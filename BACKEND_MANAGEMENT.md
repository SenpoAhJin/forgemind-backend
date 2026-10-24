# Backend Management Guide

## 🚀 Quick Commands

### Starting the Backend

```powershell
# Option 1: Start normally (fails if port 3000 is in use)
npm run dev

# Option 2: Safe start (auto-stops old process + runs migrations)
npm run start:safe

# Option 3: Restart (stops old, runs migrations, starts new)
npm run restart
```

### Stopping the Backend

```powershell
# Stop the backend gracefully
npm run stop
```

### Manual Scripts

```powershell
# Stop backend manually
.\scripts\stop-backend.ps1

# Start with migrations
.\scripts\start-backend.ps1

# Start without migrations
.\scripts\start-backend.ps1 -SkipMigration

# Force start (stops old process first)
.\scripts\start-backend.ps1 -Force

# Restart
.\scripts\restart-backend.ps1
```

---

## ❌ Common Errors & Solutions

### Error: `EADDRINUSE: address already in use 0.0.0.0:3000`

**Problem**: Another backend process is already running on port 3000

**Solutions**:

**Option 1: Use safe start**
```powershell
npm run start:safe
```

**Option 2: Stop then start**
```powershell
npm run stop
npm run dev
```

**Option 3: Use restart**
```powershell
npm run restart
```

**Option 4: Manual (if scripts fail)**
```powershell
# Find process
Get-NetTCPConnection -LocalPort 3000 -State Listen

# Stop it (use PID from above)
Stop-Process -Id <PID> -Force

# Then start
npm run dev
```

---

## 🔄 Workflow After Code Changes

### When you modify backend code:

```powershell
# Quick way:
npm run restart

# Or step by step:
npm run stop
npm run dev
```

### When you add a new migration:

```powershell
# Restart runs migrations automatically
npm run restart

# Or manually:
npm run migrate
npm run dev
```

---

## 🗄️ Database Migrations

```powershell
# Run all pending migrations
npm run migrate

# Run migrations (alias)
npm run migrate:up

# Rollback last migration
npm run migrate:down

# Check migration status (dry run)
npm run migrate:status
```

---

## 📊 Check Backend Status

```powershell
# Check if backend is running
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue

# If output shows a connection, backend is running
# If no output, backend is stopped
```

---

## 🛠️ Troubleshooting

### Backend won't stop

```powershell
# Method 1: Task Manager
# 1. Press Ctrl+Shift+Esc
# 2. Find "Node.js"
# 3. End Task

# Method 2: Force kill all Node processes (NUCLEAR OPTION)
Get-Process node | Stop-Process -Force
```

### Port still in use after stopping

```powershell
# Wait a few seconds and try again
Start-Sleep -Seconds 5
npm run dev

# Or use force start
npm run start:safe
```

### Scripts don't have permission

```powershell
# Run PowerShell as Administrator, then:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Backend starts but new code isn't loading

```powershell
# Full restart
npm run restart

# Or manually:
npm run stop
Start-Sleep -Seconds 2
npm run dev
```

---

## 📝 Best Practices

1. **Always use `npm run restart`** after modifying backend code
2. **Use `npm run start:safe`** if you're not sure if backend is running
3. **Check migration status** before deploying: `npm run migrate:status`
4. **Stop backend** before switching branches: `npm run stop`

---

## 🔍 Useful Commands

```powershell
# Check backend version
npm run typecheck

# Test if backend is responding
curl http://localhost:3000/health

# View backend logs (if running in background)
# (Not applicable for npm run dev - logs show in terminal)

# List all migrations run
# (Requires database access - see scripts/check_migrations.mjs)
```

---

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| Start | `npm run dev` |
| Safe start | `npm run start:safe` |
| Stop | `npm run stop` |
| Restart | `npm run restart` |
| Migrations | `npm run migrate` |
| Check port | `Get-NetTCPConnection -LocalPort 3000` |

---

## ✅ Post-Setup Checklist

After implementing M2 confirmation feature:

- [ ] Stop old backend: `npm run stop`
- [ ] Run migrations: `npm run migrate`
- [ ] Start backend: `npm run dev`
- [ ] Verify new endpoint exists: `curl http://localhost:3000/marketplace/offers/test/confirm -Method POST`
  - Should return 401 (not 404)
- [ ] Test full flow (see TEST_CONFIRMATION_FEATURE.md)

---

## 💡 Tips

- **Keep only ONE terminal** running `npm run dev` at a time
- **Always stop before closing terminal** to avoid orphan processes
- **Use `npm run restart`** as your default after code changes
- **Check TypeScript errors** with `npm run typecheck` before starting
