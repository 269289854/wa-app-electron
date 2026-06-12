param(
  [string]$BaseUrl = "https://wa.yizhimeng.uk",
  [string]$Password = $env:WA_APP_ELECTRON_SMOKE_PASSWORD
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "WA_APP_ELECTRON_SMOKE_PASSWORD is required"
}

function Join-ApiUrl([string]$Base, [string]$Path) {
  $baseUri = [Uri]$Base
  return [Uri]::new($baseUri, $Path).AbsoluteUri
}

function Invoke-WaGet([string]$Path) {
  $pair = "wa:$Password"
  $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
  $headers = @{ Authorization = "Basic $auth"; Accept = "application/json" }
  return Invoke-RestMethod -Method Get -Uri (Join-ApiUrl $BaseUrl $Path) -Headers $headers -TimeoutSec 30
}

$summary = [ordered]@{
  health = "pending"
  accounts = 0
  profiles = "skipped"
  contacts = "skipped"
  messages = "skipped"
  longConnections = "pending"
  otpMessages = "skipped"
}

function To-Array($Value) {
  if ($null -eq $Value) {
    return @()
  }
  if ($Value -is [System.Array]) {
    return @($Value)
  }
  return @($Value)
}

function Get-Field($Object, [string[]]$Names) {
  if ($null -eq $Object) {
    return ""
  }
  foreach ($name in $Names) {
    $property = $Object.PSObject.Properties[$name]
    if ($null -ne $property -and $null -ne $property.Value) {
      $value = [string]$property.Value
      if (![string]::IsNullOrWhiteSpace($value)) {
        return $value
      }
    }
  }
  return ""
}

$health = Invoke-WaGet "/api/wa/health"
if ($health.ok -ne $true) {
  throw "Health endpoint returned ok=false"
}
$summary.health = "ok"

$accountsResp = Invoke-WaGet "/api/wa/accounts?limit=100"
$accounts = To-Array $accountsResp.accounts
$summary.accounts = $accounts.Count

$connectionsResp = Invoke-WaGet "/api/wa/long-connections"
if ($null -eq $connectionsResp) {
  throw "Long connection endpoint returned empty response"
}
$summary.longConnections = "ok"

if ($accounts.Count -gt 0) {
  $accountId = Get-Field $accounts[0] @("wa_account_id", "waAccountId", "id", "account_id")
  if ([string]::IsNullOrWhiteSpace($accountId)) {
    $summary.profiles = "skipped:no_account_id"
    $summary.contacts = "skipped:no_account_id"
    $summary.messages = "skipped:no_account_id"
    $summary.otpMessages = "skipped:no_account_id"
    $summary | ConvertTo-Json -Compress
    exit 0
  }

  $profilesResp = Invoke-WaGet ("/api/wa/client-profiles?wa_account_id={0}&limit=20" -f [Uri]::EscapeDataString($accountId))
  $summary.profiles = (To-Array $profilesResp.client_profiles).Count

  $otpResp = Invoke-WaGet ("/api/wa/account-otp-messages?wa_account_id={0}&limit=20" -f [Uri]::EscapeDataString($accountId))
  $summary.otpMessages = (To-Array $otpResp.otp_messages).Count + (To-Array $otpResp.messages).Count

  $contactsResp = Invoke-WaGet ("/api/wa/contacts?wa_account_id={0}&limit=500" -f [Uri]::EscapeDataString($accountId))
  $contacts = To-Array $contactsResp.contacts
  $summary.contacts = $contacts.Count

  if ($contacts.Count -gt 0) {
    $contactRef = Get-Field $contacts[0] @("contact_id", "contactId", "jid", "number")
    if ([string]::IsNullOrWhiteSpace($contactRef)) {
      throw "First contact has no contact_id or jid"
    }
    $messagesPath = "/api/wa/messages?wa_account_id={0}&contact_ref={1}&limit=20&include_sensitive_text=true" -f [Uri]::EscapeDataString($accountId), [Uri]::EscapeDataString($contactRef)
    $messagesResp = Invoke-WaGet $messagesPath
    $summary.messages = (To-Array $messagesResp.messages).Count
  }
}

$summary | ConvertTo-Json -Compress
