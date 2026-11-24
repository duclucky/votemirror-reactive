# Dịch vụ gửi giao dịch VoteMirror

VoteMirror vận hành đường gửi dự phòng trên Base Sepolia. Nó đọc proposal và biên nhận
trực tiếp từ Governor, rồi gửi reconcileProposal khi đã đạt đồng thuận mà VoteMirror
chưa vote. Contract kiểm tra lại pause, skip, trạng thái Active, phiếu trước đó và phía
canonical. Ví dịch vụ không có quyền owner.

## Cấu hình đang chạy

- Ví gửi 0x90788662F1b5332979f0049FDeA519fc66d1bdAe, cấp ban đầu 0,005 ETH test.
- Task Windows VoteMirror-Relayer-Testnet tự chạy khi đăng nhập. Supervisor tự chạy lại
  tiến trình Python bị dừng. Python dùng khóa hệ điều hành để giữ một bộ cấp nonce.
- Runtime ở %USERPROFILE%/.codex/votemirror-relayer, gồm config.json, journal.json và
  health.json. Dữ liệu runtime và keystore nằm ngoài Git.
- start-relayer.ps1 nhận Directory và WalletDirectory để dùng đường dẫn riêng.
  WalletDirectory cần keystore relayer và password.dpapi.xml được bảo vệ bằng Windows
  DPAPI, cùng quyền truy cập chỉ dành cho tài khoản chạy dịch vụ.
- Config cần các trường chain, mirror, governor, sender, cast, keystore, rpcs,
  daily_budget_wei, l1_fee_reserve_wei, max_gas, max_price_wei, replacement_seconds,
  confirmations và poll_seconds. Chỉ dùng địa chỉ của deployment mình vận hành.
- Chu kỳ nghỉ hiện tại 5 giây sau mỗi lượt, hai RPC Base Sepolia, kiểm tra chain ID.
  Thời gian quét thực tế phụ thuộc số proposal và độ trễ RPC.
- Reactive theo sự kiện đang bật. CRON định kỳ đang tắt vì phí Lasna lặp cao.
  Quyết định và giao dịch xử lý ở relayer-cron-cost-mitigation.json trong deployments.

## Dựng sender từ một bản clone mới

Cần Windows, PowerShell 7, Python 3 và Foundry `cast` trên PATH. Clone repo cùng
submodule theo README rồi mở PowerShell 7 ở thư mục repo. Dùng tài khoản Windows
sẽ chạy task; DPAPI chỉ giải mã được mật khẩu bằng đúng tài khoản trên máy này.

[relayer.example.json](../service/relayer.example.json) chứa địa chỉ deployment v4
công khai và giới hạn phí hiện hành. `sender` zero và đường dẫn `YOUR_USER` là chỗ
trống bắt buộc thay; không dùng file mẫu nguyên trạng để chạy dịch vụ. Khi dùng
deployment riêng, thay cả chain, mirror và governor theo manifest của deployment đó.

### 1. Chuẩn bị ví dịch vụ và thư mục riêng

Sender cần một ví EVM testnet riêng đã có Base Sepolia ETH để trả phí; ví không cần
quyền owner. Các lệnh dưới nhập ví sẵn có bằng prompt ẩn, không truyền private key
trong tham số. Không dùng ví này cho một sender khác hoặc gửi giao dịch thủ công
song song. Khóa tiến trình chỉ bảo vệ cùng runtime trên một máy.

```powershell
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path '.').Path
$senderDirectory = Join-Path $env:LOCALAPPDATA 'VoteMirror/sender'
$walletDirectory = Join-Path $env:USERPROFILE '.codex/wallets/votemirror-relayer'
$senderUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$senderPwsh = (Get-Command pwsh -ErrorAction Stop).Source
$senderCast = (Get-Command cast -ErrorAction Stop).Source
[void](Get-Command python -ErrorAction Stop)

New-Item -ItemType Directory -Path $senderDirectory, $walletDirectory -Force | Out-Null
$senderKeystore = Join-Path $walletDirectory 'relayer'
$senderPassword = Join-Path $walletDirectory 'password.dpapi.xml'
$senderConfig = Join-Path $senderDirectory 'config.json'
if ((Test-Path -LiteralPath $senderKeystore) -or
    (Test-Path -LiteralPath $senderPassword) -or
    (Test-Path -LiteralPath $senderConfig)) {
    throw 'Profile already exists. Review and reuse it, or choose new directories.'
}
foreach ($privateDirectory in @($senderDirectory, $walletDirectory)) {
    & icacls $privateDirectory /inheritance:r /grant:r "${senderUser}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict directory permissions.' }
}

# Prompt ẩn cho private key và mật khẩu mã hóa keystore.
& $senderCast wallet import relayer --interactive --keystore-dir $walletDirectory
if ($LASTEXITCODE -ne 0) { throw 'Keystore import failed.' }
# Nhập lại đúng mật khẩu keystore, lưu bằng Windows DPAPI.
Read-Host 'Keystore password' -AsSecureString | Export-Clixml -LiteralPath $senderPassword
```

