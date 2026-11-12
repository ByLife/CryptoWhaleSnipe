import { computeRegime } from "../src/autoload/regime";
import { isDormant, rankWallets, WalletFacts } from "../src/autoload/walletStatus";
import { Buy, detectCopies } from "../src/autoload/signals";
import { stepTrade } from "../src/autoload/paper";
import { parseCsv } from "../src/scripts/importSmartWallets";

const DAY = 86400;
const D0 = 1_700_006_400; // a UTC midnight

describe("computeRegime", () => {
  const cfg = { streakDays: 21, maDays: 50, maMinDays: 40, force: "auto", everyHours: 6 };
  // 3 coins: flat for 60 days, then all rising for 40 days
  const series = (rise: boolean) =>
    Array.from({ length: 100 }, (_, i) => ({ t: D0 + i * DAY + 3600, price: i < 60 || !rise ? 100 : 100 + (i - 59) }));

  it("needs 21 consecutive altsUp days, using yesterday's close", () => {
    const r = computeRegime({ a: series(true), b: series(true), c: series(false) }, D0, D0 + 99 * DAY, cfg);
    const at = (i: number) => r.find((x) => x.day.getTime() === (D0 + i * DAY) * 1000)!;
    expect(at(60).altsUp).toBe(false); // day 60's indicator = close of day 59 (still flat)
    expect(at(61).altsUp).toBe(true); // 2 of 3 coins above their MA on day 60
    expect(at(80).streak).toBe(20);
    expect(at(80).on).toBe(false);
    expect(at(81).on).toBe(true);
  });

  it("is never ON with too little history for the 50d average", () => {
    const r = computeRegime({ a: series(true) }, D0, D0 + 30 * DAY, cfg);
    expect(r.every((x) => !x.altsUp && !x.on)).toBe(true);
  });
});

describe("wallet status", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86400_000);
  const f = (id: string, x: Partial<WalletFacts>): WalletFacts => ({
    id, influencer: false, smart: true, source: "research-A3", cashUsd: 0, lastSentAt: null, ...x,
  });
  const cfg = { dormantDays: 180, dormantMinCashUsd: 1000, maxActive: 2, everyHours: 24 };

  it("dormant = idle AND (almost) no cash; influencers never", () => {
    expect(isDormant(f("a", { lastSentAt: ago(400) }), now, cfg)).toBe(true);
    expect(isDormant(f("a", { lastSentAt: ago(400), cashUsd: 50_000 }), now, cfg)).toBe(false);
    expect(isDormant(f("a", { lastSentAt: ago(10) }), now, cfg)).toBe(false);
    expect(isDormant(f("a", { influencer: true }), now, cfg)).toBe(false);
  });

  it("caps active wallets: influencers and manual first, then most recent", () => {
    const s = rankWallets(
      [
        f("old", { lastSentAt: ago(100) }),
        f("new", { lastSentAt: ago(1) }),
        f("manual", { source: "manual", lastSentAt: ago(150) }),
        f("dead", { lastSentAt: ago(500) }),
      ],
      now,
      cfg
    );
    expect(s.get("manual")).toBe("active");
    expect(s.get("new")).toBe("active");
    expect(s.get("old")).toBe("standby");
    expect(s.get("dead")).toBe("dormant");
  });
});

describe("detectCopies", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const b = (username: string, minAgo: number, x: Partial<Buy> = {}): Buy => ({
    chain: "ETH", token: "0xabc", symbol: "ABC", username, wallet: `0x${username}`, usd: 1000,
    at: new Date(now.getTime() - minAgo * 60_000), ...x,
  });
  const cfg = { minRoi: 0, minBuyUsd: 300, cooldownDays: 30, freshMinutes: 60 };

  it("one signal per token, on the first smart buy", () => {
    const s = detectCopies([b("x", 10), b("y", 30), b("dumb", 50)], new Set(["x", "y"]), cfg, now);
    expect(s).toHaveLength(1);
    expect(s[0].walletNames).toEqual(["y"]);
    expect(s[0].fresh).toBe(true);
  });

  it("skips small buys, cooldown tokens, and flags late ones", () => {
    expect(detectCopies([b("x", 10, { usd: 100 })], new Set(["x"]), cfg, now)).toHaveLength(0);
    expect(detectCopies([b("x", 10)], new Set(["x"]), cfg, now, new Set(["ETH:0xabc"]))).toHaveLength(0);
    expect(detectCopies([b("x", 120)], new Set(["x"]), cfg, now)[0].fresh).toBe(false);
  });
});

describe("stepTrade (TP x10 / 30 days / no stop)", () => {
  const cfg = { tp: 10, maxHoldDays: 30, cost: 0.03, minLiqUsd: 1000, deadHours: 24, pendingMaxMinutes: 60, everyMinutes: 5 };
  const t0 = new Date("2026-11-01T00:00:00Z");
  const at = (h: number) => new Date(t0.getTime() + h * 3600_000);
  const q = (price: number, liqUsd = 50_000) => ({ price, pair: "0xpair", liqUsd });
  const open = { status: "open" as const, buyAt: t0, openedAt: t0, entryPrice: 1, lastPrice: 1, lastPriceAt: t0, maxMultiple: 1 };

  it("opens a pending trade at the first liquid price", () => {
    const u = stepTrade({ status: "pending", buyAt: t0 }, q(2), at(0.1), cfg);
    expect(u).toMatchObject({ status: "open", entryPrice: 2, maxMultiple: 1 });
    expect(stepTrade({ status: "pending", buyAt: t0 }, q(2, 10), at(0.1), cfg)).toEqual({});
    expect(stepTrade({ status: "pending", buyAt: t0 }, null, at(2), cfg)).toEqual({ status: "no_price" });
  });

  it("never stops out on a drawdown", () => {
    const u = stepTrade(open, q(0.2), at(5), cfg);
    expect(u.status).toBeUndefined();
    expect(u.lastPrice).toBe(0.2);
  });

  it("takes profit at exactly x10", () => {
    const u = stepTrade(open, q(13), at(48), cfg);
    expect(u).toMatchObject({ status: "closed", exitReason: "tp", exitPrice: 10 });
    expect(u.returnPct).toBeCloseTo(8.97);
  });

  it("sells after 30 days at the last price", () => {
    const u = stepTrade(open, q(1.5), at(30 * 24), cfg);
    expect(u).toMatchObject({ status: "closed", exitReason: "time", exitPrice: 1.5 });
    expect(u.returnPct).toBeCloseTo(0.47);
  });

  it("marks a token dead after 24h without liquidity", () => {
    expect(stepTrade(open, null, at(10), cfg)).toEqual({});
    expect(stepTrade(open, q(0.5, 100), at(25), cfg)).toMatchObject({ status: "closed", exitReason: "dead", returnPct: -1.03 });
  });
});

describe("parseCsv", () => {
  it("lowercases, dedupes and drops invalid addresses", () => {
    const rows = parseCsv(
      "address,source,label,roi_coef\n0xAAAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,research-A3,a3-1,0.25\n" +
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,uptrend-winner,dup,1\n" +
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,research-A2,a2-1,\nnope,x,y,0\n"
    );
    expect(rows).toEqual([
      { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", source: "research-A3", label: "a3-1", roiCoef: 0.25 },
      { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", source: "research-A2", label: "a2-1", roiCoef: null },
    ]);
  });
});
