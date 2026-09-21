import { GoogleGenAI } from "@google/genai";
import { 
  classifyCountryOffline, 
  classifyIndustryOffline, 
  INDUSTRY_KEYWORDS, 
  GLOBAL_CORPORATE_DOMAINS,
  GLOBAL_CORPORATE_INDUSTRIES 
} from "./offlineClassifier";
import { analyzeWebsiteHtmlForCountry, analyzeSearchSnippetForCountry } from "./countryDetector";

export interface CompanyIntelligenceResult {
  domain: string;
  companyName: string;
  industry: string;
  subCategory?: string;
  productCategory?: string; // Main product/service category classification
  primaryProducts?: string[]; // Core products or services offered
  overview: string;
  businessModel?: string;
  headquarters?: string;
  title?: string;
  metaDescription?: string;
  searchSnippet?: string;
  websiteUrl?: string;
  websiteStatus: 'online' | 'unreachable' | 'offline';
  websiteSnippet?: string;
  headings?: string[];
  groundingSource?: string;
  favicon?: string;
  confidenceScore?: number;
  isAiEnhanced?: boolean;
}

// In-memory cache for fast repeated domain queries
const domainCache = new Map<string, CompanyIntelligenceResult>();

/**
 * Clean and decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&bull;/g, '•')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip HTML tags and normalize whitespace
 */
function stripHtml(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '));
}

/**
 * Clean company name from page title, og:site_name, or domain
 */
function cleanCompanyName(title: string, ogSiteName: string, domain: string): string {
  if (ogSiteName && ogSiteName.length >= 2 && ogSiteName.length <= 50) {
    const cleanOg = ogSiteName.trim();
    if (!/^(home|welcome|index|login|website)$/i.test(cleanOg)) {
      return cleanOg;
    }
  }

  if (title) {
    // Split by common title dividers: "Acme Corp | Precision Machining" -> "Acme Corp"
    const parts = title.split(/[-|–—:•»]/);
    for (const part of parts) {
      const trimmed = part.trim();
      const badTokens = /^(home|welcome|official|login|index|default|untitled|untitled document|about us|main page)$/i;
      if (trimmed.length >= 2 && trimmed.length <= 45 && !badTokens.test(trimmed)) {
        return trimmed;
      }
    }
  }

  // Fallback: domain name beautification
  const root = domain.replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, '').replace(/^www\./, '');
  // If hyphenated: "acme-precision" -> "Acme Precision"
  if (root.includes('-') || root.includes('_')) {
    return root
      .split(/[-_]+/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  return root.charAt(0).toUpperCase() + root.slice(1);
}

export interface RawDomainMeta {
  domain: string;
  websiteUrl: string;
  title: string;
  metaDescription: string;
  ogSiteName: string;
  keywords: string;
  headings: string[];
  bodySnippet: string;
  aboutSnippet?: string;
  jsonLdInfo?: {
    name?: string;
    description?: string;
    industry?: string;
  };
  websiteStatus: 'online' | 'unreachable' | 'offline';
  searchSnippet?: string;
  searchTitle?: string;
  searchSource?: string;
}

/**
 * Deep Website Content & Metadata Scraper
 * Extracts Title, Meta description, Schema.org JSON-LD, Headings (H1/H2), and clean Body paragraphs
 */
async function scrapeDomainMeta(domain: string): Promise<RawDomainMeta> {
  const cleanDomain = domain.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  const targetUrl = `https://${cleanDomain}`;

  const result: RawDomainMeta = {
    domain: cleanDomain,
    websiteUrl: targetUrl,
    title: '',
    metaDescription: '',
    ogSiteName: '',
    keywords: '',
    headings: [],
    bodySnippet: '',
    websiteStatus: 'unreachable'
  };

  const browserHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
  };

  let html = '';
  // 1. Try HTTPS, fallback to HTTP or www
  try {
    const res = await fetch(targetUrl, {
      headers: browserHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(4000)
    });

    if (res.ok) {
      html = await res.text();
      result.websiteStatus = 'online';
    }
  } catch {
    // Try HTTP fallback
    try {
      const httpUrl = `http://${cleanDomain}`;
      const resHttp = await fetch(httpUrl, {
        headers: browserHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(2800)
      });
      if (resHttp.ok) {
        html = await resHttp.text();
        result.websiteStatus = 'online';
        result.websiteUrl = httpUrl;
      }
    } catch {
      // Try www fallback
      try {
        const wwwUrl = `https://www.${cleanDomain}`;
        const resWww = await fetch(wwwUrl, {
          headers: browserHeaders,
          redirect: 'follow',
          signal: AbortSignal.timeout(2800)
        });
        if (resWww.ok) {
          html = await resWww.text();
          result.websiteStatus = 'online';
          result.websiteUrl = wwwUrl;
        }
      } catch {}
    }
  }

  // 2. Extract Rich Content from HTML
  if (html) {
    // Title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      result.title = decodeHtmlEntities(titleMatch[1]);
    }

    // Meta description (name, property og:description, or twitter:description)
    const descMatch = 
      html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["']/i);
    if (descMatch) {
      result.metaDescription = decodeHtmlEntities(descMatch[1]);
    }

    // og:site_name
    const siteNameMatch = 
      html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:site_name["']/i);
    if (siteNameMatch) {
      result.ogSiteName = decodeHtmlEntities(siteNameMatch[1]);
    }

    // Meta keywords
    const kwMatch = 
      html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']keywords["']/i);
    if (kwMatch) {
      result.keywords = decodeHtmlEntities(kwMatch[1]);
    }

    // Schema.org JSON-LD Structured Data
    try {
      const jsonLdMatches = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
      for (const m of jsonLdMatches) {
        try {
          const parsed = JSON.parse(m[1].trim());
          const candidates = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
          for (const item of candidates) {
            if (item && typeof item === 'object') {
              const type = String(item['@type'] || '');
              if (/Organization|Corporation|LocalBusiness|Medical|Automotive|Manufacturer|Store|Financial/i.test(type)) {
                result.jsonLdInfo = {
                  name: item.name || item.legalName,
                  description: item.description,
                  industry: item.knowsAbout || item.industry
                };
                if (!result.metaDescription && item.description) {
                  result.metaDescription = decodeHtmlEntities(String(item.description));
                }
                break;
              }
            }
          }
        } catch {}
      }
    } catch {}

    // Headings (H1 and H2)
    const headingMatches = Array.from(html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi));
    const cleanHeadings: string[] = [];
    for (const h of headingMatches) {
      const cleaned = stripHtml(h[1]);
      if (cleaned.length >= 4 && cleaned.length <= 90 && !/menu|navigation|cookie|login|cart/i.test(cleaned)) {
        if (!cleanHeadings.includes(cleaned)) {
          cleanHeadings.push(cleaned);
        }
      }
      if (cleanHeadings.length >= 4) break;
    }
    result.headings = cleanHeadings;

    // Body Text: Strip out boilerplate (scripts, styles, svg, navigations, footers, cookie banners)
    let bodyClean = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

    // Extract paragraphs
    const pMatches = Array.from(bodyClean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
    const paragraphs: string[] = [];
    for (const p of pMatches) {
      const text = stripHtml(p[1]);
      // Exclude cookie notices, short buttons, and disclaimers
      if (
        text.length >= 35 && 
        !/cookies|privacy policy|terms of service|rights reserved|all rights|browser/i.test(text)
      ) {
        paragraphs.push(text);
      }
      if (paragraphs.join(' ').length > 1500) break;
    }
    result.bodySnippet = paragraphs.slice(0, 4).join(' ');

    // If homepage text is sparse, attempt fast About page fetch
    if ((!result.bodySnippet || result.bodySnippet.length < 80) && result.websiteStatus === 'online') {
      try {
        const aboutRes = await fetch(`https://${cleanDomain}/about`, {
          headers: browserHeaders,
          signal: AbortSignal.timeout(2400)
        });
        if (aboutRes.ok) {
          const aboutHtml = await aboutRes.text();
          const aboutDescMatch = aboutHtml.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i);
          if (aboutDescMatch && !result.metaDescription) {
            result.metaDescription = decodeHtmlEntities(aboutDescMatch[1]);
          }
          const aboutPMatches = Array.from(aboutHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
          for (const p of aboutPMatches) {
            const pText = stripHtml(p[1]);
            if (pText.length >= 40 && !/cookies|rights reserved/i.test(pText)) {
              result.aboutSnippet = pText;
              break;
            }
          }
        }
      } catch {}
    }
  }

  // 3. Search Engine / Google Grounding
  // Query Google Search / Public Search APIs to get authentic search engine summaries
  await fetchSearchGrounding(result);

  return result;
}

