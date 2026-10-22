# Empealth

Review medical bills, explore **150 procedures**, and generate an AI fairness explanation, a simple **one-to-two-paragraph bill breakdown**, and an editable email based on the same review.

## Run locally

Requires Node.js 22+ and pnpm. Install dependencies with `pnpm install`, then run `pnpm dev`. This prepares the price data and on-device OCR assets, starts the private Node API on port 3001, and starts Vite. Vite proxies `/api` to the Node server. `pnpm test` runs the automated checks; `pnpm build` creates the production frontend.

AI requires a server-side `OPENAI_API_KEY` in the ignored `.env.local` file or hosting environment. `.env.example` documents the names only. **Never commit a key or put one in a `VITE_` variable.** The default model is `gpt-4o-mini`; `OPENAI_MODEL` can select another Responses API model that supports Structured Outputs. API billing is separate from a ChatGPT subscription. Exhausted credits produce an explicit error while local checks remain usable.

The API uses the [OpenAI Responses API with Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), a fixed output schema, a 45-second upstream timeout, and `store: false`. It does not fabricate a successful AI review when the API is unavailable.

## Deploy

**Vercel:** the included `api/review.js` function and `vercel.json` run the AI endpoint alongside the frontend. Add `OPENAI_API_KEY` as a Vercel project secret for the intended environments, then redeploy. Vercel deployment URLs are allowed automatically; set `APP_ORIGIN` to an additional custom domain if needed. The function bundles the price and ZIP data produced during the build.

**Other hosts:** this version needs a **Node server**, not only static hosting. Set your hosting service's secret `OPENAI_API_KEY` and set `NODE_ENV=production` and `APP_ORIGIN` to the exact public HTTPS origin, with no trailing slash. Run `pnpm install && pnpm build` during deployment and `pnpm start` to serve the app and API on one origin. `PORT` defaults to 3001. The runtime needs the repository's `public/data`, installed dependencies and built `dist` directory. Use HTTPS through your hosting service or reverse proxy.

The local key is not automatically installed on a hosting service. Static-only previews can still show procedures and local checks, but cannot perform AI review. `pnpm preview` is a static preview; use `pnpm start` to exercise the full built app.

The server checks the configured origin and JSON request shape, limits payloads to 64 KB / 100 bill lines, and limits AI use to 10 requests per minute per direct connection address, 4 concurrent requests, and 200 requests per day per process. `AI_DAILY_REQUEST_LIMIT` changes the daily cap. These are in-memory limits that reset on restart and apply per serverless instance on Vercel, so they are not an account-wide spend cap. For a public production service, add authenticated access and shared rate limits at your hosting gateway; set a spending limit in the OpenAI project. The server deliberately does not trust arbitrary forwarded IP headers. Users behind one reverse proxy share the connection-address rate limit.

## AI review and email

1. Scan a bill or enter lines manually. Check extracted amounts, codes, units and dates against the original.
2. Confirm each reviewed line. Mark scope, setting and units as comparable only when they match the displayed estimate.
3. Enable the AI disclosure and select **Generate AI review & email**. At least one confirmed line with an amount is required.
4. Read the fairness explanation and one or two short paragraphs. Select **Read my AI email** to personalize, edit, copy or download it. Nothing is sent to a billing team automatically.

The server recomputes the numerical evidence from its own reference data. It supplies checked amounts, comparable ranges, missing information and specific review findings to AI. Evidence categories are “Review recommended”, “Within or below sample range”, and “Not enough information”. These categories describe the available sample comparisons, not actual market fairness. AI explains the evidence and writes an email consistent with it: clarification for incomplete bills, focused review questions for flagged bills, or confirmation and assistance for bills without flags.

Changing bill lines, confirmation, ZIP or total clears old AI results and cancels pending requests. Late responses cannot overwrite a changed bill. Regenerating replaces the email draft. Personal details are inserted locally after generation. Phone scripts remain local templates, clearly labeled. If AI fails, the app shows an error and keeps the local checks and template available.

## Procedures and data provenance

