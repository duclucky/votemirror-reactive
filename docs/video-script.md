# Kịch bản demo VoteMirror v4

Video đề xuất khoảng 2 phút 30 giây, dùng địa chỉ và bằng chứng của deployment v4 trong README.

| Thời lượng | Nội dung |
|---|---|
| 0:00–0:20 | Người dùng chọn 3 voter, ngưỡng 2. Token ở ví người dùng, voting power được delegate cho VoteMirror. |
| 0:20–0:55 | Mở proposal For đã kiểm chứng. Theo dõi hai phiếu nguồn, giao dịch Lasna và callback Base. Mở tổng phiếu để thấy thêm đúng 1.000 VMD của VoteMirror. |
| 0:55–1:15 | Mở proposal Split và Skip. Giải thích chia phía chưa đạt ngưỡng, còn skip do owner quyết định. |
| 1:15–1:50 | Mở bằng chứng sender: CRON tắt, Lasna thiếu phiếu; ví riêng của dịch vụ gửi reconcileProposal trực tiếp lên Base. Kiểm tra sender và sự kiện Mirrored trên explorer. |
| 1:50–2:10 | Cho thấy Task Scheduler chạy, heartbeat caught_up và journal ghi receipt. Trình bày restart và cùng nonce khi gửi lại bằng kết quả test. |
| 2:10–2:30 | Hiện 112 test Solidity, 12 test dịch vụ, các địa chỉ v4 và các giới hạn vận hành chính. |

Bằng chứng nguồn nằm trong deployments/v4-verification.json và
deployments/v4-sender-audit-service-2.json. Không dùng video hoặc giao dịch của các bản
triển khai trước làm bằng chứng cho source hiện hành. Không tuyên bố độ trễ cố định nếu
chưa đo đầy đủ từng vòng.
