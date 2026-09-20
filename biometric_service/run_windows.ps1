$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) { python -m venv .venv }

& .\.venv\Scripts\python.exe -m pip install --quiet --upgrade pip
& .\.venv\Scripts\python.exe -m pip install --quiet -r requirements.txt

# Loopback by default: the service accepts unauthenticated image uploads.
$listenHost = if ($env:BIOMETRIC_HOST) { $env:BIOMETRIC_HOST } else { "127.0.0.1" }
$listenPort = if ($env:BIOMETRIC_PORT) { $env:BIOMETRIC_PORT } else { "8765" }

& .\.venv\Scripts\python.exe -m uvicorn main:app --host $listenHost --port $listenPort
