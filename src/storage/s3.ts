import { Client } from "minio";
import debug from "debug";
import { Readable } from "node:stream";
import mime from "mime";
import path from "node:path";
import { BlobStorage, CachedBlob } from "./interface.js";

export default class S3Storage implements BlobStorage {
  log = debug("cdn:cache:s3");
  client: Client;
  bucket: string;
  publicURL: string | undefined = undefined;

  objects: string[] = [];

  constructor(endpoint: string, accessKey: string, secretKey: string, bucket: string) {
    this.client = new Client({
      endPoint: endpoint,
      accessKey: accessKey,
      secretKey: secretKey,
    });

    this.bucket = bucket;
  }

  async setup() {
    const buckets = await this.client.listBuckets();
    const bucket = buckets.find((b) => b.name === this.bucket);
    if (bucket) this.log("Found bucket", this.bucket);
    else throw new Error("Cant find bucket " + this.bucket);

    await this.loadObjects();
  }

  private loadObjects() {
    return new Promise<void>(async (res) => {
      this.objects = [];
      const stream = await this.client.listObjects(this.bucket);
      stream.on("data", (object) => {
        if (object.name) this.objects.push(object.name);
      });
      stream.on("end", () => res());
    });
  }
  private getObjectName(hash: string, mimeType?: string) {
    const ext = mimeType ? mime.getExtension(mimeType) : null;
    return hash + (ext ? "." + ext : "");
  }

  async hasBlob(hash: string): Promise<boolean> {
    return this.objects.some((name) => name.startsWith(hash));
  }
  async findBlob(hash: string): Promise<CachedBlob | undefined> {
    const object = this.objects.find((name) => name.startsWith(hash));
    if (!object) throw new Error("Missing object " + hash);

    const type = mime.getType(path.extname(object));
    return { hash, mimeType: type ?? undefined };
    // this.client.getObject
  }
  async putBlob(hash: string, stream: Readable, mimeType?: string | undefined): Promise<void> {
    const object = this.getObjectName(hash, mimeType);
    await this.client.putObject(this.bucket, object, stream, {
      "x-amz-acl": "public-read",
      "Content-Type": mimeType,
    });
    this.objects.push(object);
  }
  readBlob(hash: string): Promise<Readable> {
    const object = this.objects.find((name) => name.startsWith(hash));
    if (!object) throw new Error("Missing object " + hash);
    return this.client.getObject(this.bucket, object);
  }
  removeBlob(hash: string): Promise<void> {
    const object = this.objects.find((name) => name.startsWith(hash));
    if (!object) throw new Error("Missing object " + hash);
    this.objects.splice(this.objects.indexOf(object), 1);
    return this.client.removeObject(this.bucket, object);
  }

  getPublicURL(hash: string): string | undefined {
    const object = this.objects.find((name) => name.startsWith(hash));
    if (!object) return;
    return this.publicURL + object;
  }
}
