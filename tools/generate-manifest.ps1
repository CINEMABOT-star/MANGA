$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$mangaRoot = Join-Path $root "manga"
$manifestPath = Join-Path $root "manifest.json"
$imageExtensions = @(".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
$textInfo = (Get-Culture).TextInfo

$manga = Get-ChildItem -Path $mangaRoot -Directory | Sort-Object Name | ForEach-Object {
  $mangaDir = $_
  $cover = Get-ChildItem -Path $mangaDir.FullName -File |
    Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object Name |
    Select-Object -First 1

  $chapters = Get-ChildItem -Path $mangaDir.FullName -Directory | Sort-Object { [int](($_.Name -replace "\D+", "") -as [int]) }, Name | ForEach-Object {
    $chapterDir = $_
    $pages = Get-ChildItem -Path $chapterDir.FullName -File |
      Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() } |
      Sort-Object Name |
      ForEach-Object {
        $relative = Resolve-Path -Path $_.FullName -Relative
        $relative.Replace("\", "/").TrimStart(".", "/")
      }

    [ordered]@{
      id = $chapterDir.Name
      title = ($chapterDir.Name -replace "-", " ")
      pages = @($pages)
    }
  }

  $coverPath = ""
  if ($cover) {
    $coverPath = (Resolve-Path -Path $cover.FullName -Relative).Replace("\", "/").TrimStart(".", "/")
  }

  [ordered]@{
    id = $mangaDir.Name
    title = $textInfo.ToTitleCase(($mangaDir.Name -replace "-", " "))
    cover = $coverPath
    chapters = @($chapters)
  }
}

$manifest = [ordered]@{
  title = "MANGA Reader"
  manga = @($manga)
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Manifest aggiornato: $manifestPath"
