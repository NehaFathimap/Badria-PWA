# Badria Van Sales PWA – Frontend

React + Vite frontend for the Badria Van Sales Progressive Web App.

## Tech Stack
- **React 19** with React Router v7
- **Vite 7** with PWA plugin
- **Lucide React** for icons
- **Workbox** for service worker / offline support

## Modules
- Dashboard (Today Sales, Collections KPIs)
- Sales Invoices (Create, submit, print)
- Quotations (Create, submit, convert to Sales Order)
- Sales Orders (Create, submit, convert to Invoice)
- Customers (List, create, address management)
- Leads (Prospect management)
- Stock (Warehouse stock balance)
- Payments (Collect against outstanding invoices)
- Returns (Credit notes)

## Development

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` requests to `http://127.0.0.1:8005` (your local bench).

## Build & Deploy

```bash
npm run build
```

This outputs the built files to `../badria_pwa/public/pwa/` — which is exactly where the Frappe app expects them.

Then on your bench:
```bash
bench build --app badria_pwa
bench restart
```
