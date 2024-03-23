import { Readable } from "node:stream";

export type CachedBlob = {
  hash: string;
  type?: string;
};

export interface BlobStorage {
  setup(): Promise<void>;
  hasBlob(hash: string): Promise<boolean>;
  findBlob(hash: string): Promise<CachedBlob | undefined>;
  putBlob(hash: string, stream: Readable, mimeType?: string): Promise<void>;
  readBlob(hash: string): Promise<Readable>;
  removeBlob(hash: string): Promise<void>;
  getPublicURL(hash: string): string | undefined;
}
