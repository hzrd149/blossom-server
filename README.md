# 🌸 Blossom-server

blossom-server is a Typescript implementation of a [Blossom Server](https://github.com/hzrd149/blossom/blob/master/Server.md)

## Running from source

This project uses [yarn](https://classic.yarnpkg.com/lang/en/docs/install) to manage dependencies. It needs to be installed first in order to build the app

Next clone the repo, install the dependencies, and build

```sh
git clone https://github.com/hzrd149/blossom-server.git
cd blossom-server
yarn install
yarn build
```

Next copy the config and modify it

```sh
cp config.example.yml config.yml
nano config.yml
```

And finally start the app

```sh
yarn start
# or
node .
```

Once the server is running you can open `http://localhost:3000` to access the server

## Running with docker

An example config file can be found [here](./config.example.yml)

```sh
# create data volume
docker volume create blossom_data
# run container
docker run -v blossom_data:/app/data -v $(pwd)/config.yml:/app/config.yml -p 3000:3000 ghcr.io/hzrd149/blossom-server:master
```

You can also run it using docker compose with the [`docker-compose.yml`](./docker-compose.yml) file
