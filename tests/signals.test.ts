import { Buy, detectSignals, SignalConfig, toBuy } from "../src/autoload/signals";

const cfg: SignalConfig = {
  minWallets: 3,
  windowDays: 7,
  cooldownDays: 30,
  freshHours: 6,
  minBuyUsd: 1000,
};
const NOW = new Date("2026-01-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const buy = (username: string, h: number, extra: Partial<Buy> = {}): Buy => ({
  chain: "ETH",
  token: "0xabc",
  symbol: "ABC",
  username,
  wallet: `0x${username}`,
  usd: 5000,
  at: hoursAgo(h),
  ...extra,
});

describe("detectSignals", () => {
  it("fires when the K-th distinct wallet buys inside the window", () => {
    const s = detectSignals([buy("a", 50), buy("b", 20), buy("c", 1)], cfg, NOW);
    expect(s).toHaveLength(1);
    expect(s[0].walletNames.sort()).toEqual(["a", "b", "c"]);
    expect(s[0].usdValue).toBe(15000);
    expect(s[0].fresh).toBe(true);
    expect(s[0].signalAt).toEqual(hoursAgo(1));
  });

  it("counts a username once even with several addresses / repeat buys", () => {
    const s = detectSignals(
      [buy("a", 30), buy("a", 20, { wallet: "0xa2" }), buy("b", 10), buy("b", 2)],
      cfg,
      NOW
    );
    expect(s).toHaveLength(0);
  });

  it("ignores buys outside the window", () => {
    const s = detectSignals([buy("a", 24 * 8), buy("b", 20), buy("c", 1)], cfg, NOW);
    expect(s).toHaveLength(0);
  });

  it("ignores dust buys", () => {
    const s = detectSignals([buy("a", 30), buy("b", 20), buy("c", 1, { usd: 50 })], cfg, NOW);
    expect(s).toHaveLength(0);
  });

  it("does not re-signal a token inside its cooldown", () => {
    const s = detectSignals(
      [buy("a", 30), buy("b", 20), buy("c", 1)],
      cfg,
      NOW,
      new Set(["ETH:0xabc"])
    );
    expect(s).toHaveLength(0);
  });

  it("marks late detections as not fresh (no broadcast after restarts)", () => {
    const s = detectSignals([buy("a", 60), buy("b", 50), buy("c", 40)], cfg, NOW);
    expect(s).toHaveLength(1);
    expect(s[0].fresh).toBe(false);
  });

  it("keys by contract address, not symbol", () => {
    const s = detectSignals(
      [buy("a", 30), buy("b", 20, { token: "0xdef" }), buy("c", 1)],
      cfg,
      NOW
    );
    expect(s).toHaveLength(0);
  });
});

describe("toBuy", () => {
  const meta = { chain: "ETH" as const, username: "a", wallet: "0xa", at: NOW };

  it("ETH -> token is a buy", () => {
    const b = toBuy(
      {
        outTokens: [{ address: "0xETH_NATIVE", symbol: "ETH", usdValue: 3000 }],
        inTokens: [{ address: "0xToken", symbol: "PEPE", usdValue: 2900 }],
      },
      meta
    );
    expect(b).toMatchObject({ token: "0xtoken", symbol: "PEPE", usd: 3000 });
  });

  it("token -> USDC is a sell, not a buy", () => {
    expect(
      toBuy(
        {
          outTokens: [{ address: "0xtoken", symbol: "PEPE", usdValue: 3000 }],
          inTokens: [{ symbol: "USDC", usdValue: 3000 }],
        },
        meta
      )
    ).toBeNull();
  });

  it("CEX withdrawal (receive only) is not a buy", () => {
    expect(toBuy({ outTokens: [], inTokens: [{ address: "0xt", symbol: "X" }] }, meta)).toBeNull();
  });

  it("token -> token rotation is not a buy", () => {
    expect(
      toBuy(
        {
          outTokens: [{ address: "0x1", symbol: "AAA" }],
          inTokens: [{ address: "0x2", symbol: "BBB" }],
        },
        meta
      )
    ).toBeNull();
  });
});
