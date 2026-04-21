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
