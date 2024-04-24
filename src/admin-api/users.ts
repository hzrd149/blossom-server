import db from "../db/db.js";
import { buildConditionsFromFilter, buildOrderByFromSort } from "../helpers/sql.js";
import { getUserProfile } from "../user-profiles.js";
import { parseGetListQuery, setContentRange } from "./helpers.js";
import router from "./router.js";

function mapRowToUser(row: any) {
  return {
    ...row,
    id: row.pubkey,
    profile: getUserProfile(row.pubkey),
    blobs: row.blobs.split(","),
  };
}
function safeColumn(name: string) {
  if (["pubkey"].includes(name)) return name;
  throw new Error("Invalid table name");
}

const baseSql = `SELECT owners.pubkey, group_concat(owners.blob, ',') as blobs FROM owners`;
const groupBySql = " GROUP BY owners.pubkey";

// getList / getMany
router.get("/users", (ctx) => {
  const { filter, sort, range } = parseGetListQuery(ctx.query);

  let sql = baseSql;
  let params: string[] = [];

  const conditions = buildConditionsFromFilter(filter, ["name", "pubkey"], safeColumn);

  sql += conditions.sql;
  params.push(...conditions.params);

  sql += groupBySql;

  sql += buildOrderByFromSort(sort, safeColumn);

  const total = db
    .prepare("SELECT owners.pubkey FROM owners" + conditions.sql + groupBySql)
    .all(conditions.params).length;
  const users = db.prepare(sql).all(...params) as any[];

  setContentRange(ctx, range, users, total);
  ctx.body = users.map(mapRowToUser);
});
