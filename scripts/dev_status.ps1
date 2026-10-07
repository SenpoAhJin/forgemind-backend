# dev_status.ps1 - read-only backend reachability report (one line per item).
# Every line starts with OK or PROBLEM: plus a short reason.
# Nothing here changes the system: no firewall modifications, no listeners, no restarts.

$ErrorActionPreference = 'Continue'

function Probe($hostname, $port) {
  # Returns 'connected', 'refused' or 'timed out'. A closed port answers RST
  # (fast, refused); a dropped packet retries until the timeout expires.
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $result = $client.BeginConnect($hostname, $port, $null, $null)
    $ok = $result.AsyncWaitHandle.WaitOne(3000, $false)
    if ($ok -and $client.Connected) { 'connected' }
    elseif ($ok) { 'refused' }
    else { 'timed out' }
  } finally {
    $client.Close()
  }
}

# --- PC IPv4 addresses -----------------------------------------------------
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' -and $_.InterfaceAlias -notlike '*Loopback*' } |
  Select-Object -ExpandProperty IPAddress)
if ($lanIps.Count -eq 0) { 'PROBLEM: no LAN IPv4 address found (is the network adapter up?)' }
else { "OK: PC IPv4 addresses = $($lanIps -join ', ')" }

# --- port 3000 listener -----------------------------------------------------
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) { 'PROBLEM: port 3000 not listening (backend not running)' }
else {
  $addrs = @($listeners | Select-Object -ExpandProperty LocalAddress -Unique)
  if ($addrs -contains '0.0.0.0' -or $addrs -contains '::') { "OK: port 3000 listening on $($addrs -join ', ') (reachable from LAN)" }
  elseif ($addrs -contains '127.0.0.1' -or $addrs -contains '::1') { "PROBLEM: port 3000 listening on $($addrs -join ', ') only (localhost only, phones cannot reach it)" }
  else { "OK: port 3000 listening on $($addrs -join ', ')" }
}

# --- /health via localhost and via each LAN IP -----------------------------
function HealthLine($hostname, $label) {
  try {
    $r = Invoke-WebRequest -Uri "http://$hostname`:3000/health" -TimeoutSec 3 -UseBasicParsing
    "OK: /health via $label -> HTTP $($r.StatusCode)"
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { "OK: /health via $label -> HTTP $([int]$resp.StatusCode) (server reachable)" }
    else {
      $classification = Probe $hostname 3000
      if ($classification -eq 'refused') { "PROBLEM: /health via $label -> connection refused (nothing listening on 3000)" }
      elseif ($classification -eq 'timed out') { "PROBLEM: /health via $label -> timed out (packets dropped: likely firewall or wrong IP)" }
      else { "PROBLEM: /health via $label -> unreachable" }
    }
  }
}
HealthLine '127.0.0.1' 'localhost'
foreach ($ip in $lanIps) { HealthLine $ip "LAN $ip" }

# --- Windows Firewall inbound allow rule for TCP 3000 or node.exe (Private) --
$fwRule = 'unknown'
try {
  $rule = @()
  foreach ($pf in @(Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)) {
    if ($pf.LocalPort -eq 3000) {
      $rule += @(Get-NetFirewallRule -AssociatedNetFirewallPortFilter $pf -ErrorAction SilentlyContinue)
    }
  }
  $nodeRule = @()
  foreach ($af in @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue)) {
    if ($af.Program -and $af.Program -match 'node\.exe') {
      $nodeRule += @(Get-NetFirewallRule -AssociatedNetFirewallApplicationFilter $af -ErrorAction SilentlyContinue)
    }
  }
  $match = @($rule + $nodeRule | Where-Object {
    $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq $true -and $_.Profile -match 'Private|Any'
  })
  if ($match.Count -gt 0) { $fwRule = "yes (rules: port3000=$($rule.Count) node=$($nodeRule.Count), matching=$($match.Count))" }
  else { $fwRule = 'no' }
} catch { $fwRule = 'unknown (cannot read firewall rules)' }
if ($fwRule -eq 'no') { 'PROBLEM: no inbound allow rule found for TCP 3000 or node.exe on Private profile' }
else { "OK: firewall inbound allow rule for 3000/node = $fwRule" }

# --- port 8081 (Metro) ------------------------------------------------------
$metro = @(Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue)
if ($metro.Count -eq 0) { 'PROBLEM: port 8081 not listening (Metro is not running)' }
else { "OK: port 8081 listening on $(@($metro | Select-Object -ExpandProperty LocalAddress -Unique) -join ', ') (Metro up)" }