Các thư mục trên nằm ngoài repo. Không commit config thật, keystore, file DPAPI,
health hoặc journal. Không chuyển file DPAPI sang tài khoản/máy khác để dùng lại.
Nếu máy dùng chính sách ACL riêng, kiểm tra quyền hiệu lực với `icacls` trước khi chạy.

### 2. Tạo config thật từ mẫu

Chạy tiếp trong cùng phiên PowerShell. `cast wallet address` đọc keystore qua prompt
mật khẩu và chỉ trả địa chỉ công khai. Giá trị `cast` được lưu thành đường dẫn tuyệt
đối để Task Scheduler tìm đúng executable.

```powershell
$senderAddress = (& $senderCast wallet address --keystore $senderKeystore).Trim()
if ($LASTEXITCODE -ne 0 -or $senderAddress -notmatch '^0x[0-9a-fA-F]{40}$' -or
    $senderAddress -eq '0x0000000000000000000000000000000000000000') {
    throw 'Could not resolve the sender address from the keystore.'
}
$manifest = Get-Content -LiteralPath (Join-Path $repoPath 'deployments/hardened-testnet-v4.json') -Raw | ConvertFrom-Json
if ($senderAddress -eq $manifest.owner) { throw 'Use a dedicated non-owner sender wallet.' }
$config = Get-Content -LiteralPath (Join-Path $repoPath 'service/relayer.example.json') -Raw | ConvertFrom-Json
$config.chain = $manifest.baseSepoliaChainId
$config.mirror = $manifest.voteMirror
$config.governor = $manifest.demoGovernor
$config.sender = $senderAddress
$config.cast = $senderCast
$config.keystore = $senderKeystore
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $senderConfig -Encoding utf8

# Kiểm tra chỉ đọc; không phát giao dịch.
foreach ($rpc in $config.rpcs) {
    $chainId = & $senderCast chain-id --rpc-url $rpc
    if ($LASTEXITCODE -ne 0 -or [long]$chainId -ne $config.chain) { throw 'RPC chain mismatch or unavailable.' }
}
& $senderCast balance $senderAddress --rpc-url $config.rpcs[0]
if ($LASTEXITCODE -ne 0) { throw 'Could not read sender balance.' }
```

Kiểm tra số dư và giới hạn phí trước khi bật. `-Once` của wrapper cũng có thể ký/gửi
giao dịch đủ điều kiện; nó không phải chế độ kiểm tra chỉ đọc.

### 3. Đăng ký Task Scheduler

Task chạy bằng tài khoản đang đăng nhập, không lưu mật khẩu Windows, cửa sổ ẩn và
không có giới hạn chạy 72 giờ mặc định. Chọn tên chưa tồn tại; không ghi đè task đang
vận hành. Thư mục clone và executable cần được giữ tại vị trí đã đăng ký.

```powershell
$senderTaskName = 'VoteMirror-Relayer-MyHost'
if (Get-ScheduledTask -TaskName $senderTaskName -ErrorAction SilentlyContinue) {
    throw 'Task name already exists. Inspect it or choose a unique name.'
}
$senderScript = (Resolve-Path -LiteralPath (Join-Path $repoPath 'service/start-relayer.ps1')).Path
$senderArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -Directory "{1}" -WalletDirectory "{2}"' -f $senderScript, $senderDirectory, $walletDirectory
$senderAction = New-ScheduledTaskAction -Execute $senderPwsh -Argument $senderArguments -WorkingDirectory $repoPath
$senderTrigger = New-ScheduledTaskTrigger -AtLogOn -User $senderUser
$senderPrincipal = New-ScheduledTaskPrincipal -UserId $senderUser -LogonType Interactive -RunLevel Limited
$senderSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([timespan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$senderTask = New-ScheduledTask -Action $senderAction -Trigger $senderTrigger -Principal $senderPrincipal -Settings $senderSettings
Register-ScheduledTask -TaskName $senderTaskName -InputObject $senderTask | Out-Null

# Từ lệnh này sender có thể ký/gửi giao dịch và chi phí testnet theo config.
Start-ScheduledTask -TaskName $senderTaskName
```

### 4. Kiểm tra heartbeat và dừng có kiểm soát

Đợi lượt quét đầu hoàn thành, rồi đọc trạng thái gọn; không cần in toàn bộ journal.
`Running` của task chưa chứng minh Python/RPC khỏe: cần heartbeat mới và trạng thái
`caught_up`, `submitted` hoặc trạng thái xử lý phù hợp. `retrying`, `needs_funding`,
`daily_budget` và `nonce_attention` cần điều tra theo nguyên nhân.

