# Shared-backend verification: the web build and the phone build must both
# reach the SAME backend and see the SAME listings.
#
# What this proves (and only proves):
#   1. the backend is up and /health answers,
#   2. Expo web origins (localhost AND 127.0.0.1) pass CORS while a non-Expo
#      origin is refused,
#   3. a listing created through the web-visible URL also appears through the
#      phone-visible URL (Metro host) with the identical id set, and
#   4. the shared demo seed listings are hidden from the browse feed.
#
# Prints counts, statuses and ids only. Never prints listing text, passwords
# or stored tokens. psql is only called at the top level (see
# verify_marketplace.ps1 for why).
$ErrorActionPreference = 'Continue'
$webBase = 'http://localhost:3000'
$lanBase = 'http://192.168.254.168:3000'
$envFile = 'C:\Users\Alord\OneDrive\Documents\School\MOR\Concept\ACCEPTED COSPLAY CONTENTS\CosForge_System - Copy\forgemind-backend\.env'
$env:PGPASSWORD = ((Get-Content -LiteralPath $envFile) | Where-Object { $_ -match '^\s*DB_PASSWORD=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })

$ITEM_CATEGORY = 'Wigs'
$script:pass = 0
$script:fail = 0
$script:fails = @()
function Check($name, $condition) {
  if ($condition) { $script:pass++; "PASS  $name" }
  else { $script:fail++; $script:fails += $name; "FAIL  $name" }
}
function Api($method, $base, $path, $session, $body) {
  $headers = @{}
  if ($session) { $headers['Authorization'] = "Bearer $session" }
  $params = @{ Method = $method; Uri = "$base$path"; Headers = $headers; TimeoutSec = 20 }
  if ($null -ne $body) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = ($body | ConvertTo-Json -Depth 6 -Compress)
  }
  try {
    $r = Invoke-WebRequest @params -UseBasicParsing
    $json = $null
    try { $json = $r.Content | ConvertFrom-Json } catch {}
    return @{ status = [int]$r.StatusCode; json = $json }
  } catch {
    $code = 0
    $json = $null
    $text = ''
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $text = $_.ErrorDetails.Message }
    elseif ($_.Exception.Response) {
      try {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $text = $sr.ReadToEnd()
      } catch {}
    }
    if ($text) { try { $json = $text | ConvertFrom-Json } catch {} }
    return @{ status = $code; json = $json }
  }
}

$listening = Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue
Check 'backend port 3000 is listening' ($listening)
if (-not $listening) { "summary pass=$script:pass fail=$script:fail"; exit 1 }

# --- 1. /health on both reachable bases --------------------------------
$lm = 0; try { $lm = (Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue) } catch {}
# Instead of double-TCP, simply hit /health through each base.
$hWeb = Api 'GET' $webBase '/health' $null $null
$hLan = Api 'GET' $lanBase '/health' $null $null
Check '/health answers on the web base' ($hWeb.status -eq 200)
Check '/health answers on the phone base (LAN)' ($hLan.status -eq 200)

# --- 2. CORS for Expo web origins ---------------------------------------
function PreflightAllow($origin) {
  try {
    $r = Invoke-WebRequest -Method Options -Uri "$webBase/health" -Headers @{
      Origin = $origin; 'Access-Control-Request-Method' = 'GET'
    } -UseBasicParsing
    $acao = $r.Headers['Access-Control-Allow-Origin']
    if ($acao -is [Array]) { $acao = $acao[0] }
    return $acao -eq $origin
  } catch { return $false }
}
Check 'CORS allows http://localhost:8081' (PreflightAllow 'http://localhost:8081')
Check 'CORS allows http://127.0.0.1:8081' (PreflightAllow 'http://127.0.0.1:8081')

function PreflightDenied($origin) {
  try {
    $r = Invoke-WebRequest -Method Options -Uri "$webBase/health" -Headers @{
      Origin = $origin; 'Access-Control-Request-Method' = 'GET'
    } -UseBasicParsing
    return -not $r.Headers.ContainsKey('Access-Control-Allow-Origin')
  } catch { return $true }
}
Check 'CORS refuses a non-Expo origin' (PreflightDenied 'http://evil.example:8081')

