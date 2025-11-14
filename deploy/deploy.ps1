param(
  [string]$ProjectRef = "rujwuruuosffcxazymit"
)

Write-Host "== Supabase Deploy: api-router & events-stream ==" -ForegroundColor Cyan

# Ensure supabase CLI is available
$supabaseVersion = supabase --version 2>$null
if (-not $?) {
  Write-Error "Supabase CLI not found. Install with: scoop install supabase"
  exit 1
}
Write-Host "Supabase CLI version: $supabaseVersion"

# Acquire token if not set
if (-not $Env:SUPABASE_ACCESS_TOKEN -or [string]::IsNullOrWhiteSpace($Env:SUPABASE_ACCESS_TOKEN)) {
  $secure = Read-Host "Enter SUPABASE_ACCESS_TOKEN (input hidden)" -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  if ([string]::IsNullOrWhiteSpace($token)) { Write-Error "No token provided"; exit 1 }
  $Env:SUPABASE_ACCESS_TOKEN = $token
}

# Link and deploy
$repoRoot = Split-Path -Parent $PSScriptRoot
$functionsDir = Join-Path $repoRoot "supabase"
Push-Location $functionsDir
try {
  Write-Host "Linking project: $ProjectRef" -ForegroundColor Yellow
  supabase link --project-ref $ProjectRef

  Write-Host "Deploying api-router" -ForegroundColor Yellow
  supabase functions deploy api-router --no-verify-jwt

  Write-Host "Deploying events-stream" -ForegroundColor Yellow
  supabase functions deploy events-stream --no-verify-jwt

  Write-Host "Listing functions" -ForegroundColor Yellow
  supabase functions list
}
finally {
  Pop-Location
}

Write-Host "== Deploy complete ==" -ForegroundColor Green
