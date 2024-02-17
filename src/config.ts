import { lilconfig } from "lilconfig";
import yaml from "yaml";

export type Rule = { type?: string; pubkeys?: string[]; expiration: string };
export type Config = {
  publicDomain: string;
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
  cache: {
    dir: string;
    rules: Rule[];
  };
  upload: {
    enabled: boolean;
    rules: Rule[];
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

const result = await lilconfig("blobstr", {
  searchPlaces: ["config.yaml", "config.yml", "config.json"],
  loaders: {
    ".yaml": loadYaml,
    ".yml": loadYaml,
    ".json": loadJson,
  },
}).search();

const config: Config = result?.config;

export { config };
