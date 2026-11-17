$ErrorActionPreference = 'Stop'
$email = Read-Host 'Correo para iniciar sesion'
$secret = Read-Host 'Contrasena (minimo 12 caracteres)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  node (Join-Path $PSScriptRoot 'create-user.cjs') $email
  if ($LASTEXITCODE -ne 0) { throw 'No se creo el usuario.' }
} finally {
  Remove-Item Env:BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
