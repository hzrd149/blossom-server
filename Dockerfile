# syntax=docker/dockerfile:1
FROM node:20.11 as builder
WORKDIR /app

# Install dependencies
ENV NODE_ENV=development
COPY ./package*.json .
COPY ./yarn.lock .
RUN yarn install
COPY ./admin/package*.json ./admin/
COPY ./admin/yarn.lock ./admin/
RUN cd admin && yarn install
COPY . .
RUN yarn build
RUN cd admin && yarn build

FROM node:20.11
WORKDIR /app

ENV NODE_ENV=production
COPY ./package*.json .
COPY ./yarn.lock .
RUN yarn install

COPY --from=builder ./app/build ./build
COPY --from=builder ./app/admin/dist ./admin/dist
COPY ./public ./public

VOLUME [ "/app/data" ]
EXPOSE 3000

ENV DEBUG="blossom-server,blossom-server:*"

ENTRYPOINT [ "node", "." ]
