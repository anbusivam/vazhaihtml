# Vazhai NGO — SEO Audit & Recommendations

> **Date:** February 2026  
> **Scope:** All 7 public pages (Home, Who We Are, What We Do, Join, Donate, Contact, Events) + thankyou.html + technical assets  
> **Note:** No existing content was modified; this audit is purely evaluative.

---

## Assessment Legend

| Icon | Meaning |
|------|---------|
| ✅ **Fully Meets** | Industry best practice is implemented correctly |
| ⚠️ **Needs Improvement** | Present but incomplete, inconsistent, or suboptimal |
| ❌ **Missing / Not Found** | Entirely absent from the codebase |

---

## 1. Technical SEO

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 1.1 | **XML Sitemap** | ✅ | `sitemap.xml` exists, lists all 8 URLs with `changefreq` and `priority`. Lastmod dates are missing — an improvement would be adding `<lastmod>` fields. |
| 1.2 | **Robots.txt** | ✅ | `robots.txt` present, allows all user agents, points to sitemap. Could optionally disallow `/thankyou.html` (already has `noindex` meta). |
| 1.3 | **Canonical URLs** | ✅ | Every page has a self-referencing `<link rel="canonical">`. Correct. |
| 1.4 | **Meta Robots** | ✅ | All public pages use `index, follow`. `thankyou.html` correctly uses `noindex, nofollow`. |
| 1.5 | **Structured Data (JSON-LD)** | ✅ | Home page includes: NGO Organization, BreadcrumbList, FAQPage, DonateAction. Inner pages each have BreadcrumbList. The experimental `vazhai.html` has additional rich schemas (JobPosting × 2, Event). This is excellent. |
| 1.6 | **Hreflang Tags** | ⚠️ | Home page correctly declares `en`, `ta`, and `x-default` alternates. **Inner pages only declare `en` and `x-default`** — they are missing the `ta` (Tamil) alternate. If Tamil content is meant to be served from the same URLs, that's acceptable, but the current setup is inconsistent. |
| 1.7 | **Page Speed Signals** | ✅ | Good use of: `preconnect` to Google Fonts, `preload` for hero images and fonts, `loading="lazy"` on below-fold images, `decoding="async"`, and `fetchpriority="high"` on the primary hero image. CSS is a single file. |
| 1.8 | **Mobile Responsiveness** | ✅ | Well-implemented responsive design with breakpoints at 768px and 520px. Two navigation layouts (bottom tab bar for mobile, sidebar for desktop). Touch-friendly targets. |
| 1.9 | **HTTPS Enforcement** | ✅ | Hosted on Netlify with automatic HTTPS. All canonical URLs use HTTPS. |
| 1.10 | **Open Graph & Twitter Cards** | ✅ | Every page includes `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`. Image dimensions specified. |
| 1.11 | **Favicon & App Icons** | ✅ | `favicon.ico`, `apple-touch-icon` (192×192), and theme-color meta tag present on all pages. |
| 1.12 | **404 Page** | ✅ | Custom `404.html` created at root — Netlify auto-serves it. Includes branding, navigation links, and GA4 tracking. |
| 1.13 | **Clean URLs** | ✅ | Netlify redirect rules rewrite `/who-we-are` → `/who-we-are.html` etc. This is correct and well-configured. |
| 1.14 | **Google Search Console & Analytics** | ✅ | File-based verification (`google2e8d5954e98983fa.html`) is deployed at root and confirmed verified. No analytics/tracking script found yet. |
| 1.15 | **Custom Domain / Subdomain** | ✅ | All canonical URLs reference `https://vazhai.in`. Clean professional domain. |

---

