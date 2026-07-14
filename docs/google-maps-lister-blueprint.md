# Google Maps Lister Blueprint (Strategic)

## 1. Exact Problem

A user without a Google Maps API key needs a repeatable command-line tool that
finds local businesses directly through the Google Maps website. The first use
case is mechanics around Elwood, Victoria. A plain top-rating sort is not useful
because a 5.0 rating from one review can outrank a slightly lower rating backed
by hundreds of reviews.

**Implementation Implication:** Build a standalone browser-automation CLI named
`google-maps-lister` that extracts listing details and ranks candidates with a
Bayesian weighted rating before limiting the output.

## 2. Success Metrics

| Metric | Required outcome |
|---|---|
| Data source | Google Maps website is accessed through a real Chromium browser; no Google API or API key is used |
| Default search | `mechanics near Elwood Victoria` |
| Output size | At most 10 ranked records after all discovered candidates have been evaluated |
| Required fields | Name, rating, phone, and website |
| Ranking evidence | Review count and Bayesian score are included with each record |
| Output | A valid UTF-8 CSV file readable by common spreadsheet software |
| Verification | Unit and browser-backed integration tests pass, followed by one successful live run |

**Implementation Implication:** The live acceptance run is not replaced by
fixture tests. Success requires a CSV containing at least one real listing, with
rows in descending Bayesian-score order and no more than 10 rows.

## 3. Structural Advantage

The CLI uses the same public browser surface a person uses, so it requires no
account provisioning or API credentials. Ranking is computed locally and is
auditable because the raw rating, review count, and calculated score are all
exported.

**Implementation Implication:** Keep browser extraction separate from ranking
and CSV generation so website selector changes do not alter the scoring model.

## 4. Architecture Decisions

### ADR-001: Standalone TypeScript CLI with Playwright

| Option | Decision | Reason |
|---|---|---|
| Static HTTP fetch | Rejected | Google Maps results and detail panels are rendered interactively |
| Selenium/Python | Rejected | No Selenium convention exists in this repository, and driver management adds overhead |
| TypeScript + Playwright | Selected | Matches existing TypeScript CLI conventions and bundles reliable Chromium automation |

The CLI lives in its own `google-maps-lister/` project and does not modify the
homepage or production workflow services.

### ADR-002: Bayesian weighted rating

Three ranking models were considered: raw rating, Wilson confidence, and a
Bayesian weighted rating. Bayesian weighting is selected because it naturally
pulls low-review listings toward the candidate-set average while preserving the
strength of well-reviewed listings.

For candidate rating `R`, review count `v`, candidate-set mean rating `C`, and
candidate-set median review count `m`:

```text
score = (v / (v + m)) * R + (m / (v + m)) * C
```

If the median review count is zero, `m` is set to 1. Candidates are ordered by
score descending, review count descending, rating descending, then name
ascending.

### ADR-003: Exhaust candidate discovery before limiting

The result feed is scrolled until Google reports the end of the list or three
consecutive scroll attempts add no unique place URLs. All discovered candidates
are inspected before the top 10 are selected.

**Implementation Implication:** `--limit` controls final output only; it never
caps candidate discovery.

## 5. Technology Rationale

| Technology | Rationale |
|---|---|
| Node.js 22 + TypeScript ESM | Consistent with standalone scripts already present in the repository |
| Playwright Chromium | Directly automates the JavaScript-driven Google Maps website |
| Vitest | Matches the repository's current TypeScript unit-test convention |
| Yarn lockfile | Keeps dependencies reproducible and follows the clearest existing TypeScript app convention |

**Implementation Implication:** The project owns its dependencies and lockfile;
it does not add packages to unrelated services.

## 6. MVP Features

1. Configurable query with the mechanics/Elwood search as the default.
2. Google Maps result-feed discovery and place-detail extraction.
3. Name, rating, review count, phone, website, and Maps URL collection.
4. Bayesian ranking followed by a default top-10 limit.
5. CSV output, partial-result preservation, and clear failure messages.

## 7. Explicit Exclusions

- No Google Maps API, Places API, API key, or Google account login.
- No CAPTCHA bypass, proxy rotation, fingerprint spoofing, or anti-bot evasion.
- No scheduled Kubernetes service, database, NATS workflow, or graphical UI.
- No geographic radius guarantee; "around Elwood" follows Google Maps' own
  interpretation of the query.
- No harvesting of reviews, email addresses, or other personal data.

## 8. References

| Topic | Location |
|---|---|
| Complete implementation contract | [Google Maps Lister Design](superpowers/specs/2026-07-15-google-maps-lister-design.md#google-maps-lister-design-implementation) |
| Existing standalone TypeScript CLI precedent | [`get-article.ts`](../get-article.ts) |
| Existing TypeScript test convention | [`homepage-app/vitest.config.ts`](../homepage-app/vitest.config.ts) |
| Repository overview | [`README.md`](../README.md) |

Implementation anti-patterns, test cases, and error handling are intentionally
defined only in the [implementation design](superpowers/specs/2026-07-15-google-maps-lister-design.md#8-anti-patterns-do-not).

