import * as React from "react";
import { useMediaQuery, Theme, IconButton, Card, CardContent } from "@mui/material";
import { Description, OpenInNew } from "@mui/icons-material";
import dayjs from "dayjs";
import mime from "mime-types";

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
  SavedQueriesList,
  SearchInput,
  SimpleList,
  TextField,
  useRecordContext,
} from "react-admin";
import { truncateHash } from "../helpers/string";

const UserBulkActionButtons = (props) => <BulkDeleteWithConfirmButton {...props} />;

function OpenButton() {
  const record = useRecordContext();
  return (
    <IconButton aria-label="delete" href={record.url} target="_blank">
      <OpenInNew />
    </IconButton>
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
          <FilterListItem label=".svg" value={{ type: ["image/xml+svg"] }} />
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
      sort={{ field: "created", order: "ASC" }}
      pagination={<Pagination rowsPerPageOptions={[10, 25, 50, 100]} />}
      aside={<SideBar />}
    >
      {useMediaQuery((theme: Theme) => theme.breakpoints.down("md")) ? (
        <SimpleList primaryText={(record) => truncateHash(record.sha256)} secondaryText={(record) => record.type} />
      ) : (
        <Datagrid bulkActionButtons={<UserBulkActionButtons />} optimized>
          <TextField source="sha256" sortable={false} />
          <TextField source="type" />
          <NumberField source="size" />
          <DateField source="created" transform={(unix) => dayjs.unix(unix).toDate()} showTime />
          <OpenButton />
        </Datagrid>
      )}
    </List>
  );
}