## 2. On-Page SEO — Meta Tags

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 2.1 | **Title Tags** | ✅ | Every page has a unique, descriptive `<title>` tag (30–60 chars, keyword-rich). Examples: `"Vazhai NGO — Rural Education NGO Tamil Nadu \| Krishnagiri, Dharmapuri, Villupuram"`, `"Donate to Vazhai NGO — Support Rural Education in Tamil Nadu"`. |
| 2.2 | **Meta Descriptions** | ✅ | Every page has a unique meta description (120–160 chars) that summarizes the page content with relevant keywords. |
| 2.3 | **H1 Tags** | ✅ | Each page has exactly one clear `<h1>` reflecting the page topic. |
| 2.4 | **Heading Hierarchy (H1→H2→H3)** | ⚠️ | Content section headings use a mix of `<h2>`, `<h3>`, `<div>` with class-based styling. The visual hierarchy is correct, but many heading-like elements are `<div>` tags styled to look like headings rather than semantic `<h2>`/`<h3>` tags. For example, card titles, stat labels, and section sub-headings use non-semantic markup. This is acceptable for visual design but not ideal for screen readers and search bots. |
| 2.5 | **Keyword Focus & Relevance** | ✅ | Strong keyword alignment with NGO's mission: "rural education NGO Tamil Nadu", "Krishnagiri", "Dharmapuri", "Villupuram", "School Companion", "volunteer", "donate education". Keywords appear naturally in content without stuffing. |
| 2.6 | **Image Alt Attributes** | ✅ | All `<img>` tags have meaningful `alt` text describing the image content. Some alt texts could be more descriptive (e.g., `"Vazhai NGO program activity"` on `what-we-do.html` could say more). |
| 2.7 | **Content Uniqueness** | ✅ | Each page has distinct, non-duplicate content. The home page intro on `index.html` and `vazhai.html` differ stylistically. No thin/duplicate content issues across the primary pages. |

---

## 3. Content Quality & Depth

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 3.1 | **Story & Mission Articulation** | ✅ | The NGO's origin story (Presidency College first-generation graduates, 2005), mission, values (Generational Growth, Complete Nourishment, Built to Last), and approach are clearly articulated. |
| 3.2 | **Call-to-Action (CTA) Clarity** | ✅ | Clear, prominent CTAs throughout: "Donate Now", "Join Vazhai", "Apply to Join Vazhai", share buttons (WhatsApp, Email, Copy Link). Multiple placements guide users through the funnel. |
| 3.3 | **Social Proof (Testimonials)** | ✅ | Student quotes (Tamil + English), School Companion quote, volunteer quotes. These are authentic and add credibility. Student voice cards include the actual Tamil text. |
| 3.4 | **Impact Quantification** | ✅ | "500+ Students Supported", "19+ Years on the Ground", "3 Districts Served", "10 Schools Target 2026". Stats are prominently displayed. |
| 3.5 | **Pricing / Cost Transparency** | ✅ | Salary ranges for School Companion (₹15–20K/mo) and Field Coordinator (₹25–35K/mo) are listed. Donation tiers are clearly explained (₹500 = 1 school day, ₹15,000 = full month). |
| 3.6 | **Blog / News / Updates** | ❌ | No blog, news, or updates section. This is a **significant gap** for SEO. Fresh, regularly updated content signals to Google that the site is active and authoritative. An NGO with 19+ years of work has rich material for articles, impact reports, school visit stories, etc. |
| 3.7 | **Annual / Impact Reports** | ❌ | No annual reports, impact assessments, or published outcomes. |
| 3.8 | **Team / Board Profiles** | ❌ | The founding team is mentioned generically ("first-generation graduates from Presidency College"), but no individual names, photos, or bios. Profiles of the School Companions and Field Coordinators are also missing. Personal stories would add significant depth. |
| 3.9 | **Case Studies / Success Stories** | ⚠️ | Student voices exist, but no structured case studies (e.g., "From dropout risk to Class 10 topper"). |
| 3.10 | **Legal Pages (Privacy Policy, T&C)** | ❌ | No privacy policy, terms of service, or refund/cancellation policy page. Given that the site processes donations (collects name, email, phone, PAN, address), a privacy policy is **legally necessary** under Indian IT Act and likely required by Razorpay's terms. |

---

## 4. Local SEO

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 4.1 | **NAP Consistency** | ✅ | Name, address ("# 341/157, T.H. Road, Kaladipet, Thiruvottiyur, Chennai – 600 019"), phone (not listed on site), and email (`vazhai.connect@gmail.com`) are consistent across all pages where they appear. |
| 4.2 | **Geo Meta Tags** | ✅ | Home page includes `geo.region`, `geo.placename`, `geo.position`, and `ICBM` meta tags with Krishnagiri coordinates. Inner pages do not have these, which is acceptable. |
| 4.3 | **Location Keywords in Content** | ✅ | All three districts (Krishnagiri, Dharmapuri, Villupuram) and sub-locations (Denkanikottai, Aiyur, Kodakarai) appear in content. |
| 4.4 | **Google Business Profile** | ❌ | Not verifiable from the code. The NGO should have a verified GBP listing for "Vazhai NGO" in Chennai/Krishnagiri. |
| 4.5 | **Local Business Schema** | ⚠️ | The NGO schema includes address and areaServed, which is good. However, it could be enhanced with `telephone`, `openingHours`, and sameAs for Google Maps. |
| 4.6 | **Contact Page Completeness** | ⚠️ | The contact page lists email, Facebook, and address. **Phone number is not listed anywhere on the site** despite the donation form requesting it. A phone number is important for local SEO and trust. |

