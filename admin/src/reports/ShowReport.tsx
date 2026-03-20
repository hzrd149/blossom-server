import * as React from "react";
import { Button, Chip, Stack, Typography } from "@mui/material";
import {
  DeleteButton,
  Show,
  TabbedShowLayout,
  TextField,
  useNotify,
  useRecordContext,
  useRedirect,
  useShowController,
} from "react-admin";

type ReportShape = {
  id: number;
  event_id: string;
  reporter: string;
  blob: string;
  type: string | null;
  content: string;
  created: number;
};

/** NIP-56 type chip colours matching the list view. */
const TYPE_COLOR: Record<string, "error" | "warning" | "info" | "default"> = {
  nudity: "error",
  malware: "error",
  illegal: "error",
  profanity: "warning",
  spam: "warning",
  impersonation: "info",
  other: "default",
};

function DeleteBlobAction() {
  const record = useRecordContext<ReportShape>();
  const notify = useNotify();
  const redirect = useRedirect();

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete blob ${record.blob}?\n\nThis is permanent and will dismiss all reports for this blob.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/reports/${record.id}/blob`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`${res.status}`);
      notify("Blob deleted and all reports dismissed", { type: "success" });
      redirect("list", "reports");
    } catch {
      notify("Failed to delete blob", { type: "error" });
    }
  };

  return (
    <Button
      color="error"
      size="small"
      onClick={handleDelete}
      variant="outlined"
    >
      Delete Blob + Dismiss All Reports
    </Button>
  );
}

function Page() {
  const { record } = useShowController<ReportShape>();
  if (!record) return null;

  return (
    <TabbedShowLayout>
      <TabbedShowLayout.Tab label="Details">
        <Typography variant="subtitle2" color="text.secondary">
          Blob hash
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "monospace", mb: 1 }}>
          {record.blob}
        </Typography>

        <Typography variant="subtitle2" color="text.secondary">
          Reporter pubkey
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "monospace", mb: 1 }}>
          {record.reporter}
        </Typography>

        <Typography variant="subtitle2" color="text.secondary">
          Report type
        </Typography>
        {record.type
          ? (
            <Chip
              label={record.type}
              size="small"
              color={TYPE_COLOR[record.type] ?? "default"}
              sx={{ mb: 1 }}
            />
          )
          : (
            <Typography variant="body2" sx={{ mb: 1 }}>
              —
            </Typography>
          )}

        <Typography variant="subtitle2" color="text.secondary">
          Content
        </Typography>
        <Typography variant="body2" sx={{ mb: 1, whiteSpace: "pre-wrap" }}>
          {record.content || "—"}
        </Typography>

        <Typography variant="subtitle2" color="text.secondary">
          NIP-56 event id
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "monospace", mb: 2 }}>
          {record.event_id}
        </Typography>

        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Button
            href={`/${record.blob}`}
            target="_blank"
            size="small"
            variant="outlined"
          >
            Open Blob
          </Button>
          <Button
            href={`/admin#/blobs/${record.blob}/show`}
            size="small"
            variant="outlined"
          >
            View in Blobs
          </Button>
          <DeleteBlobAction />
          <DeleteButton label="Dismiss Report" />
        </Stack>
      </TabbedShowLayout.Tab>

      <TabbedShowLayout.Tab label="Raw">
        <TextField source="blob" label="Blob" />
        <TextField source="reporter" label="Reporter" />
        <TextField source="type" label="Type" />
        <TextField source="content" label="Content" />
        <pre>
          <code>{JSON.stringify(record, null, 2)}</code>
        </pre>
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  );
}

export default function ShowReport() {
  return (
    <Show>
      <Page />
    </Show>
  );
}
