import { checkAnimation, checkDimensions, MAX_ANIMATION_PIXELS, MAX_INPUT_PIXELS } from "./limits.ts";

/** Inspect headers before decoding and keep the same pixel cap on the decoder. */
export async function openImage(inputPath: string, animated = false) {
  const { default: sharp } = await import("sharp");
  const metadata = await sharp(inputPath, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  checkDimensions(width, height);
  if (animated) checkAnimation(width, height, metadata.pages ?? 1);
  return sharp(inputPath, {
    animated,
    limitInputPixels: animated ? MAX_ANIMATION_PIXELS : MAX_INPUT_PIXELS,
  }).timeout({ seconds: 30 });
}
