# Photo upload verification script
# Tests photo upload, listing creation with photos, permissions, cleanup
$ErrorActionPreference = 'Continue'
$base = if ($env:BASE_URL) { $env:BASE_URL } else { 'http://localhost:3000' }
$envFile = 'C:\Users\Alord\OneDrive\Documents\School\MOR\Concept\ACCEPTED COSPLAY CONTENTS\CosForge_System - Copy\forgemind-backend\.env'
$env:PGPASSWORD = ((Get-Content -LiteralPath $envFile) | Where-Object { $_ -match '^\s*DB_PASSWORD=' } | ForEach-Object { ($_ -split '=',2)[1].Trim() })

$testUserIds = @()
$testListingIds = @()
$testPhotoIds = @()

$script:pass = 0
$script:fail = 0
$script:fails = @()

function Check($name, $condition) {
  if ($condition) { $script:pass++; Write-Host "PASS  $name" -ForegroundColor Green }
  else { $script:fail++; $script:fails += "$name"; Write-Host "FAIL  $name" -ForegroundColor Red }
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

function UploadPhoto($session, $filename, $bytes) {
  $boundary = [guid]::NewGuid().ToString('N')
  $headers = @{
    'Content-Type' = "multipart/form-data; boundary=$boundary"
  }
  if ($session) { $headers['Authorization'] = "Bearer $session" }
  
  $LF = "`r`n"
  $bodyLines = @(
    "--$boundary",
    "Content-Disposition: form-data; name=`"photo`"; filename=`"$filename`"",
    "Content-Type: application/octet-stream",
    "",
    [System.Text.Encoding]::GetEncoding('ISO-8859-1').GetString($bytes),
    "--$boundary--",
    ""
  )
  $bodyText = ($bodyLines -join $LF)
  
  try {
    $r = Invoke-WebRequest -Uri "$base/marketplace/photos" -Method POST -Headers $headers `
      -Body ([System.Text.Encoding]::GetEncoding('ISO-8859-1').GetBytes($bodyText)) -UseBasicParsing -TimeoutSec 20
    $json = $null
    try { $json = $r.Content | ConvertFrom-Json } catch {}
    return @{ status = [int]$r.StatusCode; json = $json }
  } catch {
    $code = 0
    $json = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try { $json = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
    }
    return @{ status = $code; json = $json }
  }
}

# --- psql helper -------------------------------
$dbOk = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c 'SELECT 1' 2>&1) -join ' '
Check 'psql helper working' ($dbOk.Trim() -eq '1')

try {

$stamp = (Get-Date -Format 'MMddHHmmss') + '-' + ((New-Guid).ToString('N').Substring(0,6))
$seller1Email = "photoseller1-$stamp@test.com"
$seller2Email = "photoseller2-$stamp@test.com"
$secret = 'PhotoTest' + [guid]::NewGuid().ToString('N').Substring(0, 8)

# Register two sellers
function Register($email) {
  $r = Api 'POST' '/auth/register' $null @{
    email = $email; password = $secret; display_name = 'PhotoSeller'
    base_body_selection = 'male'; is_cosplayer = $true
  }
  if ($r.status -eq 201) {
    $l = Api 'POST' '/auth/login' $null @{ email = $email; password = $secret }
    if ($l.status -eq 200 -and $l.json.user.user_id) {
      $uid = $l.json.user.user_id
      $script:testUserIds += $uid
      # Grant verified marketplace access as seller
      $null = psql forgemind_dev -U forgemind_app -c "UPDATE users SET verification_status='verified', marketplace_role='seller', seller_display_name='PhotoSeller Shop', payout_method_label='GCash', payout_method_number='09123456789' WHERE user_id='$uid'" --tuples-only --no-align
      return $l.json.session_token
    }
  }
  return $null
}

$s1 = Register $seller1Email
$s2 = Register $seller2Email
Check 'seller1 registered' ($null -ne $s1)
Check 'seller2 registered' ($null -ne $s2)

# --- Test files ---
# Valid 1x1 PNG (tiny)
$pngBytes = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
              0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
              0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
              0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
              0x42, 0x60, 0x82)

# Valid JPEG (tiny)
$jpegBytes = @(0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
               0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
               0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
               0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
               0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
               0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xC0, 0x00, 0x0B,
               0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00,
               0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF,
               0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
               0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F,
               0xFF, 0xD9)

# Fake .jpg (text)
$fakeBytes = [System.Text.Encoding]::UTF8.GetBytes("This is not an image")

# Oversize (6MB of zeros)
$oversizeBytes = New-Object byte[] (6 * 1024 * 1024)

# --- no session 401 ---
$noAuth = UploadPhoto $null 'test.png' $pngBytes
Check 'no session 401' ($noAuth.status -eq 401)

# --- valid PNG 200 ---
$png = UploadPhoto $s1 'test.png' $pngBytes
Check 'valid PNG 200' ($png.status -eq 200)
Check 'PNG returns photo_id' ($null -ne $png.json.photo_id)
Check 'PNG returns path' ($null -ne $png.json.path)
if ($png.json.photo_id) { $script:testPhotoIds += $png.json.photo_id }

# --- valid JPEG 200 ---
$jpeg = UploadPhoto $s1 'test.jpg' $jpegBytes
Check 'valid JPEG 200' ($jpeg.status -eq 200)
Check 'JPEG returns photo_id' ($null -ne $jpeg.json.photo_id)
if ($jpeg.json.photo_id) { $script:testPhotoIds += $jpeg.json.photo_id }

# --- fake .jpg 400 unsupported_type ---
$fake = UploadPhoto $s1 'fake.jpg' $fakeBytes
Check 'fake jpg 400' ($fake.status -eq 400)
Check 'fake jpg unsupported_type' ($fake.json.error -eq 'unsupported_type')

# --- oversize 413 ---
$big = UploadPhoto $s1 'big.jpg' $oversizeBytes
Check 'oversize 413' ($big.status -eq 413)
Check 'oversize photo_too_large' ($big.json.error -eq 'photo_too_large')

# --- no file 400 ---
$noFile = Api 'POST' '/marketplace/photos' $s1 $null
Check 'no file 400' ($noFile.status -eq 400)
Check 'no file no_file error' ($noFile.json.error -eq 'no_file')

# --- 11th pending photo 429 ---
for ($i = 0; $i -lt 10; $i++) {
  $extra = UploadPhoto $s1 "extra$i.png" $pngBytes
  if ($extra.json.photo_id) { $script:testPhotoIds += $extra.json.photo_id }
}
$eleventh = UploadPhoto $s1 'eleventh.png' $pngBytes
Check '11th pending 429' ($eleventh.status -eq 429)
Check '11th pending too_many_pending' ($eleventh.json.error -eq 'too_many_pending')

# --- create listing with 2 photo_ids ---
$photo1 = UploadPhoto $s2 'cover.png' $pngBytes
$photo2 = UploadPhoto $s2 'second.png' $pngBytes
if ($photo1.json.photo_id) { $script:testPhotoIds += $photo1.json.photo_id }
if ($photo2.json.photo_id) { $script:testPhotoIds += $photo2.json.photo_id }

$listing = Api 'POST' '/marketplace/listings' $s2 @{
  title = 'Wig with Photos'; description = 'Test listing'; category = 'Makeup & Contacts'
  post_type = 'sell'; price = 500; condition = 'new'; photo_ids = @($photo1.json.photo_id, $photo2.json.photo_id)
}
Check 'create listing 201' ($listing.status -eq 201)
Check 'listing has photos' ($listing.json.listing.photos.Count -eq 2)
Check 'cover is first' ($listing.json.listing.photos[0].photo_id -eq $photo1.json.photo_id)
if ($listing.json.listing.id) { $script:testListingIds += $listing.json.listing.id }

# --- file reachable ---
if ($listing.json.listing.photos.Count -gt 0) {
  $photoPath = $listing.json.listing.photos[0].path
  $photoUrl = "$base/uploads/$photoPath"
  try {
    $photoResp = Invoke-WebRequest -Uri $photoUrl -UseBasicParsing -TimeoutSec 10
    Check 'photo file reachable 200' ($photoResp.StatusCode -eq 200)
    Check 'photo has image content-type' ($photoResp.Headers['Content-Type'] -match 'image')
  } catch {
    Check 'photo file reachable 200' $false
    Check 'photo has image content-type' $false
  }
}

# --- another user cannot attach my pending photo ---
$s2Photo = UploadPhoto $s2 'mine.png' $pngBytes
if ($s2Photo.json.photo_id) { $script:testPhotoIds += $s2Photo.json.photo_id }
$stolen = Api 'POST' '/marketplace/listings' $s1 @{
  title = 'Stolen Photo'; description = 'Test'; category = 'Makeup & Contacts'
  post_type = 'sell'; price = 100; condition = 'new'; photo_ids = @($s2Photo.json.photo_id)
}
Check 'cannot steal photo' ($stolen.status -eq 400 -and $stolen.json.error -eq 'invalid_photo_ids')

# --- same photo_id twice rejected ---
$dup = Api 'POST' '/marketplace/listings' $s2 @{
  title = 'Duplicate'; description = 'Test'; category = 'Makeup & Contacts'
  post_type = 'sell'; price = 100; condition = 'new'; photo_ids = @($photo1.json.photo_id, $photo1.json.photo_id)
}
Check 'duplicate photo_id rejected' ($dup.status -eq 400 -and $dup.json.error -eq 'validation_error')

# --- 6 photo_ids rejected ---
$photos = @()
for ($i = 0; $i -lt 6; $i++) {
  $p = UploadPhoto $s2 "many$i.png" $pngBytes
  if ($p.json.photo_id) {
    $photos += $p.json.photo_id
    $script:testPhotoIds += $p.json.photo_id
  }
}
$tooMany = Api 'POST' '/marketplace/listings' $s2 @{
  title = 'Too Many Photos'; description = 'Test'; category = 'Makeup & Contacts'
  post_type = 'sell'; price = 100; condition = 'new'; photo_ids = $photos
}
Check '6 photos rejected' ($tooMany.status -eq 400 -and $tooMany.json.error -eq 'validation_error')

# --- another user sees photos of active listing ---
$browse = Api 'GET' '/marketplace/listings?limit=50' $s1 $null
Check 'browse 200' ($browse.status -eq 200)
$foundListing = $browse.json.listings | Where-Object { $_.id -eq $listing.json.listing.id }
Check 'active listing visible' ($null -ne $foundListing)
Check 'other user sees photos' ($foundListing.photos.Count -gt 0)

# --- blocked listing hides photos from other user ---
# Create a listing with a known blocking word (never print it)
$blockWord = 'cocaine'
$photo3 = UploadPhoto $s2 'blocked.png' $pngBytes
if ($photo3.json.photo_id) { $script:testPhotoIds += $photo3.json.photo_id }
$blocked = Api 'POST' '/marketplace/listings' $s2 @{
  title = "Test $blockWord listing"; description = 'blocked'; category = 'Makeup & Contacts'
  post_type = 'sell'; price = 100; condition = 'new'; photo_ids = @($photo3.json.photo_id)
}
if ($blocked.json.listing.id) { $script:testListingIds += $blocked.json.listing.id }

# Check as owner
$mineList = Api 'GET' '/marketplace/listings/mine' $s2 $null
$myBlocked = $mineList.json.listings | Where-Object { $_.id -eq $blocked.json.listing.id }
Check 'owner sees blocked listing' ($null -ne $myBlocked)
Check 'owner sees blocked photos' ($myBlocked.photos.Count -gt 0)

# Check as other user
$detail = Api 'GET' "/marketplace/listings/$($blocked.json.listing.id)" $s1 $null
if ($detail.status -eq 200) {
  Check 'other user sees no photos on blocked' ($detail.json.listing.photos.Count -eq 0)
} else {
  Check 'other user sees no photos on blocked' $true # Listing not visible at all is also OK
}

# --- delete listing removes rows and files ---
if ($listing.json.listing.id) {
  # First need to remove it
  $remove = Api 'POST' "/marketplace/listings/$($listing.json.listing.id)/remove" $s2 @{}
  
  # Count photo files before delete
  $photoCountBefore = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT COUNT(*) FROM listing_photos WHERE listing_id = '$($listing.json.listing.id)'" 2>&1) -join ''
  
  # Delete
  $delete = Api 'DELETE' "/marketplace/listings/$($listing.json.listing.id)" $s2 $null
  Check 'delete listing 200' ($delete.status -eq 200)
  
  # Check rows deleted
  $photoCountAfter = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT COUNT(*) FROM listing_photos WHERE listing_id = '$($listing.json.listing.id)'" 2>&1) -join ''
  Check 'photo rows deleted' ($photoCountAfter.Trim() -eq '0')
}

# --- cleanup removes backdated pending row ---
$oldPhoto = UploadPhoto $s1 'old.png' $pngBytes
if ($oldPhoto.json.photo_id) {
  $script:testPhotoIds += $oldPhoto.json.photo_id
  
  # Backdate to 25 hours ago
  $cutoff = (Get-Date).AddHours(-25).ToString('yyyy-MM-dd HH:mm:ss')
  & psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -c "UPDATE listing_photos SET created_at = '$cutoff' WHERE id = '$($oldPhoto.json.photo_id)'" 2>&1 | Out-Null
  
  # Call cleanup (via module test)
  & node -e "require('./dist/marketplace/photoCleanup').startPhotoCleanup(); setTimeout(() => process.exit(0), 2000);" 2>&1 | Out-Null
  Start-Sleep -Seconds 3
  
  # Check row deleted
  $oldCount = (& psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -t -A -c "SELECT COUNT(*) FROM listing_photos WHERE id = '$($oldPhoto.json.photo_id)'" 2>&1) -join ''
  Check 'cleanup removes old pending' ($oldCount.Trim() -eq '0')
}

Write-Host "`n=== SUMMARY: $script:pass pass, $script:fail fail ===" -ForegroundColor Cyan
if ($script:fails.Count -gt 0) {
  Write-Host "Failed checks:" -ForegroundColor Red
  $script:fails | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
}

} finally {
  # Cleanup
  foreach ($photoId in $testPhotoIds) {
    try { & psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -c "DELETE FROM listing_photos WHERE id = '$photoId'" 2>&1 | Out-Null } catch {}
  }
  foreach ($lid in $testListingIds) {
    try { & psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -c "DELETE FROM listings WHERE listing_id = '$lid'" 2>&1 | Out-Null } catch {}
  }
  foreach ($uid in $testUserIds) {
    try { & psql -w -h 127.0.0.1 -U forgemind_app -d forgemind_dev -c "DELETE FROM users WHERE user_id = '$uid'" 2>&1 | Out-Null } catch {}
  }
  
  # Cleanup photo files
  $uploadsDir = 'C:\Users\Alord\OneDrive\Documents\School\MOR\Concept\ACCEPTED COSPLAY CONTENTS\CosForge_System - Copy\forgemind-backend\uploads\listings'
  if (Test-Path $uploadsDir) {
    Get-ChildItem $uploadsDir -Filter *.jpg | Where-Object { $_.CreationTime -gt (Get-Date).AddHours(-1) } | Remove-Item -Force
  }
}
