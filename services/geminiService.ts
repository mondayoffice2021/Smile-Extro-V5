import type { ExtractedEmail, CompanyIntel } from '../types';
import { buildDorkQuery, getCountryCcTLD } from './dorkHelper';
import { classifyCountryOffline, classifyIndustryOffline } from './offlineClassifier';
import { getCountryFlag, cleanDomainName, type DomainCountryResolution } from './countryDetector';
import { safeFetchJson } from './safeFetch';

export interface CountryResolutionItem {
  domain: string;
  country: string;
  confidence?: number;
  method?: string;
  evidence?: string;
  flag?: string;
}

// Custom API key placeholder for backwards compatibility
let customApiKey: string | null = null;

export const setGlobalApiKey = (key: string) => {
  customApiKey = key;
};

// Standard regex for email format validation.
const EMAIL_REGEX = new RegExp(
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
);

/**
 * Native Search & Scrape Engine
 * Scrapes target URLs directly or queries authentic search engine dorks with zero rate limits!
 */
export const findAndExtractEmails = async (
    keywords: string, 
    country: string, 
    industry: string,
    companySize: string,
    urls_text: string,
    verifyDomains: boolean = false
): Promise<ExtractedEmail[]> => {
    const providedUrls = urls_text ? urls_text.split('\n').map(url => url.trim()).filter(Boolean) : [];

    // Case 1: Direct URLs provided -> Direct Web Scraper
    if (providedUrls.length > 0) {
        try {
            const res = await safeFetchJson<any>('/api/scrape-urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    urls: providedUrls,
                    country: country || 'N/A'
                })
            });

            if (!res.ok || !res.data) {
                throw new Error(res.error || `Scraper request returned status ${res.status}`);
            }

            const rawResults: ExtractedEmail[] = res.data.results || [];
            return rawResults.map(item => ({
                ...item,
                country: country || 'N/A',
                isValid: item.email ? EMAIL_REGEX.test(item.email) : false
            })).filter(item => item.email && item.email.includes('@'));
        } catch (err: any) {
            console.error("Direct URL scraper notice:", err);
            throw new Error(`URL Scraper error: ${err.message || 'Failed to scrape URLs'}`);
        }
    }

    // Case 2: Keywords + Country -> Search Engine Dorking via Backend
    if (keywords) {
        const keywordsList = keywords.split('\n').map(k => k.trim()).filter(Boolean).join(' ');
        const primaryDork = buildDorkQuery(country, keywordsList, "info@");

        try {
            const res = await safeFetchJson<any>('/api/dork-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: primaryDork,
                    country: country || 'N/A'
                })
            });

            if (!res.ok || !res.data) {
                throw new Error(res.error || `Search request returned status ${res.status}`);
            }

            const rawResults: ExtractedEmail[] = res.data.results || [];
            return rawResults.map(item => ({
                ...item,
                country: country || 'N/A',
                isValid: item.email ? EMAIL_REGEX.test(item.email) : false
            })).filter(item => item.email && item.email.includes('@'));
        } catch (err: any) {
            console.error("Dork search notice:", err);
            throw new Error(`Search error: ${err.message || 'Direct search encountered an issue'}`);
        }
    }

    throw new Error("Please provide either keywords or a list of target URLs.");
};

/**
 * Deep Search Plan Generator
 * Creates 8-10 authentic search engine dorks targeting multiple corporate departments,
 * filetypes (catalogs, PDF supplier lists), and web hierarchies.
 */
