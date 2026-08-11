# Badria PWA — Van Sales PWA for ERPNext

## ⚠️ Installation (Important)

**Do NOT use `bench get-app` directly.** Use the install script below:

### Option 1 — One-line installer (Recommended)

```bash
cd ~/fifteen-bench
bash <(curl -s https://raw.githubusercontent.com/NehaFathimap/badria_pwa/develop/install.sh) ~/fifteen-bench your-site-name
```

### Option 2 — Manual steps

```bash
# 1. Clean old folders
rm -rf ~/fifteen-bench/apps/badria_pwa
rm -rf ~/fifteen-bench/apps/Badria-PWA
rm -rf ~/fifteen-bench/archived/apps/badria_pwa*

# 2. Uninstall old pip package
~/fifteen-bench/env/bin/pip uninstall badria_pwa Badria-PWA -y

# 3. Clone directly
cd ~/fifteen-bench/apps
git clone https://github.com/NehaFathimap/badria_pwa.git --branch develop

# 4. Install
cd ~/fifteen-bench
~/fifteen-bench/env/bin/pip install -e ~/fifteen-bench/apps/badria_pwa
bench --site your-site install-app badria_pwa
bench build --app badria_pwa
bench restart
```

## Features

| Module | Description |
|---|---|
| 📊 Dashboard | Today Sales, Collections (Cash + Bank) KPIs |
| 🧾 Sales Invoices | Create, submit, print with UOM and discount |
| 📋 Quotations | Create, submit, convert to Sales Order |
| 🛒 Sales Orders | Create, submit, convert to Invoice |
| 👥 Customers | List with outstanding balance, add new |
| 👤 Leads | Prospect management |
| 📦 Stock | Real-time warehouse stock balance |
| 💰 Payments | Collect against outstanding invoices |
| 🔄 Returns | Sales returns / credit notes |
| 📲 PWA | Installable on Android & iOS |

## Access

After install open: `http://your-site/badria_pwa`

## Production Templates (desk)

Replaces "duplicate the previous entry" when booking the daily production
Stock Entry.

| Artifact | Path |
|---|---|
| DocType `Production Template` | `badria_pwa/badria_pwa_app/doctype/production_template/` |
| DocType `Production Template Item` (child) | `badria_pwa/badria_pwa_app/doctype/production_template_item/` |
| Stock Entry form script | `badria_pwa/public/js/stock_entry.js` (via `doctype_js`) |
| Custom Field `Stock Entry.custom_production_template` | `badria_pwa/fixtures/custom_field.json` |
| Print Format `Badria Manufacturing` | `badria_pwa/badria_pwa_app/print_format/badria_manufacturing/` |

On a draft Stock Entry a **Template** button group appears:

* **Load Production Template** — pick a template, replace or append the Items table
* **Save as Production Template** — turn the entry on screen into a reusable
  template, optionally zeroing the quantities

The whole Items table is fetched in one call to
`badria_pwa.badria_pwa_app.doctype.production_template.production_template.get_template_items`,
which returns rows already carrying `stock_uom`, `conversion_factor` and
`transfer_qty`.

### Why it is built this way

Three things bite any bulk loader for Stock Entry, all of them found the hard way:

1. **Never populate rows with `frappe.model.set_value`.** It fires ERPNext's
   `item_code` handler once per row — 32 rows took about 30 seconds — and that
   handler re-stamps `s_warehouse` / `t_warehouse` from the header *between*
   field writes, so consumed rows come back carrying a target warehouse as well
   and drop out of the production sheet.
2. **`stock_uom`, `conversion_factor` and `transfer_qty` are mandatory** on
   Stock Entry Detail and the grid enforces them *in the browser*, before the
   request is sent. Bypassing the `item_code` handler means supplying them.
   They are resolved server-side with ERPNext's own `get_conversion_factor`
   (which is not whitelisted, so the browser cannot call it) — guessing a
   factor of 1 would corrupt `transfer_qty` for any item entered in a UOM other
   than its stock UOM.
3. **A row is either consumed (source only) or produced (target only).**
   Writing both default warehouses to every row turns each line into an
   internal transfer. `Production Template.validate()` rejects such rows, and a
   Manufacture template is rejected unless one row is flagged
   `Is Finished Item` — without it the Stock Entry throws `FinishedGoodError`.

### Print Format `Badria Manufacturing`

Daily Production Data Sheet for Stock Entry: raw materials consumed, finished
products, wastage, and a weight/value summary.

Shipped as a **standard** print format, so it is read-only in the UI and is
updated by editing the file in this app. Jinja totals use `namespace()` — a
plain `{% set %}` inside a `{% for %}` is block-scoped, which silently prints
every row counter as `1` and every total as `0`. Weight columns normalise the
stock UOM to kilograms; `transfer_qty` is already `qty x conversion_factor`, so
multiplying by the factor again is wrong.

Populate **Weight Per Unit** on finished-goods Items — otherwise the sheet falls
back to a 4.8 kg/box constant and the output-vs-input percentage is meaningless.

### After install / update

```bash
bench --site <site> migrate
bench build --app badria_pwa
```