The catalog has **150 unique procedures**, all visible, searchable and saveable. The original 144 have synthetic price samples. Six additional laboratory procedures (80048, 82043, 82565, 82746, 84439 and 85610) have **no price estimate** and are excluded from financial comparisons. Their plain-language labels are cross-checked against a [historical CMS procedure listing](https://www.cms.gov/Research-Statistics-Data-and-Systems/Statistics-Trends-and-Reports/MedicareFeeforSvcPartsAB/Downloads/LabServ12.pdf). This listing is not a current code-validation authority. No new prices were invented to expand the catalog.

`public/data/prices.csv.gz` remains an unchanged lossless copy of the user-supplied `fair_price_us_zip_cpt_cdt_2026_sample.csv`: 4,032 records, 144 codes, 28 ZIPs. Version: `2026-09-14.synthetic-v2`; ZIP snapshot: `2026-06-14`. **Every price record is synthetic**, with no healthcare price observations. These are modeled estimates before insurance, not observed market rates, insurer allowances, negotiated rates or out-of-pocket quotes. AI cannot turn those synthetic estimates into a definitive fairness verdict.

For other five-digit ZIPs, the model interpolates up to three reference ZIPs weighted by 1 / max(distance in km, 25)^2. Alaska, Hawaii and territories use same-region references. Without suitable geography it uses a national-anchor fallback. ZIP centroids come from the bundled `zipcodes` package. This heuristic is not a validated market-price model; five digits do not verify that a ZIP is assigned. Original source values remain unchanged.

The app cannot establish fraud, upcoding, unbundling, clinical appropriateness, code-description correctness or guaranteed savings. Repeated charges may be legitimate. Unread lines, adjustments and insurance can affect what is owed. The UI links to CMS and CFPB billing guidance.

## Scanning and local checks

- On-device Tesseract OCR for JPG, PNG, WebP and BMP, plus readable or scanned PDFs. Maximum 25 MB and 20 pages; English OCR. Assets are served from the app's origin.
- Per-page recovery, enhanced OCR retry, manual entry, uncoded service lines, wrapped codes and positioned PDF columns. Ambiguous amount columns require review.
- Statement balances and unmatched monetary lines remain separate from extracted service charges.
- Possible duplicates require matching confirmed code, date, provider, modifier, units and amount. Code syntax checks and catalog coverage do not validate codes clinically.
- Itemized-total reconciliation requires confirmed amounts. Per-unit price comparisons require confirmed scope, setting and units. Calculation details remain available below the AI breakdown.

## Privacy

Files, raw OCR text, bill descriptions, names and account numbers stay in browser memory. **AI is optional and remote.** After consent and a Generate action, structured codes, amounts, units, ZIP, review status and anonymous matching tokens are sent to the app server. Provider names and dates are replaced in the browser with local matching tokens. The server sends OpenAI only calculated facts, canonical catalog labels and review findings, with no matching tokens or personal email fields.

The app does not log or persist bill requests or AI drafts on its server. `store: false` disables Responses storage; it does not guarantee zero retention under OpenAI's API data policies. Hosting request-body logging must also remain disabled. Clearing the bill or reloading removes in-memory content; only saved procedure codes persist in localStorage. Clipboard content and downloads may include locally entered personal fields. Google Fonts and application assets load normally.

## Verification

`tests/engine.test.js`, `tests/extraction.test.js`, and `tests/pricing.test.js` cover original data integrity, conservative extraction, scope and confirmation gating, duplicate specificity, total reconciliation and geographic estimates. `tests/ai.test.js` covers 150 unique catalog entries, unavailable-price handling, privacy filtering, server validation, evidence categories, partial bills, structured AI responses, refusal and failure states, quota exhaustion, origin checks, request limits and secret-file protection.

Browser verification covers the catalog, search, saving, AI results with a mocked response, email personalization, stale response cancellation, API error display, clearing a bill and mobile layout. A live API check on this implementation returned exhausted project credits, so successful live model output still needs verification once credits are available.
