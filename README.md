# cofre

A personal finance PWA that runs entirely on the phone.

- The site serves **code only**. No data, keys or personal rules are ever committed or hosted.
- The phone talks directly to the [Pluggy](https://pluggy.ai) Open Finance API, and keeps credentials and the
  data snapshot encrypted in IndexedDB (WebCrypto, PIN-derived key).
- No framework, no runtime dependencies, no third-party requests.

## Leak gate

`scripts/check-no-personal-data.sh` runs in CI on every push (generic patterns) and locally before every
push with a private denylist kept outside the repo:

```bash
DENYLIST=/path/outside/repo/denylist.txt scripts/install-hooks.sh
```

## Daily watcher

`watch/` runs once a day from `.github/workflows/watch.yml` (08:00 BRT). It pulls Pluggy with the same `src/lib`
the app uses and sends the decisions that are due to a private Telegram chat: maturities at D-7/3/1/0 with the
ladder's split, card bills at D-3/1, and a Monday digest (idle cash, FGC, failed banks, expiring consents). This is
the one place data leaves the phone: the message text goes through Telegram. Credentials live only in the repo's
Actions secrets, and the logs carry counts only.

With `OPENAI_API_KEY` set, each maturity message gets a one- or two-sentence explanation (`watch/explain.mjs`,
Responses API, `store: false`). OpenAI receives only that decision's facts as the rules computed them (issuer,
amount, date, suggested split, ladder shares, CDI cost per business day), and every number in its reply must appear
verbatim in those facts or the reply is dropped.
