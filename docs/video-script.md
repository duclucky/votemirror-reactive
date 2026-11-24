# Kế hoạch video VoteMirror: quay màn hình thật + voice-over

Trạng thái: đã được người dùng duyệt và thực hiện ngày 24/11/2026. Bản cuối dài
165 giây, quay Chrome thật, có voice-over và phụ đề tiếng Anh. Bằng chứng và kết quả
kiểm tra: [video-evidence.md](video-evidence.md).

Bản công khai: [xem video](https://votemirror-demo.vercel.app/#video) trên frontend
chỉ đọc ở [repo demo riêng](https://github.com/duclucky/votemirror-demo).

## Định dạng

- Dưới 3 phút; mục tiêu 2 phút 45 giây, tối đa 2 phút 55 giây sau dựng.
- Quay trực tiếp cửa sổ Chrome khi click, cuộn, chọn proposal, đồng bộ và mở explorer.
  Không dựng slideshow từ screenshot. Screenshot chỉ dùng kiểm tra chất lượng.
- Mục tiêu MP4 1920×1080, 30 fps, H.264 và AAC 48 kHz. Ghi thử trước khi quay chính.
- Voice-over tiếng Anh, giọng Microsoft en-US-GuyNeural; phụ đề tiếng Anh.
- Không cần nhạc nền. Mục tiêu âm lượng khoảng −16 LUFS, true peak không quá −1 dBTP.
- Điều khiển Chrome bằng browser driver; không dùng Computer Use để thao tác.

## Chuẩn bị bắt buộc

1. Sửa cách frontend diễn giải requestedSupport: contract trả 0/1/2 cho
   Against/For/Abstain, còn giao diện hiện xử lý như 1/2/3. Đọc thêm mirrorRequested
   để phân biệt chưa request với Against; kiểm tra cả ba lựa chọn và chưa request.
2. Kiểm tra chữ ở 1080p, RPC, quỹ/debt hai phía, policy hash khớp và pause tắt.
   Không thay deployment hoặc policy chỉ để tạo hiệu ứng cho video.
3. Chuẩn bị profile Chrome riêng, chỉ quay ứng dụng và explorer. Không ghi tài khoản
   cá nhân, seed, keystore, password file hoặc config/journal của sender.
4. Chuẩn bị proposal mới có tên dễ hiểu và run ID riêng. Hai phiếu được ký bằng script
   dùng encrypted keystore hiện có, ngoài vùng quay. Video ghi rõ:
   “Test ballots submitted via the demo script”. Không mô tả thành ký qua extension.
5. Tạm dừng sender dự phòng khi không có pending để chứng minh đường Reactive.
   Khôi phục sender khi quay xong hoặc khi có lỗi. Giữ Cron như cấu hình hiện tại.
6. Ghi thử màn hình và giọng đọc; kiểm tra độ nét, scroll, chữ, phát âm VoteMirror,
   Reactive, Lasna trước khi ghi bản chính.

## Shot list và voice-over tiếng Anh đề xuất

Thời lượng từng cảnh là mục tiêu dựng, không phải cam kết giao dịch hoàn tất trong
số giây đó. Các đoạn chờ được rút ngắn phải có nhãn “Waiting time shortened”.

### 00:00–00:15 — Nhu cầu

Màn hình: Overview thật, tên VoteMirror và dashboard. Không intro logo dài.

Voice-over:

> DAO members cannot review every proposal. Delegating to one person gives them all
> the discretion. VoteMirror offers a clear policy: mirror a vote only when a chosen
> group agrees.

### 00:15–00:33 — Policy và quyền kiểm soát

Màn hình: click Trusted policy; cho thấy Alice/Bob/Carol, threshold 2/3, voting power
và policy hai mạng. Không đọc hash thành tiếng.

Voice-over:

> This workspace follows Alice, Bob, and Carol, with a two-of-three threshold. The
> holder keeps their tokens and delegates voting power to VoteMirror. The owner can
> pause mirroring, skip a proposal, or vote directly.

### 00:33–01:23 — Một vòng chạy mới được quay thật

Màn hình: Proposals → Live workspace → proposal mới. Gửi phiếu Alice qua script
ngoài vùng quay; Refresh để thấy 1/2 và chưa mirror. Gửi phiếu Bob; theo dõi 2/2,
request Reactive, rồi Mirrored. Ghi nhãn “Fresh testnet run” và chú thích gửi phiếu.

Voice-over:

> Now we are following a fresh proposal on Base Sepolia. Test ballots are submitted
> using the project's encrypted demo wallets. Alice votes For. One ballot is below
> the threshold, so VoteMirror waits. Bob also votes For. Reactive observes the
> Governor's events on Lasna and requests a callback. Back on Base, VoteMirror checks
> the ordered ballot receipts and current policy before casting its vote. The
> Governor now records the mirrored voting power.
> Only trusted addresses count toward the threshold. The holder's voting power is
> used once, while the tokens remain in their own wallet.

### 01:23–01:52 — Kiểm chứng đủ ba chặng

Màn hình: mở transaction nguồn, Lasna và callback Base của chính lượt quay mới;
cuộn thật đến success, địa chỉ và log cần xem. Callout ngắn: “Origin ballot”,
“Reactive request”, “Base callback”.

Voice-over:

> These explorer pages show the proof. The source ballot is on Base Sepolia. Its
> matching Lasna notification carries the same origin transaction hash and log data.
> The destination transaction goes through the callback proxy and records
> VoteMirror's result and the Governor's vote event.

### 01:52–02:22 — Các ca bảo vệ, ghi rõ là lịch sử

Màn hình: Recorded demos cho Split/Skip, rồi mở bảng tám kịch bản trong
[submission-evidence.md](submission-evidence.md) trên GitHub. Nhãn:
“Previously verified testnet scenarios”. Không giả thành các lần chạy mới.

Voice-over:

> Recorded tests cover disagreement, owner skips, paused delivery, retries, and an
> owner voting first. Split choices do not combine into agreement. A skip prevents
> an automated vote. An extra ballot does not create a duplicate vote. The evidence
> index links every tested path to its transactions.

### 02:22–02:45 — Recovery, giới hạn và kết thúc

Màn hình: mở bằng chứng sender đã xác minh rồi về policy/overview. Hiện repo public
và link evidence bằng callout nhỏ trên cảnh quay ứng dụng, không thay bằng slide.

Voice-over:

> A separate recovery sender can restore eligible votes when event delivery is
> unavailable. That path is labeled separately from Reactive callbacks. This is a
> testnet demonstration; delivery depends on network access, fee funding, and the
> voting deadline. VoteMirror: your trusted circle, your voting power, your final say.

## Quy trình sản xuất và kiểm tra

1. Chốt ngôn ngữ/lời đọc; tạo voice-over theo cảnh, nghe và sửa phát âm.
2. Quay các clip Chrome thật. Giữ bản ghi gốc của vòng chạy mới để đối chiếu.
3. Xác minh receipt/log và lưu hash của vòng mới. Chỉ chọn lượt có đủ bằng chứng
   nguồn → Reactive → callback; không dùng kết quả sender để gọi là callback Reactive.
4. Dựng theo lời đọc, cắt thời gian thừa có chú thích, thêm phụ đề và callout ngắn.
   Không sửa giá trị, trạng thái, hash hoặc kết quả giao dịch trong hình.
5. Xem toàn bộ video: chữ rõ, không cảnh trắng/đen, phụ đề không che log/hash,
   lời đọc khớp hành động, âm lượng ổn định, không có dữ liệu bí mật.
6. Dùng ffprobe kiểm tra codec, hình/tiếng, frame rate và tổng thời lượng dưới 180 giây.
   Nghe lại bằng loa/tai nghe; không coi render thành công là đã kiểm tra chất lượng.

## Khi mạng hoặc explorer chậm

- Giữ clip gốc; quay lại hoặc cắt đoạn chờ có nhãn. Không tuyên bố độ trễ cố định.
- Nếu thiếu callback: chẩn đoán và khôi phục sender/trạng thái điều khiển trước khi
  thử lại. Không lấy giao dịch lịch sử giả thành kết quả của proposal mới.
- Explorer không tải được: thử lại sau; nếu phải dùng trình xem log RPC, ghi rõ nguồn.
  Không tạo explorer giả hoặc vượt qua CAPTCHA tự động.
- Không có extension ví: dùng cách ký script đã mô tả. Không nhập khóa riêng vào web.

## Bàn giao

- artifacts/video/votemirror-demo.mp4: video cuối có voice-over và phụ đề.
- artifacts/video/votemirror-demo.en.srt: phụ đề rời.
- artifacts/video/votemirror-voiceover.wav: lời đọc riêng.
- artifacts/video/recordings/: clip quay gốc. Đã thêm ignore;
  không commit video lớn hoặc runtime vào repo.
- Hash của vòng chạy mới trong deployments/ và tài liệu evidence tương ứng.

Đã kiểm tra các khung hình của bản dựng, định dạng, giải mã toàn bộ MP4, nhận dạng
lời đọc theo từng cảnh và mức âm lượng. Chưa nghe đánh giá bằng tai nghe/loa;
nhận dạng giọng nói không thay thế đánh giá phát âm của người xem.
Video đã công khai trên Vercel và repo demo riêng. Chưa upload YouTube hoặc nộp
DoraHacks.
