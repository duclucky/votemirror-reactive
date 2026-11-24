#requires -Version 7
[CmdletBinding()]
param(
    [switch]$Broadcast,
    [Parameter(Mandatory)][string]$WalletDirectory,
    [string]$Manifest = "$PSScriptRoot/../deployments/hardened-testnet-v4.json",
    [string]$BaseRpc = 'https://sepolia.base.org',
    [string]$LasnaRpc = 'https://lasna-rpc.rnk.dev/'
)
$ErrorActionPreference = 'Stop'
Set-Location "$PSScriptRoot/.."
$proxy = '0x476F44b11F5C942c58f4c8E3d0300E5710743585'
$system = '0x8888888888888888888888888888888888888888'
function Invoke-Cast([string[]]$Arguments) {
    $result = & cast @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`n") }
    return ($result -join "`n").Trim()
}
if ((Invoke-Cast @('chain-id','--rpc-url',$BaseRpc)) -ne '84532') { throw 'Wrong Base chain' }
if ((Invoke-Cast @('chain-id','--rpc-url',$LasnaRpc)) -ne '5318007') { throw 'Wrong Lasna chain' }
$addresses = Get-Content -Raw "$WalletDirectory/addresses.json" | ConvertFrom-Json -AsHashtable
$owner = $addresses.owner
$baseBalance = Invoke-Cast @('balance',$owner,'--rpc-url',$BaseRpc)
$lasnaBalance = Invoke-Cast @('balance',$owner,'--rpc-url',$LasnaRpc)
[pscustomobject]@{Owner=$owner;BaseWei=$baseBalance;LasnaWei=$lasnaBalance;Broadcast=[bool]$Broadcast}
if (!$Broadcast) { return }
if ([bigint]$baseBalance -lt [bigint]'32000000000000000' -or
    [bigint]$lasnaBalance -lt [bigint]'2100000000000000000') { throw 'Insufficient testnet funding' }