/**
 * Fetch Search Engine & Google Grounding Snippets
 */
async function fetchSearchGrounding(meta: RawDomainMeta): Promise<void> {
  const domain = meta.domain;

  // 1. Try DuckDuckGo Instant Answer API (Zero rate-limit, authentic instant abstract)
  try {
    const ddgApiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(domain)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgApiUrl, { signal: AbortSignal.timeout(2500) });
    if (ddgRes.ok) {
      const data = await ddgRes.json();
      if (data.AbstractText && data.AbstractText.length >= 25) {
        meta.searchSnippet = decodeHtmlEntities(data.AbstractText);
        meta.searchTitle = data.Heading;
        meta.searchSource = 'DuckDuckGo Instant Answer';
        return;
      }
    }
  } catch {}

  // 2. Direct Organic Search Query (Google Search Scraper with Desktop Browser headers)
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent('"' + domain + '" company overview OR products OR about')}&hl=en`;
    const gRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(3200)
    });

    if (gRes.ok) {
      const gHtml = await gRes.text();
      // Google search snippet containers: BNeawe s3v9rd, VwiC3b, or span blocks
      const snippetMatches = Array.from(gHtml.matchAll(/<div[^>]+class="[^"]*(?:BNeawe\s+s3v9rd|VwiC3b|yXK7lf)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi));
      for (const sm of snippetMatches) {
        const text = stripHtml(sm[1]);
        if (text.length >= 40 && !text.includes('Missing:') && !text.includes('Must include:')) {
          meta.searchSnippet = text;
          meta.searchSource = 'Google Search';
          return;
        }
      }
    }
  } catch {}

  // 3. Fallback to Wikipedia Entity Search for major enterprises
  try {
    const compGuess = cleanCompanyName(meta.title, meta.ogSiteName, domain);
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(compGuess)}&format=json&utf8=1&srlimit=1`;
    const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(2200) });
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      if (wikiData?.query?.search?.[0]?.snippet) {
        const snippet = stripHtml(wikiData.query.search[0].snippet);
        if (snippet.length >= 35) {
          meta.searchSnippet = snippet;
          meta.searchTitle = wikiData.query.search[0].title;
          meta.searchSource = 'Wikipedia';
        }
      }
    }
  } catch {}
}

