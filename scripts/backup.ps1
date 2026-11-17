param([Parameter(Mandatory=$true)][ValidateSet('E','F','G','H')][string]$Stage)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root ('backups/estado-antes-inciso-' + $Stage.ToLower() + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
$paths = @('src','docs','scripts','request','tests','database','private','package.json','package-lock.json','.env','.env.example','.gitignore','README.md') | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ }
Compress-Archive -LiteralPath $paths -DestinationPath $target
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($target)
try {
  if (-not ($zip.Entries.FullName -match 'package.json')) { throw 'Respaldo incompleto' }
  Write-Output ($target + ' | entradas: ' + $zip.Entries.Count)
} finally { $zip.Dispose() }
