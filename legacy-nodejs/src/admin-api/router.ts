import Router from "@koa/router";
import { HttpError } from "koa";
const router = new Router();

router.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    if (err instanceof HttpError && 401 == err.status) {
      ctx.status = 401;
      ctx.set("WWW-Authenticate", "Basic");
      ctx.body = "cant haz that";
    } else {
      throw err;
    }
  }
});

export default router;
