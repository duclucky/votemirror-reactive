# Kịch bản demo VoteMirror v4

Video đề xuất khoảng 2 phút 30 giây, dùng địa chỉ và bằng chứng của deployment v4 trong README.

Dùng frontend trong `web/` ở độ rộng desktop. Mở tab Proposals để tập trung vào
quá trình đồng thuận và timeline giao dịch. Chờ nhãn `Receipts rechecked` trước khi
trình bày bằng chứng. `Recorded demos` là giao dịch lịch sử đã kiểm chứng;
`Live workspace` mới là nơi theo dõi một lần chạy mới. Không gọi việc chuyển
giữa các bản ghi là thực thi giao dịch mới. Xem `web/README.md` để chạy frontend.

| Thời lượng | Nội dung |
|---|---|
| 0:00–0:20 | Người dùng chọn 3 voter, ngưỡng 2. Token ở ví người dùng, voting power được delegate cho VoteMirror. |
| 0:20–0:55 | Trong Recorded demos chọn A shared conviction. Theo dõi Alice, Bob, ngưỡng 2, request Lasna và callback Base. Mở explorer để xác minh VoteMirror đóng góp 1.000 VMD. |
| 0:55–1:15 | Mở proposal Split và Skip. Giải thích chia phía chưa đạt ngưỡng, còn skip do owner quyết định. |
| 1:15–1:50 | Mở bằng chứng sender: CRON tắt, Lasna thiếu phiếu; ví riêng của dịch vụ gửi reconcileProposal trực tiếp lên Base. Kiểm tra sender và sự kiện Mirrored trên explorer. |
| 1:50–2:10 | Mở Trusted policy để thấy policy hash Base/Lasna và trạng thái Cron hiện tại. Nếu trình bày uptime sender, kiểm tra heartbeat tại thời điểm quay; frontend không đo uptime này. |
| 2:10–2:30 | Hiện 112 test Solidity, 12 test dịch vụ, các địa chỉ v4 và các giới hạn vận hành chính. |

Bằng chứng nguồn nằm trong deployments/v4-verification.json và
deployments/v4-sender-audit-service-2.json. Không dùng video hoặc giao dịch của các bản
triển khai trước làm bằng chứng cho source hiện hành. Không tuyên bố độ trễ cố định nếu
chưa đo đầy đủ từng vòng.
