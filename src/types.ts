export type CommonSearch = {
  hash: string;
  ext?: string;
};
export type NostrSearch = CommonSearch & {
  pubkey?: string;
};
export type TorrentSearch = CommonSearch & {
  infohash?: string;
};
export type BlobSearch = NostrSearch & TorrentSearch;

export type PointerMetadata = {
  pubkey?: string;
  mimeType?: string;
};
export type CommonPointer = {
  hash: string;
  mimeType?: string;
  metadata?: PointerMetadata;
};
export type HTTPPointer = CommonPointer & {
  type: "http";
  url: string;
};
export type TorrentPointer = CommonPointer & {
  type: "torrent";
  infohash?: string;
  magnet?: string;
};
export type FilePointer = CommonPointer & {
  type: "file";
  pathname: string;
  name: string;
  ext: string;
};
export type BlobPointer = HTTPPointer | TorrentPointer | FilePointer;