foreach ($pair in @(@($BaseRpc,$proxy),@($LasnaRpc,$system))) {
    if ((Invoke-Cast @('code',$pair[1],'--rpc-url',$pair[0])) -eq '0x') { throw 'Missing service contract' }
}
& forge build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$state = if (Test-Path -LiteralPath $Manifest) {
    Get-Content -Raw $Manifest | ConvertFrom-Json -AsHashtable
} else {
    @{contractVersion=4;owner=$owner;trustedVoters=@($addresses.alice,$addresses.bob,$addresses.carol);
      threshold=2;baseSepoliaChainId=84532;lasnaChainId=5318007;callbackProxy=$proxy;steps=@{}}
}
if ($state.owner -ne $owner -or $state.contractVersion -ne 4) { throw 'Manifest belongs to another deployment' }
function Save-State {
    $temporary = "$Manifest.tmp"
    $state | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 $temporary
    Move-Item -LiteralPath $temporary -Destination $Manifest -Force
}
$passwordFile = Join-Path $WalletDirectory ('.session-' + [guid]::NewGuid().ToString('N'))
try {
    $secret = Import-Clixml "$WalletDirectory/password.dpapi.xml"
    $credential = [pscredential]::new('local',$secret)
    [IO.File]::WriteAllText($passwordFile,$credential.GetNetworkCredential().Password)
    $signer = @('--keystore',"$WalletDirectory/owner",'--password-file',$passwordFile)
    # Stop on an uncertain creation rather than deploying a duplicate. Inspect the recorded nonce first.
    function Deploy-Contract([string]$Name,[string]$Rpc,[string]$Contract,[string]$Value,[string[]]$Constructor) {
        if ($state.ContainsKey($Name)) { return $state[$Name] }
        if ($state.steps.ContainsKey($Name)) { throw "Uncertain deployment $Name; inspect recorded nonce before resuming" }
        $state.steps[$Name] = @{nonce=(Invoke-Cast @('nonce',$owner,'--rpc-url',$Rpc));status='creating'}
        Save-State
        $constructorFlags = if ($Constructor.Count) { @('--constructor-args') + $Constructor } else { @() }
        $output = & forge create --broadcast --json --rpc-url $Rpc @signer --value $Value $Contract @constructorFlags 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
        $receipt = ($output -join "`n") | ConvertFrom-Json
        if (!$receipt.deployedTo -or !$receipt.transactionHash) { throw "Incomplete creation result for $Name" }
        $state[$Name] = $receipt.deployedTo
        $state.steps[$Name] = @{hash=$receipt.transactionHash;status='deployed'}
        Save-State
        return $receipt.deployedTo
    }
    function Send-Once([string]$Name,[string]$Rpc,[string[]]$Call) {
        if (!$state.steps.ContainsKey($Name)) {
            $state.steps[$Name] = @{nonce=(Invoke-Cast @('nonce',(Invoke-Cast (@('wallet','address') + $signer)),'--rpc-url',$Rpc));status='submitting'}
            Save-State
            $tx = Invoke-Cast (@('send','--async','--rpc-url',$Rpc) + $signer + $Call)
            if ($tx -notmatch '^0x[0-9a-fA-F]{64}$') { throw "Uncertain send for $Name" }
            $state.steps[$Name] = @{hash=$tx;status='pending'}
            Save-State
        }
        if (!$state.steps[$Name].hash) { throw "Uncertain send $Name; inspect nonce before resuming" }
        $receipt = Invoke-Cast @('receipt',$state.steps[$Name].hash,'--rpc-url',$Rpc,'--json','--rpc-timeout','180') | ConvertFrom-Json
        if ($receipt.status -notin @('0x1',1)) { throw "Transaction reverted for $Name" }
        $state.steps[$Name].status='confirmed'
        Save-State
    }
    $token = Deploy-Contract 'demoToken' $BaseRpc 'src/demo/DemoToken.sol:DemoToken' '0' @()
    $governor = Deploy-Contract 'demoGovernor' $BaseRpc 'src/demo/DemoGovernor.sol:DemoGovernor' '0' @($token,'5','3600')
    $trusted = '[' + ($state.trustedVoters -join ',') + ']'
    $reactive = Deploy-Contract 'mirrorReactive' $LasnaRpc 'src/MirrorReactive.sol:MirrorReactive' '2ether' @('84532',$governor,$trusted,'2')
    $mirror = Deploy-Contract 'voteMirror' $BaseRpc 'src/VoteMirror.sol:VoteMirror' '0.02ether' @($proxy,$reactive,$governor,$owner,$trusted,'2')
    Send-Once 'setMirror' $LasnaRpc @($reactive,'setMirror(address)',$mirror)
    $basePolicy = Invoke-Cast @('call',$mirror,'policyHash()(bytes32)','--rpc-url',$BaseRpc)
    $reactivePolicy = Invoke-Cast @('call',$reactive,'policyHash()(bytes32)','--rpc-url',$LasnaRpc)
    if ($basePolicy -ne $reactivePolicy) { throw 'Policy mismatch; delegation stopped' }
    $state.policyHash=$basePolicy
    Save-State
    Send-Once 'ownerTokens' $BaseRpc @($token,'faucet(address)',$owner)
    Send-Once 'ownerDelegate' $BaseRpc @($token,'delegate(address)',$mirror)
    foreach ($name in @('alice','bob','carol')) {
        $voter=$addresses[$name]
        Send-Once "$name-gas" $BaseRpc @($voter,'--value','0.002ether')
        Send-Once "$name-tokens" $BaseRpc @($token,'faucet(address)',$voter)
        $signer = @('--keystore',"$WalletDirectory/$name",'--password-file',$passwordFile)
        Send-Once "$name-delegate" $BaseRpc @($token,'delegate(address)',$voter)
        $signer = @('--keystore',"$WalletDirectory/owner",'--password-file',$passwordFile)
    }
    if ($state.status -ne 'deployed-and-live-verified') { $state.status='deployed-awaiting-live-demo' }
    Save-State
    $state | ConvertTo-Json -Depth 12
} finally {
    if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile }
}
