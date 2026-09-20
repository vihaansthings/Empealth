# Empealth

A private, browser-based medical bill review workspace. Scan a bill, confirm line items, compare ZIP-specific sample prices, save procedures, and prepare a deterministic email or phone script.

## Run

Requires Node.js 22 or newer and pnpm (or npm).

```sh
pnpm install
pnpm dev
```

```sh
pnpm test
pnpm build
pnpm preview
```

Deploy `dist/` to a static host at the domain root, served over HTTPS. No backend, API keys or AI service are required. The build copies all OCR worker, WebAssembly and English language files to the app's own origin. The first scan can take time while those assets load. Browser OCR uses Tesseract, an OCR recognition model; billing decisions and scripts use fixed code and templates, with no generative AI.

## Features

- Local JPG, PNG, WebP and BMP OCR, camera-file capture, text PDFs and scanned PDFs. Limits: 25 MB and 20 PDF pages. English OCR.
- Editable OCR draft with manual entry and original extracted text. Users must check every line against the source. Tables vary; extraction is deliberately conservative and not all lines are detected.
- Possible repeated charges only when confirmed code, date, provider, modifier, units and amount match. Date strings must match exactly. Repeat services may be legitimate.
- Code-format checks supporting CPT, CDT and HCPCS shapes. Codes absent from the sample are coverage gaps, not evidence of an invalid code.
- Entered line total versus stated itemized total reconciliation. Users must include all lines and adjustments and must not compare itemized totals to patient balances after insurance.
- ZIP and procedure lookup with geographic interpolation and a national fallback; charge per unit compared to the synthetic upper bound only after scope, setting and units are confirmed.
- Procedure search, category filters, saved code list in localStorage, and detailed price provenance.
- Deterministic, editable email and call scripts with copy and plain-text download. Nothing is sent automatically. Generated text contains no em dashes.

## Data provenance and limits

`public/data/prices.csv.gz` is a lossless gzip copy of the user-supplied `fair_price_us_zip_cpt_cdt_2026_sample.csv`. Preparation scripts reconstruct the original CSV. The data has 4,032 records, 144 codes and 28 ZIP codes, including leading-zero ZIPs. Version: `2026-09-14.synthetic-v2`; ZIP snapshot: `2026-06-14`.

**Every record is synthetic.** The source states `synthetic simulation; no healthcare price observations`. Prices are modeled consumer estimates before insurance, not negotiated hospital rates, measured market prices, insurer allowances, or out-of-pocket quotes. Geographic proxies, applicability, price units, scope ambiguity and setting are shown in details. Other five-digit ZIP inputs receive a deterministic estimate. ZIP centroid data comes from the bundled `zipcodes` package. Up to three reference ZIPs are weighted by 1 / max(distance in km, 25)^2. Alaska, Hawaii and territories use same-state or territory references only. When geography or suitable references are unavailable, the model applies a geographic factor of 1 to the national anchor and uses the median of each source price / (anchor * geographic factor) to construct the range. This is an interpolation heuristic, not a calibrated or validated market-price model. Five-digit validation does not verify that a ZIP is assigned. Procedure details identify the method and reference ZIPs. Original source values remain unchanged.

This app cannot determine medical necessity, validate a complete current CPT/CDT catalog, detect clinical upcoding or unbundling, or establish fraud, manipulation, incorrect code-description relationships, or overcharging. It raises review questions and requests explanations. A production coding audit would need licensed code data and validated payer-specific rules.

## Privacy

Files and bill fields stay in browser memory. Reloading or clearing the bill removes them. Only saved procedure codes persist on this device. There are no analytics, bill upload endpoints, or remote AI calls. App assets and Google Fonts are fetched normally, without bill content. Use trusted HTTPS hosting and avoid shared devices. Clipboard copies and downloaded scripts are controlled by the user and can contain information they entered.

## Verification

`tests/pricing.test.js` verifies interpolation, fallback, region isolation, source preservation and billing integration. `tests/engine.test.js` checks data integrity, quoted CSV fields, conservative extraction, confirmation gating, duplicate specificity, ZIP and scope gating, unit normalization, coverage versus invalid format, totals, and deterministic script wording.

Built with Vite, Tesseract.js, PDF.js and Lucide. OCR reference: https://github.com/naptha/tesseract.js/blob/master/docs/api.md . PDF reference: https://mozilla.github.io/pdf.js/examples/ .
