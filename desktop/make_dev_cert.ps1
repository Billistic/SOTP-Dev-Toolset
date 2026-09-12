<#
.SYNOPSIS
  Creates a self-signed code-signing certificate for exercising the signing + update pipeline locally.

  The cert is exported to desktop/certs/dev-codesign.pfx (git-ignored) and removed from the store again,
  so nothing lingers on the machine. It is NOT trusted by Windows: signed files verify as "UnknownError"
  (untrusted root) and SmartScreen still warns. For releases use a CA-issued certificate - see README.
#>
param([string]$Password = "sotp-dev", [string]$Subject = "CN=SOTP Dev Env (development)")
$ErrorActionPreference = "Stop"
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "certs"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$pfx = Join-Path $out "dev-codesign.pfx"

$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -KeyAlgorithm RSA -KeyLength 3072 `
          -HashAlgorithm SHA256 -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3) `
          -KeyExportPolicy Exportable -FriendlyName "SOTP Dev Env dev signing"
try {
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $Password -AsPlainText -Force) | Out-Null
} finally {
  Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Force
}
Write-Host "wrote $pfx (password: $Password, thumbprint: $($cert.Thumbprint))"