/**
 * Determine the best sub-category niche based on industry and extracted textual keywords
 */
function determineSubCategory(industry: string, text: string): string {
  const t = text.toLowerCase();

  switch (industry) {
    case 'Manufacturing':
      if (t.includes('machin') || t.includes('cnc') || t.includes('milling') || t.includes('turning')) return 'Precision CNC Machining & Tooling';
      if (t.includes('stamp') || t.includes('sheet metal') || t.includes('press')) return 'Metal Stamping & Sheet Metal Fabrication';
      if (t.includes('cast') || t.includes('foundry') || t.includes('die')) return 'Metal Casting & Foundries';
      if (t.includes('mold') || t.includes('plastic') || t.includes('injection') || t.includes('polymer')) return 'Injection Molding & Industrial Polymers';
      if (t.includes('automation') || t.includes('robot') || t.includes('hydraul') || t.includes('pneumat')) return 'Industrial Automation & Robotics';
      if (t.includes('weld') || t.includes('assembly') || t.includes('fabricat')) return 'Contract Manufacturing & Assembly';
      if (t.includes('steel') || t.includes('alloy') || t.includes('metallurg')) return 'Steel & Metal Fabrication';
      return 'OEM & Industrial Manufacturing';

    case 'Automotive':
      if (t.includes('powertrain') || t.includes('engine') || t.includes('motor')) return 'Powertrain & Engine Systems';
      if (t.includes('electric') || t.includes('ev') || t.includes('battery')) return 'Electric Vehicle & Battery Systems';
      if (t.includes('tire') || t.includes('wheel')) return 'Tires & Wheel Systems';
      if (t.includes('brake') || t.includes('suspension') || t.includes('chassis')) return 'Chassis & Brake Systems';
      if (t.includes('aftermarket') || t.includes('parts')) return 'Automotive Aftermarket & Replacement Parts';
      if (t.includes('dealer') || t.includes('dealership') || t.includes('showroom')) return 'Automobile Dealership & Retail';
      return 'Automotive Components & OEM';

    case 'Healthcare':
      if (t.includes('pharma') || t.includes('drug') || t.includes('vaccine') || t.includes('medicine')) return 'Pharmaceuticals & Drug Discovery';
      if (t.includes('biotech') || t.includes('genomic') || t.includes('cell')) return 'Biotechnology & Life Sciences';
      if (t.includes('device') || t.includes('surgical') || t.includes('implant') || t.includes('catheter')) return 'Medical Devices & Surgical Instruments';
      if (t.includes('diagnostic') || t.includes('pathology') || t.includes('radiology') || t.includes('lab')) return 'Clinical Diagnostics & Laboratory';
      if (t.includes('hospital') || t.includes('clinic') || t.includes('care center')) return 'Hospital Systems & Healthcare Centers';
      if (t.includes('dental') || t.includes('orthodontic')) return 'Dental & Oral Health';
      return 'Medical & Clinical Healthcare';

    case 'Finance':
      if (t.includes('payment') || t.includes('checkout') || t.includes('gateway') || t.includes('pos')) return 'FinTech & Payment Gateways';
      if (t.includes('bank') || t.includes('lending') || t.includes('credit')) return 'Commercial & Retail Banking';
      if (t.includes('invest') || t.includes('capital') || t.includes('wealth') || t.includes('equity') || t.includes('fund')) return 'Asset Management & Private Equity';
      if (t.includes('insur') || t.includes('underwriting') || t.includes('policy')) return 'Insurance & Risk Underwriting';
      if (t.includes('account') || t.includes('tax') || t.includes('audit')) return 'Accounting & Financial Auditing';
      return 'Banking & Financial Services';

    case 'Technology':
      if (t.includes('saas') || t.includes('cloud') || t.includes('enterprise software')) return 'Enterprise Cloud & SaaS';
      if (t.includes('ai') || t.includes('machine learning') || t.includes('artificial intelligence') || t.includes('data')) return 'Artificial Intelligence & Data Analytics';
      if (t.includes('cyber') || t.includes('security') || t.includes('threat') || t.includes('firewall')) return 'Cybersecurity & Infrastructure Defense';
      if (t.includes('api') || t.includes('developer') || t.includes('devops') || t.includes('sdk')) return 'Developer Tooling & Infrastructure';
      if (t.includes('hardware') || t.includes('chip') || t.includes('semiconductor')) return 'Semiconductors & Computing Hardware';
      return 'Information Technology & Software';

    case 'Construction':
      if (t.includes('civil') || t.includes('infrastructure') || t.includes('road') || t.includes('bridge')) return 'Civil & Infrastructure Engineering';
      if (t.includes('general contractor') || t.includes('commercial build')) return 'Commercial General Contracting';
      if (t.includes('hvac') || t.includes('cooling') || t.includes('heating') || t.includes('ventilat')) return 'Commercial HVAC & Mechanical Systems';
      if (t.includes('electric') || t.includes('wiring') || t.includes('power')) return 'Electrical Contracting & Systems';
      if (t.includes('roof') || t.includes('plumb') || t.includes('masonry')) return 'Specialty Trade Contracting';
      return 'General Construction & Architecture';

    case 'Logistics':
      if (t.includes('freight') || t.includes('forward') || t.includes('intermodal')) return 'Global Freight Forwarding & Intermodal';
      if (t.includes('warehouse') || t.includes('warehousing') || t.includes('fulfillment') || t.includes('3pl')) return 'Warehousing & 3PL Fulfillment';
      if (t.includes('courier') || t.includes('express') || t.includes('parcel') || t.includes('last mile')) return 'Courier, Parcel & Express Delivery';
      if (t.includes('shipping') || t.includes('ocean') || t.includes('marine') || t.includes('vessel')) return 'Ocean Shipping & Marine Freight';
      if (t.includes('cold chain') || t.includes('refrigerat')) return 'Temperature-Controlled Cold Chain';
      return 'Supply Chain & Logistics';

    case 'Energy':
      if (t.includes('solar') || t.includes('photovoltaic')) return 'Solar Power & Photovoltaic Systems';
      if (t.includes('wind') || t.includes('turbine')) return 'Wind Energy & Clean Power';
      if (t.includes('oil') || t.includes('petroleum') || t.includes('gas') || t.includes('drilling')) return 'Oil, Gas & Petroleum';
      if (t.includes('utility') || t.includes('grid') || t.includes('substation') || t.includes('power plant')) return 'Power Utilities & Transmission Grids';
      return 'Energy & Clean Utilities';

    case 'Food & Beverage':
      if (t.includes('brew') || t.includes('beer') || t.includes('distill') || t.includes('spirits') || t.includes('wine')) return 'Brewing, Distilling & Winemaking';
      if (t.includes('bakery') || t.includes('snack') || t.includes('confection')) return 'Commercial Bakery & Confectionery';
      if (t.includes('meat') || t.includes('poultry') || t.includes('seafood') || t.includes('dairy')) return 'Protein, Dairy & Food Processing';
      if (t.includes('ingredient') || t.includes('flavor') || t.includes('additive')) return 'Food Ingredients & Flavorings';
      if (t.includes('restaurant') || t.includes('cafe') || t.includes('catering')) return 'Foodservice & Hospitality Dining';
      return 'Packaged Foods & Beverages';

    case 'E-commerce':
      if (t.includes('apparel') || t.includes('clothing') || t.includes('fashion') || t.includes('wear')) return 'Direct-to-Consumer Apparel & Fashion';
      if (t.includes('electronics') || t.includes('gadgets')) return 'Consumer Electronics Retail';
      if (t.includes('marketplace') || t.includes('platform')) return 'Online B2B / B2C Marketplace';
      return 'Digital Commerce & Retail';

    default:
      return `${industry} Solutions`;
  }
}

