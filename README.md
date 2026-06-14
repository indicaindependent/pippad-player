# 📺 PipPad Player

> A calm, low-stimulation video player for kids — built as a single Cloudflare Worker. Grayscale, warm-tone, slow-playback presets designed to reduce sensory overload. Search YouTube (no API key) or play your own local/HTTP/NAS files.

PipPad turns any cheap screen (a Raspberry Pi, an old tablet, any browser) into a **de-stimulation video station**. It was built for a neurodivergent kid who gets overwhelmed by the saturated, fast, dopamine-spike design of modern kids' media — so every default leans calm: muted color, reduced contrast, gentler speed, lower volume.

It's one file, no build step, no database server, and **no YouTube API key required**.

---

## ✨ What Is This

A self-contained Cloudflare Worker that serves three things from one URL:

- **`/player`** — the video player UI (YouTube search + local/HTTP/NAS playback)
- **`/`** — "PipOS" shell: boots straight to the player in child mode, or shows a minimal home screen in parent mode
- **`/admin`** — PIN-gated settings (presets, defaults, media config)

Settings persist per-device in a Cloudflare KV namespace. That's the only binding you need.

---

## 🎨 Features

- **De-stimulation engine** — CSS-filter overlay applies grayscale / contrast / brightness / warm-tone / saturation over *any* video (YouTube embeds **and** local files).
- **Three presets** — `Calm` · `Focus` · `Sleep` — each tuned for color, speed, and volume. Plus full manual sliders.
- **YouTube search with no API key** — uses YouTube's public InnerTube endpoint server-side, proxied as clean JSON. Embeds via privacy-friendly `youtube-nocookie.com`.
- **Play your own media** — local files (`<input type=file>`), direct HTTP `.mp4` URLs, or NAS/SMB shares (via a tiny local HTTP server on the device — instructions included).
- **Parent / child mode** — child mode locks to the player; a hidden corner tap + 4-digit PIN unlocks the parent home screen.
- **Kiosk-ready** — pairs with Chromium kiosk mode on a Raspberry Pi for a dedicated appliance.

---

## 🏗️ Architecture

```
                    your-domain.com
                          │
                 ┌────────▼─────────┐
                 │  pip-player-worker │  (single CF Worker, ~1.2k lines)
                 │                    │
   GET /         │  PipOS shell       │  parent/child auto-boot
   GET /player   │  Player UI         │  search + filters + controls
   GET /admin    │  Settings (PIN)    │
   /api/yt/*     │  YouTube proxy     │──▶ youtube.com InnerTube (no key)
   /api/settings │  KV read/write     │──▶ ┌──────────┐
                 └────────────────────┘    │  PIP_KV  │ (settings, PIN)
                                            └──────────┘

   Optional device:  Raspberry Pi → Chromium kiosk → your-domain.com
                     NAS/SMB → mounted locally → tiny HTTP server → player
```

---

## 🚀 Self-Hosting

You need a free Cloudflare account and [`wrangler`](https://developers.cloudflare.com/workers/wrangler/).

```bash
# 1. Clone
git clone https://github.com/indicaindependent/pippad-player.git
cd pippad-player

# 2. Create the KV namespace and copy the returned id into wrangler.toml
npx wrangler kv namespace create PIP_KV

# 3. Deploy
npx wrangler deploy
```

Open your worker URL, tap into `/admin`, set a 4-digit PIN, pick a default preset — done. For the Raspberry Pi kiosk + NAS/SMB setup, see the in-app `/admin` instructions panel.

> **Security note:** `/admin` is PIN-gated in-app, but the PIN is a child-resistance measure, not a security boundary. If you expose this publicly, put the `/admin` route behind real access control (e.g. Cloudflare Zero Trust Access). See [SECURITY.md](SECURITY.md).

---

## 🤝 Contributing

Forks and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). This started as a one-kid project; if it helps yours, that's the whole point.

## 📄 License

[MIT](LICENSE) © 2026 Indica Independent

---

<sub>Built by [@indicaindependent](https://github.com/indicaindependent) · part of an indie tooling stack for people who'd rather own their software than rent it.</sub>
