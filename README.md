# Twisted Cafe

Internal POS for the Twisted Minds cafe. Replaces Loyverse (counter) and POS2 (room QR orders) with one system.

- **Counter** (Android tablet): ring up walk-ins, take cash / card / tab / free, print receipts.
- **Room orders**: each room has a QR card + a room code. Staff scan, enter the code and their name, and order. No tables.
- **Orders board**: the barista view lives on the same tablet. New → Preparing → Ready → Delivered, with a chime on new room orders.
- **Tabs**: charge employees, settle later (cash, card, payroll, write-off).
- **Rewards**: employees earn points per SAR spent and use them at the counter (staff only).
- **Reports**: sales by item, category, payment, walk-in vs room, room, hour, day, staff, customer. CSV export.
- **Live**: menus, sold-out items and order status update instantly over websockets.

Stack: Node 24 (built-in SQLite, Express, Socket.IO) + React/Vite/Tailwind. One process, one port, one data folder.

## Run locally

```bash
npm install          # also installs web/
npm run dev          # API on :8080, web with hot reload on http://localhost:5175
```
Production build on any machine: `npm run build && npm start`, then open http://localhost:8080/staff

## Deploy on Linux

Works on any 64-bit Linux (Ubuntu 22.04/24.04, Debian 12…). Everything lives in one data folder: `cafe.db` (SQLite), `.secret` (session key) and `backups/`.

### Quick install: ready-made image (easiest)

Every push to `main` publishes an image to `ghcr.io/mjebreen/twisted-cafe` (amd64 + arm64). On the server you only need Docker:

```bash
sudo apt install -y docker.io docker-compose-v2      # or Docker's own install script
sudo mkdir -p /opt/twisted-cafe && cd /opt/twisted-cafe
sudo curl -fsSLO https://raw.githubusercontent.com/Mjebreen/twisted-cafe/main/deploy/compose.yml
sudo docker compose -f compose.yml up -d
curl -s localhost:8080/api/health                    # {"ok":true,...}
```

- **Update:** `sudo docker compose -f compose.yml pull && sudo docker compose -f compose.yml up -d` (the database is kept).
- Pin a version instead of `latest` by editing the image line, e.g. `ghcr.io/mjebreen/twisted-cafe:1.4.0`.
- Or without compose: `docker run -d --name twisted-cafe --restart unless-stopped -p 8080:8080 -v cafe-data:/data ghcr.io/mjebreen/twisted-cafe:latest`
- Backups and moving an existing database over work the same as Option A (`deploy/backup-docker.sh`, `deploy/restore-docker.sh`).

### Option A: Docker, built from source

```bash
sudo apt install -y docker.io docker-compose-v2 git
sudo git clone https://github.com/Mjebreen/twisted-cafe.git /opt/twisted-cafe
cd /opt/twisted-cafe
sudo cp .env.example .env          # edit PORT / TZ_CAFE / COOKIE_SECURE if needed
sudo docker compose up -d --build
curl -s localhost:8080/api/health  # {"ok":true,...}
```

- Data is in the Docker volume `twisted-cafe_cafe-data` (mounted at `/data`). The container runs as an unprivileged user, restarts on reboot, has a health check, and rotates its logs.
- **Logs:** `sudo docker logs -f twisted-cafe`
- **Update:** `sudo git pull && sudo docker compose up -d --build` (the database is kept; new columns are added automatically on start).
- **Backups:** `sudo deploy/backup-docker.sh` copies a fresh backup to `/var/backups/twisted-cafe` (keeps 30). Add it to root's crontab:
  `15 3 * * * /opt/twisted-cafe/deploy/backup-docker.sh >> /var/log/twisted-cafe-backup.log 2>&1`
- **Move the current database over, or restore a backup:** copy the `.db` file to the server, then run `sudo deploy/restore-docker.sh /path/to/cafe.db`. It keeps a safety copy of the current database first.

### Option B: Without Docker (systemd)

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git
sudo useradd --system --home /var/lib/twisted-cafe --shell /usr/sbin/nologin twistedcafe
sudo mkdir -p /var/lib/twisted-cafe && sudo chown twistedcafe: /var/lib/twisted-cafe
sudo git clone https://github.com/Mjebreen/twisted-cafe.git /opt/twisted-cafe
cd /opt/twisted-cafe
sudo npm ci && sudo npm run build
sudo cp .env.example .env
sudo cp deploy/twisted-cafe.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now twisted-cafe
journalctl -u twisted-cafe -f
```
Backups: `sudo -u twistedcafe DATA_DIR=/var/lib/twisted-cafe node /opt/twisted-cafe/server/backup.js` (put it in cron the same way).

### HTTPS / outside access

Keep it on the office network if you can. If it goes behind a domain or needs HTTPS, put a reverse proxy in front and set `COOKIE_SECURE=1` in `.env`. WebSockets (`/socket.io`) must be passed through.

- **Caddy** (`/etc/caddy/Caddyfile`): `cafe.example.com { reverse_proxy 127.0.0.1:8080 }`
- **Cloudflare Tunnel**: point the hostname at `http://localhost:8080` (WebSockets work by default).

