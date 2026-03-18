param(
    [string]$ApiBaseUrl = "http://127.0.0.1:8080",
    [string]$WorkerBaseUrl = "http://127.0.0.1:8001",
    [string]$FixturePath = "assets/fixtures/sample.ppm",
    [int]$Scale = 2,
    [int]$StartupTimeoutSeconds = 60,
    [int]$JobTimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

function Stop-StartedProcess {
    param([System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return
    }

    try {
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force
        }
    }
    catch {
        return
    }
}

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

$workspace = (Get-Location).Path
$workerProcess = $null
$apiProcess = $null

try {
    New-Item -ItemType Directory -Force -Path "logs" | Out-Null

    $workerProcess = Start-Process `
        -FilePath "python" `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001", "--app-dir", "services/vision" `
        -WorkingDirectory $workspace `
        -RedirectStandardOutput "$workspace\logs\vision-service.out.log" `
        -RedirectStandardError "$workspace\logs\vision-service.err.log" `
        -PassThru

    $apiBinary = Join-Path $workspace "backend\target\debug\vision-api.exe"
    if (-not (Test-Path $apiBinary)) {
        throw "Missing backend binary at $apiBinary. Build it first with cargo build."
    }

    $apiProcess = Start-Process `
        -FilePath $apiBinary `
        -WorkingDirectory $workspace `
        -RedirectStandardOutput "$workspace\logs\vision-api.out.log" `
        -RedirectStandardError "$workspace\logs\vision-api.err.log" `
        -PassThru

    $workerHealth = Wait-JsonEndpoint -Url "$WorkerBaseUrl/health" -TimeoutSeconds $StartupTimeoutSeconds
    $apiHealth = Wait-JsonEndpoint -Url "$ApiBaseUrl/health" -TimeoutSeconds $StartupTimeoutSeconds

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

    if (-not (Test-Path $job.output_uri)) {
        throw "Output file is missing at $($job.output_uri)"
    }

    [pscustomobject]@{
        worker_health = $workerHealth
        api_health = $apiHealth
        asset_id = $upload.asset.asset_id
        job_id = $job.job_id
        status = $job.status
        output_uri = $job.output_uri
        progress = $job.progress
        message = $job.message
    } | ConvertTo-Json -Depth 5
}
finally {
    Stop-StartedProcess -Process $apiProcess
    Stop-StartedProcess -Process $workerProcess
}
