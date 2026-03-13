import router from "./router.js";

router.all("/auth", (ctx) => {
  ctx.body = { success: true };
});
