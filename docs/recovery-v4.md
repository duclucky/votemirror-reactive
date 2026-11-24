# Rà soát bảo mật và khôi phục VoteMirror v4

Đối tượng rà soát gồm VoteMirror, MirrorReactive, DemoGovernor, các interface, dependency
đã ghim và script triển khai. Đây là rà soát nội bộ và kiểm chứng testnet, chưa phải
kiểm toán độc lập.

## Các lỗi đã khắc phục

| Vấn đề | Cơ chế hiện hành |
|---|---|
| Callback có thể chọn phía khi nhóm thực tế chia phiếu | Base đọc biên nhận Governor và xác minh phía đầu tiên đạt k |
| Callback cũ còn hiệu lực sau đổi cấu hình | Hash gắn chain, Governor, phiên bản, danh sách theo thứ tự và ngưỡng |
| Lỗi request làm mất phiếu vừa ghi | Bắt lỗi, phục hồi trạng thái request và giữ bằng chứng phiếu |
| Log đến khác thứ tự khóa nhầm phía | Mỗi phía đạt ngưỡng có một yêu cầu; Base kiểm tra thứ tự canonical |
| Gỡ rồi thêm lại voter mang theo phiếu cũ | Base dùng mốc sequence khi thêm, Lasna dùng trust epoch |
| Thiếu log hoặc callback bị bỏ qua lúc pause | Đối soát từ registry Governor; bộ gửi dự phòng tự gửi trực tiếp trên Base |
| Gọi lồng tạo callback trùng | Dành trước trạng thái request, kiểm tra hồi quy bằng system mock |
| Bộ lọc CRON khác log thật | Regression fixture lấy từ Lasna với hai topic |
| RPC lỗi gây tính phí receipt lặp trong sender | Hoàn tất các read trước khi cập nhật accounting và journal |

## Mô hình tin cậy

Governor cung cấp biên nhận bất biến, sequence duy nhất tăng toàn cục trong cùng giao
dịch chấp nhận phiếu. DemoGovernor thực hiện API này. Fractional voting và đổi lá phiếu
không được hỗ trợ. Zero-weight ballot vẫn được tính theo địa chỉ nếu Governor chấp nhận,
đúng quy tắc đếm người hiện tại.

Cấu hình có hiệu lực tại thời điểm thực hiện trên Base. Hai chain cần cùng lịch thao tác
và policyHash. Owner vẫn được vote thủ công, pause hoặc skip. Token nằm trong ví người
ủy quyền. Những người vận hành các ví demo là cùng một bên, không phải nhóm voter độc lập.

## Các đường khôi phục

Luồng sự kiện Reactive là đường thông thường. Bộ gửi của VoteMirror theo dõi Governor
trực tiếp và trả phí gọi reconcileProposal khi chưa có vote. Hàm đối soát không cho
caller chọn phía hoặc vượt qua điều kiện của owner.

CRON recovery vẫn có sẵn và đã được kiểm chứng nhưng đang tắt do phí định kỳ cao.
DemoGovernor giới hạn 32 proposal Pending/Active đồng thời, pruning các mục kết thúc
khi tạo proposal. Batch tối đa hai mục, quay vòng bằng recoveryCursor. CRON khi bật
giới hạn một request mỗi 60 giây và 1.440 request mỗi ngày; đây là giới hạn số lượng,
không phải trần phí token.

## Kiểm chứng

- 112 test Solidity đạt; bốn test fuzz chạy 4.096 lượt mỗi test.
- 12 test sender đạt, bao gồm khôi phục journal, nonce, reorg, RPC và phí L1.
- Test cold gas kiểm tra vote đơn với 417.000 gas và batch hai proposal, mỗi proposal
  16 voter, với 1.000.000 gas trên build optimizer.
- Coverage loại hai test ngân sách gas vì instrumentation tắt optimizer. 110 test đạt;
  MirrorReactive phủ 100% dòng và 96,77% nhánh, VoteMirror phủ 96,48% dòng và 93,55% nhánh.
- Slither đã chạy 102 detector trên 60 contract, trả 33 cảnh báo, không có High. Medium
  còn lại liên quan giá trị zero mặc định, trạng thái cursor sau gọi Governor và phục
  hồi request trong catch. Các đường này được rà theo tính đúng của Solidity rollback,
  quyền gọi batch và Governor tin cậy. Vòng lặp bị chặn ở 16 voter, 32 proposal và hai
  mục mỗi batch.
- Bytecode tạo, constructor và runtime của deployment v4 đã đối chiếu bản build.
  Các source hiện hành có xác minh Sourcify; biên bản ở v4-bytecode-check.json.

Tám vòng testnet gồm For, Against, Skip, Retry, Reconcile, Split, scheduled recovery và
missing-log recovery đã đọc lại receipt và tổng phiếu trong v4-verification.json.
Vòng missing-log cố ý để Lasna thiếu một voter nhưng Base vẫn có đủ hai biên nhận.
Vòng sender riêng tắt CRON và xác minh giao dịch trực tiếp do ví dịch vụ gửi, lưu trong
v4-sender-audit-service-2.json. Không giả định mọi Mirrored trong vòng Retry đều do retry
gây ra nếu đường recovery khác cũng đang bật.

## Giới hạn còn lại

Governor có lỗi hoặc bị nâng cấp sai có thể làm API bằng chứng sai. RPC, relay, funding,
host của sender và deadline vẫn ràng buộc khả năng hoàn thành. Khi quá deadline không
thể khôi phục phiếu cho proposal đó. Callback proxy vẫn có thể tính phí cho callback
không hợp lệ; ứng dụng không thay được cơ chế tính phí này.

Bản hiện hành và cấu hình ở hardened-testnet-v4.json. CRON đã tắt và debt được thanh toán
qua giao dịch ghi trong relayer-cron-cost-mitigation.json. Snapshot readiness theo block
ở relayer-contract-readiness.json. Các file bằng chứng là quan sát lịch sử, không phải
cam kết rằng trạng thái mạng sẽ giữ nguyên về sau.
