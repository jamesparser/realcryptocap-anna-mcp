"""RealCryptoCap Market Brief Executa for Anna AI OS.

Thin market-brief tool surface: get_price, get_24h_change, get_ai_summary.
Data plane is realcryptocap.com. The brief itself is composed by the Anna host
LLM via sampling, so the primary function is AI reasoning over live market data.

Stdlib only. No third-party dependencies, so the Cloud Agent can spawn it with
no install step beyond the plugin file itself.
"""

import json
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

RCI_BASE = "https://realcryptocap.com"
# Free tier: bounded calls per calendar day against realcryptocap.com.
# Pro/Ultra customers pass RCI_API_KEY and skip the budget.
FREE_DAILY_BUDGET = 80

MANIFEST = {
    "name": "tool-dev-realcryptocap-market-brief",
    "display_name": "RealCryptoCap Market Brief",
    "version": "0.1.0",
    "description": (
        "Real crypto market prices, 24h change, and AI-composed market briefs. "
        "Real market cap methodology excludes stablecoins, wrapped/staked receipts, "
        "and tokenized assets. Full RealCryptoCap API/CLI/MCP is Pro/Ultra only."
    ),
    "author": "Node0 Data Systems / RealCryptoCap <contact@realcryptocap.com>",
    "host_capabilities": ["llm.sample"],
    "tools": [
        {
            "name": "get_price",
            "description": (
                "Get current USD price, market cap, and rank for one or more native "
                "cryptocurrencies. Stablecoins, wrapped/staked receipts and tokenized "
                "assets are excluded by the RealCryptoCap filter. Pass CoinGecko ids "
                "such as bitcoin, ethereum, solana."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "coin_ids": {
                        "type": "string",
                        "description": "Comma separated CoinGecko ids, e.g. 'bitcoin,ethereum'. Default 'bitcoin'.",
                    }
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "get_24h_change",
            "description": (
                "Get 24 hour price change percent, 24h high/low, and 24h volume for "
                "one or more native cryptocurrencies."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "coin_ids": {
                        "type": "string",
                        "description": "Comma separated CoinGecko ids, e.g. 'bitcoin,ethereum'. Default 'bitcoin'.",
                    }
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "get_ai_summary",
            "description": (
                "Compose an AI market brief from live RealCryptoCap data. Fetches "
                "prices, 24h change, the RealCryptoCap AI 24h analysis and headline "
                "news, then asks the Anna host LLM to write a short trader brief with "
                "bias, key levels and movers. Returns the brief plus the raw inputs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "coin_ids": {
                        "type": "string",
                        "description": "Comma separated CoinGecko ids to focus on. Default 'bitcoin,ethereum'.",
                    }
                },
                "additionalProperties": False,
            },
        },
    ],
}

# ---------------------------------------------------------------- free tier
_budget_lock = threading.Lock()
_budget = {"day": "", "used": 0}


def _api_key():
    import os

    return (os.environ.get("RCI_API_KEY") or "").strip()


def _charge_free_call():
    """Enforce the free-tier daily budget. Raises when exhausted."""
    if _api_key():
        return
    day = time.strftime("%Y-%m-%d", time.gmtime())
    with _budget_lock:
        if _budget["day"] != day:
            _budget["day"] = day
            _budget["used"] = 0
        if _budget["used"] >= FREE_DAILY_BUDGET:
            raise RuntimeError(
                "Free tier limit reached for today. "
                "Upgrade to RealCryptoCap Pro or Ultra at https://realcryptocap.com/api "
                "and set RCI_API_KEY for unlimited calls."
            )
        _budget["used"] += 1


# ---------------------------------------------------------------- http
def _get_json(path_or_url):
    url = path_or_url if path_or_url.startswith("http") else RCI_BASE + path_or_url
    req = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "RealCryptoCap-Anna/0.1"})
    key = _api_key()
    if key and "/api/v1/" in url:
        req.add_header("Authorization", "Bearer " + key)
    with urllib.request.urlopen(req, timeout=12) as resp:
        return json.loads(resp.read().decode("utf-8"))


# RealCryptoCap brand filter: real market cap excludes stablecoins, wrapped/staked
# receipts, tokenized assets and commodities. Keep this list in sync with the
# realcryptocap.com asset filter when the market adds new pegs.
_STABLE_IDS = {
    "tether", "usd-coin", "dai", "binance-usd", "frax", "true-usd", "gemini-dollar",
    "liquity-usd", "first-digital-usd", "paypal-usd", "usdd", "usds", "usd1", "usde",
    "ethena-usde", "wrapped-bitcoin", "weth", "wrapped-eeth", "wrapped-steth",
    "coinbase-wrapped-btc", "renbtc", "staked-ether", "rocket-pool-eth",
    "mantle-staked-ether", "tether-gold", "pax-gold", "lombard-staked-btc", "solv-btc",
}
_STABLE_NAME_RE = re.compile(
    r"usd|eur|gbp|jpy|dai|pax|gold|wrapped|staked|steth|weth|wbtc|tbill|treasury|stock|bond|tokenized|figr_|usyc|usdy|usdgo|rlusd|jaaa|ustb|bfusd|pyusd|usdf|usdg|eursafo|ousd|gho",
    re.I,
)


