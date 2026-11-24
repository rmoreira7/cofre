# cofre

A personal finance PWA that runs entirely on the phone.

- The site serves **code only**. No data, keys or personal rules are ever committed or hosted.
- The phone talks directly to the [Pluggy](https://pluggy.ai) Open Finance API, and keeps credentials and the
  data snapshot encrypted in IndexedDB (WebCrypto, PIN-derived key).
- No framework, no runtime dependencies. Besides Pluggy, the phone calls two public APIs with nothing personal in
  the request: AwesomeAPI (currency codes, for foreign balances) and the Central Bank (today's CDI, for Rendimentos).

## Leak gate

`scripts/check-no-personal-data.sh` runs in CI on every push (generic patterns) and locally before every
push with a private denylist kept outside the repo:

```bash
DENYLIST=/path/outside/repo/denylist.txt scripts/install-hooks.sh
```

## Daily watcher

`watch/` runs once a day from `.github/workflows/watch.yml` (08:00 BRT). It pulls Pluggy with the same `src/lib`
the app uses and sends the decisions that are due to a private Telegram chat: maturities at D-7/3/1/0 with the
ladder's split, card bills at D-3/1, renewals (subscriptions, annual plans) at D-30/7/1/0, and a Monday digest (idle cash with its cost
per business day, FGC, failed banks, expiring consents). The renewal list is a private Actions secret (`COFRE_RENEWALS`)
and a `renewals` list in the rules file, never in this repository.

Each decision is its own Telegram message with **✓ Feito / ⏰ Adiar** buttons (then **↩ Desfazer**). `taps.yml` picks up
the taps every ~5 minutes and edits the message; the daily run stops repeating a decided item, checks it against the
bank data with the app's `outcome()`, and reports once (confirmed, or not found: it then speaks again). That memory is
`state.enc` on the `watch-state` branch, AES-256-GCM with the `COFRE_STATE_KEY` secret: public repository, unreadable
file. Decision ids are the app's (`src/lib/decisions.js`). This is
the one place data leaves the phone: the message text goes through Telegram. Credentials live only in the repo's
Actions secrets, and the logs carry counts only.

With `OPENAI_API_KEY` set, each maturity message gets a one- or two-sentence explanation (`watch/explain.mjs`,
Responses API, `store: false`). OpenAI receives only that decision's facts as the rules computed them (issuer,
amount, date, suggested split, which ladder rungs are below and above the target, CDI cost per business day). The
model compares nothing itself (given the shares and the target it got above/below wrong in testing); every number in
its reply must appear verbatim in those facts, and a reply that does not, or that leaks a field name, is dropped.

## Architecture

```
src/
  lib/        pure domain logic, no DOM: Pluggy client, vault, categorize, spend, model, income, ladder, projection…
    view.js   the view: everything the screens show, derived from the vault's data once per change
  ui/         chrome shared by every screen
    shell.js  title bar, empty state, download helper
    tabbed.js tabbedScreen(): a tab = header + sub-tab pills + one pane per sub-tab
  screens/
    home.js   Início: a summary whose rows open the sub-tab where each thing is dealt with
    <tab>/index.js       the tab: its sub-tabs, and the context they share (built once per render)
    <tab>/<sub-tab>.js   one sub-tab: id, label, render(t, ctx) → HTML, optional bind(pane, t, ctx, { repaint, rerender })
  main.js     vault, refresh, routing (tab + sub-tab, remembered per device), auto-lock
```

- **Tabs:** Gastos (Ciclo · Grupos · Faturas · Histórico) · Investimentos (Carteira · Rendimentos · Vencimentos · Regras) ·
  Projeção (Cenários · Real × plano · Premissas) · Ajustes (Conexões · Metas · Segurança · App).
- A sub-tab owns its pane: `repaint()` redraws only it (UI state changed), `rerender()` the whole tab (data changed). A
  sub-tab that throws shows an error in its own pane and the others still work.
- Links between tabs are `data-go="tab:sub"`; pills are `data-sub="id"`. Both are handled once, in `main.js`.
- Adding a module: `node scripts/update-shell.mjs` refreshes the service worker's cache list (a test fails until you do).
- Tests: `npm test`. Besides the `lib` tests, every sub-tab is rendered against a fictional snapshot, and a static check
  fails when a screen module calls a function it never imports.