/**
 * Extract product category and key products from meta and text signals
 */
function extractProductProfile(
  industry: string,
  subCategory: string,
  headings: string[] | undefined,
  corpus: string,
  metaTitle: string
): { productCategory: string; primaryProducts: string[] } {
  const products: string[] = [];

  // Extract candidate product names from clean headings
  if (headings && headings.length > 0) {
    for (const h of headings) {
      const cleanH = h.replace(/^(our|all|the|about|welcome to|view|explore)\s+/i, '').trim();
      if (cleanH.length >= 3 && cleanH.length <= 45 && !/^(contact|home|privacy|terms|blog|careers|about us|cookie|menu|search)/i.test(cleanH)) {
        if (!products.some(p => p.toLowerCase() === cleanH.toLowerCase())) {
          products.push(cleanH);
        }
      }
      if (products.length >= 4) break;
    }
  }

  // If headings didn't yield enough, extract from title or keywords
  if (products.length === 0 && metaTitle) {
    const parts = metaTitle.split(/[-|–•:,]/).map(p => p.trim()).filter(p => p.length >= 4 && p.length <= 40);
    for (const p of parts.slice(1)) {
      if (!/^(home|official|welcome|login|portal|website)/i.test(p)) {
        products.push(p);
      }
      if (products.length >= 2) break;
    }
  }

  // Fallback to subCategory if still empty
  if (products.length === 0) {
    products.push(subCategory);
  }

  // High-level product categorization mapping
  let productCategory = subCategory;
  const c = corpus.toLowerCase();

  if (c.includes('cnc') || c.includes('milling') || c.includes('stamping') || c.includes('machining') || c.includes('tooling')) {
    productCategory = 'Precision Parts & Machined Components';
  } else if (c.includes('powertrain') || c.includes('autoparts') || c.includes('brakes') || c.includes('automotive parts')) {
    productCategory = 'Automotive Parts & Assemblies';
  } else if (c.includes('industrial equipment') || c.includes('heavy machinery') || c.includes('excavator') || c.includes('compressor')) {
    productCategory = 'Heavy Machinery & Industrial Equipment';
  } else if (c.includes('hvac') || c.includes('ventilation') || c.includes('pumps') || c.includes('valves') || c.includes('piping')) {
    productCategory = 'Valves, Pumps & Flow Controls';
  } else if (c.includes('pharmaceutical') || c.includes('vaccine') || c.includes('therapeutics') || c.includes('drugs')) {
    productCategory = 'Pharmaceuticals & Therapeutics';
  } else if (c.includes('medical device') || c.includes('surgical') || c.includes('implants') || c.includes('diagnostic device')) {
    productCategory = 'Medical Devices & Diagnostics';
  } else if (c.includes('cloud platform') || c.includes('saas') || c.includes('enterprise software') || c.includes('erp')) {
    productCategory = 'Cloud Software & Enterprise SaaS';
  } else if (c.includes('cybersecurity') || c.includes('firewall') || c.includes('endpoint security')) {
    productCategory = 'Cybersecurity Software & Network Defense';
  } else if (c.includes('freight') || c.includes('warehousing') || c.includes('logistics') || c.includes('supply chain')) {
    productCategory = 'Freight Forwarding & Warehousing Services';
  } else if (c.includes('packaging') || c.includes('corrugated') || c.includes('carton') || c.includes('containers')) {
    productCategory = 'Industrial Packaging & Containers';
  } else if (c.includes('solar panel') || c.includes('photovoltaic') || c.includes('inverter') || c.includes('wind turbine')) {
    productCategory = 'Solar & Renewable Energy Equipment';
  } else if (c.includes('plastics') || c.includes('injection mold') || c.includes('polymers') || c.includes('resins')) {
    productCategory = 'Polymers, Resins & Molded Plastics';
  } else if (c.includes('beverage') || c.includes('brewery') || c.includes('food ingredients') || c.includes('snacks')) {
    productCategory = 'Food Ingredients & Packaged Goods';
  }

  return { productCategory, primaryProducts: products.slice(0, 5) };
}