def _is_native(c):
    cid = (c.get("id") or "").lower()
    if cid in _STABLE_IDS:
        return False
    if _STABLE_NAME_RE.search(c.get("name") or "") or _STABLE_NAME_RE.search(c.get("symbol") or ""):
        return False
    return True


def _cg_markets(coin_ids):
    """Price + 24h change from the RealCryptoCap filtered top-coins endpoint.

    /api/cg?topCoins=1 returns native assets only (stables, wrapped and
    tokenized already removed by the realcryptocap.com filter) and is cached
    with multi-provider fallback. We pull the top list and filter to the
    requested ids so the client always sees our methodology applied.
    """
    wanted = [c.lower() for c in coin_ids]
    # Pull a deep enough universe to cover ordinary requests in one call.
    limit = 300 if len(wanted) <= 3 else 600
    rows = _get_json("/api/cg?topCoins=1&limit=%d" % limit)
    coins = rows.get("coins") if isinstance(rows, dict) else rows
    by_id = {}
    for c in coins or []:
        cid = (c.get("id") or "").lower()
        if cid:
            by_id[cid] = c
    out = []
    for cid in wanted:
        c = by_id.get(cid)
        if not c:
            out.append({"id": cid, "symbol": cid.upper(), "name": cid, "price": None, "not_found": True})
            continue
        if not _is_native(c):
            continue
        out.append(
            {
                "id": c.get("id"),
                "symbol": (c.get("symbol") or "").upper(),
                "name": c.get("name"),
                "price": c.get("current_price"),
                "market_cap": c.get("market_cap"),
                "rank": c.get("market_cap_rank"),
                "change_24h_pct": c.get("price_change_percentage_24h"),
                "high_24h": c.get("high_24h"),
                "low_24h": c.get("low_24h"),
                "volume_24h": c.get("total_volume"),
            }
        )
    return out


def _market_analysis():
    try:
        return _get_json("/api/market-analysis")
    except Exception:
        return {}


def _news_headlines(limit=4):
    try:
        data = _get_json("/api/news")
        items = data.get("items") if isinstance(data, dict) else data
        out = []
        for it in (items or [])[:limit]:
            out.append({"title": it.get("title"), "source": it.get("source"), "date": it.get("date")})
        return out
    except Exception:
        return []


# ---------------------------------------------------------------- sampling
_agent_requests = queue.Queue()
_host_responses = {}
_host_lock = threading.Lock()


_EOF = object()


def _reader():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        if "method" in msg:
            _agent_requests.put(msg)
        else:
            with _host_lock:
                q = _host_responses.pop(msg.get("id"), None)
            if q is not None:
                q.put(msg)
    _agent_requests.put(_EOF)


def _send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _sample(invoke_id, prompt, max_tokens=520):
    """One host LLM completion. Raises on any sampling failure."""
    rid = str(uuid.uuid4())
    q = queue.Queue()
    with _host_lock:
        _host_responses[rid] = q
    _send(
        {
            "jsonrpc": "2.0",
            "id": rid,
            "method": "sampling/createMessage",
            "params": {
                "messages": [{"role": "user", "content": {"type": "text", "text": prompt}}],
                "maxTokens": max_tokens,
                "systemPrompt": (
                    "You are a crypto market analyst writing a short brief for a trader. "
                    "Be direct. State the bias first, then key levels, then what to watch. "
                    "No hype, no financial advice disclaimers, no bullet-point spam. "
                    "Use plain sentences. Keep it under 180 words."
                ),
                "temperature": 0.3,
                "includeContext": "none",
                "metadata": {"executa_invoke_id": invoke_id},
            },
        }
    )
    resp = q.get(timeout=90)
    if "error" in resp:
        raise RuntimeError("sampling failed: " + str(resp["error"]))
    return resp["result"]["content"]["text"]


# ---------------------------------------------------------------- tools
def _parse_ids(raw, default):
    raw = (raw or "").strip()
    if not raw:
        return list(default)
    ids = [p.strip().lower() for p in raw.split(",") if p.strip()]
    return ids[:8] if ids else list(default)


def _fmt_usd(n):
    try:
        n = float(n)
    except Exception:
        return None
    if n >= 1_000_000_000_000:
        return "$%.2fT" % (n / 1_000_000_000_000)
    if n >= 1_000_000_000:
        return "$%.2fB" % (n / 1_000_000_000)
    if n >= 1_000_000:
        return "$%.2fM" % (n / 1_000_000)
    if n >= 1:
        return "$%s" % ("{:,.2f}".format(n))
    return "$%.6f" % n


