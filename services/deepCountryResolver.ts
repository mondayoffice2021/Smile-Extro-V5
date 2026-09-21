/**
 * Deep Country Resolution Engine
 * Goes deep for ambiguous and generic domains (.com, .net, .org, .io, .co, etc.)
 * by combining:
 * 1. Offline high-speed corporate registry & ccTLD maps (0ms)
 * 2. Live website contact page & impressum deep scraping (Schema.org, tel: dialing codes, postal codes, legal forms)
 * 3. Multi-engine search grounding (DuckDuckGo Instant Answer, Bing Organic Search, Wikipedia Knowledge Graph)
 * 4. DNS MX mail exchanger host country deduction
 * 5. Gemini 2.5/3.0 AI synthesis with Google Search grounding (when API key is configured)
 */

import dns from 'dns';
import { promisify } from 'util';
import { 
  GLOBAL_COUNTRIES, 
  getCountryFlag, 
  cleanDomainName, 
  analyzeWebsiteHtmlForCountry, 
  analyzeSearchSnippetForCountry,
  type DomainCountryResolution 
} from './countryDetector';
import { classifyCountryOffline, GLOBAL_CORPORATE_DOMAINS, DOMAIN_LOCATION_HINTS } from './offlineClassifier';
import { GoogleGenAI } from '@google/genai';

const resolveMx = promisify(dns.resolveMx);

// In-memory cache to prevent redundant scraping of common domains
const resolutionCache = new Map<string, DomainCountryResolution>();

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

/**
 * Probe website homepage and key contact/about/impressum pages
 */
