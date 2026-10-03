$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1')
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1')
$projectRoot = Split-Path $PSScriptRoot -Parent
$resourceRoot = Join-Path $projectRoot 'src-tauri/resources'
$assetRoot = Join-Path $resourceRoot 'classification'
$downloadRoot = Join-Path $projectRoot '.tools/classification-downloads'
$manifest = Get-Content -LiteralPath (Join-Path $resourceRoot 'classification-assets.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $assetRoot, $downloadRoot | Out-Null

function Test-Verified($Path, $Sha256) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Sha256) {
        throw "Checksum incorrecto: $Path. Aparta el archivo e intenta de nuevo."
    }
    return $true
}

function Download-Verified($Url, $Path, $Sha256) {
    if (Test-Verified $Path $Sha256) { return }
    Write-Output "Descargando $(Split-Path $Path -Leaf)..."
    $partial = "$Path.partial"
    Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing
    if (-not (Test-Verified $partial $Sha256)) { throw 'Descarga incompleta.' }
    Move-Item -LiteralPath $partial -Destination $Path
}

Download-Verified $manifest.vision.url (Join-Path $assetRoot $manifest.vision.file) $manifest.vision.sha256
foreach ($package in @($manifest.runtime, $manifest.video)) {
    $missing = @($package.files | Where-Object { -not (Test-Verified (Join-Path $assetRoot $_.file) $_.sha256) })
    if ($missing.Count -eq 0) { continue }
    $archivePath = Join-Path $downloadRoot $package.archive
    Download-Verified $package.url $archivePath $package.sha256
    $extractPath = Join-Path $downloadRoot ($package.archive + '.expanded')
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    foreach ($entry in $missing) {
        $sourcePath = Join-Path $extractPath $entry.path
        if (-not (Test-Verified $sourcePath $entry.sha256)) { throw 'Paquete incompleto.' }
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $assetRoot $entry.file)
    }
}
$embeddings = Join-Path $resourceRoot $manifest.embeddings.file
if (-not (Test-Verified $embeddings $manifest.embeddings.sha256)) { throw 'Faltan los vectores de categorías.' }
Copy-Item -LiteralPath $embeddings -Destination (Join-Path $assetRoot $manifest.embeddings.file) -Force
Get-ChildItem -LiteralPath (Join-Path $resourceRoot 'classification-licenses') -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $assetRoot -Force
}
Write-Output 'Modelo local y componentes de video verificados.'