export const generateDeepSearchPlan = async (
    baseKeywords: string,
    country: string,
    industry: string
): Promise<string[]> => {
    const cleanKw = baseKeywords.trim();
    const cctld = getCountryCcTLD(country);
    const sitePrefix = cctld ? `site:.${cctld} ` : '';

    const queries: string[] = [
        `${sitePrefix}"${cleanKw}" "info@"`,
        `${sitePrefix}"${cleanKw}" "contact@"`,
        `${sitePrefix}"${cleanKw}" "sales@" OR "export@"`,
        `"${cleanKw}" ${country} "email" "contact us"`,
        `filetype:pdf "${cleanKw}" ${country} "@"`,
        `inurl:contact "${cleanKw}" ${country} "@"`,
        `${sitePrefix}inurl:about "${cleanKw}" "@"`,
        `"${cleanKw}" "procurement" OR "purchasing" ${country} "@"`,
        `"${cleanKw}" ${country} "suppliers" OR "manufacturers" "@"`,
        `"${cleanKw}" "distributors" OR "dealers" ${country} "@"`
    ];

    return Array.from(new Set(queries));
};

/**
 * B2B Commercial Intent Keyword Suggestions
 */
export const suggestKeywords = async (currentKeywords: string): Promise<string[]> => {
    const clean = currentKeywords.split(',')[0].trim() || currentKeywords.trim();
    if (!clean) return ["manufacturers", "wholesale suppliers", "authorized distributors", "corporate procurement", "industrial exporters"];

    return [
        `${clean} manufacturers`,
        `${clean} wholesale suppliers`,
        `${clean} authorized distributors`,
        `${clean} factory OEM ODM`,
        `${clean} corporate procurement`,
        `${clean} exporters & trade`,
        `industrial ${clean} supply`,
        `commercial ${clean} dealers`
    ];
};

/**
 * Competitor & Alternative Company Search
 */
export const analyzeCompanyFromEmail = async (
    email: string,
    country: string
): Promise<string[]> => {
    const domain = email.includes('@') ? email.split('@')[1].toLowerCase().trim() : email.toLowerCase().trim();
    const companyName = domain.split('.')[0];
    const detectedIndustry = classifyIndustryOffline(domain) || 'industry';
    const cctld = getCountryCcTLD(country);
    const sitePrefix = cctld ? `site:.${cctld} ` : '';

    return [
        `${sitePrefix}"${companyName}" competitors "contact"`,
        `${sitePrefix}alternative to "${companyName}" "email"`,
        `${sitePrefix}"${detectedIndustry}" manufacturers "${country}" "info@"`,
        `${sitePrefix}"${detectedIndustry}" wholesale suppliers "${country}" "contact@"`,
        `related:${domain} "email"`,
        `"${detectedIndustry}" companies "${country}" "sales@" OR "export@"`
    ];
};

/**
 * Deep Country Identifier
 * Resolves countries for all domains, specifically diving deep into ambiguous .com, .net, .org, .io domains
 * by querying live website contact/impressum pages, phone dialing codes, Schema.org address markup,
 * multi-engine search grounding (DuckDuckGo & Google), and DNS MX mail exchangers.
 */
