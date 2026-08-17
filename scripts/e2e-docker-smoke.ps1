param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8080",
    [string]$WorkerBaseUrl = "http://127.0.0.1:8001",
    [string]$WebBaseUrl = "http://127.0.0.1:3000",
    [string]$FixturePath = "assets/fixtures/sample.ppm",
    [int]$Scale = 2,
    [int]$StartupTimeoutSeconds = 45,
    [int]$JobTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

function Wait-JsonEndpoint {
    param(
        [string]$Url,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        try {
            return Invoke-RestMethod -Uri $Url -Method Get
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Timed out waiting for $Url"
}

function Wait-HttpStatus {
    param(
        [string]$Url,
        [int]$ExpectedStatus,
        [int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Get
            if ($response.StatusCode -eq $ExpectedStatus) {
                return $response
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Timed out waiting for $Url to return HTTP $ExpectedStatus"
}

function Convert-ContainerPathToHostPath {
    param(
        [string]$PathValue,
        [string]$WorkspaceRoot
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $null
    }

    if ($PathValue -like "/workspace/*") {
        $relativePath = $PathValue.Substring("/workspace/".Length).Replace("/", "\")
        return Join-Path $WorkspaceRoot $relativePath
    }

    return $PathValue
}

$workspace = (Get-Location).Path

$apiHealth = Wait-JsonEndpoint -Url "$ApiBaseUrl/health" -TimeoutSeconds $StartupTimeoutSeconds
$workerHealth = Wait-JsonEndpoint -Url "$WorkerBaseUrl/health" -TimeoutSeconds $StartupTimeoutSeconds
$webHome = Wait-HttpStatus -Url $WebBaseUrl -ExpectedStatus 200 -TimeoutSeconds $StartupTimeoutSeconds
$webCapabilities = Wait-JsonEndpoint -Url "$WebBaseUrl/api/v1/capabilities" -TimeoutSeconds $StartupTimeoutSeconds

$loginPayload = @{
    email = "admin@vision.local"
    password = "vision123"
} | ConvertTo-Json

$auth = Invoke-RestMethod `
    -Uri "$ApiBaseUrl/api/v1/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body $loginPayload

$resolvedFixture = (Resolve-Path $FixturePath).Path
$uploadJson = & curl.exe `
    -s `
    -X POST `
    -H "Authorization: Bearer $($auth.token)" `
    -F "file=@$resolvedFixture" `
    "$ApiBaseUrl/api/v1/uploads"

if ([string]::IsNullOrWhiteSpace($uploadJson)) {
    throw "Upload returned an empty response."
}

$upload = $uploadJson | ConvertFrom-Json

$jobPayload = @{
    kind = "image_upscale"
    asset_id = $upload.asset.asset_id
    output_format = "png"
    options = @{
        engine = "ffmpeg"
        scale = "$Scale"
    }
} | ConvertTo-Json -Depth 5

$headers = @{
    Authorization = "Bearer $($auth.token)"
}

$created = Invoke-RestMethod `
    -Uri "$ApiBaseUrl/api/v1/jobs" `
    -Method Post `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $jobPayload

$jobId = $created.job.job_id
$deadline = (Get-Date).AddSeconds($JobTimeoutSeconds)
$job = $created.job

while ($job.status -in @("queued", "running") -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    $job = Invoke-RestMethod `
        -Uri "$ApiBaseUrl/api/v1/jobs/$jobId" `
        -Method Get `
        -Headers $headers
}

if ($job.status -ne "succeeded") {
    throw "Job finished with status '$($job.status)': $($job.message)"
}

if (-not $job.output_asset_id) {
    throw "Job succeeded but no output_asset_id was registered."
}

$hostOutputPath = Convert-ContainerPathToHostPath -PathValue $job.output_uri -WorkspaceRoot $workspace
if (-not [string]::IsNullOrWhiteSpace($hostOutputPath) -and -not (Test-Path $hostOutputPath)) {
    throw "The output file was not found on the host at $hostOutputPath"
}

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
$downloadTarget = Join-Path $workspace "logs\docker-smoke-output.png"
Invoke-WebRequest `
    -Uri "$ApiBaseUrl/api/v1/assets/$($job.output_asset_id)/download" `
    -Method Get `
    -Headers $headers `
    -OutFile $downloadTarget

if (-not (Test-Path $downloadTarget)) {
    throw "The asset download endpoint did not produce a file."
}

[pscustomobject]@{
    api_health = $apiHealth
    worker_health = $workerHealth
    web_status_code = $webHome.StatusCode
    capabilities_count = @($webCapabilities).Count
    asset_id = $upload.asset.asset_id
    job_id = $job.job_id
    output_asset_id = $job.output_asset_id
    status = $job.status
    output_uri = $job.output_uri
    host_output_path = $hostOutputPath
    progress = $job.progress
    message = $job.message
    download_target = $downloadTarget
} | ConvertTo-Json -Depth 5
