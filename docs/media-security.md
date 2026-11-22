# Media processing limits

Untrusted uploads are processed with fixed, process-wide safety budgets:

- At most two `/media` requests from body receipt through optimization and thumbnail creation. Excess requests receive HTTP 503 without queuing.
- At most two concurrent best-effort dimension probes across `/upload`, `/mirror`, and `/media`. When busy or on failure, dimension metadata is omitted.
- Images: at most 40 million pixels and 16,384 pixels per side. Animated GIF processing also limits input to 300 frames and 100 million total pixels. Sharp's
  decoder retains an input-pixel cap and a 30-second processing timeout.
- Video optimization: known duration of at most 10 minutes, the same input dimension/pixel limits, at most 3840×2160 output and 60 FPS, and a 256 MiB output
  limit. Over-limit or unknown-duration media returns HTTP 422.
- Video subprocess deadlines: 10 seconds for probing, five minutes for transcoding, and 30 seconds for thumbnails. Expired subprocesses are killed and reaped.
  Each captured output stream is limited to 64 KiB. Decoder/encoder threads are limited to two and filter threads to one.

FFmpeg runs noninteractively, without inherited stdin. FFmpeg and ffprobe accept only local-file input protocols and a restricted set of self-contained
containers (MP4/MOV, Matroska/WebM, AVI, MPEG-TS, MPEG, Ogg, FLV). Playlists, concat scripts and nested subtitle demuxers are not supported. Ordinary uploads
remain opaque blobs: unsupported or unsafe video probing simply omits dimensions, including when `/media` is disabled.

These are application budgets, not an OS sandbox or a guarantee against native decoder vulnerabilities. Input metadata may lie; a decoder pixel guard, runtime
deadlines and thread limits provide additional protection, but do not impose a hard total-memory limit. Keep Sharp, libvips and the host FFmpeg up to date. Run
the server as an unprivileged user with only its required filesystem permissions, restrict outbound network access, and set container/systemd CPU, memory and
temporary-storage limits. Never give media processors access to unrelated secrets.
