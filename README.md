# Futures Signal Lab v1.2

A Cloudflare Workers web app for researching 5-minute Binance futures trade setups. No exchange credentials, database, or paid market-data service are required. It does not place orders.

## v1.2 — scan interruption handling

An isolated network/timeout or server error now gets two retries (after 1.5 and 4 seconds), scheduled through the same shared request limiter. If it still fails, that contract is marked ERROR and scanning continues. Three consecutive contract failures pause the scan instead of issuing repeated failing requests. Explicit 403/451 access blocks and 418/429 rate limits still pause immediately, without retries or switching connections. A visible diagnostic line includes the market, symbol, and timeframe. The PROCESSED counter includes completed and failed analyses; the failures are counted separately. Browser DevTools request counters are not contract counts.

This fixes overly aggressive stopping, but does not establish the underlying cause of a particular network failure. Live access from the user's connection remains to be verified.

## Updating from an earlier version

Replace the existing project files in your GitHub repository with this folder's contents, preserving the current project root. Include the new `public/data.js` and `tests/data.test.js`; replace `public/app.js`, `public/index.html`, `public/style.css`, `src/worker.js`, `tests/engine.test.js`, `package.json`, and `package-lock.json`. Do not upload the ZIP itself or add an extra nested folder. Commit and allow Cloudflare to redeploy. Hard-refresh the site (Ctrl+Shift+R), verify the v1.2 header, leave **Market-data connection → Browser direct (default)** selected, and start scanning.

The default route now calls the official public Binance APIs directly from the visitor's browser. Cloudflare continues hosting the app, but does not forward market-data requests in this mode. The alternative Cloudflare server route is still selectable. There is no automatic route rotation after a block.

A 403 response indicates denied access; it does not conclusively identify a regional restriction. An IP/firewall rule can also cause it. A browser fetch may fail because of cross-origin (CORS) restrictions, the user's network, or a timeout. Both connection routes require permitted Binance access. No credentials are sent, and the app does not bypass access restrictions. A 418/429 pauses scanning and enforces at least a 60-second cooldown, honoring a longer Retry-After value. Live direct access must be confirmed from your deployed page; synthetic tests cannot verify your connection.

## Upload to GitHub and host on Cloudflare

1. Extract this ZIP. Create an empty GitHub repository named `futures-signal-lab` (private is fine).
2. On GitHub, choose **Add file → Upload files**. Upload the contents of the extracted `futures-signal-lab` folder, preserving `public`, `src`, and `tests`. `package.json` and `wrangler.jsonc` must be at the repository root. You do not need to upload the optional `repository.bundle`.
3. In Cloudflare, open **Workers & Pages → Create application**, choose the Git repository import option, and connect this repository. Choose a **Worker**, not a Pages-only static deployment.
4. Worker/project name: `futures-signal-lab` (must match `wrangler.jsonc`). Root directory: repository root. Build command: `npm run check && npm test`. Deploy command: `npm run deploy`. Node version: 22 or newer.
5. Deploy and open the generated `workers.dev` address. Press **Start live scan**. No Binance API key is needed.
6. Future commits to the production branch redeploy the app through Cloudflare's Git integration.

The remote GitHub repository and Cloudflare deployment have not been created by this package. No account tokens are included.

### Git command-line alternative

An optional portable Git history is included as `repository.bundle` beside this folder. You can clone it with `git clone repository.bundle futures-signal-lab` rather than initializing manually.

If using extracted source instead:

```bash
git init -b main
git add .
git commit -m "Initial futures scanner"
git remote add origin https://github.com/YOUR_USERNAME/futures-signal-lab.git
git push -u origin main
```

### Local development and direct deployment

Install Node.js 22+ and run in this folder:

```bash
npm ci
npm run dev
```

Open the local URL Wrangler prints. For direct deployment instead of Git integration:

```bash
npx wrangler login
npm run deploy
```

## What it analyzes

- Discovers **all currently TRADING USDⓈ-M and COIN-M contracts**, including dated futures returned by Binance. No fixed list or 50/100-contract cap.
- Fetches up to 180 closed candles for **5m, 15m, 30m, 1h, 4h, 1d**, requiring at least 150 valid closed candles in each interval. New listings without sufficient daily history remain visible as INSUFFICIENT.
- Calculates EMA20/EMA50, Wilder RSI14 and ATR14, volume expansion, two-candle-confirmed swing levels, hourly movement, and EMA extension.
- Tests **trend pullbacks**, **volume-confirmed range breakouts**, and **support/resistance rejection reversals**. A qualifying strategy plus multi-timeframe agreement is required; all three need not fire simultaneously.
- Checks liquidity, price extension, opposing 4h/daily trends, stop distance, structural target room, and configurable net reward/risk.
- Flags upward extension above 2.5 ATR from EMA20 or a 6% hourly rise; downward extension is symmetric. These are heuristic extension flags, not proof of manipulation or a prediction of reversal.
- Produces BUY/LONG, SELL/SHORT, or WAIT, with explanation. Plans use a candle-close reference entry and a +/-0.15 ATR entry zone, seven-bar structural stop plus 0.2 ATR buffer, and targets up to 1R/2R/3R bounded by structural room.
- Ranks qualifying results by rule-agreement score. This is **not a calibrated probability, profitability forecast, or historical win rate**.
- Allows fees, slippage, liquidity, and minimum reward/risk to be changed before restarting a scan.

