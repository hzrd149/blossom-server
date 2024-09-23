# 🌸 Blossom-server

blossom-server is a Typescript implementation of a [Blossom Server](https://github.com/hzrd149/blossom/blob/master/Server.md)

## Supported BUDs

- BUD-01
  - `GET /<sha256>` Retrieve blob
  - `HEAD /<sha256>` Check blob
- BUD-02
  - `PUT /upload` Upload blob
  - `GET /list<pubkey>` List blobs
  - `DELETE /<sha256>` Delete blob
- BUD-04
  - `PUT /mirror` Mirror blob
- BUD-06
  - `HEAD /upload` Upload check

## Running with npx

This app is also packaged as an npm module which you can easily run

```sh
# copy the example config
wget https://raw.githubusercontent.com/hzrd149/blossom-server/master/config.example.yml -O config.yml
# run using npx
npx blossom-server-ts
```

## Running with docker

An example config file can be found [here](./config.example.yml)

```sh
# create data volume
docker volume create blossom_data
# run container
docker run -v blossom_data:/app/data -v $(pwd)/config.yml:/app/config.yml -p 3000:3000 ghcr.io/hzrd149/blossom-server:master
```

You can also run it using docker compose with the [`docker-compose.yml`](./docker-compose.yml) file

## Running from source

This project uses [pnpm](https://pnpm.io/) to manage dependencies. It needs to be installed first in order to build the app

Next clone the repo, install the dependencies, and build

```sh
git clone https://github.com/hzrd149/blossom-server.git
cd blossom-server
pnpm install
cd admin && pnpm install && cd ../
pnpm build
```

Next copy the config and modify it

```sh
cp config.example.yml config.yml
nano config.yml
```

And finally start the app

```sh
pnpm start
# or
node .
```

Once the server is running you can open `http://localhost:3000` to access the server