Then set **Settings → Public URL** to that address and reprint the room QR cards.

### Requirements

- Node 22.13+ (24 recommended) when not using Docker. No native modules: SQLite is Node's built-in `node:sqlite`.
- About 150 MB RAM. Port 8080 (change with `PORT`).

## First-time setup

1. Sign in with PIN **1234** (Admin). Go to **Team** and change it straight away. Add a PIN for each barista.
2. **Settings → Public URL**: set it to the address phones use on the office Wi-Fi, e.g. `http://<server-ip>:8080`. The room QR codes use this. Give the server a fixed IP (DHCP reservation) so the QR codes keep working.
3. **Menu**: the starter menu is copied from the CafeMenu project. Edit prices, Arabic names and options (Size, Milk, Sugar…). To bring in the Loyverse menu, export items from Loyverse as CSV and use the upload button (needs `Name`, `Category`, `Price` columns).
4. **Rooms**: add each room, then **Print all cards** (A4 landscape, 2 A5 cards per sheet, cut down the middle). Put one card in each room.
5. **Team → Employees**: add staff names so they autocomplete in room orders and tabs.

## Import from POS2

In POS2, export tenant data, then unzip `tenant-data-export.zip`. Then either:
- **Settings → Import from POS2** and pick `tenant-export.json`, or
- `node server/importPos2.js path/to/tenant-export.json` (`--menu-only` to skip orders, `--keep-menu` to keep items not in POS2).

It brings in products (as Hot Drinks / Cold Drinks), the Coffee Type options, tables as rooms (POS2 table PIN becomes the room code, the "Counter" table is skipped), and order history. Running it again updates the menu and skips orders already imported. Orders deleted in POS2 are not imported. Product images are not in the export.

## Merging employee names

People type their names differently ("Sara", "sara ahmed", "Sarah Ahmed"). Once a week, open **Team → Merge names**:

- **Possible duplicates** lists names that look alike (capitals, extra spaces, small spelling slips, a first name vs the full name, Arabic letter variants like أ/ا and ة/ه). Pick the name to keep, untick any that don't belong, and merge, or press **Not the same person** so that group is never suggested again.
- **Pick names myself** lets you select any names and type the correct spelling to keep.

Merging moves every past order, tab charge and tab payment to the kept name, so tab balances and reports combine. It can't be undone, and each merge is recorded in the activity log.

## Employee rewards (staff only)

Employees earn points when an order with their name is paid by cash, card or tab (the tab name counts for tab orders). Free orders earn nothing. Defaults: 1 point per SAR paid, 20 points = SAR 1 off (about 5% back). Admins change these, or switch rewards off, on the **Rewards** page.

- **Counter:** type the employee's name. If they have points, the cart shows their balance; tap **Use points** to take off as much as the order needs.
- **Rewards page:** every employee's balance and full history. Admins can add or remove points by hand (a reason is required), e.g. a bonus or a fix.
- Room order pages never show points; only staff see and use them.
- Cancelling an order takes back the points it earned and returns any points spent on it. Undoing a payment removes the points it earned. Merging names also merges points.
- Points apply from now on; orders before rewards existed don't earn any. Point changes appear in the activity log, and Reports counts points used as discounts.

## Discount codes

Admins manage codes in **Discounts**: percent or fixed SAR off, optional max discount, minimum order, start/end dates, total uses, once per person (by order name), and counter-only / rooms-only / both. Staff apply a code in the counter cart; room customers tap "Have a discount code?" in their cart. The server re-checks every rule when the order is placed, so a code can't be faked from a phone. Receipts, the board, the customer status page, the orders CSV and Reports (Discounts tile + "Discount codes" table) all show it. Refused codes appear in the activity log.

## Mock data

`npm run mock` adds 30 days of fake orders, a few live orders on the board, 20 employees, tab payments, and staff logins Saud (PIN 1111), Noura (2222) and Majed (3333). `npm run mock:clear` removes exactly those rows; imported POS2 data and real orders are never touched.

## Activity log

Admins see **Logs** in the top bar: sign-ins (and wrong PINs), sales, room orders, status changes, payments, cancels, undo-payment, tab payments, menu and sold-out changes, room codes, team and settings changes, imports, CSV exports and backups. It updates live and can be filtered by type, day, text, or failed attempts only. The same lines are printed to the server console (`docker logs twisted-cafe`). PINs are never logged.

## The tablet

