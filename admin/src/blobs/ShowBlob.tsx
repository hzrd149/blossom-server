import { Button, Stack, Typography } from "@mui/material";
import { DeleteButton, NumberField, Show, TabbedShowLayout, TextField, useShowController } from "react-admin";
import BlobPreview, { canPreview } from "./BlobPreview";

type BlobShape = {
  sha256: string;
  type: string;
  size: number;
  uploaded: number;
  owners: string[];
  id: string;
  url: string;
};

function PreviewContent() {
  const { record } = useShowController<BlobShape>();
  if (!record) return;

  return canPreview(record) ? <BlobPreview blob={record} /> : <Typography>No preview available</Typography>;
}

function Page() {
  const { record } = useShowController<BlobShape>();
  if (!record) return;

  return (
    <TabbedShowLayout>
      <TabbedShowLayout.Tab label="Details">
        <TextField source="sha256" />
        <TextField source="type" />
        <NumberField source="size" />
        <Stack useFlexGap direction="row" spacing={2}>
          <Button href={record.url} target="_blank" size="small">
            Open
          </Button>
          <DeleteButton />
        </Stack>
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Preview">
        <PreviewContent />
      </TabbedShowLayout.Tab>
      <TabbedShowLayout.Tab label="Raw">
        <pre>
          <code>{JSON.stringify(record, null, 2)}</code>
        </pre>
      </TabbedShowLayout.Tab>
    </TabbedShowLayout>
  );
}

export default function ShowBlob() {
  return (
    <Show>
      <Page />
    </Show>
  );
}
