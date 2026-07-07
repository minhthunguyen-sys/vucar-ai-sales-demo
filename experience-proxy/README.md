# Vucar demo — "Trải nghiệm thử" live-mirror proxy

A tiny **read-only** endpoint that lets the static demo show an investor's *real* lead
being worked by the agent — real Zalo messages + real agent thinking — updating live.

It only runs `SELECT` queries through the **Metabase query API**. No writes, no direct DB
credentials in the browser, nothing touches production behaviour.

```
phone ──▶ leads_relation (db=11)  ─▶ thread + name
      ──▶ leads⨝cars     (db=2)   ─▶ car_id + car label
      ──▶ messages        (db=11)  ─▶ chat (both sides)
      ──▶ pipeline_logs   (db=9)   ─▶ agent thinking + tools + guardrail
                                     ▼
                       { found, name, car, avatar, feed[] }  ──▶ demo step 3
```

## Deploy (Vercel — ~2 min)

1. `cd experience-proxy && vercel` (or push this folder to a Vercel project).
   `api/lead.js` is auto-served at `/api/lead`.
2. Set env vars in the Vercel project:

   | var | value |
   |-----|-------|
   | `METABASE_URL` | your Metabase base URL, e.g. `https://metabase.vucar.net` |
   | `METABASE_API_KEY` | a Metabase **API key** for a read-only account (Admin → Settings → API Keys) |
   | `ALLOW_ORIGIN` | `https://minhthunguyen-sys.github.io` (the demo origin; or `*` while testing) |
   | `DB_CRM` / `DB_E2E` / `DB_ZALO` | optional, default `2` / `9` / `11` |

3. Test: `curl "https://<deploy>/api/lead?phone=0939706706"` → should return `{ found:true, ... }`.
4. In `vucar-ai-sales-demo.html` set:
   ```js
   const PROXY_URL = 'https://<deploy>/api/lead';
   ```
   Redeploy the demo. Done — step 3 now mirrors real leads by phone.

## Cloudflare Worker variant

Same logic; replace the `export default handler(req,res)` signature with
`export default { async fetch(request, env) { … } }`, read `env.*` instead of
`process.env.*`, parse `?phone=` from `new URL(request.url)`, and return a `Response`
with the same CORS headers.

## Notes

- **Privacy:** intended for the *investor's own* lead (data they just entered). Don't point
  it at arbitrary third-party phone numbers in a public setting.
- **Timing:** a brand-new lead needs ~1–few minutes before the first agent run produces
  logs. The bot-call screen (step 2) is the buffer; step 3 polls and fills in as data lands.
- **Fallback:** if `PROXY_URL` is empty or the fetch fails, the demo shows a real anonymised
  sample lead so it always works offline / on GitHub Pages.