async function crawlWebsiteForCountry(domain: string): Promise<DomainCountryResolution | null> {
  const cleanDomain = cleanDomainName(domain);
  if (!cleanDomain) return null;

  const targetUrls = [
    `https://${cleanDomain}`,
    `https://www.${cleanDomain}`,
    `http://${cleanDomain}`
  ];

  let homepageHtml = '';
  let successfulBase = '';

  // 1. Fetch Homepage
  for (const url of targetUrls) {
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        homepageHtml = await res.text();
        successfulBase = url;
        break;
      }
    } catch {}
  }

  // 2. Analyze Homepage Content
  if (homepageHtml) {
    const homeAnalysis = analyzeWebsiteHtmlForCountry(homepageHtml, cleanDomain, successfulBase);
    if (homeAnalysis && homeAnalysis.confidence >= 94) {
      return {
        domain: cleanDomain,
        country: homeAnalysis.country,
        confidence: homeAnalysis.confidence,
        method: homeAnalysis.method,
        evidence: homeAnalysis.evidence,
        flag: getCountryFlag(homeAnalysis.country)
      };
    }

    // 3. Proactively Probe Contact & Impressum Pages
    // Discover contact links in homepage HTML or try standard paths
    const contactLinksFound = Array.from(
      homepageHtml.matchAll(/<a[^>]+href=["']([^"']*(?:contact|impressum|kontakt|about|locations|offices|legal)[^"']*)["']/gi)
    )
      .map(m => m[1].trim())
      .filter(href => !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:'));

    const pagesToProbe = new Set<string>();
    for (const link of contactLinksFound) {
      try {
        if (link.startsWith('http://') || link.startsWith('https://')) {
          pagesToProbe.add(link);
        } else if (successfulBase) {
          const resolved = new URL(link, successfulBase).href;
          pagesToProbe.add(resolved);
        }
      } catch {}
    }

    // Add standard fallback paths
    const standardPaths = ['/contact', '/contact-us', '/about', '/about-us', '/impressum', '/locations'];
    for (const p of standardPaths) {
      if (successfulBase) pagesToProbe.add(`${successfulBase.replace(/\/$/, '')}${p}`);
    }

    // Probe up to 3 candidate pages
    const probeList = Array.from(pagesToProbe).slice(0, 3);
    for (const pageUrl of probeList) {
      try {
        const contactRes = await fetch(pageUrl, {
          headers: BROWSER_HEADERS,
          redirect: 'follow',
          signal: AbortSignal.timeout(3000)
        });
        if (contactRes.ok) {
          const contactHtml = await contactRes.text();
          const contactAnalysis = analyzeWebsiteHtmlForCountry(contactHtml, cleanDomain, pageUrl);
          if (contactAnalysis) {
            const shortPath = pageUrl.replace(/^https?:\/\/[^\/]+/, '') || '/';
            return {
              domain: cleanDomain,
              country: contactAnalysis.country,
              confidence: contactAnalysis.confidence,
              method: contactAnalysis.method,
              evidence: `${contactAnalysis.evidence} (verified on ${shortPath})`,
              flag: getCountryFlag(contactAnalysis.country)
            };
          }
        }
      } catch {}
    }

    // If home had an acceptable match, return it
    if (homeAnalysis) {
      return {
        domain: cleanDomain,
        country: homeAnalysis.country,
        confidence: homeAnalysis.confidence,
        method: homeAnalysis.method,
        evidence: homeAnalysis.evidence,
        flag: getCountryFlag(homeAnalysis.country)
      };
    }
  }

  return null;
}

/**
 * Multi-Engine Search Grounding for Domain Headquarters
 * Combines DuckDuckGo Instant Answer, Bing Organic Search, and Wikipedia API
 */
async function searchEngineCountryGrounding(domain: string): Promise<DomainCountryResolution | null> {
  const cleanDomain = cleanDomainName(domain);
  const companyName = cleanDomain
    .replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, '')
    .replace(/[-_]/g, ' ')
    .trim();

  // Tier 1: DuckDuckGo Instant Answer API (Direct company name)
  try {
    const ddgApiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(companyName)}&format=json&no_html=1&skip_disambig=1`;
    const ddgRes = await fetch(ddgApiUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(2800)
    });
    if (ddgRes.ok) {
      const data = await ddgRes.json();
      const text = `${data.Heading || ''} ${data.AbstractText || ''}`.trim();
      if (text.length >= 25) {
        const analysis = analyzeSearchSnippetForCountry(text, data.Heading);
        if (analysis) {
          return {
            domain: cleanDomain,
            country: analysis.country,
            confidence: analysis.confidence,
            method: 'search_engine',
            evidence: `Search Engine (DuckDuckGo Knowledge): ${analysis.evidence}`,
            flag: getCountryFlag(analysis.country)
          };
        }
      }
    }
  } catch {}

  // Tier 2: DuckDuckGo Instant Answer API (With "company" suffix)
  try {
    const ddgCompanyUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(companyName + ' company')}&format=json&no_html=1&skip_disambig=1`;
    const ddgCompRes = await fetch(ddgCompanyUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(2800)
    });
    if (ddgCompRes.ok) {
      const data = await ddgCompRes.json();
      const text = `${data.Heading || ''} ${data.AbstractText || ''}`.trim();
      if (text.length >= 25) {
        const analysis = analyzeSearchSnippetForCountry(text, data.Heading);
        if (analysis) {
          return {
            domain: cleanDomain,
            country: analysis.country,
            confidence: analysis.confidence,
            method: 'search_engine',
            evidence: `Search Engine (DuckDuckGo Corporate Graph): ${analysis.evidence}`,
            flag: getCountryFlag(analysis.country)
          };
        }
      }
    }
  } catch {}

  // Tier 3: Bing Organic Search Engine (Captions extraction)
  try {
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent('"' + cleanDomain + '" company headquarters country')}&setlang=en`;
    const bingRes = await fetch(bingUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(3500)
    });

    if (bingRes.ok) {
      const html = await bingRes.text();
      const captions = Array.from(html.matchAll(/<div[^>]+class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/gi))
        .map(m => m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());

      for (const cap of captions) {
        if (cap.length >= 25) {
          const analysis = analyzeSearchSnippetForCountry(cap);
          if (analysis) {
            return {
              domain: cleanDomain,
              country: analysis.country,
              confidence: analysis.confidence,
              method: 'search_engine',
              evidence: `Search Engine (Bing Grounding): ${analysis.evidence}`,
              flag: getCountryFlag(analysis.country)
            };
          }
        }
      }
    }
  } catch {}

  // Tier 4: Wikipedia Search & Knowledge Graph API
  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(companyName + ' company headquarters')}&format=json&origin=*`;
    const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(3000) });
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      const firstHit = wikiData.query?.search?.[0];
      if (firstHit && firstHit.snippet) {
        const cleanSnippet = firstHit.snippet.replace(/<[^>]*>/g, ' ').trim();
        const analysis = analyzeSearchSnippetForCountry(cleanSnippet, firstHit.title);
        if (analysis) {
          return {
            domain: cleanDomain,
            country: analysis.country,
            confidence: analysis.confidence,
            method: 'search_engine',
            evidence: `Wikipedia Knowledge Base: ${analysis.evidence}`,
            flag: getCountryFlag(analysis.country)
          };
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Check DNS Mail Exchanger (MX) host for regional country indicators
 */
async function checkDnsMxCountry(domain: string): Promise<DomainCountryResolution | null> {
  const cleanDomain = cleanDomainName(domain);
  try {
    const mxRecords = await resolveMx(cleanDomain);
    if (mxRecords && mxRecords.length > 0) {
      mxRecords.sort((a, b) => a.priority - b.priority);
      for (const record of mxRecords.slice(0, 2)) {
        const mxHost = record.exchange.toLowerCase();
        const parts = mxHost.split('.');
        const lastPart = parts[parts.length - 1];
        
        // Check regional hosting giants
        if (mxHost.includes('ovh.net') || mxHost.includes('ovh.com')) {
          return {
            domain: cleanDomain,
            country: 'France',
            confidence: 82,
            method: 'cctld',
            evidence: `Regional French MX mail provider: ${record.exchange}`,
            flag: getCountryFlag('France')
          };
        }
        if (mxHost.includes('hetzner')) {
          return {
            domain: cleanDomain,
            country: 'Germany',
            confidence: 82,
            method: 'cctld',
            evidence: `Regional German MX infrastructure: ${record.exchange}`,
            flag: getCountryFlag('Germany')
          };
        }

        // Check if MX host has a distinct ccTLD (.de, .fr, .it, .uk, .jp, .ch, .ca, .au, etc.)
        if (!['com', 'net', 'org', 'io'].includes(lastPart)) {
          for (const [countryName, info] of Object.entries(GLOBAL_COUNTRIES)) {
            if (info.cctld === lastPart) {
              return {
                domain: cleanDomain,
                country: countryName,
                confidence: 85,
                method: 'cctld',
                evidence: `Official MX mail server registered under .${lastPart} (${record.exchange})`,
                flag: info.flag
              };
            }
          }
        }
      }
    }
  } catch {}

  return null;
}

// Circuit breaker to prevent repeated 429 rate-limit errors when Gemini API free quota is exhausted
let aiQuotaCooldownUntil = 0;

/**
 * AI Grounding with Gemini 3.8 Flash & Google Search (Optional fallback)
 */
async function aiCountryReasoning(domains: string[], apiKey?: string): Promise<Map<string, DomainCountryResolution>> {
  const results = new Map<string, DomainCountryResolution>();
  
  // If quota was exhausted previously, skip AI calls during cooldown window
  if (Date.now() < aiQuotaCooldownUntil) {
    return results;
  }

  const effectiveKey = apiKey || process.env.GEMINI_API_KEY;
  if (!effectiveKey || domains.length === 0) return results;

  try {
    const ai = new GoogleGenAI({ apiKey: effectiveKey });
    const prompt = `You are an expert corporate intelligence investigator. Identify the authentic country headquarters for the following company domains:
${domains.join('\n')}

For each domain, identify the primary country where the company is headquartered or founded.
Return strictly a JSON array of objects with the exact structure:
[
  { "domain": "example.com", "country": "Country Name", "confidence": 90, "reason": "Brief 1-sentence explanation" }
]
Only use recognized sovereign country names (e.g. "United States", "Germany", "United Kingdom", "France", "Japan", "Canada", "Australia", etc.). If completely impossible to determine, set country to "Unknown".`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const jsonText = response.text?.trim() || '';
    if (jsonText) {
      // Clean possible code blocks from response
      const cleanJson = jsonText.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.domain && item.country && item.country !== 'Unknown') {
            results.set(cleanDomainName(item.domain), {
              domain: cleanDomainName(item.domain),
              country: item.country,
              confidence: item.confidence || 90,
              method: 'ai_grounding',
              evidence: item.reason || 'Gemini Google Search grounding verified headquarters',
              flag: getCountryFlag(item.country)
            });
          }
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
      // Enter a 30-minute cooldown to prevent spamming quota-exhausted keys
      aiQuotaCooldownUntil = Date.now() + 30 * 60 * 1000;
      console.log("[Deep Country Engine] Gemini API free quota limit reached; safely relying on live website contact scraping & search engine grounding.");
    } else {
      console.log("[Deep Country AI Grounding] Notice: Fallback search grounding active.");
    }
  }

  return results;
}

/**
 * Resolve a single domain using all deep methods sequentially
 */
export async function resolveDomainDeeply(domain: string, apiKey?: string): Promise<DomainCountryResolution> {
  const cleanDomain = cleanDomainName(domain);
  if (!cleanDomain) {
    return { domain, country: 'Unknown', confidence: 0, method: 'unknown', flag: '🌐' };
  }

  // 1. Check memory cache
  if (resolutionCache.has(cleanDomain)) {
    return resolutionCache.get(cleanDomain)!;
  }

  // 2. High-speed offline check (ccTLD & Corporate Registry)
  const offlineMatch = classifyCountryOffline(cleanDomain);
  if (offlineMatch) {
    const isCorp = Boolean(GLOBAL_CORPORATE_DOMAINS[cleanDomain]);
    const res: DomainCountryResolution = {
      domain: cleanDomain,
      country: offlineMatch,
      confidence: isCorp ? 99 : 98,
      method: isCorp ? 'corporate_registry' : 'cctld',
      evidence: isCorp ? `Global enterprise corporate registry (${offlineMatch})` : `ccTLD country code extension: .${cleanDomain.split('.').pop()}`,
      flag: getCountryFlag(offlineMatch)
    };
    resolutionCache.set(cleanDomain, res);
    return res;
  }

  // Check domain keyword location hints
  for (const hint of DOMAIN_LOCATION_HINTS) {
    if (hint.pattern.test(cleanDomain)) {
      const res: DomainCountryResolution = {
        domain: cleanDomain,
        country: hint.country,
        confidence: 90,
        method: 'domain_pattern',
        evidence: `Domain title incorporates distinct geographic location pattern: ${hint.country}`,
        flag: getCountryFlag(hint.country)
      };
      resolutionCache.set(cleanDomain, res);
      return res;
    }
  }

  // --- GO DEEPER: Ambiguous generic domains (.com, .net, .org, .io, .co, .app, .ai, etc.) ---

  // Step A: Live Website Contact & Impressum Page Crawling
  try {
    const webResult = await crawlWebsiteForCountry(cleanDomain);
    if (webResult && webResult.country !== 'Unknown' && webResult.confidence >= 80) {
      resolutionCache.set(cleanDomain, webResult);
      return webResult;
    }
  } catch (e: any) {
    console.warn(`[Deep Country] Web crawl notice for ${cleanDomain}:`, e.message);
  }

  // Step B: Multi-Engine Search Grounding (DuckDuckGo / Bing / Wikipedia)
  try {
    const searchResult = await searchEngineCountryGrounding(cleanDomain);
    if (searchResult && searchResult.country !== 'Unknown') {
      resolutionCache.set(cleanDomain, searchResult);
      return searchResult;
    }
  } catch (e: any) {
    console.warn(`[Deep Country] Search grounding notice for ${cleanDomain}:`, e.message);
  }

  // Step C: DNS MX Mail Exchanger Country Indicator
  try {
    const mxResult = await checkDnsMxCountry(cleanDomain);
    if (mxResult && mxResult.country !== 'Unknown') {
      resolutionCache.set(cleanDomain, mxResult);
      return mxResult;
    }
  } catch {}

  // Fallback default for remaining unresolved .com / generic domains
  const fallback: DomainCountryResolution = {
    domain: cleanDomain,
    country: 'Unknown',
    confidence: 0,
    method: 'unknown',
    evidence: 'Generic domain extension (.com/.net/.org) with no public physical contact address or search entity located',
    flag: '🌐'
  };

  resolutionCache.set(cleanDomain, fallback);
  return fallback;
}

/**
 * Resolve a batch of domains concurrently with controlled pool size
 */
export async function resolveBatchDomainsDeeply(
  domains: string[],
  apiKey?: string,
  concurrency = 5
): Promise<DomainCountryResolution[]> {
  const cleanDomains = Array.from(new Set(domains.map(cleanDomainName).filter(Boolean)));
  const results: DomainCountryResolution[] = [];

  // Split into chunks of `concurrency`
  for (let i = 0; i < cleanDomains.length; i += concurrency) {
    const chunk = cleanDomains.slice(i, i + concurrency);
    const chunkPromises = chunk.map(dom => resolveDomainDeeply(dom, apiKey));
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  // For domains still 'Unknown', if Gemini API key exists and quota is not in cooldown, do a quick batch AI lookup
  const stillUnknown = results.filter(r => r.country === 'Unknown').map(r => r.domain);
  if (stillUnknown.length > 0 && (apiKey || process.env.GEMINI_API_KEY) && Date.now() >= aiQuotaCooldownUntil) {
    try {
      const aiResults = await aiCountryReasoning(stillUnknown.slice(0, 30), apiKey);
      for (let i = 0; i < results.length; i++) {
        if (results[i].country === 'Unknown' && aiResults.has(results[i].domain)) {
          results[i] = aiResults.get(results[i].domain)!;
          resolutionCache.set(results[i].domain, results[i]);
        }
      }
    } catch {}
  }

  return results;
}
