import pfs from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import mime from "mime";
import { nanoid } from "nanoid";
import fs from "node:fs";

import { ImageOptions, optimizeGif, optimizeImage } from "./image.js";
import { optimizeVideo, VideoOptions } from "./video.js";
import logger from "../logger.js";

const log = logger.extend("optimize");

export async function optimizeMedia(
  inputPath: string,
  options: { video?: Partial<VideoOptions>; image?: Partial<ImageOptions> } = {},
): Promise<string> {
  let outputPath: string | undefined = undefined;
  try {
    const id = nanoid(8);
    let type = mime.getType(inputPath) ?? undefined;
    const inSize = fs.statSync(inputPath).size;

    if (!type) {
      // Detect file type
      const fileBuffer = await pfs.readFile(inputPath);
      type = (await fileTypeFromBuffer(fileBuffer))?.mime;
    }

    if (!type) {
      throw new Error("Could not determine file type");
    }

    const start = Date.now();
    log(`Optimizing ${type} ${id}`);

    // Handle different media types
    if (["image/jpeg", "image/png", "image/webp"].includes(type)) {
      outputPath = await optimizeImage(inputPath, options.image);
    } else if (type === "image/gif") {
      outputPath = await optimizeGif(inputPath, options.image);
    } else if (type.startsWith("video/")) {
      outputPath = await optimizeVideo(inputPath, options.video);
    } else {
      throw new Error("Unsupported file type");
    }

    const outSize = fs.statSync(outputPath!).size;

    const delta = Date.now() - start;
    log(
      `Finished ${type} ${id} reduced ${inSize} -> ${outSize} ${Math.round((1 - outSize / inSize) * 100)}% ${delta}ms`,
    );

    return outputPath!;
  } catch (error) {
    // cleanup the output
    try {
      if (outputPath) await pfs.rm(outputPath);
    } catch (error) {}

    if (error instanceof Error) throw new Error(`Optimization failed: ${error.message}`);
    else throw error;
  }
}
