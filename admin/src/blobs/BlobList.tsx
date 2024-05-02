import * as React from "react";
import {
  useMediaQuery,
  Theme,
  IconButton,
  Card,
  CardContent,
  Stack,
  Dialog,
  DialogContent,
  DialogTitle,
  useTheme,
  DialogActions,
  Button,
} from "@mui/material";
import { OpenInNew, Visibility } from "@mui/icons-material";
import {
  AutocompleteArrayInput,
  BulkDeleteWithConfirmButton,
  Datagrid,
  DateField,
  FilterList,
  FilterListItem,
  FilterLiveSearch,
  List,
  NumberField,
  Pagination,
  SearchInput,
  SimpleList,
  TextField,
  useRecordContext,
} from "react-admin";
import dayjs from "dayjs";
import mime from "mime-types";

import { truncateHash } from "../helpers/string";
import BlobPreview, { canPreview } from "./BlobPreview";

const UserBulkActionButtons = (props: any) => <BulkDeleteWithConfirmButton {...props} />;

function PreviewButton() {
  const theme = useTheme();
  const record = useRecordContext();
  const [open, setOpen] = React.useState(false);
  const fullScreen = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <>
      <IconButton
        aria-label="preview"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        size="small"
      >
        <Visibility />
      </IconButton>

      <Dialog
        maxWidth="lg"
        open={open}
        onClick={(e) => e.stopPropagation()}
        fullScreen={fullScreen}
        onClose={() => setOpen(false)}
      >
        <DialogTitle>Preview</DialogTitle>
        <DialogContent>
          {/* @ts-expect-error */}
          <BlobPreview blob={record} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function RowActions() {
  const record = useRecordContext();

  return (
    <>
      <Stack direction="row" useFlexGap spacing={1} justifyContent="flex-end">
        {canPreview(record as any) && <PreviewButton />}
        <IconButton
          aria-label="delete"
          href={record.url}
          target="_blank"
          size="small"
          onClick={(e) => e.stopPropagation()}
        >
          <OpenInNew />
        </IconButton>
      </Stack>
    </>
  );
}

function SideBar() {
  return (
    <Card sx={{ order: -1, mr: 2, mt: 9, width: 200 }}>
      <CardContent>
        <FilterLiveSearch />
        <FilterList label="Image" icon={null}>
          <FilterListItem label=".png" value={{ type: ["image/png"] }} />
          <FilterListItem label=".jpg" value={{ type: ["image/jpeg"] }} />
          <FilterListItem label=".gif" value={{ type: ["image/gif"] }} />
          <FilterListItem label=".svg" value={{ type: ["image/svg+xml"] }} />
          <FilterListItem label=".bmp" value={{ type: ["image/bmp"] }} />
          <FilterListItem label=".psd" value={{ type: ["image/vnd.adobe.photoshop"] }} />
        </FilterList>
        <FilterList label="Audio" icon={null}>
          <FilterListItem label=".mp3" value={{ type: "audio/mpeg" }} />
          <FilterListItem label=".m4a" value={{ type: "audio/mp4" }} />
          <FilterListItem label=".flac" value={{ type: "audio/x-flac" }} />
          <FilterListItem label=".ogg" value={{ type: "audio/ogg" }} />
          <FilterListItem label=".wav" value={{ type: "audio/wav" }} />
          <FilterListItem label=".mid" value={{ type: "audio/midi" }} />
        </FilterList>
        <FilterList label="Video" icon={null}>
          <FilterListItem label=".mp4" value={{ type: "video/mp4" }} />
          <FilterListItem label=".webm" value={{ type: "video/webm" }} />
          <FilterListItem label=".avi" value={{ type: "video/x-msvideo" }} />
          <FilterListItem label=".mov" value={{ type: "video/quicktime" }} />
        </FilterList>
        <FilterList label="Text" icon={null}>
          <FilterListItem label=".txt" value={{ type: "text/plain" }} />
          <FilterListItem label=".html" value={{ type: "text/html" }} />
        </FilterList>
        <FilterList label="Application" icon={null}>
          <FilterListItem label=".pdf" value={{ type: "application/pdf" }} />
          <FilterListItem label=".xml" value={{ type: "application/xml" }} />
          <FilterListItem label=".doc" value={{ type: ["application/msword"] }} />
          <FilterListItem label=".srt" value={{ type: ["application/x-subrip"] }} />
          <FilterListItem label=".zip" value={{ type: "application/zip" }} />
          <FilterListItem label=".tar" value={{ type: "application/x-tar" }} />
          <FilterListItem label=".bin" value={{ type: "application/octet-stream" }} />
        </FilterList>
        <FilterList label="Model" icon={null}>
          <FilterListItem label=".obj" value={{ type: "model/obj" }} />
          <FilterListItem label=".stl" value={{ type: "model/stl" }} />
        </FilterList>
      </CardContent>
    </Card>
  );
}

export default function BlobList() {
  return (
    <List
      filters={[
        <SearchInput source="q" alwaysOn />,
        <AutocompleteArrayInput
          source="type"
          choices={Object.keys(mime.extensions).map((type) => ({ id: type, name: type }))}
        />,
      ]}
      filterDefaultValues={{}}
      sort={{ field: "uploaded", order: "ASC" }}
      pagination={<Pagination rowsPerPageOptions={[10, 25, 50, 100]} />}
      aside={<SideBar />}
    >
      {useMediaQuery((theme: Theme) => theme.breakpoints.down("md")) ? (
        <SimpleList primaryText={(record) => truncateHash(record.sha256)} secondaryText={(record) => record.type} />
      ) : (
        <Datagrid rowClick="show" bulkActionButtons={<UserBulkActionButtons />} optimized>
          <TextField source="sha256" sortable={false} />
          <TextField source="type" />
          <NumberField source="size" />
          <DateField source="uploaded" transform={(unix: number) => dayjs.unix(unix).toDate()} showTime />
          <RowActions />
        </Datagrid>
      )}
    </List>
  );
}