---

## 5. Accessibility (a11y) & User Experience

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 5.1 | **Semantic HTML** | ⚠️ | Navigation uses `<nav>`, sections use `<section>`, articles use `<article>` where appropriate — good. But many content blocks use `<div>` instead of heading tags (see 2.4). |
| 5.2 | **ARIA Labels** | ⚠️ | Bottom navigation has `aria-label="Mobile Navigation"`. Sidebar nav does not. Testimonials carousel has `aria-label="Testimonials"`. Donation form has `aria-live="polite"` for error div. Overall partial coverage. |
| 5.3 | **Skip Navigation Link** | ❌ | No skip-to-content link for keyboard/screen reader users. |
| 5.4 | **Form Labels & Accessibility** | ✅ | Donation form has `<label>` elements linked to inputs. Required fields are marked with `*` on labels. |
| 5.5 | **Color Contrast** | ⚠️ | Visual inspection suggests good contrast overall (dark text on light backgrounds, white text on green/dark backgrounds). Amber on white backgrounds may be low contrast for small text (e.g., `color:var(--muted)` on some labels). |
| 5.6 | **Focus Indicators** | ⚠️ | No custom `:focus-visible` or `outline` styles detected. Browser defaults will apply, but custom focus styles improve UX for keyboard navigation. |
| 5.7 | **Language Attribute** | ✅ | `lang="en"` is properly set on all pages. |

---

## 6. Performance & Technical

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 6.1 | **CSS Bundling** | ✅ | Single `style.css` file. No render-blocking issues beyond standard. |
| 6.2 | **JavaScript** | ✅ | Minimal JS (common.js ~121 lines, donate.js). Good for performance. |
| 6.3 | **Image Optimization** | ⚠️ | Images use JPEG format with descriptive filenames, but no WebP/AVIF versions. No explicit `width`/`height` attributes on most `img` tags (except OG images), which can cause layout shift. |
| 6.4 | **Font Loading** | ✅ | Google Fonts loaded with `preconnect`, `preload`, and `swap` via standard CSS. |
| 6.5 | **Compression** | ✅ | Netlify applies Brotli/Gzip compression automatically. |
| 6.6 | **Caching Headers** | ✅ | `Cache-Control` headers added in `netlify.toml`: CSS/JS/images get 1-year cache with `immutable`, favicon gets 1-day cache. |

---

## 7. Off-Page & Missing Elements

| # | Checklist Item | Status | Notes |
|---|---------------|--------|-------|
| 7.1 | **Social Media Profiles** | ⚠️ | Only Facebook (`facebook.com/vazhai`) is linked. Twitter/X, Instagram, LinkedIn, and YouTube are absent. Social profiles strengthen E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness). |
| 7.2 | **Backlink Profile** | ❌ | Not assessed in this audit (requires external tools). The lack of blog content makes it harder to earn organic backlinks. |
| 7.3 | **Cookie Consent Notice** | ❌ | No cookie consent banner. If Google Analytics or tracking were added, this would be required. Even without tracking, donation pages may be subject to GDPR/Indian data privacy laws. |
| 7.4 | **Email Newsletter / Mailchimp** | ❌ | No newsletter signup form observed. An email list is valuable for donor retention and SEO signals (traffic from email campaigns). |
| 7.5 | **Donation Receipt / Confirmation Page** | ✅ | `thankyou.html` handles receipt display with URL parameters. It's minimal but functional. |

---

## Summary: Priority Recommendations

