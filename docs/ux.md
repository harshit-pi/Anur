# UX

How Anur should feel to use. Read this before mocking or changing anything a person sees.

- Never make the experience worse than what people already use: a doc editor like Google Docs or Quip, or an agent like Claude Code. Anur works behind the scenes; the page reads and types as people expect.
- Not supporting something yet is fine. Removing or blocking something those tools already let people do is not.
- Get the core working and strong before adding features. Prefer fixing what exists to adding a new button, mark or panel.
- It should feel intuitive at first use. Mock a screen before building it, and drop anything a person would have to learn.
- No words explaining what people already know from those tools: no caption on a queued message, no banner saying what just happened, no mark saying a thing is done. If Claude Code or Google Docs shows it without words, so does Anur. Check every mock for such text before showing it.
- Anything offered in the corner goes through `Offers` (`packages/desktop/src/renderer/src/regions/Offers.tsx`): one card at a time, in its priority order, never in a window's first seconds or while a thread runs. An update is a pill in the status bar, never a card.
