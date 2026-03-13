import { ParameterizedContext } from "koa";
import { ParsedUrlQuery } from "querystring";

export type GetListQuery = Partial<{
  sort: [string, string];
  range: [number, number];
  filter: Record<string, any | any[]>;
}>;

export function parseGetListQuery(query: ParsedUrlQuery): GetListQuery {
  const queryStrings = query as Record<string, string>;
  const filter = queryStrings.filter ? (JSON.parse(queryStrings.filter) as GetListQuery["filter"]) : undefined;
  const sort = queryStrings.sort ? (JSON.parse(queryStrings.sort) as GetListQuery["sort"]) : undefined;
  const range = queryStrings.range ? (JSON.parse(queryStrings.range) as GetListQuery["range"]) : undefined;

  return { filter, sort, range };
}
export function setContentRange(
  ctx: ParameterizedContext,
  range: GetListQuery["range"],
  result: Array<any>,
  total?: number,
) {
  if (range) ctx.set("Content-Range", `rules ${range[0]}-${range[1]}/${total ?? result.length}`);
  else ctx.set("Content-Range", `rules */${result.length}`);
}

export const mapParams = (arr: any[]) => arr.map(() => "?").join(", ");
