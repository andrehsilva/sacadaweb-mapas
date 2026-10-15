<#
  SacadaWeb-Mapas :: gera o pacote portatil (ZIP).

  Conteudo: runtime Electron + resources/app.asar (fora o projeto: resources/app,
  build, tools e docs). Basta extrair em qualquer pasta e abrir SacadaWeb-Mapas.exe.

  Uso:
    powershell -File tools/build-portable.ps1                  # usa Compress-Archive
    powershell -File tools/build-portable.ps1 -SevenZip <7z.exe>  # mais rapido
#>
param(
  [string]$Root = "",
  [string]$SevenZip = "",
  [string]$Version = "1.5.0"
)

if ([string]::IsNullOrEmpty($Root)) { $Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath) }

$ErrorActionPreference = "Stop"
$outName = "SacadaWeb-Mapas-$Version-portable.zip"
$outPath = Join-Path $Root $outName
$stage = Join-Path $env:TEMP ("swmap-portable-" + [guid]::NewGuid().ToString("N").Substring(0, 8))

# 1. copia o runtime (fora o projeto e os insumos de build)
New-Item -ItemType Directory -Path $stage | Out-Null
Get-ChildItem -LiteralPath $Root -Force | Where-Object {
  $_.Name -notin @("build", "tools", '$t', '$tmp') -and
  -not ($_.Name -like "SacadaWeb-Mapas-*-portable.*") -and
  -not ($_.Name -like "*.md")
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
}
Remove-Item -LiteralPath (Join-Path $stage "resources\app") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stage "resources\app.asar.unpacked") -Recurse -Force -ErrorAction SilentlyContinue

# 2. zip (deflate, legivel pelo Explorer)
Remove-Item -LiteralPath $outPath -Force -ErrorAction SilentlyContinue
if ([string]::IsNullOrEmpty($SevenZip)) {
  # ZipArchive direto: grava os nomes com "/" (o CreateFromDirectory usa "\" no Windows)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::Open($outPath, 'Create')
  try {
    Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
      $entry = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $_.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally {
    $zip.Dispose()
  }
} else {
  Push-Location $stage
  try {
    & $SevenZip a -tzip -mx=5 -bso0 -bsp0 $outPath "*" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7z falhou ao criar o pacote" }
  } finally {
    Pop-Location
  }
}

Remove-Item -LiteralPath $stage -Recurse -Force
$size = [math]::Round((Get-Item $outPath).Length / 1MB, 1)
Write-Output "Gerado: $outPath ($size MB)"
