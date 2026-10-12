# Marketplace listing deletion verification.
# Tests POST /listings/:id/remove and DELETE /listings/:id.
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3000'
$envFile = 'C:\Users\Alord\OneDrive\Documents\School\MOR\Concept\ACCEPTED COSPLAY CONTENTS\CosForge_System - Copy\forgemind-backend\.env'
$env:PGPASSWORD = ((Get-Content -LiteralPath $envFile) | Where-Object { $_ -match '^\s*DB_PASSWORD=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })

$testEmails = @()
$script:pass = 0
$script:fail = 0
$script:fails = @()

function Check($name, $condition) {
  if ($condition) { $script:pass++; "PASS  $name" }
  else { $script:fail++; $script:fails += $name; "FAIL  $name" }
}

function Api($method, $path, $session, $body) {
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

try {

$stamp = (Get-Date -Format 'MMddHHmmssffff') + '-' + ((New-Guid).ToString('N').Substring(0,4))
$email1 = "del1-$stamp@forge.test"
$email2 = "del2-$stamp@forge.test"
$testEmails += $email1
$testEmails += $email2
$secret = 'Del-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

# Register and login account 1
$reg1 = Api 'POST' '/auth/register' $null @{
  email = $email1; password = $secret; display_name = 'Del Test 1'
  base_body_selection = 'female'; is_cosplayer = $true; data_consent_given = $true
}
$login1 = Api 'POST' '/auth/login' $null @{ email = $email1; password = $secret }
$session1 = $login1.json.session_token
$userId1 = $login1.json.user.user_id

# Register and login account 2
$reg2 = Api 'POST' '/auth/register' $null @{
  email = $email2; password = $secret; display_name = 'Del Test 2'
  base_body_selection = 'female'; is_cosplayer = $true; data_consent_given = $true
}
$login2 = Api 'POST' '/auth/login' $null @{ email = $email2; password = $secret }
$session2 = $login2.json.session_token

# Mark verified and setup as marketplace seller directly
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE users SET verification_status = 'verified', marketplace_role = 'seller', seller_display_name = 'Del Shop 1', marketplace_contact_email = 'del1@test', marketplace_contact_phone = '09171234567', payout_method_label = 'Test', payout_method_number = '12345678', agreed_to_marketplace_terms = true, marketplace_terms_accepted_at = NOW(), marketplace_submitted_at = NOW(), marketplace_verification_status = 'verified' WHERE user_id = '$userId1'" 2>&1) -join ' ' | Out-Null

# Create listing
$create = Api 'POST' '/marketplace/listings' $session1 @{
  title = 'Black cosplay wig'
  description = 'Worn once'
  category = 'Wigs'
  post_type = 'sell'
  price = 500
  condition = 'like_new'
}
Check 'owner creates listing (201)' ($create.status -eq 201)
$listingId = $create.json.listing.id

# Remove listing
$remove = Api 'POST' "/marketplace/listings/$listingId/remove" $session1 @{ removed_reason = 'other' }
Check 'owner removes listing (200)' ($remove.status -eq 200)

# Account 2 should not see it in browse
$browse = Api 'GET' '/marketplace/listings' $session2
Check 'removed listing not in browse feed' ($null -eq ($browse.json | Where-Object { $_.listing_id -eq $listingId }))

# Owner should still see it in /mine
$mine = Api 'GET' '/marketplace/listings/mine' $session1
Check 'owner still sees removed listing in /mine' ($null -ne ($mine.json | Where-Object { $_.listing_id -eq $listingId }))

# Permanently delete
$delete = Api 'DELETE' "/marketplace/listings/$listingId" $session1
Check 'owner deletes removed listing (200)' ($delete.status -eq 200)

# Should be gone from /mine
$mineAfter = Api 'GET' '/marketplace/listings/mine' $session1
Check 'deleted listing gone from /mine' ($null -eq ($mineAfter.json | Where-Object { $_.listing_id -eq $listingId }))

# Create another listing for auth tests
$create2 = Api 'POST' '/marketplace/listings' $session1 @{
  title = 'White wig'
  description = 'New'
  category = 'Wigs'
  post_type = 'sell'
  price = 600
  condition = 'new'
}
$listingId2 = $create2.json.listing.id

# Non-owner remove 403
$removeOther = Api 'POST' "/marketplace/listings/$listingId2/remove" $session2 @{ removed_reason = 'other' }
Check 'non-owner remove 403' ($removeOther.status -eq 403)

# Non-owner delete 403
$deleteOther = Api 'DELETE' "/marketplace/listings/$listingId2" $session2
Check 'non-owner delete 403' ($deleteOther.status -eq 403)

# Delete active listing 409
$deleteActive = Api 'DELETE' "/marketplace/listings/$listingId2" $session1
Check 'delete active listing 409' ($deleteActive.status -eq 409)

# Remove it first
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE listings SET listing_status = 'cancelled' WHERE listing_id = '$listingId2'" 2>&1) -join ' ' | Out-Null

# Unknown ID 404
$fakeId = (New-Guid).ToString()
$deleteUnknown = Api 'DELETE' "/marketplace/listings/$fakeId" $session1
Check 'delete unknown id 404' ($deleteUnknown.status -eq 404)

# Invalid reason 400
$create3 = Api 'POST' '/marketplace/listings' $session1 @{
  title = 'Blue wig'; description = 'Test'; category = 'Wigs'; post_type = 'sell'; price = 700; condition = 'new'
}
$listingId3 = $create3.json.listing.id
$removeInvalid = Api 'POST' "/marketplace/listings/$listingId3/remove" $session1 @{ removed_reason = 'invalid_reason' }
Check 'invalid removal reason 400' ($removeInvalid.status -eq 400)

"summary pass=$script:pass fail=$script:fail"
if ($script:fail -gt 0) {
  "failed: $($script:fails -join ', ')"
  exit 1
}

} finally {
  # Cleanup
  if ($testEmails.Count -gt 0) {
    $emailList = ($testEmails | ForEach-Object { "'$_'" }) -join ','
    (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM listings WHERE seller_user_id IN (SELECT user_id FROM users WHERE email IN ($emailList))" 2>&1) -join ' ' | Out-Null
    (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM users WHERE email IN ($emailList)" 2>&1) -join ' ' | Out-Null
  }
}
