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
