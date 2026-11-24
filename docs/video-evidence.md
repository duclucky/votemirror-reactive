# VoteMirror: bằng chứng cho video demo

Video ngày 24/11/2026 dài **2:45**, 1920×1080, 30 fps, H.264/AAC, có voice-over
và phụ đề tiếng Anh. Kịch bản đã duyệt ở [video-script.md](video-script.md).

## Vòng chạy mới trong video

Run ID: `video-20261124-01`. Proposal:
`28406061311993319165249340124674604467037773408864227618107871060751779118491`.

| Chặng | Giao dịch thật |
| --- | --- |
| Tạo proposal — Base Sepolia | [propose](https://base-sepolia.blockscout.com/tx/0xb4698c5f35f2ef0d4b1ca7e426966dc5ec6e6c64fa15ae6c6b9d08de2f864e5b) |
| Phiếu Alice — Base Sepolia | [castVote](https://base-sepolia.blockscout.com/tx/0x4264c4238c8f5aadfb960cf4268d0a531a397d4f147ed0162184672579b6d449) |
| Phiếu Bob đạt ngưỡng — Base Sepolia | [castVote](https://base-sepolia.blockscout.com/tx/0xc996f86a6f8773ce4afa2dd2a0a5a5ff96d9b935c16c98cab38a28718c6d7998) |
| Nhận sự kiện và yêu cầu callback — Lasna | [Reactive request](https://lasna.reactscan.net/tx/0x9af3bad9bfb1c8f20bfc465badc87ad573456cbfbcadf41f99c2ae2a80b69577) |
| Callback proxy → VoteMirror → Governor — Base Sepolia | [callback và logs](https://base-sepolia.blockscout.com/tx/0xeba01810ae9a5b48d490eb8ad0d27ddaeb8848937f83ad138e68a1c8178c2105) |

Đã đối chiếu hash, block hash, log index, topics và data của nguồn với OriginLogRecord
trong giao dịch Lasna; giải mã payload callback để kiểm tra proxy, recipient,
proposal, support và policy hash. Governor ghi support `1` (For), voting power
`1000 × 10^18`. Xem [bằng chứng máy đọc được](../deployments/video-proof-video-20261124-01.json)
và [trạng thái demo](../deployments/v4-for-video-20261124-01.json).

Sender dự phòng được tạm dừng khi không có pending trong vòng chạy này và đã được
khôi phục sau quay. Kết quả mới là **Reactive callback**, không phải sender recovery.

## Nguồn hình và cách dựng

- Quay viewport Chrome bằng Playwright, `channel: 'chrome'`, cửa sổ hiện thật;
  click, cuộn và đọc RPC thật. Không ghép screenshot thành video hoặc thay dữ liệu.
- Bản ghi liên tục giữ đủ lúc proposal có 0 phiếu, Alice 1/2, Bob đạt 2/2 và kết quả
  Mirrored. Thời gian chờ mạng được cắt, có nhãn **Waiting time shortened**.
- Các cảnh explorer quay bổ sung dùng đúng các hash trên. BaseScan gặp chặn trình
  duyệt nên dùng explorer Blockscout thật. Không vượt CAPTCHA.
- Phiếu ký bằng script và encrypted keystore ngoài vùng quay; có chú thích rõ.
- Split/skip và tám kịch bản an toàn là lịch sử đã xác minh, được gắn nhãn riêng.
  [Bảng bằng chứng tám kịch bản](submission-evidence.md).
- Cảnh recovery dùng [giao dịch sender riêng](https://base-sepolia.blockscout.com/tx/0xba401020d14156ed4b4e2748b4f6d969911aa42691311f5c372290cab2b8cd21).

## File bàn giao cục bộ

Trong `artifacts/video/` (được Git ignore):

- `votemirror-demo.mp4`: bản cuối có voice-over và phụ đề gắn trong hình.
- `votemirror-demo.en.srt`: phụ đề rời.
- `votemirror-voiceover.wav`: lời đọc riêng.
- `recordings/`, các timeline và `edit-decision-list.json`: bản gốc và nguồn các cảnh.
- `qa/`: kết quả kiểm tra codec, khung hình, nhận dạng lời đọc và âm lượng.

Đã giải mã hết file MP4 không lỗi; ffprobe xác nhận 165 giây, 1080p/30 fps,
AAC 48 kHz stereo. Âm lượng bản cuối khoảng −16,07 LUFS, true peak −3,84 dBTP.
Đã kiểm tra khung hình và nhận dạng lời đọc; chưa đánh giá phát âm bằng tai nghe/loa.
Chưa tải video lên dịch vụ công khai hoặc nộp cuộc thi.