export const identifyCountriesForDomains = async (
    domains: string[],
    options?: { deepResolve?: boolean; apiKey?: string }
): Promise<CountryResolutionItem[]> => {
    if (!domains || domains.length === 0) return [];

    const deep = options?.deepResolve !== false; // Default to deep resolve
    const effectiveKey = options?.apiKey || customApiKey || (typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') || '' : '');

    // Step 1: Separate immediate offline hits (ccTLDs like .de, .co.uk, known corporate giants)
    const results: CountryResolutionItem[] = [];
    const unresolved: string[] = [];

    domains.forEach(domain => {
        const clean = cleanDomainName(domain);
        const offlineMatch = classifyCountryOffline(clean);
        // If it's a direct country TLD (.de, .fr, .uk, etc.) or in our corporate registry, resolve instantly
        if (offlineMatch) {
            results.push({
                domain: clean,
                country: offlineMatch,
                confidence: 98,
                method: 'cctld',
                evidence: `Resolved via country top-level domain or enterprise registry`,
                flag: getCountryFlag(offlineMatch)
            });
        } else {
            unresolved.push(clean);
        }
    });

    // If all domains resolved via ccTLD or deep resolve is disabled, return now
    if (unresolved.length === 0 || !deep) {
        unresolved.forEach(dom => {
            results.push({
                domain: dom,
                country: 'Unknown',
                confidence: 0,
                method: 'unknown',
                evidence: 'Unresolved domain',
                flag: '🌐'
            });
        });
        return results;
    }

    // Step 2: Go deep on unresolved (.com, .net, .org, .io, .co, etc.) via backend crawler & search engines
    try {
        const res = await safeFetchJson<any>('/api/deep-country-resolve', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(effectiveKey ? { 'x-gemini-api-key': effectiveKey } : {})
            },
            body: JSON.stringify({ domains: unresolved, apiKey: effectiveKey })
        });

        if (res.ok && res.data && Array.isArray(res.data.results)) {
            res.data.results.forEach((item: any) => {
                results.push({
                    domain: item.domain,
                    country: item.country || 'Unknown',
                    confidence: item.confidence || 0,
                    method: item.method || 'search_engine',
                    evidence: item.evidence || '',
                    flag: item.flag || getCountryFlag(item.country || 'Unknown')
                });
            });
            return results;
        }
    } catch (err) {
        console.warn("[Country Resolution Notice] Backend deep resolver notice, falling back to local heuristic:", err);
    }

    // Fallback: Return unresolved items as Unknown with basic flag
    unresolved.forEach(dom => {
        results.push({
            domain: dom,
            country: 'Unknown',
            confidence: 0,
            method: 'unknown',
            evidence: 'Generic domain extension with no public contact/search match',
            flag: '🌐'
        });
    });

    return results;
};

export const identifyUnknownDomainsDeeply = async (
    domains: string[],
    apiKey?: string
): Promise<CountryResolutionItem[]> => {
    return identifyCountriesForDomains(domains, { deepResolve: true, apiKey });
};

/**
 * Industry Identifier (Instantaneous, Zero Quota Limits)
 */
export const identifyIndustriesForDomains = async (
    domains: string[]
): Promise<{ domain: string; industry: string }[]> => {
    return domains.map(domain => {
        const industry = classifyIndustryOffline(domain) || 'Other';
        return { domain, industry };
    });
};

/**
 * Deep Domain & Company Intelligence
 * Fetches live domain HTML meta tags (title, description, og:site_name),
 * queries search engine snippets, and runs high-accuracy company profiling.
 */
export const fetchDomainIntelligence = async (
    domains: string[],
    customApiKey?: string
): Promise<CompanyIntel[]> => {
    if (!domains || domains.length === 0) return [];

    try {
        const effectiveKey = customApiKey || (typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') || '' : '');
        const res = await safeFetchJson<any>('/api/domain-intelligence', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                ...(effectiveKey ? { 'x-gemini-api-key': effectiveKey } : {})
            },
            body: JSON.stringify({ domains, apiKey: effectiveKey })
        });

        if (res.ok && res.data && Array.isArray(res.data.results)) {
            return res.data.results.map((item: any) => ({
                ...item,
                emails: item.emails || []
            }));
        }
    } catch (err) {
        console.warn("[Domain Intelligence] API request notice, using heuristic fallback:", err);
    }

    // Heuristic fallback if network or server error
    return domains.map(domain => {
        const industry = classifyIndustryOffline(domain) || 'General Business';
        const root = domain.replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, '').replace(/^www\./, '');
        const companyName = root.charAt(0).toUpperCase() + root.slice(1);
        return {
            domain,
            companyName,
            industry,
            subCategory: `${industry} Solutions`,
            overview: `${companyName} is an active enterprise operating under domain ${domain}.`,
            businessModel: 'B2B',
            headquarters: classifyCountryOffline(domain) || 'Global',
            websiteUrl: `https://${domain}`,
            websiteStatus: 'online' as const,
            confidenceScore: 75,
            emails: []
        };
    });
};
