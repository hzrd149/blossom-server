import { Duplex, Writable } from "stream";

export class SplitStream extends Duplex {
  streams: Writable[];

  constructor(...streams: Writable[]) {
    super();
    this.streams = streams;
  }

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null | undefined) => void): void {
    let failed = false;
    for (const stream of this.streams) {
      const res = stream.write(chunk);
      if (!res) failed = true;
    }
    callback(failed ? new Error("Failed to write to destinations") : null);
  }

  _read() {}
}
