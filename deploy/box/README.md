# Public demo box

One container that serves the whole public demo: the dashboard and plan book reading the Base Sepolia deployment, and the attack arena with its own agent on its own anvil chain. This is what the arena QR code on the deck points to.

| Inside the container | Port | Network |
| --- | --- | --- |
| anvil, a fresh arena chain on every start | 127.0.0.1:8546 | `anvil-arena` (LocalSafe, anvil dev keys) |
| arena agent (`agent: npm run serve`) | 127.0.0.1:8788 | `anvil-arena` |
| read-only agent for the dashboard | 127.0.0.1:8787 | `base-sepolia`, no keys |
| website (`next start`) | 0.0.0.0:3000 | `base-sepolia` |

The box holds no keys. `start.sh` refuses to start if any `*_PRIVATE_KEY` variable is set; the Base Sepolia agent runs read-only, and the arena chain uses anvil's public dev keys. The only secret it may hold is `MODEL_API_KEY` for the arena agent, which stays on the server.

## Run it

On any Linux server with Docker (2 GB RAM is enough), from a clone of this repo:

```sh
cd deploy/box
docker compose up -d --build                                  # plain HTTP on port 80
SITE_ADDRESS=demo.example.com docker compose up -d --build    # HTTPS for a domain that points at the server
```

Compose puts Caddy in front (HTTPS when `SITE_ADDRESS` is a domain, and the real client address for the arena's per-person rate limit). Then set `PUBLIC_ARENA_URL` to the address people will scan, e.g. `PUBLIC_ARENA_URL=http://203.0.113.7/arena`, and run the same command again.

Optional settings (shell or a `.env` file next to `compose.yaml`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SITE_ADDRESS` | `:80` | Caddy site address: a domain for HTTPS, or `:80` |
| `PUBLIC_ARENA_URL` | request origin + `/arena` | What the arena's QR code shows |
| `BASE_SEPOLIA_RPC` | `https://base-sepolia-rpc.publicnode.com` | Read-only RPC. Not `sepolia.base.org`, which caps log reads at 200 blocks |
| `MODEL_PROVIDER`, `MODEL_BASE_URL`, `MODEL_NAME`, `MODEL_API_KEY` | unset | The arena agent's model, as in `agent/README.md`. Unset: the rule-based extractor |

Without compose: `docker build -f deploy/box/Dockerfile -t signal8-box .` from the repo root, then `docker run -d -p 80:3000 --restart unless-stopped signal8-box`. Leave `TRUST_PROXY` unset then, so everyone shares one rate-limit key (5 attempts a minute in total).

Restarting the container resets the arena: a new chain and an empty board. The dashboard's agent log starts empty too, because the decision logs from our runs are not in the repo; the dashboard's activity comes from the chain.

## Where to host it for judges in mainland China

`*.vercel.app` and other free hosting subdomains are often blocked or slow in mainland China. A small server in Hong Kong (Alibaba Cloud or Tencent Cloud Lighthouse, Hong Kong region) usually loads well from the mainland and needs no ICP filing. Mainland regions need an ICP filing before port 80 or 443 opens. Check from a mainland phone network before demo day.