## How to use the result

1. Use Best setups to see only fresh qualifying trades; All contracts explains waiting or failed results.
2. Open Details to inspect the direction, entry zone, stop, targets, higher-timeframe conditions, and support/resistance.
3. Check the current exchange price, spread, upcoming funding, and whether the stop or targets have already traded since the signal candle. The dashboard uses candle data, not a live order book or intrabar trade tracker.
4. Skip expired or already-moved setups. A plan expires at the next five-minute candle close. Plans do not execute or monitor a real position.
5. Paper-trade and validate before risking funds. Strategies have **not** been historically backtested or validated for positive expected returns.

The suggested 40%/35%/25% TP exit split is a discretionary illustration. Displayed net R:R is to TP3 for the entire position, not the lower blended payoff of partial exits. Fee/slippage estimates assume symmetric entry/exit costs near the entry price. Funding is excluded. COIN-M uses inverse settlement, so these price-space R:R estimates are not exact coin-denominated account P&L. No position sizing or leverage recommendation is made.

## Scanning and operating limits

This is a **single-user, browser-driven scanner**, not an unattended 24/7 backend. Keep the tab open and active; browsers can throttle background tabs. Three analysis lanes share a request scheduler (approximately 5 requests/second maximum). Closed higher-timeframe candles are reused locally until their next boundary; the Worker also caches upstream responses. The full universe is ordered by 24h dollar turnover, so the most liquid contracts appear first. Every contract is analyzed even if it fails the liquidity threshold.

The first full pass can exceed five minutes (800 contracts × six candle calls / 5 calls per second is approximately 16 minutes, before network latency). Subsequent passes reuse unchanged candles, but cannot promise every market will have a fresh analysis at every five-minute close. Results expire honestly; there is no fabricated coverage. After each pass the scanner waits for the next five-minute boundary, refreshes the universe/24h tickers, and starts another pass. Coverage is per pass. Each contract's six inputs are current as fetched, not one globally synchronized snapshot.

Cloudflare and Binance quotas are shared by traffic and may change. The browser throttle is per tab, not a globally coordinated IP limiter. Use one scanning tab. Publishing to many simultaneous users requires a centralized scheduler and shared results. On Cloudflare Free, repeated scanning consumes dynamic Worker requests; a cold 800-contract pass uses about 4,800 candle requests. These dynamic Worker costs apply only to Cloudflare server mode. Browser-direct mode sends these requests straight to Binance; it still consumes Binance rate limits. The Worker cache reduces Binance calls in server mode, but does not remove Worker invocations. Do not assume uninterrupted 24/7 operation on a free quota.

Binance may reject Cloudflare egress locations with 403/451 or rate-limit shared egress IPs with 418/429. The app pauses on these responses and displays the error; it does not rotate proxies or bypass regional restrictions. Validate live connectivity after deployment. If unavailable, a permitted data provider or backend location is required.

## Files

- `public/index.html`, `style.css`, `app.js`: responsive dashboard, scan scheduling and detail views.
- `public/engine.js`: deterministic signal calculations using closed candles.
- `public/data.js`: browser/server data connection, closed-candle request construction, and error handling.
- `src/worker.js`: optional constrained public Binance market-data proxy and caching.
- `wrangler.jsonc`: Worker and static asset deployment configuration.
- `tests/engine.test.js`: deterministic long/short plans, freshness, open-candle exclusion, cost/liquidity guards, and proxy validation/error behavior.

Run `npm run check` and `npm test`. The connection tests also cover direct endpoint selection, HTML error responses, network/CORS errors, and Retry-After handling. Tests use synthetic data; they verify implementation properties, not trading performance. Sample mode is visibly labeled and is never substituted for failed live market data.

## Official references

- Binance USDⓈ-M market data: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data
- Binance COIN-M market data: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-coin-m-futures/api/rest-api/market-data
- Cloudflare Git integration: https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/
- Cloudflare Worker limits: https://developers.cloudflare.com/workers/platform/limits/
