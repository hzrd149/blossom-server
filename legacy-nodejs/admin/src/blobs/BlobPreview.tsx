import { Typography } from "@mui/material";

export function canPreview(blob: { type: string }) {
  return blob.type.startsWith("image/") || blob.type.startsWith("video/") || blob.type.startsWith("audio/");
}

export default function BlobPreview({ blob }: { blob: { type: string; url: string } }) {
  if (blob.type.startsWith("image/")) {
    return <img src={blob.url} />;
  } else if (blob.type.startsWith("video/")) {
    return <video src={blob.url} controls />;
  } else if (blob.type.startsWith("audio/")) {
    return <audio src={blob.url} controls style={{ minWidth: "30rem" }} />;
  }

  return <Typography>No preview available</Typography>;
}
