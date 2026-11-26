# Central relay server

This directory holds the central server of OpenBot-NC. It is the only server: each OpenBot (desktop,
Linux server, web client, browser extension and phone app) of a team opens a WebSocket to it. The
server verifies each member with a certificate, sends each member the list of the connected members
of its team, and passes the bytes of a connection between two members of the same team.

- `api/src/relay/`: the server and its certificate authority (`ca` commands).
- `scripts/build-relay.ts`: builds one program file (`bun run relay:build`).
- `scripts/relay-e2e.ts`: the end-to-end test (`bun run test:relay`).
- `api/src/relay/admin-page/`: the admin page (join codes, teams, members, revoke). It listens only
  on a private address (`RELAY_ADMIN_HOST`), never on the public listener.
- `compose.relay.yaml` and `api/Dockerfile`: the Docker set-up.

The full guide is [docs/central-server.md](../docs/central-server.md): certificates, join codes,
the admin page, set-up with and without Docker, settings, protocol and tests.

## Docker

```sh
compose="docker compose -f remote/compose.relay.yaml --env-file remote/.env.relay"
$compose run --rm relay ca init
$compose run --rm relay ca server --dns relay.example.com
$compose run --rm relay ca team add "My Team"
$compose up -d --build
```

`remote/.env.relay` sets at least `RELAY_PUBLIC_URL=wss://relay.example.com/v1/relay`. To serve the
web client at `/app`, build it with `bun run web-client:build`, then set `RELAY_WEB_CLIENT_DIR` to
the build folder as an absolute path or a path that starts with `./` (relative to `remote/`). Compose
mounts that folder read-only at `/web-client` in the container. With no value, the server does not
serve `/app`.
