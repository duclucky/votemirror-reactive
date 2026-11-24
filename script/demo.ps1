#requires -Version 7
[CmdletBinding()]
param(
    [ValidateSet('for','against','abstain','splitmajority','thirdvote','owneroverride','skip','retry','reconcile','split','recovery','lostlogs','sender')]
    [string]$Mode = 'for',
    [Parameter(Mandatory)][string]$WalletDirectory,
    [string]$Manifest = "$PSScriptRoot/../deployments/hardened-testnet-v4.json",
    [string]$RunId,
    [ValidateSet('complete','proposal','firstvote')][string]$StopAfter='complete',
    [int]$WaitSeconds = 90
)
$ErrorActionPreference='Stop'
if($StopAfter -ne 'complete' -and $Mode -ne 'for'){throw 'Staged recording is supported only for the For scenario.'}
Set-Location "$PSScriptRoot/.."
$baseRpc='https://sepolia.base.org'
$lasnaRpc='https://lasna-rpc.rnk.dev/'


$deployment=Get-Content -Raw $Manifest | ConvertFrom-Json
if (!$RunId) { $RunId=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString() }
if ($RunId -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid run ID' }
$evidencePath="deployments/v4-$Mode-$RunId.json"
$governor=$deployment.demoGovernor
$mirror=$deployment.voteMirror
$reactive=$deployment.mirrorReactive
$support=if($Mode -eq 'against'){0}elseif($Mode -eq 'abstain'){2}else{1}
function Invoke-Cast([string[]]$Arguments) {
    # Read-only RPC retries are safe. Never retry an uncertain broadcast here.
    $attempts=if($Arguments[0] -in @('call','logs','block-number','receipt')){3}else{1}
    for($attempt=1;$attempt -le $attempts;$attempt++){
        $output=& cast @Arguments 2>&1
        if($LASTEXITCODE -eq 0){return ($output -join "`n").Trim()}
        if($attempt -lt $attempts){Start-Sleep -Seconds 2}
    }
    throw ($output -join "`n")
}
$state=if(Test-Path -LiteralPath $evidencePath){
    Get-Content -Raw $evidencePath | ConvertFrom-Json -AsHashtable
}else{
    @{mode=$Mode;runId=$RunId;support=$support;steps=@{};
      initialRecoveryEnabled=((Invoke-Cast @('call',$reactive,'recoveryEnabled()(bool)','--rpc-url',$lasnaRpc)) -eq 'true');
      description="VoteMirror v4 $Mode $RunId";baseFrom=(Invoke-Cast @('block-number','--rpc-url',$baseRpc));
      lasnaFrom=(Invoke-Cast @('block-number','--rpc-url',$lasnaRpc))}
}
function Save-State {
    $state | ConvertTo-Json -Depth 15 | Set-Content -Encoding utf8 "$evidencePath.tmp"
    Move-Item -LiteralPath "$evidencePath.tmp" -Destination $evidencePath -Force
}
Save-State
function Send-Step([string]$Name,[string]$Account,[string]$Rpc,[string[]]$Call) {
    if(!$state.steps.ContainsKey($Name)){
        $signer=@('--keystore',"$walletDirectory/$Account",'--password-file',$passwordFile)
        $sender=Invoke-Cast (@('wallet','address')+$signer)
        $state.steps[$Name]=@{status='sending';nonce=(Invoke-Cast @('nonce',$sender,'--rpc-url',$Rpc));sender=$sender}
        Save-State
        $hash=Invoke-Cast (@('send','--async','--rpc-url',$Rpc)+$signer+$Call)
        if($hash -notmatch '^0x[0-9a-fA-F]{64}$'){throw 'Uncertain transaction hash'}
        $state.steps[$Name].hash=$hash
        $state.steps[$Name].status='pending'
        Save-State
    }
    if(!$state.steps[$Name].hash){throw "Uncertain $Name; inspect recorded nonce"}
    $receipt=Invoke-Cast @('receipt',$state.steps[$Name].hash,'--json','--rpc-url',$Rpc,'--rpc-timeout','180') | ConvertFrom-Json
    if($receipt.status -notin @('0x1',1)){throw "Reverted $Name"}
    $state.steps[$Name].status='confirmed'
    Save-State
    Write-Host "$Name $($state.steps[$Name].hash)"
}
function Find-Events([string]$Signature,[string]$Rpc,[string]$Contract,[long]$From) {
    $last=[long](Invoke-Cast @('block-number','--rpc-url',$Rpc))
    $topic=Invoke-Cast @('to-uint256',[string]$state.proposalId)
    $events=@()
    for($b=$From;$b -le $last;$b+=200){
        $to=[math]::Min($b+199,$last)
        $logs=Invoke-Cast @('logs','--json','--rpc-url',$Rpc,'--address',$Contract,'--from-block',"$b",'--to-block',"$to",$Signature,$topic) | ConvertFrom-Json
        $events+=@($logs)
    }
    return $events
}
function Wait-ForCallback([string]$Signature,[string]$Key) {
    $deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
    do {
        $events=@(Find-Events $Signature $baseRpc $mirror ([long]$state.baseFrom))
        if($events.Count){$state[$Key]=$events;Save-State;return}
        Start-Sleep -Seconds 4
    } while([DateTime]::UtcNow -lt $deadline)
    throw "No $Key callback observed within $WaitSeconds seconds; resume with RunId $RunId"
}
$passwordFile=Join-Path $walletDirectory ('.session-'+[guid]::NewGuid().ToString('N'))
try {
    $credential=[pscredential]::new('local',(Import-Clixml "$walletDirectory/password.dpapi.xml"))
    [IO.File]::WriteAllText($passwordFile,$credential.GetNetworkCredential().Password)
    $basePolicy=Invoke-Cast @('call',$mirror,'policyHash()(bytes32)','--rpc-url',$baseRpc)
    $reactivePolicy=Invoke-Cast @('call',$reactive,'policyHash()(bytes32)','--rpc-url',$lasnaRpc)
    if($basePolicy -ne $reactivePolicy -and !($Mode -in @('lostlogs','sender') -and $state.steps.omitCarol.status -eq 'confirmed')){
        throw 'Policy mismatch'
    }
    $calldata=Invoke-Cast @('calldata','faucet(address)',$governor)
    $descriptionHash=Invoke-Cast @('keccak',$state.description)
    $id=Invoke-Cast @('call',$governor,'hashProposal(address[],uint256[],bytes[],bytes32)(uint256)',"[$($deployment.demoToken)]",'[0]',"[$calldata]",$descriptionHash,'--rpc-url',$baseRpc)
    $state.proposalId=($id -split ' ')[0]
    Save-State
    Send-Step 'propose' 'owner' $baseRpc @($governor,'propose(address[],uint256[],bytes[],string)',"[$($deployment.demoToken)]",'[0]',"[$calldata]",$state.description)
    if($Mode -eq 'skip'){Send-Step 'skip' 'owner' $baseRpc @($mirror,'setSkipped(uint256,bool)',$state.proposalId,'true')}
    if($Mode -in @('retry','reconcile','recovery')){
        Send-Step 'pause' 'owner' $baseRpc @($mirror,'setPaused(bool)','true')
    }
    $activeDeadline=[DateTime]::UtcNow.AddSeconds(30)
    while((Invoke-Cast @('call',$governor,'state(uint256)(uint8)',$state.proposalId,'--rpc-url',$baseRpc)) -ne '1'){
        if([DateTime]::UtcNow -gt $activeDeadline){throw 'Proposal did not become Active'}
        Start-Sleep -Seconds 2
    }
    if($Mode -eq 'owneroverride'){
        Send-Step 'ownerOverride' 'owner' $baseRpc @($mirror,'castVote(uint256,uint8,string)',$state.proposalId,'0','Owner chooses Against before trusted agreement')
    }
    if($StopAfter -eq 'proposal'){
        $state.status='prepared-for-live-recording';Save-State;return
    }
    if($Mode -in @('lostlogs','sender')){
        # Deliberately omit Carol's subscription on Lasna while Base still trusts her.
        Send-Step 'omitCarol' 'owner' $lasnaRpc @($reactive,'removeTrusted(address)',$deployment.trustedVoters[2])
        if($Mode -eq 'sender'){
            Send-Step 'disableRecoveryForSenderProof' 'owner' $lasnaRpc @($reactive,'setRecoveryEnabled(bool)','false')
        }elseif((Invoke-Cast @('call',$reactive,'recoveryEnabled()(bool)','--rpc-url',$lasnaRpc)) -ne 'true'){
            Send-Step 'enableRecovery' 'owner' $lasnaRpc @($reactive,'setRecoveryEnabled(bool)','true')
        }
    }
    Send-Step 'aliceVote' 'alice' $baseRpc @($governor,'castVote(uint256,uint8)',$state.proposalId,"$support")
    if($StopAfter -eq 'firstvote'){
        $state.status='first-ballot-for-live-recording';Save-State;return
    }
    $bobSupport=if($Mode -in @('split','splitmajority')){0}else{$support}
    $secondVoter=if($Mode -in @('lostlogs','sender')){'carol'}else{'bob'}
    Send-Step 'bobVote' $secondVoter $baseRpc @($governor,'castVote(uint256,uint8)',$state.proposalId,"$bobSupport")
    if($Mode -eq 'splitmajority'){
        # Read the negative control before Carol supplies a matching ballot.
        $state.beforeMajority=@{
            block=(Invoke-Cast @('block-number','--rpc-url',$baseRpc));
            hasVoted=(Invoke-Cast @('call',$governor,'hasVoted(uint256,address)(bool)',$state.proposalId,$mirror,'--rpc-url',$baseRpc));
            confirmedSupport=(Invoke-Cast @('call',$mirror,'confirmedSupport(uint256)(bool,uint8)',$state.proposalId,'--rpc-url',$baseRpc))
        }
        if($state.beforeMajority.hasVoted -ne 'false' -or $state.beforeMajority.confirmedSupport -notmatch '^false'){throw 'Split ballots unexpectedly reached consensus'}
        Save-State
        Send-Step 'carolVote' 'carol' $baseRpc @($governor,'castVote(uint256,uint8)',$state.proposalId,"$support")
    }
    if($Mode -eq 'split'){
        Send-Step 'reconcileSplit' 'owner' $baseRpc @($mirror,'reconcileVote(uint256,uint8)',$state.proposalId,'1')
        $state.reconcileEvidence=@(Find-Events 'Skipped(uint256 indexed,uint8,uint8)' $baseRpc $mirror ([long]$state.baseFrom))
    }elseif($Mode -in @('skip','retry','reconcile','recovery','owneroverride')){
        Wait-ForCallback 'Skipped(uint256 indexed,uint8,uint8)' 'initialSkipped'
        if($Mode -in @('retry','reconcile','recovery')){
            if($Mode -eq 'recovery'){
                Send-Step 'enableRecovery' 'owner' $lasnaRpc @($reactive,'setRecoveryEnabled(bool)','true')
            }
            Send-Step 'unpause' 'owner' $baseRpc @($mirror,'setPaused(bool)','false')
            if($Mode -eq 'retry'){
                Send-Step 'retry' 'owner' $lasnaRpc @($reactive,'retryMirror(uint256,uint8)',$state.proposalId,"$support")
            }elseif($Mode -eq 'reconcile'){
                Send-Step 'reconcile' 'owner' $baseRpc @($mirror,'reconcileVote(uint256,uint8)',$state.proposalId,"$support")
            }
            Wait-ForCallback 'Mirrored(uint256 indexed,uint8,uint256)' 'mirrored'
        }
    }else{
        Wait-ForCallback 'Mirrored(uint256 indexed,uint8,uint256)' 'mirrored'
    }
    if($Mode -eq 'thirdvote'){
        Send-Step 'carolVote' 'carol' $baseRpc @($governor,'castVote(uint256,uint8)',$state.proposalId,"$support")
        $deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
        do {
            $recorded=Invoke-Cast @('call',$reactive,'recordedVote(uint256,address)(uint8)',$state.proposalId,$deployment.trustedVoters[2],'--rpc-url',$lasnaRpc)
            if($recorded -eq '2'){break}
            Start-Sleep -Seconds 3
        }while([DateTime]::UtcNow -lt $deadline)
        if($recorded -ne '2'){throw 'Third ballot was not observed by Reactive'}
        $state.thirdVoteObserved=$true
        $state.mirrored=@(Find-Events 'Mirrored(uint256 indexed,uint8,uint256)' $baseRpc $mirror ([long]$state.baseFrom))
        if($state.mirrored.Count -ne 1){throw 'Unexpected mirror count after third ballot'}
    }
    if($Mode -in @('lostlogs','sender')){
        $state.sourceAgreement=Invoke-Cast @('call',$reactive,'agreement(uint256,uint8)(uint256)',$state.proposalId,'1','--rpc-url',$lasnaRpc)
        $state.sourceCarolVote=Invoke-Cast @('call',$reactive,'recordedVote(uint256,address)(uint8)',$state.proposalId,$deployment.trustedVoters[2],'--rpc-url',$lasnaRpc)
        if([int]$state.sourceAgreement -ge 2 -or $state.sourceCarolVote -ne '0'){throw 'Missing-log condition was not reproduced'}
        Save-State
        Send-Step 'restoreCarolSource' 'owner' $lasnaRpc @($reactive,'addTrusted(address)',$deployment.trustedVoters[2])
        Send-Step 'alignRemoveCarolBase' 'owner' $baseRpc @($mirror,'removeTrusted(address)',$deployment.trustedVoters[2])
        Send-Step 'alignAddCarolBase' 'owner' $baseRpc @($mirror,'addTrusted(address)',$deployment.trustedVoters[2])
        $state.restoredBasePolicy=Invoke-Cast @('call',$mirror,'policyHash()(bytes32)','--rpc-url',$baseRpc)
        $state.restoredSourcePolicy=Invoke-Cast @('call',$reactive,'policyHash()(bytes32)','--rpc-url',$lasnaRpc)
        if($state.restoredBasePolicy -ne $state.restoredSourcePolicy){throw 'Policy restore failed'}
        if($Mode -eq 'sender'){
            $recoverySetting=if($state.initialRecoveryEnabled){'true'}else{'false'}
            Send-Step 'restoreRecoveryAfterSenderProof' 'owner' $lasnaRpc @($reactive,'setRecoveryEnabled(bool)',$recoverySetting)
        }
    }
    $state.hasVoted=Invoke-Cast @('call',$governor,'hasVoted(uint256,address)(bool)',$state.proposalId,$mirror,'--rpc-url',$baseRpc)
    $expected=if($Mode -in @('skip','split')){'false'}else{'true'}
    if($state.hasVoted -ne $expected){throw 'Unexpected hasVoted result'}
    $state.proposalVotes=Invoke-Cast @('call',$governor,'proposalVotes(uint256)(uint256,uint256,uint256)',$state.proposalId,'--rpc-url',$baseRpc)
    $state.confirmedSupport=Invoke-Cast @('call',$mirror,'confirmedSupport(uint256)(bool,uint8)',$state.proposalId,'--rpc-url',$baseRpc)
    $state.reactiveEvents=@(Find-Events 'MirrorRequested(uint256 indexed,uint8,uint256)' $lasnaRpc $reactive ([long]$state.lasnaFrom))
    if($Mode -eq 'thirdvote' -and $state.reactiveEvents.Count -ne 1){throw 'Third ballot caused an unexpected callback request'}
    $state.status='verified'
    Save-State
    Write-Host "VERIFIED $Mode $evidencePath"
} finally {
    if(Test-Path -LiteralPath $passwordFile){Remove-Item -LiteralPath $passwordFile}
}
