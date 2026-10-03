# Marketplace listing verification with two real accounts.
# Prints counts, statuses and ids only. Never prints listing text.
# psql is never called from inside a function: a native call in a function
# scope fails with a call depth overflow in this shell, so every query is
# inlined at the top level.
$ErrorActionPreference = 'Continue'
$base = 'http://localhost:3000'
$envFile = 'C:\Users\Alord\OneDrive\Documents\School\MOR\Concept\ACCEPTED COSPLAY CONTENTS\CosForge_System - Copy\forgemind-backend\.env'
$env:PGPASSWORD = ((Get-Content -LiteralPath $envFile) | Where-Object { $_ -match '^\s*DB_PASSWORD=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })

$ITEM_CATEGORY = 'Wigs'
$SERVICE_CATEGORY = 'Commissions & Crafting Services'
$MATERIAL_CATEGORY = 'Materials & Fabric'

$script:pass = 0
$script:fail = 0
function Check($name, $condition) {
  if ($condition) { $script:pass++; "PASS  $name" } else { $script:fail++; "FAIL  $name" }
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
    # ErrorDetails carries the body on an HTTP error; the stream is the fallback.
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

# --- sanity: psql works at the top level -------------------------------
$dbOk = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c 'SELECT 1' 2>&1) -join ' '
Check 'psql helper is working' ($dbOk.Trim() -eq '1')

$stamp = (Get-Date -Format 'MMddHHmmss')
$sellerEmail = "mkseller-$stamp@forge.test"
$buyerEmail = "mkbuyer-$stamp@forge.test"
$secret = 'Verify-' + [guid]::NewGuid().ToString('N').Substring(0, 12)

function Register($email, $displayName) {
  # /auth/register answers with the user row only, so the session comes from a
  # login straight after registration.
  $r = Api 'POST' '/auth/register' $null @{
    email = $email; password = $secret; display_name = $displayName
    base_body_selection = 'female'; is_cosplayer = $true; data_consent_given = $true
  }
  if ($r.status -eq 201 -or $r.status -eq 200) {
    $l = Api 'POST' '/auth/login' $null @{ email = $email; password = $secret }
    if ($l.status -eq 200) { return $l.json.session_token }
  }
  return $null
}
function SubmitRegistration($session, $role, $displayName) {
  # The existing registration endpoint requires a valid seller_display_name for
  # every role, so both test accounts send one.
  return Api 'POST' '/marketplace/registration' $session @{
    marketplace_role = $role; seller_display_name = $displayName
    marketplace_contact_email = 'seller@forge.test'
    marketplace_contact_phone = '09171234567'
    payout_method_label = 'Test payout'; payout_method_number = '12345678'
    agreed_to_marketplace_terms = $true
  }
}
function NewListing($session, $payload, $label) {
  $r = Api 'POST' '/marketplace/listings' $session $payload
  if ($r.status -eq 201) { return @{ ok = $true; id = $r.json.listing.id; json = $r.json; status = 201 } }
  $fieldNames = if ($r.json.fields) { ($r.json.fields.PSObject.Properties.Name -join ', ') } else { 'none' }
  "CREATE_ERROR [$label]: HTTP $($r.status), error=$($r.json.error), fields=$fieldNames"
  return @{ ok = $false; id = $null; json = $r.json; status = $r.status }
}

$sellerSession = Register $sellerEmail 'Verify Seller'
$buyerSession = Register $buyerEmail 'Verify Buyer'
Check 'account A registered and holds a session' ($null -ne $sellerSession)
Check 'account B registered and holds a session' ($null -ne $buyerSession)
if (-not $sellerSession -or -not $buyerSession) { "summary pass=$script:pass fail=$script:fail"; exit 1 }

$r = SubmitRegistration $sellerSession 'seller' 'Verify Seller Shop'
Check 'A submitted a seller registration through the API' ($r.status -eq 200)
$r = SubmitRegistration $buyerSession 'buyer' 'Verify Buyer Shop'
Check 'B submitted a buyer registration through the API' ($r.status -eq 200)

# The Head Organizer approval endpoint needs a Head session that does not exist
# in this environment, so only verification_status is set directly. Everything
# else goes through the real API.
$updA = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE users SET verification_status = 'verified' WHERE email = '$sellerEmail'" 2>&1) -join ' '
$updB = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE users SET verification_status = 'verified' WHERE email = '$buyerEmail'" 2>&1) -join ' '
$verified = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM users WHERE email IN ('$sellerEmail','$buyerEmail') AND verification_status = 'verified'" 2>&1) -join ' '
Check 'A and B are verified marketplace users in the database' ($verified.Trim() -eq '2')
if ($verified.Trim() -ne '2') {
  "DBERR seller=[$updA] buyer=[$updB]"
  "summary pass=$script:pass fail=$script:fail"
  exit 1
}

# --- 1. A creates a listing, B sees it ---------------------------------
$valid = @{
  post_type = 'sell'; title = 'Heat resistant white wig base'
  description = 'Cosplay wig cap, unused, heat styling friendly.'
  price = 350; category = $ITEM_CATEGORY; condition = 'like_new'
}
$created = NewListing $sellerSession $valid 'validCreate'
Check 'A create returns 201' ($created.ok)
Check 'A create row reports active' ($created.json.listing.status -eq 'active' -and $created.json.listing.screening_result -eq 'passed')
$activeId = $created.id
$createdCount = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$activeId' AND listing_status = 'active' AND screening_result = 'passed'" 2>&1) -join ' '
Check 'the row is stored active with a pass result' ($createdCount.Trim() -eq '1')

$feed = Api 'GET' '/marketplace/listings?limit=50' $buyerSession
Check 'B feed request returns 200' ($feed.status -eq 200)
Check 'B sees the listing A created' (@($feed.json.listings | Where-Object { $_.id -eq $activeId }).Count -eq 1)
$seeded = @($feed.json.listings | Where-Object { $_.id -ne $activeId }).Count
Check 'B feed carries the seeded 6 listings too' ($seeded -eq 6)
Check 'B feed never exposes a screening_reason field' (@($feed.json.listings | Where-Object { $_.PSObject.Properties.Name -contains 'screening_reason' }).Count -eq 0)
Check 'B feed never exposes a seller email field' (@($feed.json.listings | Where-Object { $_.PSObject.Properties.Name -contains 'seller_email' }).Count -eq 0)

$mineA = Api 'GET' '/marketplace/listings/mine' $sellerSession
$mineActive = @($mineA.json.listings | Where-Object { $_.id -eq $activeId })
Check 'A /mine shows the listing' ($mineA.status -eq 200 -and $mineActive.Count -eq 1)
Check 'A /mine exposes the appeal fields for the owner' ($mineActive.Count -eq 1 -and $mineActive[0].PSObject.Properties.Name -contains 'appeal_status')
Check 'a passed listing carries no screening reason' ($mineActive.Count -eq 1 -and $null -eq $mineActive[0].screening_reason)

# --- 2. role and category rules ----------------------------------------
$r = NewListing $buyerSession $valid 'buyerSellAttempt'
Check 'buyer cannot create a sell listing (403)' (-not $r.ok -and $r.status -eq 403)
$buyPayload = @{
  post_type = 'buy'; title = 'Looking for a used cosplay wig in black'
  description = 'Budget friendly, Metro Manila pickup preferred.'
  budget = 400; category = $ITEM_CATEGORY; condition = 'good'
}
$buyListing = NewListing $buyerSession $buyPayload 'buyListing'
Check 'buyer can create a buy listing (201)' ($buyListing.ok)
Check 'buyer /mine shows the buy listing' (@((Api 'GET' '/marketplace/listings/mine' $buyerSession).json.listings | Where-Object { $_.id -eq $buyListing.id }).Count -eq 1)
$buyId = $buyListing.id

$bad = $valid.Clone()
$bad['price'] = 0
$r = NewListing $sellerSession $bad 'priceZero'
Check 'sell with price 0 is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$bad = $valid.Clone()
$bad['category'] = $SERVICE_CATEGORY
$r = NewListing $sellerSession $bad 'wrongCategory'
Check 'sell post in a service only category is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$service = @{
  post_type = 'service_offer'; title = 'Wig styling, cutting and heat set service'
  description = 'Styling and heat setting for cosplay wigs, same day service.'
  rate = 250; category = $SERVICE_CATEGORY; condition = 'like_new'
}
$svcListing = NewListing $sellerSession $service 'svcListing'
Check 'service_offer in a service category is accepted (201)' ($svcListing.ok)

# --- 3. server moderation stores blocked listings -----------------------
$blockedOne = NewListing $sellerSession @{
  post_type = 'sell'; title = 'Cosplay lab coat with beaker prop set'
  description = 'Unused lab coat with beakers, for convention photos.'
  price = 400; category = $MATERIAL_CATEGORY; condition = 'like_new'
} 'blockedOne'
$blockedTwo = NewListing $sellerSession @{
  post_type = 'sell'; title = 'Replica tactical vest with straps and pouches'
  description = 'Unused costume vest, worn only for a photoshoot.'
  price = 900; category = $MATERIAL_CATEGORY; condition = 'new'
} 'blockedTwo'
$blockedThree = NewListing $sellerSession @{
  post_type = 'sell'; title = 'Cosplay prop blade set with sheath for stage'
  description = 'Foam blade and sheath, safe for conventions and stage use.'
  price = 250; category = $MATERIAL_CATEGORY; condition = 'new'
} 'blockedThree'
Check 'blocked input 1 is stored as blocked (201)' ($blockedOne.ok -and $blockedOne.json.listing.status -eq 'blocked')
Check 'blocked input 2 is stored as blocked (201)' ($blockedTwo.ok -and $blockedTwo.json.listing.status -eq 'blocked')
Check 'blocked input 3 is stored as blocked (201)' ($blockedThree.ok -and $blockedThree.json.listing.status -eq 'blocked')
$blockedIds = @($blockedOne.id, $blockedTwo.id, $blockedThree.id)
# Quoted per id. A bare uuid starts with digits, so psql reads it as a numeric
# literal and the whole IN list dies with "trailing junk after numeric literal".
$idList = (($blockedIds | ForEach-Object { "'$_'" }) -join ',')
$stored = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id IN ($idList)" 2>&1) -join ' '
Check 'all three blocked inputs produced a stored row' ($stored.Trim() -eq '3')
$dbBlocked = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id IN ($idList) AND screening_result = 'blocked' AND screening_reason IS NOT NULL" 2>&1) -join ' '
Check 'all three are blocked in the database with a stored reason' ($dbBlocked.Trim() -eq '3')
$dbNotBlocked = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id IN ($idList) AND listing_status = 'blocked'" 2>&1) -join ' '
Check 'no blocked row is anything other than blocked' ($dbNotBlocked.Trim() -eq '3')

$feedB = Api 'GET' '/marketplace/listings?limit=50' $buyerSession
Check 'B feed shows none of the blocked listings' (@($feedB.json.listings | Where-Object { $blockedIds -contains $_.id }).Count -eq 0)
$mineB = Api 'GET' '/marketplace/listings/mine' $buyerSession
Check 'B /mine shows none of A blocked listings' (@($mineB.json.listings | Where-Object { $blockedIds -contains $_.id }).Count -eq 0)
$mineA2 = Api 'GET' '/marketplace/listings/mine' $sellerSession
$mineBlocked = @($mineA2.json.listings | Where-Object { $blockedIds -contains $_.id })
Check 'A /mine shows the blocked listings' ($mineBlocked.Count -eq 3)
Check 'A /mine gives a plain reason for every blocked listing' ($mineBlocked.Count -eq 3 -and @($mineBlocked | Where-Object { -not [string]::IsNullOrWhiteSpace($_.screening_reason) }).Count -eq 3)

# --- 4. appeal ----------------------------------------------------------
$r = Api 'POST' "/marketplace/listings/$($blockedOne.id)/appeal" $sellerSession @{ message = 'Please review, this is a harmless costume prop.' }
Check 'A can appeal a blocked listing (200)' ($r.status -eq 200)
$appealState = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$($blockedOne.id)' AND appeal_status = 'pending'" 2>&1) -join ' '
Check 'appeal is stored as pending' ($appealState.Trim() -eq '1')
$r = Api 'POST' "/marketplace/listings/$activeId/appeal" $sellerSession @{ message = 'Appealing a healthy listing.' }
Check 'appeal on a non blocked listing is refused (409)' ($r.status -eq 409)
$r = Api 'POST' "/marketplace/listings/$($blockedTwo.id)/appeal" $buyerSession @{ message = 'Not my listing to appeal.' }
Check 'non owner appeal is refused (403)' ($r.status -eq 403)
$r = Api 'POST' "/marketplace/listings/$($blockedThree.id)/appeal" $sellerSession @{ }
Check 'an empty appeal message is rejected (400)' ($r.status -eq 400)
$inject = NewListing $sellerSession @{
  post_type = 'sell'; title = 'Appeal state injection attempt'
  description = 'The client must not be able to set the appeal state.'
  price = 100; category = $ITEM_CATEGORY; condition = 'good'; appeal_status = 'overturned'
} 'inject'
$injected = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$($inject.id)' AND appeal_status <> 'none'" 2>&1) -join ' '
Check 'appeal_status cannot be set by the client' ($injected.Trim() -eq '0')

# --- 5. remove ----------------------------------------------------------
$removable = NewListing $sellerSession @{
  post_type = 'sell'; title = 'Cosplay shoe covers pair, size 8'
  description = 'Unused shoe covers, size 8, for convention use.'
  price = 150; category = $MATERIAL_CATEGORY; condition = 'new'
} 'removable'
$r = Api 'POST' "/marketplace/listings/$($removable.id)/remove" $sellerSession @{ removed_reason = 'no_longer_available' }
Check 'A can remove the listing (200)' ($r.status -eq 200)
$removed = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$($removable.id)' AND listing_status = 'cancelled' AND removed_reason = 'no_longer_available'" 2>&1) -join ' '
Check 'removed listing is cancelled with a reason' ($removed.Trim() -eq '1')
$feedB2 = Api 'GET' '/marketplace/listings?limit=50' $buyerSession
Check 'removed listing is gone from the B feed' (@($feedB2.json.listings | Where-Object { $_.id -eq $removable.id }).Count -eq 0)
$mineA3 = Api 'GET' '/marketplace/listings/mine' $sellerSession
Check 'removed listing is still in A /mine' (@($mineA3.json.listings | Where-Object { $_.id -eq $removable.id }).Count -eq 1)
$r = Api 'POST' "/marketplace/listings/$activeId/remove" $buyerSession @{ removed_reason = 'sold_elsewhere' }
Check 'non owner remove is refused (403)' ($r.status -eq 403)
$r = Api 'POST' "/marketplace/listings/$($svcListing.id)/remove" $sellerSession @{ removed_reason = 'invented_reason' }
Check 'an unknown removal reason is rejected (400)' ($r.status -eq 400)
$r = Api 'POST' "/marketplace/listings/$($svcListing.id)/remove" $sellerSession @{}
Check 'remove without a reason still works (200)' ($r.status -eq 200)

# --- 6. sold ------------------------------------------------------------
# The buy listing belongs to B, so B is the one who marks it sold.
$r = Api 'POST' "/marketplace/listings/$buyId/sold" $buyerSession @{}
Check 'the owner can mark the buy listing sold (200)' ($r.status -eq 200)
$sold = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$buyId' AND listing_status = 'sold'" 2>&1) -join ' '
Check 'sold listing is stored as sold' ($sold.Trim() -eq '1')
$r = Api 'POST' "/marketplace/listings/$buyId/sold" $buyerSession @{}
Check 'marking an already sold listing sold again is refused (409)' ($r.status -eq 409)
$r = Api 'POST' "/marketplace/listings/$($svcListing.id)/sold" $sellerSession @{}
Check 'sold on a cancelled listing is refused (409)' ($r.status -eq 409)

# --- 7. access control --------------------------------------------------
$r = Api 'GET' '/marketplace/listings?limit=5' $null
Check 'no session on the browse feed is 401' ($r.status -eq 401)
$r = Api 'POST' '/marketplace/listings' $null $valid
Check 'no session on create is 401' ($r.status -eq 401)
$r = Api 'GET' '/marketplace/listings?limit=5' 'not-a-real-session-value'
Check 'a bogus session is 401' ($r.status -eq 401)
$r = Api 'GET' '/marketplace/listings/mine' $null
Check 'no session on /mine is 401' ($r.status -eq 401)
$r = Api 'POST' "/marketplace/listings/$activeId/sold" $null @{}
Check 'no session on sold is 401' ($r.status -eq 401)
$r = Api 'POST' '/marketplace/listings/not-a-number/sold' $sellerSession @{}
Check 'a malformed listing id is 400' ($r.status -eq 400)
$r = Api 'GET' '/marketplace/listings?limit=abc' $sellerSession
Check 'a malformed limit is 400' ($r.status -eq 400)
$r = Api 'GET' '/marketplace/listings?limit=2' $sellerSession
Check 'limit is honoured' (@($r.json.listings).Count -le 2)

# --- 8. cleanup ---------------------------------------------------------
# A listing that is already sold can be deleted outright. Every other status is
# cancelled first so the delete has no state left to disagree with.
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE listings SET listing_status = 'cancelled', removed_reason = 'test_cleanup' WHERE seller_user_id IN (SELECT user_id FROM users WHERE email IN ('$sellerEmail','$buyerEmail')) AND listing_status <> 'cancelled'" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM listings WHERE seller_user_id IN (SELECT user_id FROM users WHERE email IN ('$sellerEmail','$buyerEmail'))" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM users WHERE email IN ('$sellerEmail','$buyerEmail')" 2>&1) -join ' ' | Out-Null
$leftListings = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id IN ($idList, '$activeId', '$buyId', '$($svcListing.id)', '$($removable.id)', '$($inject.id)')" 2>&1) -join ' '
Check 'every test listing was deleted' ($leftListings.Trim() -eq '0')
$leftUsers = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM users WHERE email IN ('$sellerEmail','$buyerEmail')" 2>&1) -join ' '
Check 'both test accounts were deleted' ($leftUsers.Trim() -eq '0')
$seedLeft = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings" 2>&1) -join ' '
Check 'the seeded 6 listings are still present' ($seedLeft.Trim() -eq '6')

"created_ids=$activeId,$buyId,$($svcListing.id)"
"summary pass=$script:pass fail=$script:fail"