# --- 3. one backend, one feed, on both bases ----------------------------
# A throwaway buyer that can browse is enough; creating a listing is not
# required for the shared-feed proof, but it makes "the SAME data" concrete.
try {
$stamp = (Get-Date -Format 'MMddHHmmss') + '-' + ((New-Guid).ToString('N').Substring(0,6))
$sellerEmail = "shared-seller-$stamp@forge.test"
$secret = 'Verify-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
function Register($email, $displayName) {
  $r = Api 'POST' $webBase '/auth/register' $null @{
    email = $email; password = $secret; display_name = $displayName
    base_body_selection = 'female'; is_cosplayer = $true; data_consent_given = $true
  }
  if ($r.status -eq 201 -or $r.status -eq 200) {
    $l = Api 'POST' $webBase '/auth/login' $null @{ email = $email; password = $secret }
    if ($l.status -eq 200) { return $l.json.session_token }
  }
  return $null
}
function SubmitRegistration($session, $role) {
  return Api 'POST' $webBase '/marketplace/registration' $session @{
    marketplace_role = $role; seller_display_name = 'Shared Verify Shop'
    marketplace_contact_email = 'shared@forge.test'
    marketplace_contact_phone = '09171234561'
    payout_method_label = 'Test payout'; payout_method_number = '12345678'
    agreed_to_marketplace_terms = $true
  }
}
$sellerSession = Register $sellerEmail 'Shared Verify Seller'
Check 'seller account registered and holds a session' ($null -ne $sellerSession)
if (-not $sellerSession) { "summary pass=$script:pass fail=$script:fail"; exit 1 }
$r = SubmitRegistration $sellerSession 'seller'
Check 'seller registration submitted' ($r.status -eq 200)
if ($r.status -ne 200) { "REG_DETAIL err=$($r.json.error) msg=$($r.json.message) status=$($r.status) tok=$([bool]$sellerSession)" }
$verified = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE users SET verification_status = 'verified' WHERE email = '$sellerEmail'" 2>&1) -join ' '
$recount = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM users WHERE email = '$sellerEmail' AND verification_status = 'verified'" 2>&1) -join ' '
Check 'seller is a verified marketplace user' ($recount.Trim() -eq '1')

$created = Api 'POST' $webBase '/marketplace/listings' $sellerSession @{
  post_type = 'sell'; title = 'Heat resistant white wig base'
  description = 'Cosplay wig cap, unused, heat styling friendly.'
  price = 350; category = $ITEM_CATEGORY; condition = 'like_new'
}
Check 'create returns 201' ($created.status -eq 201)
if ($created.status -eq 201) {
  $newId = $created.json.listing.id

  $feedWeb = Api 'GET' $webBase '/marketplace/listings?limit=50' $sellerSession
  $feedLan = Api 'GET' $lanBase '/marketplace/listings?limit=50' $sellerSession
  Check 'web-visible feed returns 200' ($feedWeb.status -eq 200)
  Check 'phone-visible feed (LAN) returns 200' ($feedLan.status -eq 200)

  $idsWeb = @($feedWeb.json.listings | ForEach-Object { $_.id }) | Sort-Object
  $idsLan = @($feedLan.json.listings | ForEach-Object { $_.id }) | Sort-Object
  Check 'web and phone see the identical listing set' (@(Compare-Object $idsWeb $idsLan).Count -eq 0)
  Check 'the listing created via the web URL is on the phone feed too' (@($idsLan | Where-Object { $_ -eq $newId }).Count -eq 1)

  # The shared demo seeds were created by the fixed demo sellers; none of their
  # listing ids may appear in the feed.
  $demoSellerIds = @('38255f1d-df55-5b03-85b7-3699325bc140','27906419-2410-5711-b4c7-0700c19c646d','291fa5a1-d801-576e-8b26-d76e01016836')
  $leaks = @($feedWeb.json.listings | Where-Object { $demoSellerIds -contains $_.seller_user_id })
  Check 'browse feed hides every shared demo seed listing' ($leaks.Count -eq 0)

  $mine = Api 'GET' $lanBase '/marketplace/listings/mine' $sellerSession
  Check 'phone base /mine returns 200' ($mine.status -eq 200)
  Check 'phone base /mine shows the seller listing only (no seeds)' (@($mine.json.listings | Where-Object { $demoSellerIds -contains $_.seller_user_id }).Count -eq 0)
}
} catch {
  "SCRIPT_ERROR $($_.Exception.Message)"
}

# --- cleanup -------------------------------------------------------------
# Leave the shared database exactly as found: only the seed listings and real
# user content. Remove this script's throwaway seller account and listings.
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM marketplace_strikes WHERE user_id IN (SELECT user_id FROM users WHERE email = '$sellerEmail')" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM marketplace_user_status WHERE user_id IN (SELECT user_id FROM users WHERE email = '$sellerEmail')" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM listings WHERE seller_user_id IN (SELECT user_id FROM users WHERE email = '$sellerEmail')" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM users WHERE email = '$sellerEmail'" 2>&1) -join ' ' | Out-Null
$leftover = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM users WHERE email = '$sellerEmail'" 2>&1) -join ' '
Check 'throwaway seller account is removed' ($leftover.Trim() -eq '0')

"summary pass=$script:pass fail=$script:fail"
if ($script:fails.Count -gt 0) { exit 1 }