import { lilconfig } from "lilconfig";
import yaml from "yaml";
import fs from "node:fs";
import { generate } from "generate-password";
import { S3StorageOptions } from "blossom-server-sdk";

import logger from "./logger.js";
import { mergeDeep } from "./helpers/object.js";
import { VideoOptions } from "./optimize/video.js";
import { ImageOptions } from "./optimize/image.js";

const log = logger.extend("config");

export type Rule = { id: string; type: string; pubkeys?: string[]; expiration: string };
export type Config = {
  publicDomain: string;
  databasePath: string;
  storage: {
    backend: "local" | "s3";
    removeWhenNoOwners: boolean;
    local?: {
      dir: string;
    };
    s3?: {
      endpoint: string;
      accessKey: string;
      secretKey: string;
      bucket: string;
      publicURL?: string;
    } & S3StorageOptions;
    rules: Rule[];
  };
  dashboard: {
    enabled: boolean;
    username: string;
    password?: string;
  };
  discovery: {
    nostr: {
      enabled: boolean;
      relays: string[];
    };
    upstream: {
      enabled: boolean;
      domains: string[];
    };
  };
  upload: {
    enabled: boolean;
    requireAuth: boolean;
    requirePubkeyInRule: boolean;
  };
  media: {
    enabled: boolean;
    requireAuth: boolean;
    requirePubkeyInRule: boolean;
    video?: VideoOptions;
    image?: ImageOptions;
  };
  list: {
    requireAuth: boolean;
    allowListOthers: boolean;
  };
  tor: {
    enabled: boolean;
    proxy: string;
  };
};

function loadYaml(filepath: string, content: string) {
  return yaml.parse(content);
}
function loadJson(filepath: string, content: string) {
  return JSON.parse(content);
}

const defaultConfig: Config = {
  publicDomain: "",
  databasePath: "data/sqlite.db",
  dashboard: { enabled: false, username: "admin" },
  discovery: {
    nostr: { enabled: false, relays: [] },
    upstream: { enabled: false, domains: [] },
  },
  storage: {
    backend: "local",
    removeWhenNoOwners: false,
    local: { dir: "data/blobs" },
    rules: [],
  },
  upload: { enabled: false, requireAuth: true, requirePubkeyInRule: false },
  media: { enabled: false, requireAuth: true, requirePubkeyInRule: false },
  list: { requireAuth: false, allowListOthers: false },
  tor: { enabled: false, proxy: "" },
};

const searchPlaces = ["config.yaml", "config.yml", "config.json"];
if (process.env.BLOSSOM_CONFIG) searchPlaces.unshift(process.env.BLOSSOM_CONFIG);

const result = await lilconfig("blossom", {
  searchPlaces,
  loaders: {
    ".yaml": loadYaml,
    ".yml": loadYaml,
    ".json": loadJson,
  },
}).search();

if (result) logger(`Found config at ${result.filepath}`);

const config = mergeDeep(defaultConfig, result?.config ?? {}) as Config;

function saveConfig() {
  if (result) {
    if (result.filepath.includes(".json")) {
      fs.writeFileSync(result.filepath, JSON.stringify(config), { encoding: "utf-8" });
    } else {
      fs.writeFileSync(result.filepath, yaml.stringify(config), { encoding: "utf-8" });
    }
    log("Saved config file", result.filepath);
  } else {
    fs.writeFileSync("config.yml", yaml.stringify(config), { encoding: "utf-8" });
    log("Saved config file config.yml");
  }
}

export { config, saveConfig };
