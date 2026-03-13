export type CommonSearch = {
  hash: string;
  ext?: string;
  type?: string;
};
export type NostrSearch = CommonSearch;
export type TorrentSearch = CommonSearch & {
  infohash?: string;
};
export type BlobSearch = NostrSearch & TorrentSearch;

export type PointerMetadata = {
  pubkey?: string;
  type?: string;
};
export type CommonPointer = {
  hash: string;
  type?: string;
  size: number;
  metadata?: PointerMetadata;
};
export type HTTPPointer = CommonPointer & {
  kind: "http";
  url: string;
};
export type TorrentPointer = CommonPointer & {
  kind: "torrent";
  infohash?: string;
  magnet?: string;
};
export type StoragePointer = CommonPointer & {
  kind: "storage";
};
export type BlobPointer = HTTPPointer | TorrentPointer | StoragePointer;
