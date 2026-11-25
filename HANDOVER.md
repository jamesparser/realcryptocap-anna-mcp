# Handover: RealCryptoCap Market Brief (Anna AI App Builder Program)

Updated 2026-11-10. Owner: Casey / Node0 Data Systems.

## Status
- Anna app **@realcryptocap/realcryptocap-market-brief** (app_id 848) is **pending_review**, v0.1.9 pinned for review (resubmitted 2026-11-25: "Since your last visit" panel; simplified UI, no stale brief on open, source shown as RealCryptoCap (prices: HTX), free Top 50 MCP link). Anna sends no email; check with `anna-app apps status realcryptocap-market-brief`.
- Tested end to end inside Anna's cloud agent (linux-x86_64): live prices, rank, market cap, 24h change, AI brief via host sampling, headlines, MCP upsell.
- Listing is complete: logo, 2 screenshots, homepage https://realcryptocap.com, support /support, privacy /legal. Category `data` (Anna has no finance category).
- A reminder is scheduled for 2026-11-11 07:03 UTC to check the review status.

## Deadlines and program rules
- DoraHacks hackathon 2349: final deadline **2026-11-30 15:59 UTC**. https://dorahacks.io/hackathon/2349/detail
- The final submission must be the **approved, published** Anna app. Submit the DoraHacks BUILD after approval. Casey must be signed in to DoraHacks.
- Grants are based on monthly active users: 200+ in a calendar month for Tier E ($50). Separately, builders get 70% of the profit when users run the app on Anna's paid credits. Hitting 200 users by Nov 30 is unlikely; confirm in the Anna Discord whether apps can still join after Nov 30.

## Product rules (from Casey)
- Free on Anna: prices, rank, market cap, 24h change, the AI brief and headlines only.
- Do **not** give away Fear & Greed, signals, derivatives, long/short, ETF flows or TraderSpy. The plugin's `_scrub()` plus prompt rules enforce this. Do not mention or market TraderSpy.
- Upsell to the MCP plan at https://realcryptocap.com/mcp (currently redirects to /api). Paid plans: Pro $25/mo, Ultra $59/mo; an MCP-only tier at about $12–15/mo has been discussed.

## Identities
- Anna account: Casey's Google sign-in, developer handle `realcryptocap`.
- Executa tool_id: `tool-jasonparser-realcryptocap-market-brief-srwkkp4n`. The minted ID contains the old handle and cannot change. Current executa version 0.1.4, visibility app_bundled.
- CLI: `anna-app` (@anna-ai/cli 0.1.63) at ~/.local/node/bin. Host https://anna.partners. PAT in ~/.config/anna/credentials.json, expires about 2027-02.

## Layout
- `manifest.json`: app manifest. `required_executas` uses the real tool_id.
- `app.json`: store metadata (slug, version, category, description).
- `bundle/`: static SPA UI. `bundle/listing/` hosts the screenshots and logo, served at https://anna.partners/anna-apps/realcryptocap/realcryptocap-market-brief/0.1.4/listing/
- `executas/realcryptocap-market-brief/`: Python stdlib plugin, `executa.json` (binary distribution), and `manifest.json` (the describe output, which must stay in sync). `dist/` is gitignored and holds the PyInstaller **--onedir** archives.

## How to release a change
1. Edit the plugin and bump `MANIFEST.version`. Regenerate `executas/.../manifest.json` from the `describe` output.
2. Build the onedir archives with Python 3.12 from uv `--python-preference only-managed`, so the result stays compatible with older glibc. Use `pyinstaller --onedir --name realcryptocap-market-brief`, copy `manifest.json` into the folder, then `tar czf` the folder contents.
   - linux-x86_64: build on any x86_64 Linux. This is the platform Anna's cloud agent uses.
   - darwin-arm64: build on the Mac.
3. Bump `executa.json` version, then run `anna-app executa publish` from the executa directory.
4. Bump `app.json` version, then run `anna-app apps publish` from the repo root.
5. Run `anna-app apps submit-review`, which re-pins the review to the newest version.

## Gotchas already hit
- Each tool's `parameters` must be a **list** of `{name, type, required, description}`. Anna rejects JSON-Schema objects with "describe handshake failed".
- The `describe` name must equal the minted tool_id. The UI (`bundle/app.js`) must call that tool_id.
- Use onedir, not onefile: the `describe` call times out after 5 s.
- Binaries upload content-addressed. Check sha256 before publishing, because a stale tarball once went out as "cached".
- The local network inside the Cowork VM and cloud sandbox blocks anna.partners and realcryptocap.com. Run the CLI on the Mac natively.

## Next steps
1. When approved: add mobile support (`ui.form_factors: ["desktop","mobile"]`, checklist at https://anna.partners/developers/apps/app-mobile.md). Cut and submit a new version. No Apple or Google developer accounts are needed, because the app runs inside Anna's mobile app.
2. Get the App Store link and post the launch tweet (free features plus the realcryptocap.com/mcp upsell).
3. Submit the DoraHacks BUILD before Nov 30 15:59 UTC.
4. If rejected: read the review notes, fix, and resubmit.
5. Optional: push a public mirror. The jamesparser repo is empty because this Mac has no push access to it.

## Copy rules (from Casey)
- Source is shown as "RealCryptoCap (prices: HTX)". Do not name other upstream providers in the app, listing or README.
- No refresh-rate or news-feed details in the app; just the data timestamp and linked, timestamped headlines.
- MCP link copy: free MCP for the Top 50, Pro for the full data.
