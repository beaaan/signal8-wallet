# Demo script and demo-day checklist

## 10-minute deck

1. **0:00 Hook (1 min).** "7 September 2024, 1pm: Yagi makes landfall in Hải Phòng, the costliest typhoon in Vietnam's history. We're a team from Vietnam; this was our storm." Then a year later in Hong Kong: Ragasa, Signal 10, and Mrs Chan's staff are due to be paid while she sandbags her shop door. One number: a 27-day cash buffer (NY Fed).
2. **1:00 Two problems (1 min).** Owners can't run finance during a storm. AI agents that could are easy to talk out of money (Grok wallet, May 2026).
3. **2:00 The idea (1 min).** Plans signed in calm weather, executed by the agent under an official trigger. One diagram.
4. **3:00 Live: Ragasa replay (3 min).** `npm run replay -- --event ragasa-2025 --pause-at-steps`. Brace → unlock → payout → payroll → credit draw → fake "Signal 10" email rejected → lock. On Base Sepolia the runner prints each hash as a Basescan link.
5. **6:00 Everyday mode (1 min).** One client payment matched and swept, one supplier paid, surplus to the vault, the daily report hash.
6. **7:00 Security (1.5 min).** Tier table, bank-controls table, red-team chart (bare agent vs ours).
7. **8:30 Arena (1 min).** QR code on screen; judges submit attacks; the live board shows each one refused or sent to the owners.
8. **9:30 Close (0.5 min).** 30-second Yagi replay on FISCO BCOS ending in a Circular 53 restructuring request; other shocks are a config file; what a bank or insurer would plug in.

## 5-minute video

Cut from one clean run: sections 3 to 7 of the deck, with captions. Doubles as the backup if the live demo fails.

## Demo-day checklist

- [ ] Wallets pre-funded (no faucet on the day): agent, relayers, demo client
- [ ] Payees in place: set at deploy, or `setPayee` applied through the 24 h timelock
- [ ] Rehearsals done on the Anvil fork, not on Base Sepolia (the live run needs the day's caps)
- [ ] Storm plan signed; plan hash on-chain
- [ ] Replay tested twice that morning on the Anvil fork; `spentAllToday` on Base Sepolia is 0
- [ ] Local Anvil fork ready (`anvil --fork-url $BASE_SEPOLIA_RPC`) in case the testnet is slow
- [ ] Backup video on the laptop, not only online
- [ ] Arena on its own chain, never the demo one: a second anvil (`anvil --port 8546`), deploy with `NETWORK=anvil-arena`, a second agent API with `NETWORK=anvil-arena RPC_URL=http://127.0.0.1:8546 AGENT_API_PORT=8788 npm run serve`, and `ARENA_AGENT_API_URL=http://127.0.0.1:8788` for the website
- [ ] Arena reset before the session: restart its anvil and redeploy (old attempts drop off the board when the start block changes)
- [ ] Arena rate limit on (5 per IP and 20 overall per minute); `TRUST_PROXY=1` only behind a real proxy; QR code slide tested from a phone
- [ ] Dashboard open in a second window in presenter mode (`?big=1`, or press `b`)
- [ ] Explorer tabs pre-opened
