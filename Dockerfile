# syntax=docker/dockerfile:1
FROM node:20.11 as builder

WORKDIR /app

# Install dependencies
COPY ./package*.json .
COPY ./yarn.lock .
ENV NODE_ENV=production
RUN yarn install

COPY . .

VOLUME [ "/data" ]

ENV DEBUG="cdn,cdn:*"
ENV DATA_DIR="/data"
ENV PARENT_CDNS="https://cdn.satellite.earth"
ENV RELAYS="wss://nostrue.com,wss://relay.damus.io,wss://nostr.wine,wss://nos.lol,wss://nostr-pub.wellorder.net"

ENTRYPOINT [ "node", "src/index.js" ]
