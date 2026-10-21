# Port 3000 Troubleshooting Guide

## Error: EADDRINUSE (Address Already in Use)

**Full Error:**
```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
```

This means another process is already using port 3000, preventing the backend server from starting.

---

## Root Cause

A previous `npm run dev` command didn't shut down cleanly:
- Ctrl+C didn't work properly
- Terminal was closed while server was running
- System crashed or restarted abruptly
- Multiple instances were started accidentally

The Node.js process remains running in the background and keeps port 3000 occupied.

---

## Quick Fix (PowerShell on Windows)

### Step 1: Find what's using port 3000
```powershell
netstat -ano | Select-String ":3000"
```

**Output example:**
```
TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    18900
```

The last number (18900) is the Process ID (PID).

### Step 2: Identify the process
```powershell
Get-Process -Id 18900 | Select-Object Id, ProcessName, Path
```

### Step 3: Kill the process
```powershell
Stop-Process -Id 18900 -Force
```

### Step 4: Verify port is free
```powershell
netstat -ano | Select-String ":3000"
```

Should return nothing if port is free.

### Step 5: Start the server
```powershell
npm run dev
```

---

## One-Line Quick Fix

**Kill all node processes on port 3000:**
```powershell
$pid = (netstat -ano | Select-String ":3000" | Select-String "LISTENING")[0].ToString().Split()[-1]
if ($pid) { Stop-Process -Id $pid -Force }
```

---

## Prevention Tips

1. **Always use Ctrl+C to stop the server**
   - Press Ctrl+C in the terminal running `npm run dev`
   - Wait for "Gracefully shutting down..." message
   - Don't close the terminal window directly

2. **Check if server is already running before starting**
   ```powershell
   netstat -ano | Select-String ":3000"
   ```

3. **Use a different port if needed**
   - Create `.env` file in `forgemind-backend/`
   - Add: `PORT=3001` (or any free port)
   - Server will use this port instead

4. **Set up a cleanup script** (optional)
   - Create `scripts/kill-backend.ps1`:
     ```powershell
     $pid = (netstat -ano | Select-String ":3000" | Select-String "LISTENING")[0].ToString().Split()[-1]
     if ($pid) {
         Write-Host "Killing process $pid on port 3000..."
         Stop-Process -Id $pid -Force
         Write-Host "Port 3000 is now free"
     } else {
         Write-Host "No process found on port 3000"
     }
     ```
   - Run before starting: `.\scripts\kill-backend.ps1`

---

## Port Configuration

The backend reads port from environment variable:

**File:** `src/config.ts` (line 60)
```typescript
port: Number(process.env.PORT ?? 3000),
```

**Default:** 3000 (if PORT not set in .env)

**To change:**
1. Copy `.env.example` to `.env` (if not exists)
2. Add or update: `PORT=3001`
3. Restart server: `npm run dev`

Server will now listen on the new port.

---

## Related Ports

- **Port 3000:** Backend API (this server)
- **Port 5000:** Flask AI service (for matcher, if running)
- **Port 8081:** Expo Metro bundler (mobile app)
- **Port 8082:** Expo web dev server (alternative)
- **Port 19006:** Expo web dev server (default)

Make sure these don't conflict with other services.

---

## macOS / Linux Quick Fix

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process (replace PID with actual process ID)
kill -9 <PID>

# Or one-liner
kill -9 $(lsof -t -i :3000)
```

---

## When Port 3000 is Not the Problem

If you get EADDRINUSE but port 3000 appears free:

1. **Check if backend is binding to wrong interface**
   - Backend binds to `0.0.0.0` (all interfaces) by default
   - Another service might be on `127.0.0.1:3000` or `localhost:3000`

2. **Check other Node processes**
   ```powershell
   Get-Process node
   ```
   Kill suspicious processes.

3. **Restart your machine** (last resort)
   - Sometimes network stack needs reset
   - Clears all stale connections

---

## Verification After Fix

Backend should show:
```
forgemind-backend listening on 0.0.0.0:3000 (development)
CORS origins: http://localhost:8081, http://localhost:19006, http://localhost:8082
  phone / LAN:  http://192.168.x.x:3000
  this PC:      http://localhost:3000
  android emu:  http://10.0.2.2:3000
  health:       GET /health
database: OK
```

Test health endpoint:
```powershell
curl http://localhost:3000/health
```

Should return: `{"status":"ok","timestamp":"..."}`

---

**Last Updated:** October 15, 2026
**Issue Fixed:** Process 18900 was occupying port 3000, killed with `Stop-Process`
