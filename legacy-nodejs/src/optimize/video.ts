import ffmpeg from "fluent-ffmpeg";
import mime from "mime";
import logger from "../logger.js";
import { newTempFile } from "../storage/upload.js";

const log = logger.extend("optimize:video");

export type VideoOptions = {
  quality: number; // 0-100 video (higher is better for video)
  maxHeight: number;
  maxFps: number;
  format: "mp4" | "webm" | "mkv";
  videoCodec?: "libx264" | "libx265" | "vp8" | "vp9";
  audioCodec?: "aac" | "mp3" | "vorbis" | "opus";
  keepAspectRatio: boolean;
};

const defaultOptions: VideoOptions = {
  quality: 90,
  maxHeight: 1080,
  maxFps: 30,
  format: "mp4",
  keepAspectRatio: true,
};

// Codec configurations
const codecConfigs = {
  libx264: {
    qualityRange: { min: 0, max: 51 },
    supportedContainers: ["mp4", "mkv", "mov", "avi"],
  },
  libx265: {
    qualityRange: { min: 0, max: 51 },
    supportedContainers: ["mp4", "mkv", "mov"],
  },
  vp8: {
    qualityRange: { min: 4, max: 63 },
    supportedContainers: ["webm", "mkv"],
  },
  vp9: {
    qualityRange: { min: 0, max: 63 },
    supportedContainers: ["webm", "mkv"],
  },
} as const;

// Format configurations
const formatConfigs = {
  mp4: {
    defaultVideoCodec: "libx264",
    defaultAudioCodec: "aac",
    extension: "mp4",
    options: ["-movflags", "+faststart"],
  },
  webm: {
    defaultVideoCodec: "vp9", // WebM typically uses VP8/VP9
    defaultAudioCodec: "opus",
    extension: "webm",
    options: [],
  },
  mkv: {
    defaultVideoCodec: "libx264",
    defaultAudioCodec: "aac",
    extension: "mkv",
    options: [],
  },
} as const;

// Helper function to convert 0-100 quality to CRF (0-51)
function qualityToCRF(quality: number, codec: keyof typeof codecConfigs): number {
  // Convert 0-100 scale to 51-0 scale (inverse)
  // 100 quality = 0 CRF (best)
  // 0 quality = 51 CRF (worst)
  const config = codecConfigs[codec];
  const { min, max } = config.qualityRange;
  return Math.round(max - (quality / 100) * (max - min));
}

export async function optimizeVideo(inputPath: string, options?: Partial<VideoOptions>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const opts: VideoOptions = { ...defaultOptions, ...options };

    // Set default format if not specified
    const format: keyof typeof formatConfigs = opts.format;
    const formatConfig = formatConfigs[format];

    // Determine codecs based on format and user preferences
    const videoCodec = opts.videoCodec || formatConfig.defaultVideoCodec;
    const audioCodec = opts.audioCodec || formatConfig.defaultAudioCodec;

    // Verify codec and container compatibility
    if (!codecConfigs[videoCodec].supportedContainers.includes(format as "mkv")) {
      reject(new Error(`Codec ${videoCodec} is not supported in ${format} container`));
      return;
    }

    const codecConfig = codecConfigs[videoCodec];
    const crf = qualityToCRF(opts.quality, videoCodec);

    // First get video metadata to check original FPS
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      // Get original video stream
      const videoStream = metadata.streams.find((stream) => stream.codec_type === "video");

      // Parse original FPS
      let originalFps = 30; // default fallback
      if (videoStream && videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split("/");
        originalFps = Math.round(parseInt(num) / parseInt(den));
      }

      // Use the lower value between original FPS and maxFps
      const targetFps = opts.maxFps ? Math.min(originalFps, opts.maxFps) : originalFps;

      const outputPath = newTempFile(mime.getType(formatConfig.extension) ?? undefined);

      const command = ffmpeg(inputPath)
        .videoCodec(videoCodec)
        .audioCodec(audioCodec)
        .size(`?x${opts.maxHeight}`)
        .fps(targetFps)
        .addOption("-crf", crf.toString())
        .addOption("-preset", "fast")
        .addOption("-movflags", "+faststart");

      // Add audio options based on codec
      switch (audioCodec) {
        case "aac":
          command.addOption("-b:a", "128k");
          break;
        case "opus":
          command.addOption("-b:a", "96k");
          break;
        case "vorbis":
          command.addOption("-q:a", "4");
          break;
      }

      command
        .on("progress", (progress) => {
          log(`Processing ${progress.percent?.toFixed(2)}%`);
        })
        .on("end", () => {
          log(`Finished ${inputPath}`);
          resolve(outputPath);
        })
        .on("error", (err) => {
          console.error("Error:", err);
          reject(err);
        })
        .save(outputPath);
    });
  });
}
