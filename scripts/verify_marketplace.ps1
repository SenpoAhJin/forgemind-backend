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
$script:fails = @()
function Check($name, $condition) {
  # The check name is printed, never the value under test. A name is a field
  # name, an endpoint and a status code, so nothing a seller wrote can reach
  # the console through here.
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
# Seller identity travels as an id and a name, never as an address, and
# ownership is answered by the server instead of by the client comparing
# addresses. Without these three fields a client cannot name the seller or tell
# its own listing apart, which is what broke the listing detail screen.
Check 'the feed names the seller with seller_user_id' (@($feed.json.listings | Where-Object { -not ($_.PSObject.Properties.Name -contains 'seller_user_id') }).Count -eq 0)
Check 'the feed names the seller with seller_name' (@($feed.json.listings | Where-Object { -not ($_.PSObject.Properties.Name -contains 'seller_name') }).Count -eq 0)
Check 'the feed answers ownership with is_owner' (@($feed.json.listings | Where-Object { -not ($_.PSObject.Properties.Name -contains 'is_owner') }).Count -eq 0)
Check 'the feed seller id is a non-empty string' (@($feed.json.listings | Where-Object { $_.seller_user_id -isnot [string] -or $_.seller_user_id -eq '' }).Count -eq 0)
Check 'another user listing is never owned by the reader' (@($feed.json.listings | Where-Object { $_.is_owner -eq $true }).Count -eq 0)
Check 'the feed is_owner is a boolean' (@($feed.json.listings | Where-Object { $_.is_owner -isnot [bool] }).Count -eq 0)

$mineA = Api 'GET' '/marketplace/listings/mine' $sellerSession
$mineActive = @($mineA.json.listings | Where-Object { $_.id -eq $activeId })
Check 'A /mine shows the listing' ($mineA.status -eq 200 -and $mineActive.Count -eq 1)
Check 'A /mine exposes the appeal fields for the owner' ($mineActive.Count -eq 1 -and $mineActive[0].PSObject.Properties.Name -contains 'appeal_status')
Check 'a passed listing carries no screening reason' ($mineActive.Count -eq 1 -and $null -eq $mineActive[0].screening_reason)
Check 'the owner listing reports is_owner true' ($mineActive.Count -eq 1 -and $mineActive[0].is_owner -eq $true)
Check 'A /mine never exposes a seller email field' (@($mineA.json.listings | Where-Object { $_.PSObject.Properties.Name -contains 'seller_email' }).Count -eq 0)

# The owner listing seen by its own seller, and the same listing seen by
# another user, must disagree about is_owner. If they ever agree, the flag is
# not per-caller and every ownership decision in the app is wrong.
$mineB = Api 'GET' '/marketplace/listings/mine' $buyerSession
$bOwnRow = @($mineB.json.listings | Where-Object { $_.id -eq $activeId })
Check 'the other account does not own the listing' ($bOwnRow.Count -eq 0)
Check 'the other account feed marks the listing as not owned' (@($feed.json.listings | Where-Object { $_.id -eq $activeId -and $_.is_owner -eq $false }).Count -eq 1)

# --- 2. role and category rules ----------------------------------------
$r = NewListing $buyerSession $valid 'buyerSellAttempt'
Check 'buyer cannot create a sell listing (403)' (-not $r.ok -and $r.status -eq 403)

# The four post types migration 016 retired. Each must be a 400, not a 403 and
# not a 201: the caller is allowed to post, the value is simply gone.
foreach ($retired in @('buy', 'rent', 'service_offer', 'service_request')) {
  $retiredPayload = @{
    post_type = $retired; title = 'Retired post type probe'
    description = 'Checking a post type that no longer exists.'
    price = 300; rate = 300; budget = 300; rental_fee = 300; rental_period_days = 2
    category = $ITEM_CATEGORY; condition = 'good'
  }
  $r = NewListing $buyerSession $retiredPayload "retired_$retired"
  Check "the retired post type $retired is rejected (400)" (-not $r.ok -and $r.status -eq 400)
}

# trade is the one type a buyer may post: a buyer trading something they already
# own is legitimate.
$tradePayload = @{
  post_type = 'trade'; title = 'Trading a cosplay wig for a styled collar'
  description = 'Unused black cosplay wig, looking for a detachable collar in return.'
  trade_offered_item = 'Unused black cosplay wig'
  trade_wanted_item = 'Detachable cosplay collar'
  category = $ITEM_CATEGORY; condition = 'good'
}
$tradeListing = NewListing $buyerSession $tradePayload 'tradeListing'
Check 'buyer can create a trade listing (201)' ($tradeListing.ok)
Check 'buyer /mine shows the trade listing' (@((Api 'GET' '/marketplace/listings/mine' $buyerSession).json.listings | Where-Object { $_.id -eq $tradeListing.id }).Count -eq 1)
$tradeId = $tradeListing.id

$tradeNoWanted = $tradePayload.Clone()
$tradeNoWanted.Remove('trade_wanted_item')
$r = NewListing $sellerSession $tradeNoWanted 'tradeNoWanted'
Check 'a trade with only one item is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$bad = $valid.Clone()
$bad['price'] = 0
$r = NewListing $sellerSession $bad 'priceZero'
Check 'sell with price 0 is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$bad = $valid.Clone()
$bad['category'] = $SERVICE_CATEGORY
$r = NewListing $sellerSession $bad 'wrongCategory'
Check 'sell post in a service only category is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$bad = $valid.Clone()
$bad['post_type'] = 'trade'
$r = NewListing $sellerSession $bad 'tradeInItemNoItems'
Check 'a trade in an item category still needs both items (400)' (-not $r.ok -and $r.status -eq 400)

# commission: the third type. Needs a rate, lives only in a service category, and
# does not need a condition because nothing has been made yet.
$commission = @{
  post_type = 'commission'; title = 'Wig styling, cutting and heat set service'
  description = 'Styling and heat setting for cosplay wigs, same day service.'
  rate = 250; category = $SERVICE_CATEGORY
}
$svcListing = NewListing $sellerSession $commission 'commissionListing'
Check 'commission in a service category is accepted (201)' ($svcListing.ok)
if ($svcListing.ok) {
  Check 'the stored commission kept its rate' ($svcListing.json.listing.rate -eq 250)
  Check 'a commission with no condition got the server default' ($svcListing.json.listing.condition -eq 'good')
}

$commissionNoRate = $commission.Clone()
$commissionNoRate.Remove('rate')
$r = NewListing $sellerSession $commissionNoRate 'commissionNoRate'
Check 'commission without a rate is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$commissionZeroRate = $commission.Clone()
$commissionZeroRate['rate'] = 0
$r = NewListing $sellerSession $commissionZeroRate 'commissionZeroRate'
Check 'commission with rate 0 is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$commissionInItem = $commission.Clone()
$commissionInItem['category'] = $ITEM_CATEGORY
$r = NewListing $sellerSession $commissionInItem 'commissionInItemCategory'
Check 'commission in an item category is rejected (400)' (-not $r.ok -and $r.status -eq 400)

$r = NewListing $buyerSession $commission 'buyerCommission'
Check 'buyer cannot create a commission (403)' (-not $r.ok -and $r.status -eq 403)

# --- 3. server moderation stores blocked listings -----------------------
# The three blocked inputs are read from the generated temp file at run time.
# They are never echoed here and never written into this repository, so the
# fixture stays the single copy of that text. Every probe sends condition
# 'good', including the ones meant to be blocked, so a blocked result can only
# come from the title and description and never from a missing field.
$fixture = Join-Path $env:TEMP 'opencode\blocked_inputs.json'
$blockedInputs = @()
if (Test-Path -LiteralPath $fixture) {
  $blockedInputs = @(((Get-Content -LiteralPath $fixture -Raw) | ConvertFrom-Json))
}
Check 'the blocked input fixture was found and holds 3 objects' ($blockedInputs.Count -eq 3)
Check 'every fixture object has a title, a description and a category' (@($blockedInputs | Where-Object { -not $_.title -or -not $_.description -or -not $_.category }).Count -eq 0)
Check 'every fixture object uses the Wigs category' (@($blockedInputs | Where-Object { $_.category -ne 'Wigs' }).Count -eq 0)

$blockedOne = @{ ok = $false; id = $null; json = $null; status = 0 }
$blockedTwo = $blockedOne
$blockedThree = $blockedOne
$blockedIds = @()
if ($blockedInputs.Count -eq 3) {
  for ($i = 0; $i -lt 3; $i++) {
    $probe = NewListing $sellerSession @{
      post_type = 'sell'; title = $blockedInputs[$i].title; description = $blockedInputs[$i].description
      price = 500; category = $blockedInputs[$i].category; condition = 'good'
    } "blockedInput$($i + 1)"
    $held = $probe.ok -and $probe.json.listing.status -eq 'blocked' -and $probe.json.listing.screening_result -eq 'blocked'
    Check "blocked input $($i + 1) is stored as blocked (201)" ($held)
    if ($i -eq 0) { $blockedOne = $probe }
    if ($i -eq 1) { $blockedTwo = $probe }
    if ($i -eq 2) { $blockedThree = $probe }
  }
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
}

# The other half of screening. Everything above proves the server can refuse
# something; these three prove it can still pass ordinary cosplay stock, which
# is the case a false positive would break. They reuse the blocked inputs'
# category and condition so the only thing that differs is the wording.
$harmless = @(
  @{ label = 'sell'; title = 'Heat resistant white wig base'; description = 'Cosplay wig cap, unused, heat styling friendly.' }
  @{ label = 'commission'; title = 'Wig styling and heat set'; description = 'Styling and heat setting for cosplay wigs, same day service.'; asCommission = $true }
  @{ label = 'trade'; title = 'Trading a cosplay wig for a styled collar'; description = 'Unused black cosplay wig, looking for a detachable collar in return.'; asTrade = $true }
)
foreach ($h in $harmless) {
  if ($h.asCommission) {
    $payload = @{
      post_type = 'commission'; title = $h.title; description = $h.description
      rate = 250; category = $SERVICE_CATEGORY; condition = 'good'
    }
  } elseif ($h.asTrade) {
    $payload = @{
      post_type = 'trade'; title = $h.title; description = $h.description
      trade_offered_item = 'Unused black cosplay wig'; trade_wanted_item = 'Detachable cosplay collar'
      category = $ITEM_CATEGORY; condition = 'good'
    }
  } else {
    $payload = @{
      post_type = 'sell'; title = $h.title; description = $h.description
      price = 350; category = $ITEM_CATEGORY; condition = 'good'
    }
  }
  $r = NewListing $sellerSession $payload "harmless_$($h.label)"
  Check "harmless cosplay listing is allowed ($($h.label))" ($r.ok -and $r.json.listing.status -eq 'active' -and $r.json.listing.screening_result -eq 'passed')
}

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

# Removing a blocked listing is the case that used to be impossible: the owner
# sees a listing held by screening and has no way to take it down, because the
# route only accepted active rows. A withdrawn or unwanted item that got held
# should be removable, and the appeal it may have filed must not survive.
$blockedRemovable = $blockedOne
$r = Api 'POST' "/marketplace/listings/$($blockedRemovable.id)/remove" $sellerSession @{ removed_reason = 'no_longer_available' }
Check 'A can remove a blocked listing (200)' ($r.status -eq 200)
$blockedRemoved = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$($blockedRemovable.id)' AND listing_status = 'cancelled'" 2>&1) -join ' '
Check 'the blocked listing is cancelled once removed' ($blockedRemoved.Trim() -eq '1')
$mineAfterBlockedRemove = Api 'GET' '/marketplace/listings/mine' $sellerSession
$stillThere = @($mineAfterBlockedRemove.json.listings | Where-Object { $_.id -eq $blockedRemovable.id })
Check 'the removed blocked listing is still in A /mine' ($stillThere.Count -eq 1)
Check 'the removed blocked listing reports the cancelled status' ($stillThere.Count -eq 1 -and $stillThere[0].status -eq 'cancelled')
Check 'removing a blocked listing cleared its pending appeal' ($stillThere.Count -eq 1 -and $stillThere[0].appeal_status -eq 'none')
$r = Api 'POST' "/marketplace/listings/$($blockedRemovable.id)/sold" $sellerSession @{}
Check 'a cancelled listing cannot then be marked sold (409)' ($r.status -eq 409)
$r = Api 'POST' "/marketplace/listings/$($blockedRemovable.id)/remove" $sellerSession @{ removed_reason = 'sold_elsewhere' }
Check 'removing an already cancelled listing is refused (409)' ($r.status -eq 409)

# --- 6. sold ------------------------------------------------------------
# The trade listing belongs to B, so B is the one who marks it sold.
$r = Api 'POST' "/marketplace/listings/$tradeId/sold" $buyerSession @{}
Check 'the owner can mark the trade listing sold (200)' ($r.status -eq 200)
$sold = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$tradeId' AND listing_status = 'sold'" 2>&1) -join ' '
Check 'sold listing is stored as sold' ($sold.Trim() -eq '1')
$r = Api 'POST' "/marketplace/listings/$tradeId/sold" $buyerSession @{}
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

# --- 8. permanent delete ------------------------------------------------
# DELETE /marketplace/listings/:id works only for cancelled or blocked listings.
# Create a test listing, remove it, then delete it.
$deleteTest = NewListing $sellerSession @{
  post_type = 'sell'; title = 'Listing for delete test'
  description = 'Will be removed then deleted'
  price = 50; category = $ITEM_CATEGORY; condition = 'good'
} 'deleteTest'
Check 'delete test listing created' ($deleteTest.ok)
$deleteTestId = $deleteTest.id

# Try to delete an active listing (409)
$r = Api 'DELETE' "/marketplace/listings/$deleteTestId" $sellerSession
Check 'deleting active listing refused (409)' ($r.status -eq 409)

# Remove the listing first
$r = Api 'POST' "/marketplace/listings/$deleteTestId/remove" $sellerSession @{ removed_reason = 'no_longer_available' }
Check 'test listing removed' ($r.status -eq 200)

# Non-owner cannot delete (403)
$r = Api 'DELETE' "/marketplace/listings/$deleteTestId" $buyerSession
Check 'non-owner delete refused (403)' ($r.status -eq 403)

# Owner can delete removed listing (200)
$r = Api 'DELETE' "/marketplace/listings/$deleteTestId" $sellerSession
Check 'owner deleted removed listing (200)' ($r.status -eq 200)

# Verify listing is gone from database
$deletedCheck = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$deleteTestId'" 2>&1) -join ' '
Check 'deleted listing removed from database' ($deletedCheck.Trim() -eq '0')

# Try to delete unknown listing (404)
$r = Api 'DELETE' "/marketplace/listings/00000000-0000-0000-0000-000000000000" $sellerSession
Check 'deleting unknown listing returns 404' ($r.status -eq 404)

# Create a blocked listing and test deleting it
if ($blockedOne.ok -and $blockedOne.id) {
  $r = Api 'DELETE' "/marketplace/listings/$($blockedOne.id)" $sellerSession
  Check 'owner deleted blocked listing (200)' ($r.status -eq 200)
  $blockedDelCheck = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id = '$($blockedOne.id)'" 2>&1) -join ' '
  Check 'deleted blocked listing removed from database' ($blockedDelCheck.Trim() -eq '0')
}

# --- 9. cleanup ---------------------------------------------------------
# A listing that is already sold can be deleted outright. Every other status is
# cancelled first so the delete has no state left to disagree with.
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "UPDATE listings SET listing_status = 'cancelled', removed_reason = 'test_cleanup' WHERE seller_user_id IN (SELECT user_id FROM users WHERE email IN ('$sellerEmail','$buyerEmail')) AND listing_status <> 'cancelled'" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM listings WHERE seller_user_id IN (SELECT user_id FROM users WHERE email IN ('$sellerEmail','$buyerEmail'))" 2>&1) -join ' ' | Out-Null
(& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "DELETE FROM users WHERE email IN ('$sellerEmail','$buyerEmail')" 2>&1) -join ' ' | Out-Null
$allTestIds = @($idList, "'$activeId'", "'$tradeId'", "'$($svcListing.id)'", "'$($removable.id)'", "'$($inject.id)'") -join ','
$leftListings = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings WHERE listing_id IN ($allTestIds)" 2>&1) -join ' '
Check 'every test listing was deleted' ($leftListings.Trim() -eq '0')
$leftUsers = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM users WHERE email IN ('$sellerEmail','$buyerEmail')" 2>&1) -join ' '
Check 'both test accounts were deleted' ($leftUsers.Trim() -eq '0')
$seedLeft = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM listings" 2>&1) -join ' '
Check 'the seeded 6 listings are still present' ($seedLeft.Trim() -eq '6')
$seedTypes = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(DISTINCT post_type) FROM listings" 2>&1) -join ' '
Check 'the seeded listings span more than one post type' ([int]$seedTypes.Trim() -ge 2)
$staleTestUsers = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT count(*) FROM users WHERE email LIKE '%@forge.test'" 2>&1) -join ' '
Check 'no test account was left behind' ($staleTestUsers.Trim() -eq '0')

"summary pass=$script:pass fail=$script:fail"
if ($script:fail -gt 0) { "failed: $(($script:fails -join ', '))" }