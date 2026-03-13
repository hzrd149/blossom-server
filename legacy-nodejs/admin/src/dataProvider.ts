import simpleRestProvider from "ra-data-simple-rest";
import { fetchUtils } from "react-admin";
import { getAuthHeaders } from "./authProvider";
import { API_BASE } from "./env";

console.log("Connecting to", API_BASE);

export const dataProvider = simpleRestProvider(API_BASE, (url, opts) =>
  fetchUtils.fetchJson(url, {
    ...opts,
    headers: new Headers({
      ...opts?.headers,
      ...getAuthHeaders(),
      Accept: "application/json",
    }),
  }),
);
