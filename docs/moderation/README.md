# Moderation

Specifications for banning users and blobs on this server. They are written for operators, contributors, and developers of other Blossom implementations or
tools that want to interoperate with this one.

These documents are not Blossom BUDs. Formats that other implementations should share may later be proposed as BUDs; until then, the documents here are the
reference for this server.

## Conventions

- The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are used as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
- Hashes and public keys are lowercase hexadecimal unless stated otherwise.
- Each document starts with a status header:
  - **Status:** `Draft` (open for change), `Accepted` (design agreed, implementation may be incomplete), `Implemented` (matches the released server), or
    `Superseded`.
  - **Implemented in:** the first server version that implements the document, or `—`.
- Placeholders that still need a final value are written as `<UPPER_CASE>` and listed under **Open questions** in the document.
- Changing a published format (a document marked `Implemented` with a wire format) requires a new format version; existing versions are not edited in place.

## Documents

| Document                    | Status | Summary                                                         |
| --------------------------- | ------ | --------------------------------------------------------------- |
| [Local bans](local-bans.md) | Draft  | Banning pubkeys and blob hashes on one server, and enforcement. |

Local bans are always enabled. Sharing ban lists between servers is planned separately and is not part of this server yet.
