export type Nip94Tag = [name: string, value: string, ...rest: string[]];

export interface Nip94Metadata {
  url: string;
  sha256: string;
  size: number;
  type: string;
  tags?: Nip94Tag[] | null;
}

export function nip94Tags(metadata: Nip94Metadata): Nip94Tag[] {
  const tags: Nip94Tag[] = [
    ["url", metadata.url],
    ["m", metadata.type.toLowerCase()],
    ["x", metadata.sha256],
    ["size", String(metadata.size)],
  ];

  if (metadata.tags) tags.push(...metadata.tags);

  return tags;
}

export function optionalNip94Tags(metadata: {
  dim?: string | null;
  originalSha256?: string | null;
  thumbnail?: { url: string; sha256: string } | null;
}): Nip94Tag[] | null {
  const tags: Nip94Tag[] = [];
  if (metadata.originalSha256) tags.push(["ox", metadata.originalSha256]);
  if (metadata.dim) tags.push(["dim", metadata.dim]);
  if (metadata.thumbnail) {
    tags.push(["thumb", metadata.thumbnail.url, metadata.thumbnail.sha256]);
  }
  return tags.length > 0 ? tags : null;
}
