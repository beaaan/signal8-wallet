# One container for the public demo: the website, the attack arena's agent on its own anvil chain, and a read-only
# agent for the dashboard. It holds no keys: the arena chain uses anvil's public dev keys, and the Base Sepolia
# side only reads. See deploy/box/README.md.
#
#   docker build -f deploy/box/Dockerfile -t signal8-box .      (from the repo root)

ARG NODE_IMAGE=node:22-bookworm-slim
ARG FOUNDRY_IMAGE=ghcr.io/foundry-rs/foundry:v1.3.5

# Contracts, built with the same library versions as CI. This also downloads solc 0.8.11.
FROM ${FOUNDRY_IMAGE} AS contracts
WORKDIR /home/foundry/app
COPY --chown=foundry contracts contracts
COPY --chown=foundry data data
RUN cd contracts \
  && git clone --depth 1 --branch v4.9.6 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts \
  && git clone --depth 1 --branch v1.9.7 https://github.com/foundry-rs/forge-std lib/forge-std \
  && forge build

FROM ${NODE_IMAGE}
COPY --from=contracts /usr/local/bin/forge /usr/local/bin/anvil /usr/local/bin/cast /usr/local/bin/
COPY --from=contracts /home/foundry/.svm /root/.svm
WORKDIR /app
COPY --from=contracts /home/foundry/app/contracts contracts
COPY data data

COPY agent/package.json agent/package-lock.json agent/
RUN cd agent && npm ci --no-audit --no-fund
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund

COPY agent agent
COPY web web
RUN cd web && NETWORK=base-sepolia npm run build

COPY deploy/box/start.sh deploy/box/start.sh

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["/app/deploy/box/start.sh"]