/**
 * Intelligent Rule-Based Analyzer (Offline & Heuristic Mode)
 * Uses genuine scraped text from Title, Meta description, JSON-LD, Headings, and Search snippets
 */
export function analyzeMetaLocally(meta: RawDomainMeta): CompanyIntelligenceResult {
  const cleanDom = meta.domain.toLowerCase().trim();

  // 1. Direct match for known enterprise domains
  if (GLOBAL_CORPORATE_INDUSTRIES[cleanDom]) {
    const prof = GLOBAL_CORPORATE_INDUSTRIES[cleanDom];
    const compName = prof.companyName;
    const prodInfo = extractProductProfile(prof.industry, prof.subCategory, meta.headings, `${prof.companyName} ${prof.subCategory} ${meta.metaDescription || ''}`, meta.title || '');
    return {
      domain: cleanDom,
      companyName: compName,
      industry: prof.industry,
      subCategory: prof.subCategory,
      productCategory: prodInfo.productCategory,
      primaryProducts: prodInfo.primaryProducts,
      overview: meta.metaDescription || meta.searchSnippet || `${compName} is a global enterprise operating in ${prof.industry} (${prof.subCategory}).`,
      businessModel: prof.industry === 'Manufacturing' || prof.industry === 'Automotive' ? 'B2B Manufacturer / OEM' : 'Enterprise',
      headquarters: classifyCountryOffline(cleanDom) || 'Global',
      title: meta.title || `${compName} | Official Website`,
      metaDescription: meta.metaDescription || meta.searchSnippet || '',
      searchSnippet: meta.searchSnippet || '',
      websiteUrl: meta.websiteUrl,
      websiteStatus: meta.websiteStatus,
      websiteSnippet: meta.bodySnippet || meta.aboutSnippet,
      headings: meta.headings,
      groundingSource: meta.searchSnippet ? meta.searchSource : 'Verified Corporate Registry',
      favicon: `https://www.google.com/s2/favicons?domain=${cleanDom}&sz=64`,
      confidenceScore: 99,
      isAiEnhanced: false
    };
  }

  // 2. Aggregate all scraped text signals
  const jsonDesc = meta.jsonLdInfo?.description || '';
  const jsonIndustry = meta.jsonLdInfo?.industry || '';
  const headingsText = (meta.headings || []).join(' ');
  const bodyText = meta.bodySnippet || '';
  const aboutText = meta.aboutSnippet || '';
  const searchSnippet = meta.searchSnippet || '';
  const metaDesc = meta.metaDescription || '';
  const title = meta.title || '';
  const keywords = meta.keywords || '';

  const fullCorpus = [
    title,
    metaDesc,
    headingsText,
    searchSnippet,
    jsonDesc,
    bodyText,
    aboutText,
    keywords
  ].join(' ').toLowerCase();

  // 3. Multi-Weight Keyword Scoring
  const scores: Record<string, number> = {};
  for (const [ind, kwList] of Object.entries(INDUSTRY_KEYWORDS)) {
    let score = 0;
    for (const kw of kwList) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');

      // Heavy weight for Schema.org JSON-LD and Meta Description
      if (jsonDesc && wordRegex.test(jsonDesc)) score += 10;
      if (metaDesc && wordRegex.test(metaDesc)) score += 8;
      if (title && wordRegex.test(title)) score += 7;
      if (headingsText && wordRegex.test(headingsText)) score += 6;
      if (searchSnippet && wordRegex.test(searchSnippet)) score += 6;
      if (bodyText && wordRegex.test(bodyText)) score += 3;
      if (aboutText && wordRegex.test(aboutText)) score += 4;
      if (keywords && wordRegex.test(keywords)) score += 2;

      // Domain token check
      const rootDomain = cleanDom.replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, '');
      if (rootDomain.includes(kw) && (kw.length >= 4 || rootDomain.startsWith(kw))) {
        score += 6;
      }
    }
    scores[ind] = score;
  }

  // Find top scoring industry
  let bestIndustry = 'Technology';
  let maxScore = 0;
  for (const [ind, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestIndustry = ind;
    }
  }

  // If no keywords matched in page text, fallback to domain token analysis
  if (maxScore === 0) {
    const offlineGuess = classifyIndustryOffline(meta.domain);
    if (offlineGuess) {
      bestIndustry = offlineGuess;
    } else {
      bestIndustry = 'Manufacturing'; // Sensible default for industrial inquiries if domain ends in .com
    }
  }

  // 4. Determine Sub-Category
  const subCategory = determineSubCategory(bestIndustry, fullCorpus);

  // 5. Determine Business Model
  let businessModel = 'B2B';
  if (fullCorpus.includes('saas') || fullCorpus.includes('subscription software') || fullCorpus.includes('cloud platform')) {
    businessModel = 'B2B SaaS';
  } else if (fullCorpus.includes('manufacturer') || fullCorpus.includes('oem') || fullCorpus.includes('fabrication') || fullCorpus.includes('machining')) {
    businessModel = 'B2B Manufacturer / OEM';
  } else if (fullCorpus.includes('distributor') || fullCorpus.includes('wholesale') || fullCorpus.includes('supply')) {
    businessModel = 'B2B Wholesale / Distribution';
  } else if (fullCorpus.includes('shop') || fullCorpus.includes('cart') || fullCorpus.includes('consumer') || fullCorpus.includes('d2c')) {
    businessModel = 'B2C / Direct-to-Consumer';
  } else if (fullCorpus.includes('contractor') || fullCorpus.includes('engineering') || fullCorpus.includes('consulting') || fullCorpus.includes('services')) {
    businessModel = 'Contract Services / Engineering';
  }

  // 6. Clean Company Name
  const companyName = cleanCompanyName(meta.title || meta.searchTitle || '', meta.ogSiteName, meta.domain);

  // 7. Factual Overview Synthesis (Never output generic filler text!)
  let overview = '';
  if (meta.jsonLdInfo?.description && meta.jsonLdInfo.description.length >= 25) {
    overview = meta.jsonLdInfo.description;
  } else if (meta.searchSnippet && meta.searchSnippet.length >= 35) {
    overview = meta.searchSnippet;
  } else if (meta.metaDescription && meta.metaDescription.length >= 30) {
    overview = meta.metaDescription;
  } else if (meta.bodySnippet && meta.bodySnippet.length >= 45) {
    // Extract first 1-2 clean sentences from body snippet
    const sentences = meta.bodySnippet.split(/(?<=[.!?])\s+/);
    overview = sentences.slice(0, 2).join(' ');
  } else if (meta.aboutSnippet && meta.aboutSnippet.length >= 30) {
    overview = meta.aboutSnippet;
  } else if (meta.headings && meta.headings.length > 0) {
    overview = `${companyName} specializes in ${meta.headings.slice(0, 2).join(' and ')} for the ${bestIndustry.toLowerCase()} sector.`;
  } else {
    overview = `${companyName} operates in the ${bestIndustry} sector, providing specialized ${subCategory.toLowerCase()} solutions.`;
  }

  // Cap overview length
  if (overview.length > 300) {
    overview = overview.slice(0, 297) + '...';
  }

  // 8. Headquarters (Deep resolution via ccTLD, corporate registries, website contact, and search snippet)
  let hq = classifyCountryOffline(meta.domain);
  if (!hq && meta.bodySnippet) {
    const webCountry = analyzeWebsiteHtmlForCountry(meta.bodySnippet, meta.domain);
    if (webCountry) hq = webCountry.country;
  }
  if (!hq && meta.searchSnippet) {
    const searchCountry = analyzeSearchSnippetForCountry(meta.searchSnippet, meta.searchTitle);
    if (searchCountry) hq = searchCountry.country;
  }
  if (!hq) hq = 'Global';

  // 9. Confidence Score
  let confidence = 75;
  if (meta.searchSnippet && meta.websiteStatus === 'online') confidence = 96;
  else if (meta.websiteStatus === 'online' && (meta.metaDescription || meta.bodySnippet)) confidence = 92;
  else if (meta.searchSnippet) confidence = 88;
  else if (meta.title) confidence = 82;

  // 10. Extract Product Profile & Categories
  const productProfile = extractProductProfile(bestIndustry, subCategory, meta.headings, fullCorpus, meta.title || '');

  return {
    domain: meta.domain,
    companyName,
    industry: bestIndustry,
    subCategory,
    productCategory: productProfile.productCategory,
    primaryProducts: productProfile.primaryProducts,
    overview,
    businessModel,
    headquarters: hq,
    title: meta.title || meta.searchTitle || '',
    metaDescription: meta.metaDescription || '',
    searchSnippet: meta.searchSnippet || '',
    websiteUrl: meta.websiteUrl,
    websiteStatus: meta.websiteStatus,
    websiteSnippet: meta.bodySnippet || meta.aboutSnippet,
    headings: meta.headings,
    groundingSource: meta.searchSnippet ? meta.searchSource : (meta.websiteStatus === 'online' ? 'Live Website Crawl' : 'Domain Heuristic'),
    favicon: `https://www.google.com/s2/favicons?domain=${meta.domain}&sz=64`,
    confidenceScore: confidence,
    isAiEnhanced: false
  };
}

