import debug from "debug";

if (!process.env.DEBUG) debug.enable("blossom-server, blossom-server:*");

const logger = debug("blossom-server");

export default logger;
