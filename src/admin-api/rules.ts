import dayjs from "dayjs";

import { config, saveConfig } from "../config.js";
import router from "./router.js";
import { getExpirationTime } from "../rules/index.js";
import { parseGetListQuery, setContentRange } from "./helpers.js";

// getList / getMany
router.get("/rules", (ctx) => {
  let rules = Array.from(config.storage.rules);
  const { filter, sort, range } = parseGetListQuery(ctx.query);

  if (filter) {
    const fields = Object.entries(filter);
    if (fields.length > 0) {
      rules = rules.filter((rule) =>
        fields.some(([key, value]) => {
          // @ts-expect-error
          if (Array.isArray(value)) return value.includes(rule[key]);
          // @ts-expect-error
          return rule[key] === value;
        }),
      );
    }
  }

  if (sort) {
    const [key, dir] = sort;
    switch (key) {
      case "expiration":
        const now = dayjs().unix();
        rules.sort((a, b) => getExpirationTime(b, now) - getExpirationTime(a, now));
        break;
    }

    if (dir === "ASC") rules.reverse();
  }

  if (range) rules = rules.slice(range[0], range[1]);

  setContentRange(ctx, range, rules);
  ctx.body = rules.map((rule) => ({ ...rule, id: config.storage.rules.indexOf(rule) }));
});

// getOne
router.get("/rules/:id", (ctx) => {
  const id = parseInt(ctx.params.id);
  return config.storage.rules[id];
});

// delete
// router.delete("/rules/:id", (ctx) => {
//   config.storage.rules.filter((r) => r.id !== ctx.params.id);
//   saveConfig();
// });
