# Login verification script
$API = 'http://localhost:3000'
$script:pass = 0
$script:fail = 0
$testAccounts = @()

function Check($name, $cond) {
  if ($cond) { $script:pass++; Write-Host "[PASS] $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "[FAIL] $name" -ForegroundColor Red }
}

function Api($method, $path, $session, $body, $skipContentType = $false) {
  $headers = @{}
  if (-not $skipContentType) { $headers['Content-Type'] = 'application/json' }
  if ($session) { $headers['Authorization'] = "Bearer $session" }
  try {
    $r = Invoke-WebRequest -Uri "$API$path" -Method $method -Headers $headers -Body ($body | ConvertTo-Json -Compress) -UseBasicParsing
    @{status=$r.StatusCode; json=($r.Content | ConvertFrom-Json); raw=$r.Content}
  } catch {
    $resp = $_.Exception.Response
    $stream = $resp.GetResponseStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $content = $reader.ReadToEnd()
    $parsed = $content | ConvertFrom-Json -ErrorAction SilentlyContinue
    @{status=[int]$resp.StatusCode; json=$parsed; raw=$content}
  }
}

function Cleanup {
  foreach ($acct in $script:testAccounts) {
    try { Invoke-WebRequest -Uri "$API/dev/delete-user/$($acct.user_id)" -Method DELETE -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null } catch {}
  }
}

try {
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $email = "verify${ts}@test.com"
  $password = 'TestPass123!'

  # Register
  $reg = Api 'POST' '/auth/register' $null @{
    email=$email; password=$password; name='Test'; phone='+639123456789'
    display_name='TestUser'; base_body_selection='male'
  }
  Check 'register 201' ($reg.status -eq 201)
  if ($reg.json.user.user_id) { $script:testAccounts += $reg.json.user }

  # Login correct
  $login = Api 'POST' '/auth/login' $null @{email=$email; password=$password}
  Check 'login correct 200' ($login.status -eq 200)
  Check 'session token present' ($null -ne $login.json.session_token)

  # Login case-insensitive
  $loginUpper = Api 'POST' '/auth/login' $null @{email=$email.ToUpper(); password=$password}
  Check 'login uppercase email 200' ($loginUpper.status -eq 200)

  $loginSpaces = Api 'POST' '/auth/login' $null @{email="  $email  "; password=$password}
  Check 'login spaces around email 200' ($loginSpaces.status -eq 200)

  # Wrong password
  $wrongPass = Api 'POST' '/auth/login' $null @{email=$email; password='wrong'}
  Check 'wrong password 401' ($wrongPass.status -eq 401)

  # Unknown email
  $unknown = Api 'POST' '/auth/login' $null @{email='unknown@test.com'; password='test'}
  Check 'unknown email 401' ($unknown.status -eq 401)
  Check 'unknown email same error as wrong password' ($unknown.json.error -eq $wrongPass.json.error)

  # Empty body
  $empty = Api 'POST' '/auth/login' $null @{}
  Check 'empty body 400' ($empty.status -eq 400)
  # Debug: Write-Host "DEBUG empty fields: $($empty.json.fields | ConvertTo-Json -Compress)"
  Check 'empty body has email field' ($null -ne $empty.json.fields.email -and $empty.json.fields.email -ne '')
  Check 'empty body has password field' ($null -ne $empty.json.fields.password -and $empty.json.fields.password -ne '')

  # Email only
  $emailOnly = Api 'POST' '/auth/login' $null @{email='test@test.com'}
  Check 'email only 400' ($emailOnly.status -eq 400)
  Check 'email only has password field' ($null -ne $emailOnly.json.fields.password -and $emailOnly.json.fields.password -ne '')
  Check 'email only has no email field' ($null -eq $emailOnly.json.fields.email -or $emailOnly.json.fields.email -eq '')

  # Password only
  $passOnly = Api 'POST' '/auth/login' $null @{password='test'}
  Check 'password only 400' ($passOnly.status -eq 400)
  Check 'password only has email field' ($null -ne $passOnly.json.fields.email -and $passOnly.json.fields.email -ne '')
  Check 'password only has no password field' ($null -eq $passOnly.json.fields.password -or $passOnly.json.fields.password -eq '')

  # Content-Type variants (from 1c)
  $noContentType = Api 'POST' '/auth/login' $null @{email=$email; password=$password} -skipContentType $true
  Check 'no Content-Type 400' ($noContentType.status -eq 400)
  Check 'no Content-Type has email field' ($null -ne $noContentType.json.fields.email -and $noContentType.json.fields.email -ne '')
  Check 'no Content-Type has password field' ($null -ne $noContentType.json.fields.password -and $noContentType.json.fields.password -ne '')

  Write-Host "`nSummary: pass=$script:pass fail=$script:fail"
} finally {
  Cleanup
}
