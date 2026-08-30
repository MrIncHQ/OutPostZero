param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$AssetPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$repository = 'MrIncHQ/OutPostZero'
$asset = Get-Item -LiteralPath $AssetPath
if (-not $asset -or $asset.PSIsContainer) { throw 'Nature release asset is missing.' }

$credentialInput = "protocol=https`nhost=github.com`n`n"
$credentialOutput = $credentialInput | git credential fill
if ($LASTEXITCODE -ne 0) { throw 'GitHub credentials are unavailable from Git credential manager.' }
$passwordLine = $credentialOutput | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
if (-not $passwordLine) { throw 'GitHub credential manager did not return an access token.' }
$token = $passwordLine.Substring('password='.Length)

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromHours(2)
$client.DefaultRequestHeaders.UserAgent.ParseAdd('OutpostZero-Nature-Publisher/1.0')
$client.DefaultRequestHeaders.Accept.ParseAdd('application/vnd.github+json')
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
$client.DefaultRequestHeaders.Add('X-GitHub-Api-Version', '2022-11-28')

function Read-JsonResponse([System.Net.Http.HttpResponseMessage]$Response) {
    $body = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $Response.IsSuccessStatusCode) { throw "GitHub request failed ($([int]$Response.StatusCode)): $body" }
    return $body | ConvertFrom-Json
}

try {
    $releaseResponse = $client.GetAsync("https://api.github.com/repos/$repository/releases/tags/$Tag").GetAwaiter().GetResult()
    if ($releaseResponse.StatusCode -eq [System.Net.HttpStatusCode]::NotFound) {
        $releaseBody = @{
            tag_name = $Tag
            target_commitish = 'main'
            name = "Outpost Nature Data $($Tag.Replace('nature-data-', ''))"
            body = 'Signed catalog data for the fully offline Outpost Nature Library.'
            draft = $false
            prerelease = $false
        } | ConvertTo-Json
        $releaseContent = [System.Net.Http.StringContent]::new($releaseBody, [Text.Encoding]::UTF8, 'application/json')
        $release = Read-JsonResponse ($client.PostAsync("https://api.github.com/repos/$repository/releases", $releaseContent).GetAwaiter().GetResult())
    } else {
        $release = Read-JsonResponse $releaseResponse
    }

    $existing = $release.assets | Where-Object name -eq $asset.Name | Select-Object -First 1
    if ($existing) {
        if ([int64]$existing.size -ne $asset.Length) { throw "Release already contains $($asset.Name) with a different size." }
        [pscustomobject]@{ Release = $release.html_url; Asset = $existing.browser_download_url; Bytes = [int64]$existing.size; Uploaded = $false }
        exit 0
    }

    $escapedName = [Uri]::EscapeDataString($asset.Name)
    $uploadUri = "https://uploads.github.com/repos/$repository/releases/$($release.id)/assets?name=$escapedName"
    $stream = [System.IO.File]::OpenRead($asset.FullName)
    try {
        $content = [System.Net.Http.StreamContent]::new($stream)
        $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/zip')
        $content.Headers.ContentLength = $asset.Length
        $uploaded = Read-JsonResponse ($client.PostAsync($uploadUri, $content).GetAwaiter().GetResult())
    } finally {
        $stream.Dispose()
    }
    [pscustomobject]@{ Release = $release.html_url; Asset = $uploaded.browser_download_url; Bytes = [int64]$uploaded.size; Uploaded = $true }
} finally {
    $client.Dispose()
    $token = $null
    $credentialOutput = $null
}
