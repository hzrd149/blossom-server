import React from "react";
import { Admin, Resource, defaultLightTheme, defaultDarkTheme } from "react-admin";
import { Code, FolderOpen, People } from "@mui/icons-material";
import { dataProvider } from "./dataProvider";
import { authProvider } from "./authProvider";
import { CustomLayout } from "./Layout";

import * as users from "./users";
import * as blobs from "./blobs";
import * as rules from "./rules";

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
  </Admin>
);
