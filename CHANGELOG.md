# blossom-server

## 4.3.1

### Patch Changes

- Fix bug with some browsers setting incorrect mime type for .m3u8
- 8096b37: Expand S3 Storage options

## 4.3.0

### Minor Changes

- 6749892: Add `useSSL` and `region` options for s3 storage

## 4.2.0

### Minor Changes

- Add `removeWhenNoOwners` option to config
- Add window.nostr.js to landing page

## 4.1.1

### Patch Changes

- Fix typo in /upload endpoint

## 4.1.0

### Minor Changes

- Add /mirror endpoint
- Add mirror page to UI

## 4.0.1

### Patch Changes

- Replace websocket-polyfill package

## 4.0.0

### Major Changes

- Require "x" tag with sha256 hash on uploads

### Minor Changes

- Rebuild landing page with tailwind and lit

## 3.0.0

### Major Changes

- Rename "created" field to "uploaded" on blobs

### Minor Changes

- Support "since" and "until" on /list endpoint

## 2.1.2

### Patch Changes

- 7520055: Add default for publicDomain option
- 7520055: Change default local blob directory
- 7520055: Fix bug with unowned blobs in dashboard

## 2.1.1

### Patch Changes

- Create data directory if it does not exist

## 2.1.0

### Minor Changes

- Add blob details page with preview

## 2.0.0

### Major Changes

- Add simple admin dashboard

### Patch Changes

- Fix bug with app crashing when config fields missing

## 1.1.1

### Patch Changes

- Fix docker image
- Fix expiration in auth events for index.html
