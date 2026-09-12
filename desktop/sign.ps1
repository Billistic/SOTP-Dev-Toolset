<#
.SYNOPSIS
  Authenticode-signs one or more files. Used by desktop/build.py and by Inno Setup (SignTool=sotp).

  Certificate source, first match wins:
    SOTP_SIGN_PFX (+ SOTP_SIGN_PFX_PASSWORD)  path to a .pfx  - CI secrets or a purchased cert exported with its key
    SOTP_SIGN_THUMBPRINT                      cert in CurrentUser\My / LocalMachine\My - hardware tokens / EV certs
    desktop/certs/dev-codesign.pfx            self-signed dev cert from make_dev_cert.ps1 (pipeline test only)

  Uses signtool.exe from the Windows SDK when present, otherwise Set-AuthenticodeSignature.
  Timestamps with RFC3161 so signatures outlive the certificate.
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)][string[]]$Files,
  [string]$TimestampUrl = "http://timestamp.digicert.com"
)
$ErrorActionPreference = "Stop"
if (-not $Files -or $Files.Count -eq 0) { throw "sign.ps1: no files given" }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-SignTool {
  $roots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")
  foreach ($r in $roots) {
    if (Test-Path $r) {
      $hit = Get-ChildItem -Path $r -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -match "\\x64\\" } | Sort-Object FullName -Descending | Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
  }
  return $null
}

$pfx = $env:SOTP_SIGN_PFX
$pfxPass = $env:SOTP_SIGN_PFX_PASSWORD
$thumb = $env:SOTP_SIGN_THUMBPRINT
$devPfx = Join-Path $here "certs\dev-codesign.pfx"
if (-not $pfx -and -not $thumb -and (Test-Path $devPfx)) {
  $pfx = $devPfx
  if (-not $pfxPass) { $pfxPass = "sotp-dev" }
  Write-Host "sign.ps1: using the self-signed DEV certificate (not trusted by SmartScreen)" -ForegroundColor Yellow
}
if (-not $pfx -and -not $thumb) {
  Write-Host "sign.ps1: no certificate configured - files left unsigned" -ForegroundColor Yellow
  exit 0
}

$signtool = Find-SignTool
foreach ($f in $Files) {
  if (-not (Test-Path $f)) { throw "sign.ps1: file not found: $f" }
  if ($signtool) {
    $args = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $TimestampUrl, "/d", "SOTP Dev Env")
    if ($pfx) { $args += @("/f", $pfx); if ($pfxPass) { $args += @("/p", $pfxPass) } }
    else { $args += @("/sha1", $thumb) }
    & $signtool @args $f
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $f" }
  } else {
    if ($pfx) {
      $secure = if ($pfxPass) { ConvertTo-SecureString $pfxPass -AsPlainText -Force } else { $null }
      $cert = Get-PfxCertificate -FilePath $pfx -Password $secure
    } else {
      $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My | Where-Object Thumbprint -eq $thumb | Select-Object -First 1
      if (-not $cert) { throw "certificate $thumb not found" }
    }
    $r = Set-AuthenticodeSignature -FilePath $f -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
    if ($r.Status -notin @("Valid", "UnknownError")) { throw "Set-AuthenticodeSignature: $($r.Status) $($r.StatusMessage)" }
  }
  $status = (Get-AuthenticodeSignature -FilePath $f).Status
  Write-Host ("signed {0}  [{1}]" -f (Split-Path -Leaf $f), $status)
}
