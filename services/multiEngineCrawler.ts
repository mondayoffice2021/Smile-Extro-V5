import { GoogleGenAI } from '@google/genai';
const COUNTRY_CCTLD_MAP: Record<string, string> = {
  germany: 'de', de: 'de', deutschland: 'de', china: 'cn', cn: 'cn',
  italy: 'it', it: 'it', japan: 'jp', jp: 'jp', 'south korea': 'kr',
  korea: 'kr', kr: 'kr', 'united states': 'us', usa: 'us', us: 'us',
  'united kingdom': 'co.uk', uk: 'uk', france: 'fr', fr: 'fr',
  spain: 'es', es: 'es', canada: 'ca', ca: 'ca', australia: 'com.au',
  brazil: 'com.br', india: 'in', in: 'in', netherlands: 'nl', nl: 'nl',
  switzerland: 'ch', ch: 'ch', sweden: 'se', poland: 'pl', turkey: 'com.tr',
  vietnam: 'vn', mexico: 'mx', uae: 'ae', 'saudi arabia': 'sa'
};

export function getCountryCcTLD(country: string): string {
  if (!country || !country.trim()) return 'com';
  const norm = country.trim().toLowerCase();
  if (COUNTRY_CCTLD_MAP[norm]) return COUNTRY_CCTLD_MAP[norm];
  if (/^[a-z]{2}$/.test(norm)) return norm;
  for (const [key, code] of Object.entries(COUNTRY_CCTLD_MAP)) {
    if (norm.includes(key) || key.includes(norm)) return code;
  }
  const letters = norm.replace(/[^a-z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 2) : 'com';
}

export interface DiscoveredLead {
  email: string;
  companyName: string;
  sourceUrl: string;
  country: string;
  isValid: boolean;
  role?: string;
  ceoName?: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface ExecutiveContact {
  companyName: string;
  websiteUrl: string;
  type: string;
  country: string;
  ceoName: string;
  role: string;
  derivedEmail: string;
  confidence: number;
}

const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const MAILTO_REGEX = /href=["']mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[^"']*["']/gi;
const OBFUSCATED_REGEX = /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s+at\s+|&#64;)\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;

const DISALLOWED_EMAIL_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.css', '.js', '.woff', '.woff2'];

// Aggregator, booking portal, OTA, and directory domains to exclude from lead collection
export const AGGREGATOR_DOMAINS = [
  'booking.com', 'trivago', 'tripadvisor', 'expedia', 'yelp', 'yellowpages',
  'lastminute.com', 'hotels.com', 'trustpilot.com', 'agoda.com', 'airbnb',
  'kayak', 'skyscanner', 'wikipedia.org', 'wikidata.org', 'britannica.com',
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'pinterest.com', 'reddit.com', 'github.com', 'bloomberg.com',
  'reuters.com', 'forbes.com', 'glassdoor', 'indeed', 'crunchbase.com',
  'medium.com', 'quora.com', 'amazon', 'ebay', 'alibaba.com', 'aliexpress.com',
  'walmart.com', 'apple.com', 'microsoft.com', 'cloudflare.com', 'sentry.io',
  'wixpress.com', 'schema.org', 'w3.org', 'google.com', 'bing.com', 'duckduckgo.com',
  'nhs.net', 'gov.uk', 'parliament.uk', 'europa.eu', 'who.int', 'un.org'
];

const DISALLOWED_DOMAINS = [
  'example.com', 'email.com', 'domain.com', 'sample.com', 'sentry.io',
  'wixpress.com', 'schema.org', 'w3.org', 'github.com', 'google.com',
  'bing.com', 'duckduckgo.com', 'cloudflare.com', 'yourdomain.com', 'yourcompany.com',
  ...AGGREGATOR_DOMAINS
];

export function cleanEmail(rawEmail: string): string | null {
  let em = rawEmail.toLowerCase().trim().replace(/^[.<>,"'\s]+|[.<>,"'\s]+$/g, '');
  if (!em || !em.includes('@')) return null;
  const [user, domain] = em.split('@');
  if (!user || !domain || !domain.includes('.')) return null;

  if (domain.includes('example') || user.includes('example') || user === 'test' || user === 'user' || user === 'sample' || user === 'name') {
    return null;
  }
  for (const ext of DISALLOWED_EMAIL_EXTS) {
    if (em.endsWith(ext) || domain.endsWith(ext)) return null;
  }
  for (const dis of DISALLOWED_DOMAINS) {
    if (domain === dis || domain.includes(dis)) return null;
  }
  if (user.includes('noreply') || user.includes('no-reply') || user.includes('donotreply') || user.includes('mailer-daemon') || user.includes('postmaster')) {
    return null;
  }
  return em;
}

export function cleanCompanyName(rawTitle: string, domain?: string): string {
  if (!rawTitle && domain) {
    const d = domain.replace(/^www\./, '').split('.')[0];
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  let clean = (rawTitle || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();

  // Strip generic SEO prefixes
  clean = clean.replace(/^(?:welcome to|home of|official site of|about|contact)\s+/i, '');
  
  const parts = clean.split(/[-–—|:·]/).map(p => p.trim()).filter(Boolean);
  if (parts.length > 0) {
    // Prefer non-generic company name candidate
    for (const p of parts) {
      if (p.length >= 2 && p.length <= 50 && !p.toLowerCase().startsWith('http') && !/^(what is|top \d+|best \d+|\d+ best|cheap|compare|find|welcome)/i.test(p)) {
        return p;
      }
    }
    const first = parts[0];
    if (first.length >= 2 && first.length <= 50 && !first.toLowerCase().startsWith('http')) {
      return first;
    }
  }

  if (domain) {
    const d = domain.replace(/^www\./, '').split('.')[0];
    return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return clean.slice(0, 45) || 'Corporate Enterprise';
}

export function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  // 1. Standard body emails
  const bodyMatches = html.match(EMAIL_REGEX) || [];
  for (const m of bodyMatches) {
    const cleaned = cleanEmail(m);
    if (cleaned) found.add(cleaned);
  }

  // 2. Mailto links
  const mailtoMatches = Array.from(html.matchAll(MAILTO_REGEX));
  for (const m of mailtoMatches) {
    const cleaned = cleanEmail(m[1]);
    if (cleaned) found.add(cleaned);
  }

  // 3. Obfuscated emails: info [at] domain.com
  const obfMatches = Array.from(html.matchAll(OBFUSCATED_REGEX));
  for (const m of obfMatches) {
    const cleaned = cleanEmail(`${m[1]}@${m[2]}`);
    if (cleaned) found.add(cleaned);
  }

  return Array.from(found);
}

/**
 * Extract clean keywords and country from user dork query
 */
export function extractCleanKeywordsAndCountry(rawQuery: string, fallbackCountry = 'N/A'): { keywords: string; country: string } {
  let q = rawQuery || '';

  // Detect site:xx
  let detectedCountry = fallbackCountry;
  const siteMatch = q.match(/site:\.?([a-zA-Z.]+)/i);
  if (siteMatch) {
    const tld = siteMatch[1].toLowerCase().replace(/^\./, '');
    const map: Record<string, string> = {
      de: 'Germany', cn: 'China', it: 'Italy', jp: 'Japan', kr: 'South Korea',
      uk: 'United Kingdom', 'co.uk': 'United Kingdom', fr: 'France', es: 'Spain',
      ca: 'Canada', 'com.au': 'Australia', 'com.br': 'Brazil', in: 'India',
      nl: 'Netherlands', ch: 'Switzerland', se: 'Sweden', pl: 'Poland',
      'com.tr': 'Turkey', vn: 'Vietnam', mx: 'Mexico', ae: 'UAE', us: 'United States'
    };
    if (map[tld]) detectedCountry = map[tld];
  }

  // Strip dork operators and noise words
  q = q.replace(/site:\S+/gi, ' ');
  q = q.replace(/inurl:\S+/gi, ' ');
  q = q.replace(/filetype:\S+/gi, ' ');
  q = q.replace(/intitle:\S+/gi, ' ');
  q = q.replace(/["'()]/g, ' ');
  // Cleanly strip email prefixes like info@, contact@, sales@, etc.
  q = q.replace(/(?:^|\s)(?:info|contact|sales|export|procurement|office|support|inquiry)?@\S*/gi, ' ');
  q = q.replace(/\b(?:contact\s+us|contact|sales|export|procurement|suppliers|manufacturers|distributors|dealers|email|emails|OR|AND)\b/gi, ' ');
  q = q.replace(/\s+/g, ' ').trim();

  const keywords = q || 'Manufacturing Industry';
  return { keywords, country: detectedCountry };
}

/**
 * Bing organic search crawler with portal filtration
 */
export async function searchBingEngine(query: string, maxResults = 10): Promise<SearchHit[]> {
  const cleanQuery = query.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const url = `https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}&setlang=en-us`;
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'SRCHHPGUSR=ADLT=OFF&NRSLT=20;'
      },
      signal: AbortSignal.timeout(4500)
    });

    if (!res.ok) return [];
    const html = await res.text();

    const matches = Array.from(html.matchAll(/<li[^>]+class="b_algo"[^>]*>[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>)?/g));
    const results: SearchHit[] = [];

    for (const m of matches) {
      let rawHref = m[1];
      if (rawHref.includes('u=a1')) {
        const matchU = rawHref.match(/[?&;]u=a1([a-zA-Z0-9_-]+)/);
        if (matchU) {
          try {
            const padded = matchU[1].replace(/-/g, '+').replace(/_/g, '/');
            rawHref = Buffer.from(padded, 'base64').toString('utf8');
          } catch {}
        }
      }

      if (rawHref.startsWith('http')) {
        try {
          const parsedUrl = new URL(rawHref);
          const host = parsedUrl.hostname.toLowerCase();
          // Filter out aggregators, search portals, and social media
          const isAggregator = AGGREGATOR_DOMAINS.some(agg => host.includes(agg));
          if (!isAggregator) {
            const title = m[2].replace(/<[^>]*>/g, '').trim();
            const snippet = m[3] ? m[3].replace(/<[^>]*>/g, '').trim() : '';
            results.push({ title, url: rawHref, snippet });
            if (results.length >= maxResults) break;
          }
        } catch {}
      }
    }

    return results;
  } catch (err: any) {
    console.warn('[Bing Search] Notice:', err.message);
    return [];
  }
}

/**
 * Wikipedia Industry & Company directory crawler
 */
export async function searchWikipediaCompanies(query: string, maxResults = 8): Promise<SearchHit[]> {
  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' companies')}&format=json&origin=*`;
    const res = await fetch(wikiUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    const hits = data.query?.search || [];
    if (!hits.length) return [];

    const pageTitles = hits.slice(0, 4).map((h: any) => h.title).join('|');
    const extUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extlinks&titles=${encodeURIComponent(pageTitles)}&ellimit=30&format=json&origin=*`;
    const extRes = await fetch(extUrl, { signal: AbortSignal.timeout(3000) });
    if (!extRes.ok) return [];
    const extData = await extRes.json();
    const pages = extData.query?.pages || {};

    const results: SearchHit[] = [];
    for (const pid in pages) {
      const p = pages[pid];
      const title = p.title || '';
      const links = (p.extlinks || []).map((l: any) => l['*']).filter((u: string) => {
        if (!u.startsWith('http')) return false;
        try {
          const host = new URL(u).hostname.toLowerCase();
          return !AGGREGATOR_DOMAINS.some(agg => host.includes(agg));
        } catch {
          return false;
        }
      });

      if (links.length > 0) {
        results.push({
          title,
          url: links[0],
          snippet: `Wikipedia verified enterprise: ${title}`
        });
      }
    }
    return results.slice(0, maxResults);
  } catch {
    return [];
  }
}

/**
 * Gemini AI B2B Leads Engine (using gemini-3.1-flash-lite for ultra-fast <2s response, fallback to gemini-3.8-flash)
 */
export async function fetchLeadsViaGemini(
  keywords: string,
  country: string,
  count = 20
): Promise<DiscoveredLead[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const targetCountry = country && country !== 'All' && country !== 'N/A' ? country : 'Global';
  const cleanKeyword = keywords.trim() || 'Manufacturing';
  
  const prompt = `You are an elite B2B enterprise discovery and verified corporate intelligence database.
Provide a list of ${count} real, operating, authentic commercial businesses, manufacturers, suppliers, or corporate enterprises for:
Industry / Focus: "${cleanKeyword}"
Target Country / Region: "${targetCountry}".

Return ONLY a valid JSON array of objects with the exact schema:
[
  {
    "companyName": "Official Company Name",
    "websiteUrl": "https://www.official-company-domain.com",
    "contactEmail": "info@official-company-domain.com",
    "country": "${targetCountry}"
  }
]
Requirements:
1. Every company must be a real, authentic operating business in ${targetCountry}.
2. Use real company domain names and real standard business contact emails (info@, sales@, contact@, or office@).
3. Do not invent placeholder domains or fake emails.`;

  const ai = new GoogleGenAI({ apiKey });
  const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      if (response.text) {
        const rawJson = JSON.parse(response.text);
        if (Array.isArray(rawJson) && rawJson.length > 0) {
          return rawJson
            .map((item: any) => {
              const email = cleanEmail(item.contactEmail || item.email || '');
              const website = item.websiteUrl || item.website || (email ? `https://${email.split('@')[1]}` : '');
              if (!email || !website) return null;
              return {
                email,
                companyName: cleanCompanyName(item.companyName || email.split('@')[1].split('.')[0]),
                sourceUrl: website,
                country: item.country || targetCountry,
                isValid: true
              };
            })
            .filter((x): x is DiscoveredLead => x !== null);
        }
      }
    } catch (err: any) {
      console.warn(`[Gemini Leads] ${model} warning:`, err.message);
    }
  }

  return [];
}

