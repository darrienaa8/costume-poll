# 🎃 Costume Poll

Guests scan a QR code, type their favorite costume, and watch a live tally. No accounts, no dependencies, just Node 18+.

## Run it

```bash
cd costume-poll
node server.js
```

The terminal prints everything you need:

- **Guest link**: `http://localhost:3000/` (and your Wi-Fi address)
- **Host view**: `/host?key=…` (private, keep the key to yourself)
- **QR poster**: `/qr`

Set your own host key and port if you like:

```bash
HOST_KEY=my-secret-word PORT=8080 node server.js
```

## Pages

| Page | Who | What |
|---|---|---|
| `/` | Guests | One question, one box, one vote |
| `/results` | Everyone | Live ranked tally, leader highlighted (ties share the crown) |
| `/host` | You | Merge / split / rename entries, reset the poll |
| `/qr` | You | Printable QR poster, plus PNG and SVG download |

## Hosting it so phones can reach it

Pick one. Whichever you choose, **open `/qr`, paste in the link guests will use, and print or show it.**

### A. Your laptop + a tunnel (fastest, free, works on cellular too)
1. `node server.js`
2. In a second terminal: `cloudflared tunnel --url http://localhost:3000`
   (install cloudflared first: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>)
3. It prints an `https://something.trycloudflare.com` link. Use that as the guest link.

Your laptop must stay on and awake for the party. The link changes each time you restart the tunnel, so make the QR code *after* it starts.

### B. Your laptop on the party Wi-Fi (no internet needed)
Use the "same Wi-Fi" address the terminal prints (like `http://192.168.1.23:3000/`). Guests must be on the same network. Many guest networks and some routers block device-to-device traffic ("client isolation"), and if so this won't work. Use option A.

### C. A cloud host (Render, Railway, Fly.io…)
Push this folder to a GitHub repo and create a **Node web service** with start command `node server.js`. Set the `HOST_KEY` environment variable. No build step or install needed.
- Free tiers may **sleep when idle**. Open the site a few minutes before the party to wake it.
- Free disks are often **temporary**: votes survive restarts only if the host gives you a persistent disk (point `DATA_FILE` at it). For one party night that usually doesn't matter.

## How the rules work

- **One vote per device.** Each phone gets an anonymous cookie, and the browser also keeps a local-storage flag. Either one blocks a second vote, so clearing just one doesn't help. Repeat visitors see "You've already voted. Thanks!" and go to the results.
  *Limit:* this is a casual device check, not security. A guest in a private window or a different browser can vote again. Fine for a party.
- **Grouping.** Matching ignores case, punctuation, accents and extra spaces; skips filler words (*the, from, as, costume…*); treats a shorter answer whose words all appear in a longer one as the same ("Gina" = "Gina from Martin", "the witch" = "witch"); and forgives small typos ("wtich", "darth vadar", "spider man"). The display name is the most common spelling, shortest on ties.
- **Fixing mistakes** in `/host`: tick two or more entries and **Merge selected**, or tap ▾ on an entry and **Split out** a spelling. ✏️ renames an entry. Merges and splits stick for future votes.
- **Reset** wipes all votes and lets everyone vote again.

## Files

```
server.js         HTTP server and API (no dependencies)
lib/grouping.js   answer matching and display names
lib/poll.js       poll state, saved to data/poll.json
public/           the pages, styles, and a small QR generator (qr.js)
```

The Halloween font (Creepster) loads from Google Fonts when guests have internet; otherwise a spooky-ish fallback font is used.