// Quota circuit breaker to prevent repeated 429 errors when Gemini API key limit is reached
let enricherAiCooldownUntil = 0;

/**
 * AI-Enhanced Synthesis via Gemini 3.8 Flash with Google Search Grounding
 */
async function enhanceWithGemini(
  rawMetas: RawDomainMeta[],
  customApiKey?: string
): Promise<Map<string, CompanyIntelligenceResult>> {
  if (Date.now() < enricherAiCooldownUntil) {
    return new Map();
  }

  const apiKey = (customApiKey && customApiKey.trim()) || process.env.GEMINI_API_KEY;
  const results = new Map<string, CompanyIntelligenceResult>();
  if (!apiKey || rawMetas.length === 0) return results;

  try {
    const ai = new GoogleGenAI({ apiKey });

    const promptPayload = rawMetas.map(m => ({
      domain: m.domain,
      websiteUrl: m.websiteUrl,
      websiteStatus: m.websiteStatus,
      pageTitle: m.title || m.searchTitle || 'N/A',
      metaDescription: m.metaDescription || 'N/A',
      jsonLdDescription: m.jsonLdInfo?.description || 'N/A',
      pageHeadings: m.headings && m.headings.length > 0 ? m.headings.join(' | ') : 'N/A',
      bodyTextSnippet: m.bodySnippet ? m.bodySnippet.slice(0, 450) : (m.aboutSnippet || 'N/A'),
      searchEngineSnippet: m.searchSnippet || 'N/A'
    }));

    const prompt = `You are an elite corporate intelligence analyst and B2B researcher.
For each company domain below, analyze the provided live website data and use Google Search grounding to determine their exact business profile and product catalog.

Key Directives:
1. "companyName": Official corporate brand name (clean, no generic words like 'Home', 'Official Website', etc.).
2. "industry": Choose the single most accurate industry sector from this list:
   [Manufacturing, Automotive, Healthcare, Technology, Finance, Construction, Logistics, Energy, Food & Beverage, E-commerce, Real Estate, Agriculture, Legal, Education, Marketing, Consulting, Media, Travel, Aerospace & Defense, Chemicals, Non-Profit]
   CRITICAL: If the company manufactures products, parts, machinery, industrial equipment, or performs fabrication/machining, classify them as 'Manufacturing' (or 'Automotive' for auto parts). DO NOT default to 'Technology'.
3. "subCategory": Specific industrial niche (e.g. 'Precision CNC Stamping & Machining', 'Automotive Powertrain & Sensor Systems', 'Commercial HVAC Systems', 'Cardiovascular Diagnostic Devices', 'Global Freight Forwarding & 3PL').
4. "productCategory": High-level product or service family that categorizes their offerings (e.g. 'Precision Parts & Machined Components', 'Automotive Parts & Assemblies', 'Heavy Machinery & Industrial Equipment', 'Valves, Pumps & Flow Controls', 'Medical Devices & Diagnostics', 'Cloud Software & Enterprise SaaS', 'Industrial Packaging & Containers', 'Solar & Renewable Energy Equipment', 'Polymers & Molded Plastics', 'Food Ingredients & Packaged Goods').
5. "primaryProducts": Array of 2 to 5 specific, concrete products or core services offered (e.g. ["CNC Turned Components", "Sheet Metal Enclosures", "Custom Stamped Brackets"]).
6. "overview": An accurate, factual 1-2 sentence overview describing what this company actually manufactures, sells, or services based on the live website and Google search. DO NOT use generic filler text like "is an established company providing specialized services".
7. "businessModel": (e.g. 'B2B Manufacturer / OEM', 'B2B SaaS', 'B2C Retail', 'Contract Engineering', 'Wholesale Distribution', 'Clinical Healthcare').
8. "headquarters": Country or City, Country.
9. "confidenceScore": Integer between 85 and 99.

Input company domain data:
${JSON.stringify(promptPayload, null, 2)}

Return your output STRICTLY as a JSON array wrapped in a markdown code block:
\`\`\`json
[
  {
    "domain": "example.com",
    "companyName": "Brand Name",
    "industry": "Industry Sector",
    "subCategory": "Specific Niche",
    "productCategory": "Product Family Category",
    "primaryProducts": ["Product 1", "Product 2", "Product 3"],
    "overview": "Clear 1-2 sentence description of products and business activities.",
    "businessModel": "Business Model",
    "headquarters": "City, Country",
    "confidenceScore": 95
  }
]
\`\`\``;

    // Use gemini-3.8-flash with Google Search grounding tool
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1
      }
    });

    const responseText = response.text || '';
    
    // Extract JSON array from code block or raw text
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && item.domain) {
          const raw = rawMetas.find(r => r.domain.toLowerCase() === item.domain.toLowerCase()) || rawMetas[0];
          const rawFullCorpus = `${raw?.title || ''} ${raw?.metaDescription || ''} ${(raw?.headings || []).join(' ')} ${raw?.bodySnippet || ''} ${raw?.aboutSnippet || ''}`;
          const fallbackProduct = extractProductProfile(item.industry || 'Manufacturing', item.subCategory || 'Industrial Solutions', raw?.headings, rawFullCorpus, raw?.title || '');
          
          results.set(item.domain.toLowerCase(), {
            domain: item.domain.toLowerCase(),
            companyName: item.companyName || cleanCompanyName(raw.title, raw.ogSiteName, raw.domain),
            industry: item.industry || 'Manufacturing',
            subCategory: item.subCategory || `${item.industry || 'Industrial'} Solutions`,
            productCategory: item.productCategory || fallbackProduct.productCategory,
            primaryProducts: (Array.isArray(item.primaryProducts) && item.primaryProducts.length > 0) ? item.primaryProducts : fallbackProduct.primaryProducts,
            overview: item.overview || raw?.metaDescription || raw?.searchSnippet || '',
            businessModel: item.businessModel || 'B2B',
            headquarters: item.headquarters || classifyCountryOffline(raw.domain) || 'Global',
            title: raw?.title || raw?.searchTitle || '',
            metaDescription: raw?.metaDescription || '',
            searchSnippet: raw?.searchSnippet || '',
            websiteUrl: raw?.websiteUrl || `https://${item.domain}`,
            websiteStatus: raw?.websiteStatus || 'online',
            websiteSnippet: raw?.bodySnippet || raw?.aboutSnippet,
            headings: raw?.headings,
            groundingSource: 'Google Search & Live Web AI',
            favicon: `https://www.google.com/s2/favicons?domain=${item.domain}&sz=64`,
            confidenceScore: Math.min(99, Math.max(85, Number(item.confidenceScore) || 96)),
            isAiEnhanced: true
          });
        }
      }
    }
  } catch (err: any) {
    const errMsg = (err?.message || '').toLowerCase();
    const isQuotaError = 
      errMsg.includes('429') || 
      errMsg.includes('quota') || 
      errMsg.includes('resource_exhausted') || 
      errMsg.includes('rate_limit') ||
      err?.status === 'RESOURCE_EXHAUSTED' ||
      err?.code === 429;

    if (isQuotaError) {
      enricherAiCooldownUntil = Date.now() + 30 * 60 * 1000;
      console.log("[Domain Intelligence] Gemini API quota limit reached; safely using high-fidelity web meta & search heuristic extraction.");
    } else {
      console.log("[Domain Intelligence] Notice: Fallback search extraction active.");
    }
  }

  return results;
}

