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

- `/usage` — open the usage dashboard without forcing a live refresh. Use this for fast, side-effect-light inspection.
- `/usage:refresh` — force live provider refresh, rescan local history, then open the usage dashboard. Use this when you want the latest usage data (requires providers already configured in Pi).

## Setup note

Offline totals work from local Pi history. Live provider cards are shown only for providers you have already configured in Pi.

## Event API

`@pi-vault/pi-usage` emits:

- `usage-core:ready`
- `usage-core:update-current`

Both events send `{ state }` where `state` is a cloned `UsageCoreState` snapshot.

For late subscribers, request the current snapshot via `usage-core:request`:

```ts
import {
  USAGE_CORE_REQUEST_EVENT,
  type UsageCorePayload,
} from "@pi-vault/pi-usage/events";

pi.events.emit(USAGE_CORE_REQUEST_EVENT, {
  type: "current",
  reply: ({ state }: UsageCorePayload) => {
    // Render from latest cloned snapshot.
  },
});
```

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
