$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
function Leer([string]$texto) {
  $s = Read-Host $texto -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$email = Read-Host 'Correo del usuario'
$uno = Leer 'Nueva contrasena (minimo 12 caracteres)'
$dos = Leer 'Repite la contrasena'
if ($uno -cne $dos) { throw 'Las contrasenas no coinciden. No se cambio nada.' }
try {
  $env:BOOTSTRAP_PASSWORD = $uno
  node (Join-Path $PSScriptRoot 'reset-password.cjs') $email
  if ($LASTEXITCODE -ne 0) { throw 'No se cambio la contrasena.' }
} finally {
  Remove-Item Env:BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
}
