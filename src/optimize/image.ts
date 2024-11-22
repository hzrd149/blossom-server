import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import { newTempFile } from "../storage/upload.js";

export type ImageOptions = {
  quality: number; // 0-100 for images
  progressive: boolean;
  maxWidth: number;
  maxHeight: number;
  outputFormat: "webp" | "jpeg" | "png" | "mp4" | "webm" | "gif";
  maintainAspectRatio: boolean;
  keepExif: boolean;
  fps: number;
};

const defaultOptions: ImageOptions = {
  quality: 90,
  progressive: true,
  maxWidth: 1920,
  maxHeight: 1080,
  outputFormat: "webp",
  maintainAspectRatio: true,
  keepExif: false,
  fps: 30,
};

export async function optimizeImage(inputPath: string, options?: Partial<ImageOptions>): Promise<string> {
  const opts: ImageOptions = { ...defaultOptions, ...options };
  if (opts.quality === 0) opts.quality = 1;

  let sharpInstance = sharp(inputPath);

  const metadata = await sharpInstance.metadata();
  const isLargeImage = (metadata.width || 0) * (metadata.height || 0) > 1024 * 768;
  const useProgressive = opts.progressive && isLargeImage;

  // Handle EXIF data
  if (!opts.keepExif) {
    sharpInstance = sharpInstance.withMetadata({ exif: {} });
  }

  // Resize if needed
  if (opts.maxWidth || opts.maxHeight) {
    sharpInstance = sharpInstance.resize(opts.maxWidth, opts.maxHeight, {
      fit: opts.maintainAspectRatio ? "inside" : "fill",
      withoutEnlargement: true,
    });
  }

  // Set format and quality
  switch (opts.outputFormat) {
    case "jpeg": {
      const outputPath = newTempFile("image/jpeg");
      await sharpInstance.jpeg({ quality: opts.quality, progressive: useProgressive }).toFile(outputPath);
      return outputPath;
    }
    case "png": {
      const outputPath = newTempFile("image/png");
      await sharpInstance.png({ quality: opts.quality, progressive: useProgressive }).toFile(outputPath);
      return outputPath;
    }
    default:
    case "webp": {
      const outputPath = newTempFile("image/webp");
      await sharpInstance.webp({ quality: opts.quality }).toFile(outputPath);
      return outputPath;
    }
  }
}

export async function optimizeGif(inputPath: string, options?: Partial<ImageOptions>): Promise<string> {
  const opts: ImageOptions = { ...defaultOptions, ...options };

  if (opts.outputFormat === "webp") {
    // Convert GIF to animated WebP
    const sharpInstance = sharp(inputPath, { animated: true });

    // Handle EXIF data
    if (!opts.keepExif) {
      sharpInstance.withMetadata({ exif: {} });
    }

    if (opts.maxWidth || opts.maxHeight) {
      sharpInstance.resize(opts.maxWidth, opts.maxHeight, {
        fit: opts.maintainAspectRatio ? "inside" : "fill",
        withoutEnlargement: true,
      });
    }

    const outputPath = newTempFile("image/webp");
    await sharpInstance
      .webp({
        quality: opts.quality,
        force: true,
      })
      .toFile(outputPath);

    return outputPath;
  } else {
    const outputPath = newTempFile("image/gif");

    // Optimize GIF using ffmpeg
    return new Promise<string>((resolve, reject) => {
      ffmpeg(inputPath)
        .fps(opts.fps)
        .size(`${opts.maxWidth}x${opts.maxHeight}`)
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err))
        .run();
    });
  }
}