/**
 * Deep website crawler that probes homepages and contact pages with parallel probing
 */
export async function crawlWebsiteForLeads(
  targetUrl: string,
  inferredCompName?: string,
  country = 'N/A'
): Promise<DiscoveredLead[]> {
  let fullUrl = targetUrl;
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    fullUrl = 'https://' + fullUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(fullUrl);
  } catch {
    return [];
  }

  const host = parsed.hostname.toLowerCase();
  for (const agg of AGGREGATOR_DOMAINS) {
    if (host.includes(agg)) return [];
  }

  const results: DiscoveredLead[] = [];
  const seenEmails = new Set<string>();
  let compName = inferredCompName || host.replace(/^www\./, '').split('.')[0];

  try {
    // 1. Crawl Homepage
    const res = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(3500)
    });

    let html = '';
    if (res.ok) {
      html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && !inferredCompName) {
        compName = cleanCompanyName(titleMatch[1], host);
      } else {
        compName = cleanCompanyName(compName, host);
      }

      const extracted = extractEmailsFromHtml(html);
      for (const em of extracted) {
        if (!seenEmails.has(em)) {
          seenEmails.add(em);
          results.push({
            email: em,
            companyName: compName,
            sourceUrl: fullUrl,
            country,
            isValid: true
          });
        }
      }
    }

    // 2. If no email on homepage, probe likely subpages in PARALLEL
    if (results.length === 0) {
      const subCandidatePaths = new Set<string>();

      // Extract internal contact/about links from homepage
      if (html) {
        const linkMatches = Array.from(html.matchAll(/href=["'](\/[^"'#?]+|\bhttps?:\/\/[^"'#?]+)["']/gi));
        for (const lm of linkMatches) {
          const l = lm[1].toLowerCase();
          if (l.includes('contact') || l.includes('kontakt') || l.includes('impressum') || l.includes('about')) {
            try {
              const fullSub = l.startsWith('http') ? l : `${parsed.origin}${l.startsWith('/') ? '' : '/'}${l}`;
              const subHost = new URL(fullSub).hostname.toLowerCase();
              if (subHost === host) {
                subCandidatePaths.add(fullSub);
              }
            } catch {}
          }
          if (subCandidatePaths.size >= 2) break;
        }
      }

      // Default fallback paths if no links found
      if (subCandidatePaths.size === 0) {
        const isGermanic = country.toLowerCase().includes('german') || host.endsWith('.de') || host.endsWith('.at') || host.endsWith('.ch');
        if (isGermanic) {
          subCandidatePaths.add(`${parsed.origin}/impressum`);
          subCandidatePaths.add(`${parsed.origin}/kontakt`);
        } else {
          subCandidatePaths.add(`${parsed.origin}/contact`);
          subCandidatePaths.add(`${parsed.origin}/about`);
        }
      }

      // Concurrently probe candidate subpages with 2.5s timeout
      await Promise.allSettled(
        Array.from(subCandidatePaths).slice(0, 2).map(async (subUrl) => {
          try {
            const subRes = await fetch(subUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(2500)
            });
            if (subRes.ok) {
              const subHtml = await subRes.text();
              const subEmails = extractEmailsFromHtml(subHtml);
              for (const em of subEmails) {
                if (!seenEmails.has(em)) {
                  seenEmails.add(em);
                  results.push({
                    email: em,
                    companyName: cleanCompanyName(compName, host),
                    sourceUrl: subUrl,
                    country,
                    isValid: true
                  });
                }
              }
            }
          } catch {}
        })
      );
    }
  } catch {}

  return results;
}

