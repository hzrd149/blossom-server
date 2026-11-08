import type { Client } from "@libsql/client";
import * as blobs from "../../db/blobs.ts";
import * as reports from "../../db/reports.ts";

/** Main-thread management queries. Deliberately independent of the upload-worker RPC interface. */
export function createManagementDatabase(db: Client) {
  return {
    getBlob: (hash: string) => blobs.getBlob(db, hash),
    getStats: () => blobs.getBlobStats(db),
    listAllBlobs: (options?: Parameters<typeof blobs.listAllBlobs>[1]) => blobs.listAllBlobs(db, options),
    countBlobs: (filter?: Parameters<typeof blobs.countBlobs>[1]) => blobs.countBlobs(db, filter),
    deleteBlob: (hash: string) => blobs.deleteBlob(db, hash),
    listBlobsByPubkeyAdmin: (pubkey: string, options?: Parameters<typeof blobs.listBlobsByPubkeyAdmin>[2]) => blobs.listBlobsByPubkeyAdmin(db, pubkey, options),
    getReport: (id: number) => reports.getReport(db, id),
    deleteReport: (id: number) => reports.deleteReport(db, id),
    deleteReportsByBlob: (hash: string) => reports.deleteReportsByBlob(db, hash),
  };
}

export type ManagementDatabase = ReturnType<typeof createManagementDatabase>;
