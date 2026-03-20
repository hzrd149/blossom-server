import React from "react";
import {
  Admin,
  defaultDarkTheme,
  defaultLightTheme,
  Resource,
} from "react-admin";
import { Code, Flag, FolderOpen, People } from "@mui/icons-material";
import { dataProvider } from "./dataProvider";
import { authProvider } from "./authProvider";
import { CustomLayout } from "./Layout";

import * as users from "./users";
import * as blobs from "./blobs";
import * as rules from "./rules";
import * as reports from "./reports";

export const App = () => (
  <Admin
    dataProvider={dataProvider}
    authProvider={authProvider}
    disableTelemetry
    lightTheme={defaultLightTheme}
    darkTheme={defaultDarkTheme}
    defaultTheme="dark"
    layout={CustomLayout}
  >
    <Resource name="blobs" icon={FolderOpen} {...blobs} />
    <Resource name="users" icon={People} {...users} />
    <Resource name="rules" icon={Code} {...rules} />
    <Resource name="reports" icon={Flag} {...reports} />
  </Admin>
);
