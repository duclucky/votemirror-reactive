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
