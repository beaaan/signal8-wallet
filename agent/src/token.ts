// The token the deployment accounts in, as people read it: mUSD (MockUSD) on anvil and Base Sepolia, mVND
// (MockVNDDeposit, a mock bank-issued VND deposit token) on the local FISCO chain of the Yagi replay. makeAgent sets it
// from the plan book. Amounts stay in 6-decimal token units everywhere; only labels and the storm loop's dollar-sized
// defaults (forecast, brace margin) follow the token.

/** Dollar-sized defaults × this, in each token: the Yagi deployment sizes mVND at about 25,000 dong per US dollar
 *  (Deploy.s.sol VND_SIZING). Sizing only, not an exchange rate. Unknown tokens keep the dollar sizes. */
export const TOKEN_SIZING: Record<string, bigint> = { mUSD: 1n, mVND: 25_000n };

let symbol = "mUSD";

export function tokenSymbol(): string {
  return symbol;
}

export function setTokenSymbol(s: string): void {
  if (!/^[A-Za-z0-9.]{1,12}$/.test(s)) throw new Error(`bad token symbol "${s}"`);
  symbol = s;
}

export function tokenSizing(s: string = symbol): bigint {
  return TOKEN_SIZING[s] ?? 1n;
}
