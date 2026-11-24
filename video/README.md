# Demo video for the post-review deployment (work in progress)

Paused on 2026-11-24 before the final render. Nothing here is the finished video.

## State

- `narration.py`: final captions and spoken text for eight scenes (intro, architecture, For, Against, Skip, Retry, tests, outro).
- `audio/voice.flac`: the voice-over take generated from it (149.5 s, Piper `en_US-ryan-high`). This take was transcribed and checked end to end; Piper is not deterministic, so re-running `tts.py` gives a new take that has to be listened to again. `timeline.json` matches this take.
- `page.html`: the animated scenes, already updated for the four loops and the new addresses.
- `*.log`, `verify.json`: terminal text shown in the video, produced by `verify.py`, which re-reads every address and hash in `README.md` and `deployments/testnet.json` from Base Sepolia and Reactive Lasna (read-only).
- `ex_*.png`: explorer screenshots of the new transactions, taken with `shot.py`.
- Not done: the full frame render, the mux, and the watch-and-listen pass on the finished file.
- The status page (https://duclucky.github.io/votemirror-reactive/) returned 404 when checked, so it is not in the video.

## Finish it

Needs Python with `piper-tts`, `numpy`, `playwright`, a Chrome reachable over CDP on `localhost:29229`, `cast` and `ffmpeg`.

```sh
cd video
python verify.py                 # must end with ALL OK
ffmpeg -i audio/voice.flac audio/voice.wav
python build.py                  # writes video.html
python render.py frames          # 30 fps JPEG frames
ffmpeg -framerate 30 -i frames/f%05d.jpg -i audio/voice.wav \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -shortest votemirror-demo.mp4
```

Then watch and listen to the whole file before using it.
