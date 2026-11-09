# RealCryptoCap Market Brief for Anna AI OS

An Anna AI OS app that generates trader-ready crypto market briefs from live data.

Pick coins. Hit Generate. Get a short brief with the bias, key levels and what to watch, composed by AI from live prices, 24h change, the RealCryptoCap 24h analysis and current headlines.

## What it does

- `get_price` : current USD price, market cap and rank for one or more coins.
- `get_24h_change` : 24h percent change, plus 24h high/low and volume when the provider supplies them.
- `get_ai_summary` : the full brief. Live data plus AI 24h analysis plus headlines get composed into a short trader brief.

The app ships an interactive UI (coin picker, generate action, brief card, loading and error states) and a working Executa backend. Inside Anna you can also just ask in chat: "give me a market brief on BTC and ETH".

## Real market cap methodology

RealCryptoCap measures market cap without the noise. Stablecoins and fiat pegs, wrapped and staked receipt assets, tokenized stocks, funds, treasuries and RWA products, commodities and other duplicate or non-native assets are excluded. If a coin is missing from the results, that is why.

## Pricing and tiers

This Anna app includes a **limited free tier** so anyone can run a brief.

The full RealCryptoCap product line is paid.

- **API/CLI/MCP: Pro/Ultra only ($25/mo or $59/mo). API key required. Not free.**
- Pro: $25/mo or $250/yr. Ultra: $59/mo or $588/yr.
- Full product: real crypto market cap, native Top 500, coin lookup, market briefs, signals, derivatives and more.

Get the MCP at **[realcryptocap.com/mcp](https://realcryptocap.com/mcp)** (API docs: [realcryptocap.com/api](https://realcryptocap.com/api)).

## Project layout

```
manifest.json          Anna App manifest (schema 2, UI + executa + prompt directives)
app.json               store listing metadata
bundle/                interactive UI (static SPA served in the Anna iframe)
  index.html
  app.js
  styles.css
executas/
  realcryptocap-market-brief/
    realcryptocap_market_brief_plugin.py    Executa plugin (stdio, JSON-RPC 2.0)
    pyproject.toml
```

## How the AI core works

`get_ai_summary` does not just display numbers. It fetches live price and 24h data from RealCryptoCap, pulls the RealCryptoCap AI 24h market analysis and a few headlines, then asks the Anna host LLM to compose a fresh brief from those inputs. The primary function of the app is AI reasoning over live market data, not a static feed.

If host LLM sampling is unavailable (not granted, quota, or a host that does not negotiate it), the tool degrades gracefully and still returns the AI analysis text plus all the live data.

## Local development

Prerequisites: Node 22+, `uv`, and the `anna-app` CLI (`npm i -g @anna-ai/cli`).

```bash
anna-app doctor
anna-app dev          # mock dashboard at http://localhost:5180/
anna-app validate --strict
```

The Executa is plain Python stdlib. No third-party dependencies. Smoke test it directly:

```bash
echo '{"jsonrpc":"2.0","method":"describe","id":1}' | python3 executas/realcryptocap-market-brief/realcryptocap_market_brief_plugin.py
echo '{"jsonrpc":"2.0","method":"invoke","id":2,"params":{"tool":"get_price","arguments":{"coin_ids":"bitcoin"}}}' \
  | python3 executas/realcryptocap-market-brief/realcryptocap_market_brief_plugin.py
```

## Configuration

| Variable | Meaning |
| --- | --- |
| `RCI_API_KEY` | Optional. RealCryptoCap Pro/Ultra API key. When set, the free-tier call budget is skipped and you can point the tools at the Pro `/api/v1` surface. |
| `RCI_BASE` | Optional. Defaults to `https://realcryptocap.com`. |

## Data sources

- `https://realcryptocap.com/api/cg?topCoins=1` : filtered native coins with price, 24h change, cap and volume. Cached with multi-provider fallback.
- `https://realcryptocap.com/api/market-analysis` : RealCryptoCap AI 24h market analysis.
- `https://realcryptocap.com/api/news` : headline context.

## Links

- RealCryptoCap: [realcryptocap.com](https://realcryptocap.com)
- Paid API, CLI and MCP: [realcryptocap.com/api](https://realcryptocap.com/api)
- Full MCP server (Pro/Ultra): `realcryptocap-mcp`
- Anna developer docs: [anna.partners/developers](https://anna.partners/developers)

## License

See LICENSE. Contact: contact@realcryptocap.com
