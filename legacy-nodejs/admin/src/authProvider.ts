import { AuthProvider, HttpError } from "react-admin";
import { API_BASE } from "./env";

function getApiURL(path: string) {
  return API_BASE + path;
}

let savedAuth: null | string = null;
export function getAuthHeaders(): { Authorization: string } | {} {
  if (!savedAuth) return {};
  return { Authorization: savedAuth };
}

export const authProvider: AuthProvider = {
  async login({ username, password }) {
    const auth = "Basic " + btoa(username + ":" + password);

    const res = await fetch(getApiURL("/auth"), {
      method: "post",
      headers: { "Content-Type": "application/json", Authorization: auth },
    });
    if (res.ok) {
      savedAuth = auth;
      return Promise.resolve();
    } else savedAuth = null;

    return Promise.reject(
      new HttpError("Unauthorized", 401, {
        message: "Invalid username or password",
      }),
    );
  },
  async logout() {
    savedAuth = null;
  },
  async checkError() {},
  async checkAuth() {
    return savedAuth ? Promise.resolve() : Promise.reject();
  },
  async getPermissions() {},
  async getIdentity() {
    return { id: "admin", fullName: "admin" };
  },
};

export default authProvider;
