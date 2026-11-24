#requires -Version 7
[CmdletBinding()]
param(
    [string]$Directory = "$env:USERPROFILE/.codex/votemirror-relayer",
    [string]$WalletDirectory = "$env:USERPROFILE/.codex/wallets/votemirror-relayer-20261124",
    [switch]$Once
)
$ErrorActionPreference='Stop'
$passwordFile=Join-Path $WalletDirectory ('.session-'+[guid]::NewGuid().ToString('N'))
try {
    $credential=[pscredential]::new('local',(Import-Clixml "$WalletDirectory/password.dpapi.xml"))
    [IO.File]::WriteAllText($passwordFile,$credential.GetNetworkCredential().Password)
    $arguments=@("$PSScriptRoot/relayer.py",'--config',"$Directory/config.json",
        '--directory',$Directory,'--password-file',$passwordFile)
    if($Once){$arguments+='--once'}
    # Keep the local sender alive after a crash; a second instance cannot acquire
    # the Python sender lock and therefore cannot allocate competing nonces.
    do {
        & python @arguments
        if($Once){break}
        Start-Sleep -Seconds 10
    } while($true)
} finally {
    if(Test-Path -LiteralPath $passwordFile){Remove-Item -LiteralPath $passwordFile}
}
