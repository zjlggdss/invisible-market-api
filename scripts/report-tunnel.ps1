[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [Alias('Host')]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9.-]*$')]
    [string]$ServerHost,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z_][A-Za-z0-9_-]*$')]
    [string]$User,

    [Parameter(Mandatory = $true)]
    [string]$KeyPath,

    [Parameter(Mandatory = $true)]
    [string]$KnownHostsPath,

    [ValidateRange(1, 65535)]
    [int]$LocalPort = 43104,

    [ValidateRange(1, 65535)]
    [int]$RemotePort = 4104,

    [ValidateRange(1, 65535)]
    [int]$SshPort = 22
)

$ErrorActionPreference = 'Stop'
foreach ($filePath in @($KeyPath, $KnownHostsPath)) {
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw "SSH file not found: $filePath"
    }
}
$resolvedKeyPath = (Resolve-Path -LiteralPath $KeyPath).Path
$resolvedKnownHostsPath = (Resolve-Path -LiteralPath $KnownHostsPath).Path
$knownHostsOption = 'UserKnownHostsFile="' + $resolvedKnownHostsPath.Replace('\', '/') + '"'
Get-Command ssh -ErrorAction Stop | Out-Null

Write-Host "The report endpoint will be forwarded over SSH to http://127.0.0.1:${LocalPort}. Keep this window open; press Ctrl+C to close the tunnel."
$sshArguments = @(
    '-i', $resolvedKeyPath,
    '-p', "$SshPort",
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', $knownHostsOption,
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', "127.0.0.1:${LocalPort}:127.0.0.1:$RemotePort",
    '-N', "$User@$ServerHost"
)
& ssh @sshArguments
if ($LASTEXITCODE -ne 0) {
    throw "SSH tunnel exited with code $LASTEXITCODE"
}
