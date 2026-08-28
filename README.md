# Listing QA Lab

A privacy-first browser application for **pre-publication ecommerce image quality assurance**. It helps catalog and marketplace teams identify weak product imagery before it reaches production.

## Core workflow

1. Drop a batch of PNG/JPG/WEBP product images.
2. Select a QA profile such as Marketplace Main, Storefront Product, Social/Mobile or Custom QA.
3. Listing QA Lab measures image quality locally in the browser.
4. Investigate high-risk files and the exact reason each one was flagged.
5. Review SKU-level completeness and near-duplicate pairs.
6. Export a CSV QA report for the catalog/content team.

No application database receives the uploaded images.

## What the engine checks

- Resolution and aspect ratio against the selected profile.
- Sharpness using a Laplacian-based edge statistic.
- Mean luminance and clipped-dark / clipped-highlight proportions.
- Background consistency using border-pixel variation.
- Approximate foreground bounding box and subject occupancy.
- Possible edge clipping.
- Whole-image color-channel imbalance.
- Thumbnail separation using estimated subject/background luminance contrast.
- Perceptual near-duplicates using a 64-bit difference hash.
- Listing-view completeness using a transparent filename convention such as `SKU123_front.jpg`, `SKU123_back.jpg`, `SKU123_detail.jpg`.

## Confidence & honesty layer

Every finding is labelled as one of:

- **Known** — directly observed dimensions or filename structure.
- **Statistical estimate** — pixel-statistic based measures such as sharpness, exposure and border variation.
- **Heuristic** — foreground occupancy, clipping and thumbnail-survival cues.

Listing QA Lab does **not** claim to reproduce Amazon, Shopify or any marketplace's proprietary moderation system. It is an explainable internal QA gate.

## Why this is not just another image editor

Image editors help create or retouch imagery. Listing QA Lab deliberately does not beautify or silently change the product image. Its job is to answer a different operational question:

> Which images or SKU image sets should be stopped for human review before publishing, and why?

That creates a usable content-operations output: a ranked review queue plus an exportable QA file.

## Data contract

### Images

Browser-readable image files such as PNG, JPG/JPEG and WEBP.

### Optional filename convention

`<SKU>_<view>.<ext>` where supported views are `front`, `back`, `side`, `detail`, `packaging`, `pack`, or `hero`.

Examples:

- `PERFUME-101_front.jpg`
- `PERFUME-101_back.jpg`
- `PERFUME-101_detail.jpg`

`hero` is normalized to `front`; `pack` is normalized to `packaging`.

## Methodology

The browser downsamples each image to a maximum working dimension of 720 px for efficient pixel analysis while retaining the original dimensions for resolution checks. The application calculates luminance and edge statistics, estimates a background color from the image border, estimates a foreground bounding box from color distance to that border, and computes a perceptual difference hash. Profile-specific rules convert those measurements into explainable findings. A transparent weighted penalty creates a triage score; the score is not a marketplace acceptance probability.

## Tests

`npm test` covers:

- clean-image pass behavior
- low-resolution and blur flags
- occupancy/clipping independence
- perceptual hash distance
- SKU/view parsing
- listing completeness

Use `npm run typecheck` and `npm run build` for the application quality gate.

## Limitations

- Foreground/background separation is deliberately lightweight and can struggle with complex lifestyle scenes, transparent products, shadows or backgrounds close to the product color.
- Sharpness thresholds are heuristics, not camera/lens diagnostics.
- No OCR is claimed in this release, so packaging text-to-catalog consistency is not yet validated.
- Variant-color matching against catalog metadata is not yet implemented.
- Perceptual hashes can flag visually similar legitimate variants; human review remains required.
- The safe-crop overlay is a preview aid, not a guarantee of how a third-party platform will crop an image.
- Browser-local processing means very large batches are constrained by the user's device memory and CPU.

## Architecture

- Next.js 16 App Router
- React 19
- TypeScript
- Browser Canvas / ImageData analytics
- Pure TypeScript QA engine in `lib/qa.ts`
- Node regression tests via `tsx --test`
- Static-friendly deployment on Vercel

## Privacy

Uploaded product imagery is decoded and analysed in the user's browser. The app has no image-upload API and no application persistence layer.

## Deployment

Designed for Vercel. Production checks should include successful tests, TypeScript validation, Next.js production build, deployed page response, and runtime-error inspection.
