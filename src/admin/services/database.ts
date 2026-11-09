import type { Client } from "@libsql/client";
import * as blobs from "../../db/blobs.ts";
import * as reports from "../../db/reports.ts";
import * as admin from "../../db/admin.ts";

/** Main-thread management queries. Deliberately independent of the upload-worker RPC interface. */
export function createManagementDatabase(db: Client) {
  return {
    listAdminReports: (query: Parameters<typeof admin.listAdminReports>[1]) => admin.listAdminReports(db, query),
    listUsers: (query: Parameters<typeof admin.listUsers>[1]) => admin.listUsers(db, query),
    getUser: (pubkey: string) => admin.getUser(db, pubkey),
    listUserBlobs: (pubkey: string, query: Parameters<typeof admin.listUserBlobs>[2]) => admin.listUserBlobs(db, pubkey, query),
    listUserReports: (pubkey: string, query: Parameters<typeof admin.listUserReports>[2]) => admin.listUserReports(db, pubkey, query),
    getBlob: (hash: string) => blobs.getBlob(db, hash),
    getStats: () => blobs.getBlobStats(db),
    listAllBlobs: (options?: Parameters<typeof blobs.listAllBlobs>[1]) => blobs.listAllBlobs(db, options),
    countBlobs: (filter?: Parameters<typeof blobs.countBlobs>[1]) => blobs.countBlobs(db, filter),
    deleteBlob: (hash: string) => blobs.deleteBlob(db, hash),
    listBlobsByPubkeyAdmin: (pubkey: string, options?: Parameters<typeof blobs.listBlobsByPubkeyAdmin>[2]) => blobs.listBlobsByPubkeyAdmin(db, pubkey, options),
    getBlobRelations: (hash: string) => admin.getBlobRelations(db, hash),
    getAdminCounts: () => admin.getAdminCounts(db),
    listReports: (options?: Parameters<typeof reports.listAllReports>[1]) => reports.listAllReports(db, options),
    getReport: (id: number) => reports.getReport(db, id),
    deleteReport: (id: number) => reports.deleteReport(db, id),
    deleteReportsByBlob: (hash: string) => reports.deleteReportsByBlob(db, hash),
  };
}

export type ManagementDatabase = ReturnType<typeof createManagementDatabase>;
