# Regenerating the video fixtures

Generated once with `ffmpeg-static@5.3.0` (Task 1) and committed; the tests only
read the bytes, they never spawn ffmpeg. Each command was run from
`src/web/packages/theme-package/test-fixtures/` with
`FF=../../../../node_modules/ffmpeg-static/ffmpeg.exe`.

```sh
# conforming.mp4 — 320x180, High, yuv420p, 30 fps CFR, silent, +faststart, 2 s
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=320x180:rate=30:duration=2 \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  -movflags +faststart conforming.mp4

# long.mp4 — 31.5 s, otherwise conforming
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=320x180:rate=30:duration=31.5 \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  -movflags +faststart long.mp4

# too-long.mp4 — 61.5 s, past the 60 s cap, otherwise conforming
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=320x180:rate=30:duration=61.5 \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  -movflags +faststart too-long.mp4

# wide.mp4 — 5120x180 long edge, over the 4096 cap
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=5120x180:rate=30:duration=1 \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  -movflags +faststart wide.mp4

# odd.mp4 — 641x360; libx264 cannot carry an odd width in 4:2:0, so yuv444p,
# and the lavfi color source rounds to even, so pad after it
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=640x360:rate=30:duration=1 \
  -vf "format=yuv444p,pad=641:360:0:0" \
  -an -c:v libx264 -pix_fmt yuv444p -crf 35 \
  -movflags +faststart odd.mp4

# audio.mp4 — conforming video plus a quiet mono audio track
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=320x180:rate=30:duration=1 \
  -f lavfi -i sine=frequency=440:duration=1 \
  -map 0:v -map 1:a -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  -c:a aac -b:a 16k -ar 8000 -ac 1 -shortest \
  -movflags +faststart audio.mp4

# nofaststart.mp4 — ffmpeg's default puts moov after mdat
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=320x180:rate=30:duration=2 \
  -an -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  nofaststart.mp4

# vfr.mp4 — a 10 fps second followed by a 30 fps second, cadence left alone
"$FF" -hide_banner -nostdin -y \
  -f lavfi -i color=c=0x336699:size=160x90:rate=10:duration=1 \
  -f lavfi -i color=c=0x336699:size=160x90:rate=30:duration=1 \
  -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -an \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 35 \
  -fps_mode passthrough -video_track_timescale 90000 \
  -movflags +faststart vfr.mp4

# chroma422.mp4 — yuv422p (High 4:2:2 profile)
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=320x180:rate=30:duration=1 \
  -an -c:v libx264 -pix_fmt yuv422p -crf 35 \
  -movflags +faststart chroma422.mp4

# other.webm — not an MP4
"$FF" -hide_banner -nostdin -y -f lavfi \
  -i color=c=0x336699:size=160x90:rate=30:duration=1 \
  -an -c:v libvpx -crf 50 -b:v 0 other.webm

# truncated.mp4 — the first 200 bytes of conforming.mp4, cut inside moov
head -c 200 conforming.mp4 > truncated.mp4
```
