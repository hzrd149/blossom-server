import * as React from "react";
import {
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Theme,
  Tooltip,
  useMediaQuery,
} from "@mui/material";
import {
  DeleteForever,
  OpenInNew,
  RemoveCircleOutline,
} from "@mui/icons-material";
import {
  BulkDeleteWithConfirmButton,
  Datagrid,
  DateField,
  FilterList,
  FilterListItem,
  FilterLiveSearch,
  List,
  Pagination,
  SearchInput,
  SimpleList,
  TextField,
  useDataProvider,
  useNotify,
  useRecordContext,
  useRefresh,
} from "react-admin";
import dayjs from "dayjs";
import { truncateHash } from "../helpers/string";

/** NIP-56 report type colours for visual scanning. */
const TYPE_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  nudity: "error",
  malware: "error",
  illegal: "error",
  profanity: "warning",
  spam: "warning",
  impersonation: "info",
  other: "default",
};

const REPORT_TYPES = [
  "nudity",
  "malware",
  "profanity",
  "illegal",
  "spam",
  "impersonation",
  "other",
];

function TypeChip() {
  const record = useRecordContext();
  if (!record?.type) return <Chip label="—" size="small" />;
  return (
    <Chip
      label={record.type}
      size="small"
      color={TYPE_COLOR[record.type] ?? "default"}
    />
  );
}

/** Dismiss button — removes the report row, leaves the blob untouched. */
function DismissButton() {
  const record = useRecordContext();
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dataProvider.delete("reports", {
        id: record.id,
        previousData: record,
      });
      notify("Report dismissed", { type: "success" });
      refresh();
    } catch {
      notify("Failed to dismiss report", { type: "error" });
    }
  };

  return (
    <Tooltip title="Dismiss report">
      <IconButton
        size="small"
        onClick={handleDismiss}
        aria-label="dismiss report"
      >
        <RemoveCircleOutline fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/** Delete blob + auto-dismiss all its reports in a single action. */
function DeleteBlobButton() {
  const record = useRecordContext();
  const notify = useNotify();
  const refresh = useRefresh();

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm(
        `Delete blob ${record.blob}?\n\nThis is permanent and will dismiss all reports for this blob.`,
      )
    ) {
      return;
    }
    try {
      // Custom admin action: DELETE /api/reports/:id/blob
      const res = await fetch(`/api/reports/${record.id}/blob`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      notify("Blob deleted and reports dismissed", { type: "success" });
      refresh();
    } catch {
      notify("Failed to delete blob", { type: "error" });
    }
  };

  return (
    <Tooltip title="Delete blob + dismiss all reports">
      <IconButton
        size="small"
        onClick={handleDelete}
        aria-label="delete blob"
        color="error"
      >
        <DeleteForever fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function OpenBlobButton() {
  const record = useRecordContext();
  return (
    <Tooltip title="Open blob">
      <IconButton
        size="small"
        href={`/${record.blob}`}
        target="_blank"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        aria-label="open blob"
      >
        <OpenInNew fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function RowActions() {
  return (
    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
      <OpenBlobButton />
      <DismissButton />
      <DeleteBlobButton />
    </Stack>
  );
}

function SideBar() {
  return (
    <Card sx={{ order: -1, mr: 2, mt: 9, width: 200 }}>
      <CardContent>
        <FilterLiveSearch />
        <FilterList label="Report type" icon={null}>
          {REPORT_TYPES.map((t) => (
            <FilterListItem key={t} label={t} value={{ type: t }} />
          ))}
        </FilterList>
      </CardContent>
    </Card>
  );
}

const BulkActions = () => <BulkDeleteWithConfirmButton />;

export default function ReportList() {
  return (
    <List
      filters={[<SearchInput key="q" source="q" alwaysOn />]}
      sort={{ field: "created", order: "DESC" }}
      pagination={<Pagination rowsPerPageOptions={[10, 25, 50, 100]} />}
      aside={<SideBar />}
    >
      {useMediaQuery((theme: Theme) => theme.breakpoints.down("md"))
        ? (
          <SimpleList
            primaryText={(r) => truncateHash(r.blob)}
            secondaryText={(r) => r.type ?? "—"}
          />
        )
        : (
          <Datagrid
            rowClick="show"
            bulkActionButtons={<BulkActions />}
            optimized
          >
            <TextField source="blob" label="Blob hash" sortable={false} />
            <TypeChip />
            <TextField source="reporter" label="Reporter" sortable={false} />
            <DateField
              source="created"
              label="Reported"
              transform={(unix: number) => dayjs.unix(unix).toDate()}
              showTime
            />
            <RowActions />
          </Datagrid>
        )}
    </List>
  );
}