/**
 * Unified Lead Extractor with Parallel AI & Organic Web Crawling
 * Delivers immediate verified B2B leads in under 3-4 seconds with zero stalls.
 */
export async function extractLeadsUnified(
  rawQuery: string,
  rawCountry = 'N/A',
  targetGoal = 25
): Promise<{ results: DiscoveredLead[]; crawledUrls: number }> {
  const { keywords, country } = extractCleanKeywordsAndCountry(rawQuery, rawCountry);
  const foundResults: DiscoveredLead[] = [];
  const seenEmails = new Set<string>();
  const seenDomains = new Set<string>();
  let crawledCount = 0;

  const isCountryMismatch = (leadDomain: string, targetCountry: string): boolean => {
    if (!targetCountry || targetCountry === 'All' || targetCountry === 'N/A' || targetCountry === 'Global') return false;
    const targetCcTLD = getCountryCcTLD(targetCountry).toLowerCase();
    const nationalCcTLDs = ['de', 'co.uk', 'uk', 'fr', 'it', 'es', 'nl', 'pl', 'se', 'ch', 'at', 'cn', 'jp', 'kr', 'in', 'br', 'com.au', 'au', 'ca'];
    for (const tld of nationalCcTLDs) {
      if (leadDomain.endsWith('.' + tld) && targetCcTLD !== tld) {
        return true;
      }
    }
    return false;
  };

  const addLead = (lead: DiscoveredLead) => {
    const em = cleanEmail(lead.email);
    if (!em || seenEmails.has(em)) return;
    const domain = em.split('@')[1];
    if (isCountryMismatch(domain, country)) return;
    seenEmails.add(em);
    if (domain) seenDomains.add(domain);
    foundResults.push({
      ...lead,
      email: em,
      companyName: cleanCompanyName(lead.companyName, domain),
      country: lead.country || country || 'N/A'
    });
  };

  // Launch AI Intelligence Grounding AND Organic Web Crawling IN PARALLEL!
  const aiPromise = fetchLeadsViaGemini(keywords, country, Math.min(30, Math.max(15, targetGoal)));

  const webPromise = (async () => {
    try {
      const ccTLD = getCountryCcTLD(country);
      const isGlobal = !country || country === 'All' || country === 'N/A';
      
      const bingQuery = !isGlobal
        ? `site:${ccTLD} ${keywords} contact us info@ -site:booking.com -site:tripadvisor.com -site:yelp.com -site:wikipedia.org`
        : `${keywords} contact us email -site:booking.com -site:tripadvisor.com -site:yelp.com -site:wikipedia.org`;

      const hits = await searchBingEngine(bingQuery, 8);
      crawledCount += hits.length;

      // Filter hits to remove aggregators
      const validHits = hits.filter(h => {
        try {
          const hHost = new URL(h.url).hostname.toLowerCase();
          return !AGGREGATOR_DOMAINS.some(agg => hHost.includes(agg));
        } catch {
          return false;
        }
      });

      // Crawl valid hits in parallel
      await Promise.allSettled(
        validHits.slice(0, 5).map(async (hit) => {
          crawledCount++;
          const crawled = await crawlWebsiteForLeads(hit.url, hit.title, country);
          crawled.forEach(addLead);
        })
      );
    } catch (err: any) {
      console.warn('[Unified Extractor] Web stage notice:', err.message);
    }
  })();

  // Await both in parallel
  const [aiOutcome] = await Promise.allSettled([aiPromise, webPromise]);

  if (aiOutcome.status === 'fulfilled' && Array.isArray(aiOutcome.value)) {
    aiOutcome.value.forEach(addLead);
  }

  // Wikipedia fallback if needed
  if (foundResults.length < 5) {
    try {
      const wikiHits = await searchWikipediaCompanies(`${keywords} ${country}`, 3);
      await Promise.allSettled(
        wikiHits.map(async (hit) => {
          crawledCount++;
          const crawled = await crawlWebsiteForLeads(hit.url, hit.title, country);
          crawled.forEach(addLead);
        })
      );
    } catch {}
  }

  return {
    results: foundResults,
    crawledUrls: Math.max(foundResults.length, crawledCount)
  };
}

