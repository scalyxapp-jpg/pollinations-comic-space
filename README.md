---
title: Pollinations Comic Page
emoji: 🖼️
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 6.30.0
app_file: app.py
pinned: false
license: mit
---

# Pollinations Comic Page

One idea in, a comic page out. A text model writes the panel script, an image model
draws each panel, and the page is assembled with its captions underneath.

Built for the Pollinations [quest #17249](https://github.com/pollinations/pollinations/issues/17249).

**Visitors sign in with their own Pollinations account**, so the requests are billed to
their own Pollen and this Space never runs on a key that can dry up.

## Use it

1. Press **Sign in with Pollinations**. A short code appears.
2. Open the link, enter the code, approve. The Space receives its own key for your
   account — that is the standard RFC 8628 device flow, so nothing has to be
   redirected back into this Space.
3. Type an idea, pick 2, 4 or 6 panels, press **Make the comic**.

You can also paste an API key from <https://enter.pollinations.ai/keys> instead of
signing in. A pasted key lives in the browser session only and is never written to disk.

Getting a code and a key takes about 20 seconds, and a page takes roughly 10 seconds per
panel.

## Make it your own

- **Duplicate this Space** (⋮ → Duplicate this Space). It runs on your account at once,
  with your visitors signing in as above.
- **Add an app key (optional).** Create an App Key at
  <https://enter.pollinations.ai/keys> and set it as a Space secret named
  `POLLINATIONS_APP_KEY`. Visitors who sign in are then attributed to your app, so you
  earn your share of what they spend. Without the secret, sign-in still works and
  visitors still pay with their own Pollen — the app is simply not attributed.
- **Change the comic.** The panel script lives in `SCRIPT_SYSTEM_PROMPT` in `comic.py`;
  the layout is `panel_grid`, which takes a column count. Captions are drawn with PIL,
  so a speech-bubble layout is a change in one function.
- **Change the models.** Two boxes under _Models_ on the page, or the defaults
  `DEFAULT_TEXT_MODEL` and `DEFAULT_IMAGE_MODEL` in `comic.py`. Any id from
  <https://gen.pollinations.ai/models> works.

## How it works

| Step     | Call                                                                  |
| -------- | --------------------------------------------------------------------- |
| Sign in  | `POST /api/device/code`, then `POST /api/device/token` until approved |
| Script   | `POST /v1/chat/completions` on a text model                           |
| Panels   | `GET /image/{prompt}?model=…&width=512&height=512`                    |
| Assembly | Pillow, in `panel_grid`                                               |

Two details worth knowing, because both cost an afternoon otherwise:

- The image endpoint requires **at least 256 px per side**; smaller requests are refused
  with `400`. Panels are 512 px and scaled down for the page.
- Models do not always answer with clean JSON, so `parse_panels` accepts JSON inside a
  code fence or surrounded by prose, and falls back to line-by-line captions. A rambling
  model still produces a page instead of an error.

## Tests

```bash
pip install -r requirements.txt pytest
pytest test_comic.py -q      # 10 tests, no API key needed
```

They cover the parser fallbacks and the page geometry, which is the arithmetic worth
pinning down.

## Costs and limits

One page is one text request and one image request per panel. On the free tier that is
a fraction of a Pollen; see <https://gen.pollinations.ai/models> for current prices. The
Space adds no cost of its own — it has no key and stores nothing about you.

## License

MIT.
