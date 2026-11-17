# Brand

| File                | What it is                                                    | Source                                                   |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `app-icon-1024.png` | The app icon: an off-white diamond on a dark rounded square   | `anur-living-map-mac/brand/hianur-mark-1024.png`         |
| `mark-1024.png`     | The diamond alone, dark on transparent, for light backgrounds | `anur-living-map-mac/brand/hianur-diamond-dark-1024.png` |
| `tokens.css`        | Colours, light and dark, and type for the app                 | Light from the UI mocks in the vault; dark made to match |

- The icon's colours are `#1F1B14` (dark) and `#F8F6F1` (off-white), warmer than the app's cool slate palette; it sits in the dock, so the two never meet on screen.
- The UI has one accent, `--blue`, used for previews and the single action on screen.
- Each colour is `light-dark(light, dark)`: the theme follows the system unless the app sets `data-theme` on `<html>`.
- Text colours pass WCAG AA in both themes, checked by `packages/desktop/src/brand.test.ts`.
- Two light colours differ from the mocks so they pass AA: `--graphite` is `#656E7B` (was `#7A8494`) and `--red` is `#BE402C` (was `#C2412D`).
- `--pencil` stays below 3:1; it only decorates thread outlines whose text already identifies them.
- Type has three roles: Avenir Next for the UI, Charter for decided text, and Iowan Old Style in italic for thinking.
- Re-export the icon at release time as an `.icns` for macOS from `app-icon-1024.png`.