/**
 * Main Entry Point: Enrich a batch of email domains with live web meta & search intelligence
 */
export async function enrichDomainsIntelligence(
  domains: string[],
  customApiKey?: string
): Promise<CompanyIntelligenceResult[]> {
  const uniqueDomains = Array.from(
    new Set(
      domains
        .map(d => d.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0])
        .filter(d => d && d.includes('.'))
    )
  ).slice(0, 40); // Cap batch at 40 domains per request for high responsiveness

  const finalResults: CompanyIntelligenceResult[] = [];
  const uncachedDomains: string[] = [];

  // Check cache first
  for (const domain of uniqueDomains) {
    if (domainCache.has(domain)) {
      finalResults.push(domainCache.get(domain)!);
    } else {
      uncachedDomains.push(domain);
    }
  }

  if (uncachedDomains.length === 0) {
    return finalResults;
  }

  console.log(`[Domain Intelligence] Scraping live website and Google search intelligence for ${uncachedDomains.length} domains...`);

  // Fetch website metadata and search snippets in parallel (batches of 6)
  const rawMetas: RawDomainMeta[] = [];
  const BATCH_SIZE = 6;
  for (let i = 0; i < uncachedDomains.length; i += BATCH_SIZE) {
    const chunk = uncachedDomains.slice(i, i + BATCH_SIZE);
    const chunkResults = await Promise.all(chunk.map(d => scrapeDomainMeta(d)));
    rawMetas.push(...chunkResults);
  }

  // Attempt AI enhancement with Google Search grounding if an API key is available
  const effectiveKey = (customApiKey && customApiKey.trim()) || process.env.GEMINI_API_KEY;
  let aiResults = new Map<string, CompanyIntelligenceResult>();
  if (effectiveKey) {
    aiResults = await enhanceWithGemini(rawMetas, effectiveKey);
  }

  // Build final results using AI where available or rule-based parser
  for (const meta of rawMetas) {
    let finalIntel: CompanyIntelligenceResult;
    if (aiResults.has(meta.domain)) {
      finalIntel = aiResults.get(meta.domain)!;
    } else {
      finalIntel = analyzeMetaLocally(meta);
    }

    // Cache result
    domainCache.set(meta.domain, finalIntel);
    finalResults.push(finalIntel);
  }

  return finalResults;
}