```powershell
$health = Get-Content -LiteralPath (Join-Path $senderDirectory 'health.json') -Raw | ConvertFrom-Json
[pscustomobject]@{
    Task = (Get-ScheduledTask -TaskName $senderTaskName).State.ToString()
    HeartbeatAgeSeconds = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $health.timestamp
    Status = $health.status
    Pending = $health.pending
    ConfirmedTransactions = $health.confirmed_transactions
}
# Khi chủ động dừng, giữ nguyên runtime để lần khởi động sau đối soát đúng nonce.
# Stop-ScheduledTask -TaskName $senderTaskName
```

Máy phải bật, có mạng và tài khoản còn đăng nhập. Task không cung cấp uptime khi
đăng xuất/tắt máy. Khi chuyển máy, không khởi chạy hai sender dùng chung ví cùng lúc;
xử lý mọi giao dịch pending và giữ lịch sử journal trước khi chuyển quyền vận hành.

## Gửi và khôi phục

Journal lưu chain, địa chỉ contract, ví gửi, nonce, calldata, gas, chữ ký và hash trước
broadcast. Mất phản hồi hoặc restart chỉ dẫn đến phát lại cùng giao dịch. Sau 90 giây,
replacement tăng gas price ít nhất 13%, giữ nguyên nonce, đích và calldata. Mọi hash đã
ký vẫn được theo dõi để nhận receipt của bất kỳ phiên bản nào thực sự vào block.

Receipt phải thuộc block canonical và có ít nhất hai block xác nhận. Dịch vụ đọc lại
hasVoted trước khi cập nhật sổ chi phí. Receipt thành công nhưng chưa vote vẫn có thể
thử lại nếu proposal còn đủ điều kiện. Nonce đã tiêu thụ mà chưa tìm thấy receipt báo
nonce_attention, không tự cấp nonce mới mù quáng.

Giới hạn đang dùng là 900.000 gas, gas price 1 gwei, ngân sách dự kiến 0,002 ETH mỗi ngày
UTC và dự phòng phí L1 0,000001 ETH trước mỗi lần ký. Phí ghi sổ gồm gasUsed nhân
effectiveGasPrice cộng l1Fee. Dự phòng L1 là ước lượng, không bảo đảm trần phí dữ liệu
sau khi mạng thay đổi giá. Khi thiếu tiền hoặc chạm giới hạn, health báo needs_funding
hoặc daily_budget và dừng ký thêm.

## Kiểm chứng

12 unit test bao gồm RPC failover, restart sau broadcast mất phản hồi, replacement cùng
nonce, receipt phiên bản cũ, reorg, nonce bất thường, giới hạn phí, L1 fee và lỗi đọc
hasVoted sau receipt. Chạy bằng:

```sh
python -m unittest discover -s service -p test_relayer.py -v
```

Đã thử dừng tiến trình con; supervisor sinh PID mới và tiếp tục journal. Snapshot lịch
sử ở deployments/relayer-runtime-verification.json. Không coi file snapshot là trạng
thái realtime.

Vòng testnet sender tắt CRON và bỏ đăng ký một voter trên Lasna. Khi Base có đủ biên
nhận, ví dịch vụ tự gửi giao dịch, nhận receipt và xác nhận vote. Chứng cứ cuối ở
deployments/v4-sender-audit-service-2.json. Trong lần đó, tại thời điểm đối soát Lasna
chưa có đủ hai phiếu. Sau thử nghiệm đã khôi phục danh sách, đồng bộ policy và tắt lại
CRON theo cấu hình vận hành. Snapshot theo block ở relayer-contract-readiness.json.

## Vận hành

health.json có timestamp epoch, PID, trạng thái, pending và confirmed_transactions.
Kiểm tra heartbeat còn mới, reserve/debt của cả hai contract, số dư ví gửi và các trạng
thái cần xử lý. Giữ một ví ký riêng cho mỗi bộ cấp nonce, không dùng ví này để gửi các
giao dịch ngoài dịch vụ.

Dịch vụ hiện chạy trên máy Windows của người dùng. Máy phải bật, có mạng và đã đăng nhập.
Muốn cam kết liên tục cần host luôn bật, giám sát và quy trình bổ sung phí. Source Python
có khóa trên Linux, còn wrapper DPAPI dành cho Windows và cần thay bằng secret manager
của host khi chuyển môi trường. VoteMirror chịu trách nhiệm gửi và thử lại trong phạm
vi vận hành đó; deadline và tính sẵn sàng của mạng vẫn là giới hạn bên ngoài.
