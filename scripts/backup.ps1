param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9-]{1,40}$')][string]$Etiqueta)
# Respaldo local privado (incluye .env). No compartir ni subir a Git.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup.ps1 -Etiqueta antes-cores
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'backups'
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$target = Join-Path $dir ($Etiqueta.ToLower() + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
$paths = @('src','web/src','web/index.html','web/package.json','web/vite.config.js','docs','scripts','request','tests','database','private','package.json','package-lock.json','.env','.env.example','.gitignore','README.md') |
  ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ }
Compress-Archive -LiteralPath $paths -DestinationPath $target
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($target)
try {
  if (-not ($zip.Entries.FullName -match 'package.json')) { throw 'Respaldo incompleto' }
  Write-Output ($target + ' | entradas: ' + $zip.Entries.Count)
} finally { $zip.Dispose() }