- Open `http://<server-ip>:8080/staff` in Chrome. Use **menu → Add to Home screen** to run it full screen.
- Tap the screen once after signing in so the new-order chime is allowed to play (the speaker icon turns on).
- Keep the screen awake: Android **Settings → Display → Screen timeout**, or developer option **Stay awake** while charging.

## Receipt printer

Receipts are printed through Chrome's print dialog. Pick the roll width in **Settings → Receipt paper width**: 80mm or 58mm.

**Direct Bluetooth printing (like Loyverse, no print dialog)**: tap the **printer button** in the staff top bar → **Connect Bluetooth printer** → pick the printer (e.g. `PT-210_20E7`) → **Test print**. From then on every receipt on that tablet prints straight to it (auto-print after a sale too). The receipt is drawn as an image, so Arabic prints fine. Chrome only allows Bluetooth on a secure page:
- Use the app over **https://** (e.g. Cloudflare Tunnel or a reverse proxy with a certificate), **or**
- On the tablet, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, add the app address (e.g. `http://192.168.1.50:8080`), set it to Enabled, and relaunch Chrome.

The printer is remembered per device. If it sleeps, the app reconnects on the next print; if that fails, tap the printer button → **Reconnect**. If prints come out cut or garbled, tick **Slow mode** there. Printers with only classic Bluetooth (no BLE) can connect from desktop Chrome through **Bluetooth serial**.

**Print dialog instead**: the fallback setups below.

**GOOJPRT PT-210 (58mm Bluetooth)**: set the paper width to 58mm first. The printer's built-in fonts have no Arabic, so print the receipt as an image (both setups below do that).
- *Android tablet*: pair the printer in Bluetooth settings (PIN `0000` or `1234`). Install **RawBT**, choose the printer (e.g. `PT-210_20E7`), and set the paper to 58mm / 384 dots. Turn on RawBT under Android **Settings → Connected devices → Printing**. In Chrome's print dialog pick RawBT.
- *Windows PC*: pair the printer, install the GOOJPRT "POS-58" driver on the Bluetooth COM port, and set the paper to 58mm. In Chrome's print dialog pick it, with Margins: None and Scale 100.
- **Network/USB thermal printer on Android**: install the printer maker's print service, or **RawBT**, then pick it in the print dialog.
- **Auto print** after each paid counter sale: Settings → tick "Print receipt automatically".
- Direct ESC/POS printing (no dialog) is not built in yet.

### Saudi receipts (ZATCA)

Receipts are bilingual (Arabic + English). Set up once in **Settings**: Arabic cafe name (as on the VAT certificate), address, 15-digit VAT number, and optionally the CR number.

- **Paid order + valid VAT number** → printed as **فاتورة ضريبية مبسطة / Simplified Tax Invoice**: seller name and address, VAT number, invoice number (`INV-000123`, unique and in sequence), date and time (cafe timezone), items with quantity, unit price and line total, discounts, total before VAT, VAT 15%, total incl. VAT, payment method, and the ZATCA QR code.
- The QR holds the 5 Phase 1 fields as Base64 TLV: seller name, VAT number, time (UTC), total incl. VAT, VAT amount. Scanning it with the ZATCA "VAT" app shows these.
- **No valid VAT number** → prints as a plain "Receipt / إيصال" with no QR.
- **Unpaid** orders print as an order slip marked "Not a tax invoice". **Cancelled** orders are marked cancelled and carry no QR.
- Not covered: ZATCA **Phase 2** (Fatoora integration: XML invoice, cryptographic stamp, reporting each invoice to ZATCA within 24 hours) and credit notes for refunds. Businesses whose VAT-taxable revenue went over SAR 187,500 in any year from 2022 to 2025 must integrate by 1 Feb 2027 (Wave 25). That needs a ZATCA-certified e-invoicing provider, or Phase 2 support added to this app.

## Room codes

The QR on the card never changes. Only the 4-digit code does. Rooms → **New code** (one room) or **New codes for all**, then reprint the card(s). People with the old code are asked for the new one on their next order.

## Money and reports

- Prices are VAT-inclusive. The receipt shows the VAT part using the VAT % in Settings.
- **Sales** = all non-cancelled orders except Free (comp). Unpaid and tab orders are counted as sales and also shown separately.
- "Today" follows the cafe timezone (`Asia/Riyadh` by default). Order numbers restart at #1 every day.

## Backup

Settings → **Download backup** gives a copy of the whole database. Or copy the `data/` folder while the app is stopped.

## Security notes

- Room ordering is open to anyone on the network who has the room code. Rotate codes if they leak.
- Staff PINs are hashed (scrypt). Login is rate-limited (10 tries / 5 min per device IP).
- Run it on the internal network only. If it ever faces the internet, put it behind HTTPS (reverse proxy).