| Priority | Area | Recommendation | Effort | SEO Impact |
|----------|------|---------------|--------|-----------|
| 🔴 **P1** | **Legal** | Add a **Privacy Policy** page (required for collecting PAN, email, phone, address via donation form). | Low | High (risk mitigation) |
| 🔴 **P1** | **Content** | Start a **blog / news section** with monthly updates: field visit stories, student progress, School Companion profiles, impact reports. Even 1 article/month creates fresh crawlable content. | Medium | Very High |
| 🔴 **P1** | **Analytics** | Add **Google Search Console** verification and **Google Analytics 4** (or Plausible/Umami for privacy). Without analytics you cannot measure SEO performance. | Low | Very High |
🟢 **Done** | **Analytics** | ✅ Google Search Console file verified. ✅ GA4 tag (`G-SPVB6NE6JN`) added to all 9 HTML pages. | ✅ | ✅ |
| 🟠 **P2** | **Content** | Add **team/board member profiles** — names, photos, bios of founders, School Companions, Field Coordinators. Builds E-E-A-T. | Medium | High |
| 🟠 **P2** | **Technical** | Create a **custom 404 page** that helps users find their way back. | Low | Low |
| � **P2** | **Technical** | Add `<lastmod>` dates to `sitemap.xml`. | Low | Medium |
| 🟠 **P2** | **Content** | Add **phone number** to contact page and schema markup. | Low | Medium |
| 🟠 **P2** | **Performance** | Serve images in **WebP format** with JPEG fallback. Add explicit `width`/`height` attributes to prevent CLS. | Medium | Medium |
| 🟡 **P3** | **Content** | Publish **annual impact report** (PDF or page) showing outcomes, numbers, school photos, student journeys. | High | High |
| 🟡 **P3** | **Accessibility** | Add a **skip-to-content** link at the top of each page. | Low | Low |
| 🟡 **P3** | **Technical** | Add explicit `Cache-Control` headers in `netlify.toml` for static assets. | Low | Medium (performance) |
| 🟡 **P3** | **Content** | Expand **social media presence** — add links to Twitter/X, Instagram, LinkedIn, YouTube. | Medium | Medium |
| 🟡 **P3** | **Content** | Add **CSR partner logos** and case studies (if any corporate partnerships exist). | Medium | High |
| 🟡 **P3** | **Technical** | Add **breadcrumb structured data** with proper `position` on all pages (already present — verify correctness). | Low | Low |
| 🟡 **P3** | **Content** | Add a **newsletter signup** section to capture email leads. | Medium | Medium |
| 🟡 **P3** | **Accessibility** | Add explicit `:focus-visible` styles for keyboard navigation. | Low | Low |
| 🔵 **P4** | **Content** | Bridge the content gap on small pages (e.g., Events page is thin — add past event highlights, photos, outcomes). | Medium | Medium |
| 🔵 **P4** | **Technical** | Fix hreflang inconsistency — if inner pages do not have Tamil versions, remove `ta` from home page alternates or add Tamil alternates for all pages. | Low | Low |
| 🔵 **P4** | **Technical** | Convert heading-like `<div>` elements to semantic `<h2>`/`<h3>` tags for better screen reader and SEO parsing. | Medium | Low |

---

## Scoring Summary

| Category | Score | Explanation |
|----------|-------|-------------|
| **Technical SEO** | 8.5 / 10 | Strong fundamentals. Missing: 404 page, GA/SC verification, caching headers. |
| **On-Page SEO** | 8 / 10 | Excellent meta tags. Needs semantic heading improvements. |
| **Content Quality** | 6.5 / 10 | Great mission storytelling, but no blog, no team profiles, no impact reports. |
| **Local SEO** | 7 / 10 | Good NAP and geo-tags. Missing: GBP verification, phone number on site. |
| **Accessibility** | 6 / 10 | Functionally usable but lacks skip nav, strong focus indicators, full ARIA coverage. |
| **Overall** | **7.2 / 10** | Well-built foundation with notable content gaps that, if filled, would significantly improve organic search performance. |

---

## Quick Wins (Can be done in a few hours)

1. ✅ Add Google Search Console verification meta tag - done
2. ✅ Add Google Analytics 4 tracking snippet - done
3. ✅ Create a custom 404 page - done
4. ✅ Add phone number to contact page and schema
5. ✅ Add `<lastmod>` dates to sitemap.xml
6. ✅ Add `Cache-Control` headers to netlify.toml
7. ✅ Add skip-to-content link
8. ✅ Fix hreflang consistency

## Strategic Investments (1–4 weeks)

1. 📝 Launch a blog with 3–5 initial articles
2. 📝 Add team profiles page
3. 📝 Publish privacy policy
4. 📝 Create annual impact report page
5. 📝 Add newsletter signup
6. 📝 Set up and verify Google Business Profile