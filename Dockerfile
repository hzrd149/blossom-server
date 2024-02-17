# syntax=docker/dockerfile:1
FROM node:20.11 as builder

WORKDIR /app

# Install dependencies
COPY ./package*.json .
COPY ./yarn.lock .
ENV NODE_ENV=development
RUN yarn install
COPY . .
RUN yarn build

FROM node:20.11

ENV NODE_ENV=production
COPY ./package*.json .
COPY ./yarn.lock .
RUN yarn install

COPY --from=builder ./app/build ./build

VOLUME [ "/data" ]
EXPOSE 3000

ENV DEBUG="cdn,cdn:*"

ENTRYPOINT [ "node", "src/index.js" ]