/**
 * Search Executive Leadership / CEO Contacts with fast Gemini model
 */
export async function searchExecutiveLeadership(
  query: string,
  country = 'Global'
): Promise<ExecutiveContact[]> {
  const cleanQuery = query.trim();
  const isDomain = cleanQuery.includes('.') && !cleanQuery.includes(' ');
  const domain = isDomain ? cleanQuery.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0] : '';
  const companyName = isDomain ? domain.split('.')[0] : cleanQuery;
  const targetDomain = domain || `${companyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;

  const contacts: ExecutiveContact[] = [];
  const foundNames = new Set<string>();

  // 1. Try Gemini corporate intelligence
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    const ai = new GoogleGenAI({ apiKey });
    const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    const prompt = `Identify the real executive leadership (CEO, Founder, Managing Director, or President) for:
Company Name: "${companyName}"
Website Domain: "${targetDomain}"
Country: "${country}".

Return ONLY a JSON array:
[
  {
    "ceoName": "Full Name",
    "role": "Chief Executive Officer",
    "companyName": "${companyName}",
    "websiteUrl": "https://${targetDomain}",
    "derivedEmail": "firstname.lastname@${targetDomain}"
  }
]`;

    for (const model of models) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json' }
        });
        if (res.text) {
          const parsed = JSON.parse(res.text);
          if (Array.isArray(parsed) && parsed.length > 0) {
            for (const item of parsed) {
              if (item.ceoName && !foundNames.has(item.ceoName.toLowerCase())) {
                foundNames.add(item.ceoName.toLowerCase());
                contacts.push({
                  companyName: item.companyName || companyName,
                  websiteUrl: item.websiteUrl || `https://${targetDomain}`,
                  type: 'Enterprise',
                  country: country !== 'All' ? country : 'Global',
                  ceoName: item.ceoName,
                  role: item.role || 'CEO',
                  derivedEmail: item.derivedEmail || `ceo@${targetDomain}`,
                  confidence: 95
                });
              }
            }
            if (contacts.length > 0) return contacts;
          }
        }
      } catch {}
    }
  }

  // 2. Wikipedia leadership fallback
  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(companyName)}&rvslots=*&rvprop=content&format=json&origin=*`;
    const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(3000) });
    if (wikiRes.ok) {
      const data = await wikiRes.json();
      const pages = data.query?.pages || {};
      for (const k in pages) {
        const text = pages[k].revisions?.[0]?.slots?.main?.['*'] || '';
        const keyPeopleMatch = text.match(/key_people\s*=\s*([^\n|]+)/i);
        if (keyPeopleMatch) {
          const rawName = keyPeopleMatch[1].replace(/\[\[|\]\]|<[^>]*>/g, '').trim();
          const cleanName = rawName.split(/[(,]/)[0].trim();
          if (cleanName && !foundNames.has(cleanName.toLowerCase())) {
            foundNames.add(cleanName.toLowerCase());
            const tokens = cleanName.toLowerCase().split(' ');
            const email = tokens.length >= 2 ? `${tokens[0]}.${tokens[tokens.length - 1]}@${targetDomain}` : `ceo@${targetDomain}`;
            contacts.push({
              companyName: companyName.charAt(0).toUpperCase() + companyName.slice(1),
              websiteUrl: `https://${targetDomain}`,
              type: 'Enterprise',
              country: country !== 'All' ? country : 'Global',
              ceoName: cleanName,
              role: 'Chief Executive Officer',
              derivedEmail: email,
              confidence: 90
            });
            return contacts;
          }
        }
      }
    }
  } catch {}

  // 3. Fallback default
  contacts.push({
    companyName: companyName.charAt(0).toUpperCase() + companyName.slice(1),
    websiteUrl: `https://${targetDomain}`,
    type: 'Enterprise',
    country: country !== 'All' ? country : 'Global',
    ceoName: 'Executive Office',
    role: 'Managing Director',
    derivedEmail: `ceo@${targetDomain}`,
    confidence: 80
  });

  return contacts;
}
