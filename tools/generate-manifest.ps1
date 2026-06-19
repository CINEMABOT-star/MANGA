$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$chaptersRoot = Join-Path $root "chapters"
$manifestPath = Join-Path $root "manifest.json"
$imageExtensions = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

$chapters = Get-ChildItem -LiteralPath $chaptersRoot -Directory | Sort-Object Name | ForEach-Object {
  $chapterDir = $_
  $pages = Get-ChildItem -LiteralPath $chapterDir.FullName -File |
    Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object Name |
    ForEach-Object {
      $relative = Resolve-Path -LiteralPath $_.FullName -Relative
      $relative.Replace("\", "/").TrimStart(".", "/")
    }

  [ordered]@{
    id = $chapterDir.Name
    title = ($chapterDir.Name -replace "-", " ")
    pages = @($pages)
  }
}

$manifest = [ordered]@{
  title = "Pure Perverted Love"
  chapters = @($chapters)
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Manifest aggiornato: $manifestPath"
