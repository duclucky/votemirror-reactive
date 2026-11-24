#requires -Version 7
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WalletDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9-]+$')][string]$RunId,
    [string[]]$Modes=@('for','against','abstain','splitmajority','skip','retry','thirdvote','owneroverride'),
    [hashtable]$ModeRunIds=@{}
)
$ErrorActionPreference='Stop'
Set-Location "$PSScriptRoot/.."
$deployment=Get-Content deployments/hardened-testnet-v4.json -Raw|ConvertFrom-Json
$reportPath="deployments/evidence-suite-$RunId.json"
$runtime=Join-Path $env:USERPROFILE '.codex/votemirror-relayer'
$taskName='VoteMirror-Relayer-Testnet'
$task=Get-ScheduledTask -TaskName $taskName
$initialTaskRunning=$task.State -eq 'Running'
$baseRpc='https://sepolia.base.org'
function Read-Paused {
    $answer=& cast call $deployment.voteMirror 'paused()(bool)' --rpc-url $baseRpc
    if($LASTEXITCODE){throw 'Could not read pause control'}
    return $answer.Trim()
}
function Save-Report {
    $report|ConvertTo-Json -Depth 15|Set-Content -Encoding utf8 "$reportPath.tmp"
    Move-Item -LiteralPath "$reportPath.tmp" -Destination $reportPath -Force
}
$initialPaused=Read-Paused
if($initialPaused -ne 'false'){throw 'Mirror is already paused. Preserve the existing operating decision.'}
$report=if(Test-Path -LiteralPath $reportPath){Get-Content $reportPath -Raw|ConvertFrom-Json -AsHashtable}else{
    @{runId=$RunId;startedAt=[DateTimeOffset]::UtcNow.ToString('o');initialTaskRunning=$initialTaskRunning;
      initialPaused=$initialPaused;status='running';scenarios=@{};deployment='deployments/hardened-testnet-v4.json'}
}
$report.status='running'
$report.Remove('error')
Save-Report
$senderStopped=$false
try {
    $journal=Get-Content (Join-Path $runtime 'journal.json') -Raw|ConvertFrom-Json
    if($null -ne $journal.pending){throw 'Recovery sender has a pending transaction; do not interrupt it.'}
    if($initialTaskRunning){
        Stop-ScheduledTask -TaskName $taskName
        $senderStopped=$true
        Start-Sleep -Seconds 2
        $remaining=@(Get-CimInstance Win32_Process -Filter "Name='python.exe'"|Where-Object CommandLine -Like '*votemirror-relayer*')
        if($remaining.Count){throw 'Sender process remains active; stop and verify before collecting Reactive-only proof.'}
        $journal=Get-Content (Join-Path $runtime 'journal.json') -Raw|ConvertFrom-Json
        if($null -ne $journal.pending){throw 'A sender transaction appeared while stopping; resume its journal first.'}
    }
    $report.recoverySenderStoppedForProof=$senderStopped
    Save-Report
    foreach($mode in $Modes){
        if($report.scenarios[$mode].status -eq 'verified'){continue}
        $caseRunId=if($ModeRunIds.ContainsKey($mode)){$ModeRunIds[$mode]}else{$RunId}
        Write-Host "SCENARIO $mode"
        & "$PSScriptRoot/demo.ps1" -WalletDirectory $WalletDirectory -Mode $mode -RunId $caseRunId -WaitSeconds 180
        $report.scenarios[$mode]=@{status='verified';evidence="deployments/v4-$mode-$caseRunId.json";finishedAt=[DateTimeOffset]::UtcNow.ToString('o')}
        Save-Report
    }
    $report.status='executed-awaiting-independent-verification'
} catch {
    $report.status='interrupted'
    $report.error=$_.Exception.Message
    throw
} finally {
    try {
        if((Read-Paused) -ne $initialPaused){
            $passwordFile=Join-Path $WalletDirectory ('.session-'+[guid]::NewGuid().ToString('N'))
            try {
                $credential=[pscredential]::new('local',(Import-Clixml (Join-Path $WalletDirectory 'password.dpapi.xml')))
                [IO.File]::WriteAllText($passwordFile,$credential.GetNetworkCredential().Password)
                $hash=& cast send --async --keystore (Join-Path $WalletDirectory 'owner') --password-file $passwordFile --rpc-url $baseRpc $deployment.voteMirror 'setPaused(bool)' $initialPaused
                if($LASTEXITCODE -or $hash -notmatch '^0x[0-9a-fA-F]{64}$'){throw 'Could not restore pause state'}
                $receipt=& cast receipt $hash --json --rpc-url $baseRpc|ConvertFrom-Json
                if($LASTEXITCODE -or $receipt.status -ne '0x1'){throw 'Pause restoration failed'}
                $report.restorePauseTx=$hash.Trim()
            } finally {if(Test-Path -LiteralPath $passwordFile){Remove-Item -LiteralPath $passwordFile}}
        }
    } finally {
        if($senderStopped){Start-ScheduledTask -TaskName $taskName}
        $report.finishedAt=[DateTimeOffset]::UtcNow.ToString('o')
        $report.finalPaused=Read-Paused
        $report.senderTaskState=(Get-ScheduledTask -TaskName $taskName).State.ToString()
        Save-Report
    }
}
