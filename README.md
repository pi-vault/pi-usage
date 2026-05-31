# @pi-vault/pi-usage

Show aggregated Pi usage stats across your sessions.

## Install

```bash
pi install npm:@pi-vault/pi-usage
```

Then reload Pi:

```bash
/reload
```

## Usage

- `/usage` — show cached aggregated usage from your local Pi session history.
- `/usage --refresh` — refresh live provider usage cards (requires providers already configured in Pi).

## Setup note

Offline totals work from local Pi history. Live provider cards are shown only for providers you have already configured in Pi.

## Acknowledgements

This package borrows ideas from these projects for Pi UX and provider usage fetching approaches:

- [tmustier/pi-extensions](https://github.com/tmustier/pi-extensions)
- [marckrenn/pi-sub](https://github.com/marckrenn/pi-sub)
- [steipete/CodexBar](https://github.com/steipete/CodexBar)

## Development Setup

```bash
pnpm install
pnpm test
pnpm check
pnpm pack --dry-run
```

## License

MIT
