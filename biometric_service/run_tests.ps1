# Whole Python suite, stdlib runner only - no pytest, no model weights.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" }
          elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" }
          else { throw "No 'python' or 'py' launcher found on PATH." }

& $python -m unittest discover -p "test_*.py" -v
