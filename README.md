# Vucar AI Sales Agent — Interactive Demo

Interactive walkthrough of Vucar's autonomous AI sales agent, built on a **real deal** (Hyundai Santafe 2.5L HTRAC 2021, Hà Nội, closed 889M VND in 3 days).

- **Left:** the product surface — Zalo chat + Sierra-style action cards (booking, dealer bids, follow-up, close & deposit, self-learning).
- **Right:** the real orchestrator (Claude) chain-of-thought trace per stage.

Open `index.html` in a browser, or deploy the folder as-is (static site).

## Deploy
- **Vercel / Netlify:** import this repo → framework "Other" → publish directory = root. No build step.
- **Any static host:** upload `index.html` + `assets/`.

Data source: real traces from `agent_pipeline_logs` + `agent_skills` / `agent_insights`. Customer name and phone are partially masked.
