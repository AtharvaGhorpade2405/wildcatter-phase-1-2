# PharmaChain OS — MVP

A minimum viable product of the **AI-native 4-stage pharmaceutical supply chain suite** described in
`RFP-PHARMA-MASTER-2026-V5`. It shows the whole idea working end to end: a batch moves
**API plant → Formulator/C&F → Stockist → Pharmacy**, and every step is visible on a live
**Metro-Line Control Tower**, recorded as **GS1 EPCIS 2.0** events, and exposed through an **open REST API**.

It comes in three forms, all running the same code:

| Form | How |
|---|---|
| **Desktop app** (Windows/macOS/Linux, Electron) | `npm run desktop` |
| **Web / mobile app** (installable PWA, responsive) | `npm start` → open http://localhost:4600 → browser menu → *Install app* |
| **REST API + live event stream** for other developers | `http://localhost:4600/api/v1` · spec at `/api/v1/openapi.json` · docs in the app under *Developer API* |

## Publishing to Google Play (Trusted Web Activity)

The deployed site can be wrapped as an Android app with [PWABuilder](https://www.pwabuilder.com):

1. Deploy over HTTPS. The manifest already has the 192/512 PNG icons (normal + maskable) Android needs.
2. In PWABuilder, enter your site URL, choose **Android**, and download the generated package (`.aab`) and its `assetlinks.json`.
3. On the server, save that file as `assetlinks.json` in the project folder (see `assetlinks.example.json`; it is git-ignored). Express serves it at `/.well-known/assetlinks.json`, which removes the browser bar inside the app. No rebuild or restart is needed.
4. In Play Console, use `https://<your-domain>/privacy.html` as the privacy policy URL, then upload the `.aab`.

If Play App Signing re-signs the app, add Play Console's SHA-256 fingerprint (Setup → App signing) to `sha256_cert_fingerprints` too.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | **React 18 + TypeScript** (strict), built with **Vite** |
| Backend / API | **Node.js + Express**: REST, Server-Sent Events, OpenAPI 3 spec |
| Desktop | **Electron**: runs the same Express server and React build in a native window |
| Mobile | Installable **PWA** (manifest + service worker), responsive layout |
| Storage | JSON file (MVP stand-in for PostgreSQL) |
| Tests | `node:test`: rule-engine property tests + end-to-end API flow |

## Quick start

```bash
npm install
npm start          # builds the React app, then serves web app + API on http://localhost:4600
npm run desktop    # desktop app (embedded API on http://127.0.0.1:4601)
npm test           # 21 deterministic rule-engine + end-to-end API tests
npm run typecheck  # TypeScript strict check of the frontend
```

**Frontend development with hot reload:** run `npm run serve` (API on :4600) in one terminal and `npm run dev`
(Vite on http://localhost:5173, proxies `/api`) in another.

To use it from a phone on the same Wi-Fi, run `HOST=0.0.0.0 npm start` (PowerShell: `$env:HOST="0.0.0.0"; npm start`) and open `http://<your-PC-IP>:4600`.
To build a portable Windows `.exe`: `npm run dist` (downloads electron-builder on first run).

**Demo script (≈3 min pitch):** open *Metro Control Tower* → **Run end-to-end demo** → watch trains move →
click a cold-chain train (❄) → **Inject excursion** → MKT breaches and the batch is auto-quarantined (red) →
type `APB2611001` into the **Recall Brake** → it cascades to every finished-goods batch made from that API →
ask the Copilot "show red signals" → go to *Pharmacy POS*, add Warfin + Clopirel → see the DDI alert.

## What is in the MVP (mapped to the RFP)

| RFP item | MVP implementation |
|---|---|
| **Stage 1** 1.1 Synthesis ERP | API batch creation, potency + LOD dispensing formula, simulated RS-232 scale capture with ±0.5% tolerance |
| 1.2 21 CFR Part 11 eBMR | Ordered MAKER → CHECKER → QA e-signatures, segregation of duties, signature hashes, SHA-256 hash-chained ALCOA+ audit trail |
| 1.3 LIMS | QC results vs IP/USP-style spec, auto-generated digital CoA |
| 1.4 QMS / OOS | OOS → automatic quarantine + drafted Phase I deviation/CAPA |
| 1.5 Agents & linkage | **QA/QC Release Agent** (deterministic rules), GS1-128 SSCC drum labels, EPCIS commissioning/shipping events to Stage 2 |
| **Stage 2** 2.1 Formulation | FG batches consume API stock (CoA-linked genealogy) |
| 2.2 Serialization | SGTIN commissioning, pack → case → pallet SSCC aggregation, **Schedule H2 QR payload**, DSCSA-style EPCIS |
| 2.3 C&F + cold chain | **FEFO dispatch gatekeeper**, e-Way Bill no. above ₹50k, live IoT temperature stream, **Mean Kinetic Temperature**, automatic excursion quarantine |
| 2.4 NPPA/DPCO | Ceiling-price check, sale blocked if MRP exceeds ceiling |
| 2.5 Agents | **Demand-Sensing & Reallocation Agent**, Cold-Chain Excursion Agent |
| **Stage 3** 3.1 Billing + schemes | 10+1 free, 5+1 + 2% CD, slab discounts, CGST/SGST vs IGST from GSTIN state codes, simulated IRN, auto **claim debit notes**, sub-ms pricing |
| 3.2 Scan-verify WMS | Zero-typing inward: every SSCC on the ASN must be scanned + VRS check; FEFO picking |
| 3.3 Expiry engine | 180/90/60/30-day buckets, return → credit note + manufacturer claim |
| **Stage 4** 4.1 POS | Keyboard-first POS (`/`, ↑↓, Enter, F9), salt search with **higher-margin bioequivalent suggestions**, loose-tablet billing, GST-inclusive split |
| 4.2 Registers + anti-counterfeit | Automatic Schedule H/H1/X registers (prescriber reg., patient ID), **pack verification** (authentic / counterfeit / recalled / already dispensed / expired) |
| 4.3 Clinical decision support | Drug–drug interactions, duplicate therapy, allergy, pregnancy, paediatric alerts, with logged pharmacist override |
| 4.5 Agents | **Multi-Distributor Procurement Agent**: splits reorders across stockists by net landed cost after schemes, one-click order placement |
| **Module 5** Control Tower | Dark Canvas metro board: lines = therapeutic categories + cold-chain lane, stations = stages, trains = shipments with Green/Amber/Red signals, **Emergency Recall Brake**, **Control Room Copilot** (natural-language queries) |
| **Module 6** Entity Data Lake | Golden-record directory, real **GSTIN mod-36 checksum** validation, PAN/name de-duplication, simulated discovery-agent swarm |
| Interop mesh | Every action emits GS1 EPCIS 2.0 JSON-LD events (commissioning, packing, shipping, receiving, dispensing, holding/recall, sensor reporting) |

## Deliberately out of scope for the MVP (the "big picture" items)

Kept out as the brief says: real GSTN IRP / e-Way Bill / VRS network connections (simulated locally and labelled as such),
LLM-backed agents (agents are deterministic rule engines with a clear place to plug in an LLM), PLC/camera line integration,
OCR, WhatsApp bots, HL7 FHIR, Account Aggregator credit, Marg/Tally/SAP connectors, user login/RBAC, multi-tenant
Postgres/ClickHouse/Neo4j (a single JSON file stands in), WebGL 100k-train scale, and offline CRDT sync.
The clinical knowledge base is a small demo set and **not for clinical use**. All companies and brands are fictional.

## Project layout

```
server/
  domain/      pure rule engines: gs1, gstin, pharma (potency/QC), coldchain (MKT), schemes (GST), fefo, clinical, audit, epcis
  services.js  business logic for all 6 modules + simulation clock
  app.js       Express REST API + SSE stream (shared by web and desktop)
  openapi.js   OpenAPI 3 spec
  seed.js      demo network: 7 trading partners, 15 SKUs, stock, in-flight shipments
web/           React + TypeScript frontend (Vite)
  src/types.ts         typed API response models
  src/api.ts           typed fetch client
  src/live.tsx         SSE live-update context, reference data, toasts, useApi() refetching hook
  src/components/      MetroBoard (Canvas 60 FPS), Inbound scan-verify, shared UI
  src/pages/           Tower, Stage1-4, DataLake, Epcis, Developer
  public/              PWA manifest, service worker, icon
dist-web/      production build (generated by `npm run build`, served by Express)
desktop/       Electron shell (starts the embedded API, opens the window)
tests/         node:test unit + end-to-end API tests
```

Data is stored in `data/pharmachain-db.json` (desktop: the OS user-data folder). Use **Reset data** on the
Control Tower page or `POST /api/v1/demo/reset` to start over.

## API at a glance

```bash
curl http://localhost:4600/api/v1/tower/state
curl -X POST http://localhost:4600/api/v1/stage3/invoices/quote -H "Content-Type: application/json" \
  -d '{"sellerId":"E004","buyerId":"E006","lines":[{"productId":"P001","qty":22}]}'
curl -X POST http://localhost:4600/api/v1/tower/copilot -H "Content-Type: application/json" -d '{"query":"show red signals"}'
```

Live events: `new EventSource('http://localhost:4600/api/v1/stream')`, which sends `tick`, `change`, `epcis` and `alert` events.
55+ endpoints, all listed in the in-app *Developer API* page with “Try” buttons.