def _lines_for(rows):
    out = []
    for r in rows:
        ch = r.get("change_24h_pct")
        ch_s = ("%+.2f%%" % ch) if isinstance(ch, (int, float)) else "n/a"
        out.append(
            "%s (%s): %s, 24h %s, cap %s, rank %s"
            % (
                r.get("name") or r.get("id"),
                r.get("symbol") or "",
                _fmt_usd(r.get("price")) or "n/a",
                ch_s,
                _fmt_usd(r.get("market_cap")) or "n/a",
                r.get("rank") if r.get("rank") is not None else "n/a",
            )
        )
    return out


def _compose_brief(ctx, rows, analysis, news, prompt_extra=""):
    prompt = (
        "Write a crypto market brief.\n\n"
        "Live prices (RealCryptoCap, real cap methodology):\n"
        + ("\n".join(_lines_for(rows)) if rows else "no price rows")
        + "\n\nRealCryptoCap AI 24h analysis:\n"
        + (analysis.get("analysis") or analysis.get("title") or "none")
        + "\n\nHeadlines:\n"
        + ("\n".join("- %s (%s)" % (n.get("title"), n.get("source")) for n in news) if news else "none")
        + "\n"
        + prompt_extra
    )
    return _sample(ctx.get("invoke_id", "unknown"), prompt)


def invoke(tool, args, ctx):
    if tool == "get_price":
        _charge_free_call()
        ids = _parse_ids(args.get("coin_ids"), ("bitcoin",))
        rows = _cg_markets(ids)
        return {"success": True, "data": {"coins": rows, "provider": "realcryptocap.com", "tier": "pro" if _api_key() else "free"}}

    if tool == "get_24h_change":
        _charge_free_call()
        ids = _parse_ids(args.get("coin_ids"), ("bitcoin",))
        rows = _cg_markets(ids)
        slim = [
            {
                "id": r.get("id"),
                "symbol": r.get("symbol"),
                "name": r.get("name"),
                "change_24h_pct": r.get("change_24h_pct"),
                "high_24h": r.get("high_24h"),
                "low_24h": r.get("low_24h"),
                "volume_24h": r.get("volume_24h"),
            }
            for r in rows
        ]
        return {"success": True, "data": {"coins": slim, "provider": "realcryptocap.com"}}

    if tool == "get_ai_summary":
        _charge_free_call()
        ids = _parse_ids(args.get("coin_ids"), ("bitcoin", "ethereum"))
        rows = _cg_markets(ids)
        analysis = _market_analysis()
        news = _news_headlines()
        brief = None
        composed = False
        try:
            brief = _compose_brief(ctx, rows, analysis, news)
            composed = True
        except Exception as e:
            # Graceful degradation: still return the AI analysis and the data.
            brief = (
                (analysis.get("analysis") or "Market analysis unavailable.")
                + "\n\n(Data fetched live. AI composition was unavailable: %s)" % str(e)[:160]
            )
        return {
            "success": True,
            "data": {
                "brief": brief,
                "ai_composed": composed,
                "coins": rows,
                "analysis": analysis,
                "news": news,
                "provider": "realcryptocap.com",
                "tier": "pro" if _api_key() else "free",
                "upgrade": "Full RealCryptoCap API/CLI/MCP is Pro/Ultra only. https://realcryptocap.com/api",
            },
        }

    return {"success": False, "error": "unknown tool: %s" % tool}


def main():
    threading.Thread(target=_reader, daemon=True).start()
    while True:
        req = _agent_requests.get()
        if req is _EOF:
            break
        method = req.get("method")
        try:
            if method == "describe":
                _send({"jsonrpc": "2.0", "id": req.get("id"), "result": MANIFEST})
            elif method == "initialize":
                _send(
                    {
                        "jsonrpc": "2.0",
                        "id": req.get("id"),
                        "result": {
                            "protocolVersion": "2.0",
                            "serverInfo": {"name": "realcryptocap-market-brief", "version": "0.1.0"},
                            "capabilities": {"sampling": {}},
                        },
                    }
                )
            elif method == "health":
                _send({"jsonrpc": "2.0", "id": req.get("id"), "result": {"status": "ready"}})
            elif method == "invoke":
                params = req.get("params") or {}
                ctx = params.get("context") or {}
                result = invoke(params.get("tool"), params.get("arguments") or {}, ctx)
                _send({"jsonrpc": "2.0", "id": req.get("id"), "result": result})
            else:
                _send(
                    {
                        "jsonrpc": "2.0",
                        "id": req.get("id"),
                        "error": {"code": -32601, "message": "unknown rpc: %s" % method},
                    }
                )
        except Exception as e:
            _send(
                {
                    "jsonrpc": "2.0",
                    "id": req.get("id"),
                    "error": {"code": -32603, "message": str(e)},
                }
            )


if __name__ == "__main__":
    main()
