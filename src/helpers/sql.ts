import { mapParams } from "../admin-api/helpers.js";

export function buildConditionsFromFilter(
  filter: Record<string, string[]> | undefined,
  searchFields: string[],
  safeColumn: (name: string) => string,
) {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (key === "q") {
        conditions.push(`( ${searchFields.map((field) => `${safeColumn(field)} LIKE ?`).join(" OR ")} )`);
        params.push(...searchFields.map(() => `%${value}%`));
      } else if (Array.isArray(value)) {
        conditions.push(`${safeColumn(key)} IN (${mapParams(value)})`);
        params.push(...value);
      } else {
        conditions.push(`${safeColumn(key)} = ?`);
        params.push(value);
      }
    }
  }

  return { conditions, params, sql: conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "" };
}

export function buildOrderByFromSort(sort: [string, string] | undefined, safeColumn: (name: string) => string) {
  if (sort) {
    if (sort[1] === "DESC") {
      return ` ORDER BY ${safeColumn(sort[0])} DESC`;
    } else if (sort[1] === "ASC") {
      return ` ORDER BY ${safeColumn(sort[0])} ASC`;
    }
  }
  return "";
}
