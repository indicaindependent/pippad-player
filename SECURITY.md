# Security Policy

## Scope & threat model

PipPad Player is a child-facing kiosk app. The 4-digit PIN on parent/admin mode
is a **child-resistance measure, not a security boundary**. Do not treat it as
authentication for anything sensitive.

If you deploy PipPad on a publicly reachable URL, you should put the `/admin`
route behind real access control — e.g. [Cloudflare Zero Trust Access](https://developers.cloudflare.com/cloudflare-one/applications/)
requiring your email + device posture. The worker is designed to sit comfortably
behind WARP/Access.

Never commit secrets. This project needs **no API keys** (YouTube search uses the
public InnerTube endpoint). The only binding is a KV namespace id, which is not a
secret but should still come from your own account.

## Reporting a vulnerability

Found something? Please report responsibly via Bluesky DM to
[@indicaindependent](https://bsky.app/profile/indica.osintnet.uk) rather than
opening a public issue. I'll acknowledge within a few days.
