/**
 * Process-wide, no-queue budgets. Upload workers only bound receipt of bytes,
 * not the native work that follows. Metadata probes have a separate small budget
 * so ordinary uploads cannot spawn unlimited ffprobe processes.
 */
export class ProcessingGate {
  private active = 0;
  constructor(private readonly capacity: number) {}

  tryAcquire(): (() => void) | null {
    if (this.active >= this.capacity) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }

  get available(): boolean {
    return this.active < this.capacity;
  }
}

export const mediaGate = new ProcessingGate(2);
export const metadataGate = new ProcessingGate(2);
export const MAX_INPUT_PIXELS = 40_000_000;
export const MAX_INPUT_DIMENSION = 16_384;
export const MAX_ANIMATION_FRAMES = 300;
export const MAX_ANIMATION_PIXELS = 100_000_000;
export const MAX_VIDEO_SECONDS = 600;
export const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export function checkDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width <= 0 || height <= 0 || width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION ||
    width * height > MAX_INPUT_PIXELS
  ) {
    throw new Error("Media exceeds input dimension or pixel limits");
  }
}

export function checkAnimation(width: number, height: number, frames: number): void {
  checkDimensions(width, height);
  if (
    !Number.isSafeInteger(frames) || frames < 1 || frames > MAX_ANIMATION_FRAMES ||
    width * height * frames > MAX_ANIMATION_PIXELS
  ) {
    throw new Error("Media exceeds animation frame or total pixel limits");
  }
}
