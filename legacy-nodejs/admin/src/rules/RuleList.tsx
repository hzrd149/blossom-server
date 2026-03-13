import * as React from "react";
import { useMediaQuery, Theme } from "@mui/material";
import { ArrayField, Datagrid, List, SimpleList, TextField } from "react-admin";

export default function RuleList() {
  return (
    <List>
      {useMediaQuery((theme: Theme) => theme.breakpoints.down("md")) ? (
        <SimpleList primaryText={(record) => record.name} secondaryText={(record) => record.type} />
      ) : (
        <Datagrid sort={{ field: "id", order: "ASC" }} optimized bulkActionButtons={<></>}>
          <TextField source="id" />
          <TextField source="type" sortable={false} />
          <TextField source="expiration" sortable={false} />
          <ArrayField source="pubkeys">
            <SimpleList primaryText={(p) => p} />
          </ArrayField>
        </Datagrid>
      )}
    </List>
  );
}
