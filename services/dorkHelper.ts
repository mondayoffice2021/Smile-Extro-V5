import type { ExtractedEmail } from '../types';

export interface DorkQueryConfig {
  country: string;
  keywords: string;
  emailPrefix: string;
  searchEngine: 'all' | 'google' | 'bing' | 'brave' | 'duckduckgo' | 'yahoo' | 'yandex';
  extraTerms?: string;
  avoidDuplicateCompanies?: boolean;
}

export const COUNTRY_CCTLD_MAP: Record<string, string> = {
  // Major industrial countries specifically highlighted
  "germany": "de",
  "de": "de",
  "deutschland": "de",
  "china": "cn",
  "cn": "cn",
  "italy": "it",
  "it": "it",
  "japan": "jp",
  "jp": "jp",
  "south korea": "kr",
  "korea": "kr",
  "kr": "kr",
  "republic of korea": "kr",

  // Top manufacturing and industrial countries
  "united states": "us",
  "united states of america": "us",
  "usa": "us",
  "us": "us",
  "united kingdom": "co.uk",
  "uk": "uk",
  "great britain": "co.uk",
  "france": "fr",
  "fr": "fr",
  "spain": "es",
  "es": "es",
  "canada": "ca",
  "ca": "ca",
  "australia": "com.au",
  "au": "au",
  "brazil": "com.br",
  "br": "br",
  "india": "in",
  "in": "in",
  "netherlands": "nl",
  "nl": "nl",
  "switzerland": "ch",
  "ch": "ch",
  "sweden": "se",
  "se": "se",
  "poland": "pl",
  "pl": "pl",
  "turkey": "com.tr",
  "tr": "tr",
  "vietnam": "vn",
  "vn": "vn",
  "mexico": "mx",
  "mx": "mx",
  "uae": "ae",
  "united arab emirates": "ae",
  "saudi arabia": "sa",
  "sa": "sa",
  "singapore": "sg",
  "sg": "sg",
  "taiwan": "tw",
  "tw": "tw",
  "south africa": "co.za",
  "za": "za",
  "belgium": "be",
  "be": "be",
  "austria": "at",
  "at": "at",
  "denmark": "dk",
  "dk": "dk",
  "norway": "no",
  "no": "no",
  "finland": "fi",
  "fi": "fi",
  "ireland": "ie",
  "ie": "ie",
  "portugal": "pt",
  "pt": "pt",
  "greece": "gr",
  "gr": "gr",
  "israel": "co.il",
  "il": "il",
  "new zealand": "co.nz",
  "nz": "nz",
  "malaysia": "com.my",
  "my": "my",
  "indonesia": "co.id",
  "id": "id",
  "thailand": "co.th",
  "th": "th",
  "philippines": "ph",
  "ph": "ph",
  "czech republic": "cz",
  "czechia": "cz",
  "romania": "ro",
  "hungary": "hu",
  "hong kong": "hk",
  "russia": "ru",
  "chile": "cl",
  "colombia": "co",
  "argentina": "com.ar",
  "pakistan": "pk",
  "bangladesh": "bd",
  "egypt": "eg",
  "morocco": "ma",
  "nigeria": "ng",
  "kenya": "ke",
  "ukraine": "ua",
  "slovakia": "sk",
  "slovenia": "si",
  "croatia": "hr",
  "bulgaria": "bg",
  "estonia": "ee",
  "latvia": "lv",
  "lithuania": "lt"
};

export function getCountryCcTLD(country: string): string {
  if (!country || !country.trim()) return "com";
  const normalized = country.trim().toLowerCase();

  if (COUNTRY_CCTLD_MAP[normalized]) {
    return COUNTRY_CCTLD_MAP[normalized];
  }

  // Exact 2-letter code check
  if (/^[a-z]{2}$/.test(normalized)) {
    return normalized;
  }

  // Check matching words
  for (const [key, code] of Object.entries(COUNTRY_CCTLD_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return code;
    }
  }

  const letters = normalized.replace(/[^a-z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 2) : "com";
}

/**
 * Builds the exact Dork query format requested by user:
 * Examples:
 * site:de steel manufacturer contact us sales export procurement info@
 * site:cn shipyard contact us sales export procurement info@
 * site:it pharmaceutical equipment manufacturer contact us sales export procurement @
 * site:jp marine engine manufacturer contact us sales export procurement @
 * site:kr shipbuilding company contact us sales export procurement @
 */
export function buildDorkQuery(
  country: string,
  keywords: string,
  emailPrefix: string = "info@",
  extraTerms: string = "contact us sales export procurement"
): string {
  const ccTLD = getCountryCcTLD(country);
  const cleanKeywords = keywords
    .split('\n')
    .map(k => k.trim())
    .filter(Boolean)
    .join(' ') || "manufacturer";

  const cleanPrefix = emailPrefix ? emailPrefix.trim() : "@";
  return `site:${ccTLD} ${cleanKeywords} ${extraTerms} ${cleanPrefix}`.replace(/\s+/g, ' ').trim();
}

/**
 * Returns direct search engine links for Google, Bing, Brave, DuckDuckGo, Yahoo, Yandex
 */
export function getSearchEngineUrl(engine: string, query: string): string {
  const encoded = encodeURIComponent(query);
  switch (engine.toLowerCase()) {
    case 'bing':
      return `https://www.bing.com/search?q=${encoded}`;
    case 'brave':
      return `https://search.brave.com/search?q=${encoded}`;
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${encoded}`;
    case 'yahoo':
      return `https://search.yahoo.com/search?p=${encoded}`;
    case 'yandex':
      return `https://yandex.com/search/?text=${encoded}`;
    case 'google':
    default:
      return `https://www.google.com/search?q=${encoded}`;
  }
}

export const SEARCH_ENGINES_LIST = [
  { id: 'google', name: 'Google', color: 'text-blue-400 border-blue-500/40' },
  { id: 'bing', name: 'Bing', color: 'text-cyan-400 border-cyan-500/40' },
  { id: 'brave', name: 'Brave', color: 'text-orange-400 border-orange-500/40' },
  { id: 'duckduckgo', name: 'DuckDuckGo', color: 'text-amber-400 border-amber-500/40' },
  { id: 'yahoo', name: 'Yahoo', color: 'text-purple-400 border-purple-500/40' },
  { id: 'yandex', name: 'Yandex', color: 'text-red-400 border-red-500/40' },
  { id: 'all', name: 'All Engines', color: 'text-emerald-400 border-emerald-500/40' }
] as const;

export const EMAIL_PREFIX_OPTIONS = [
  { id: 'info@', label: 'info@ (Standard)' },
  { id: '@', label: '@ (Any email)' },
  { id: 'sales@', label: 'sales@' },
  { id: 'export@', label: 'export@' },
  { id: 'procurement@', label: 'procurement@' },
  { id: 'contact@', label: 'contact@' }
] as const;

/**
 * Extracts business emails and infers company names and sources
 * from pasted search results, html snippets, or search engine text
 */
export function extractEmailsFromText(
  text: string,
  country: string = 'N/A'
): ExtractedEmail[] {
  if (!text) return [];

  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = text.match(emailRegex) || [];

  const seen = new Set<string>();
  const extractedList: ExtractedEmail[] = [];

  for (const rawEmail of matches) {
    const cleanEmail = rawEmail.toLowerCase().trim().replace(/^[.<>]+|[.<>]+$/g, '');
    if (!cleanEmail || seen.has(cleanEmail)) continue;

    // Filter out common image/code extensions or invalid patterns
    if (cleanEmail.endsWith('.png') || cleanEmail.endsWith('.jpg') || cleanEmail.endsWith('.gif') || cleanEmail.endsWith('.svg')) {
      continue;
    }

    seen.add(cleanEmail);

    const domain = cleanEmail.split('@')[1] || '';
    // Infer company name from domain: e.g. "schmidt-steel.de" -> "Schmidt Steel"
    const domainNamePart = domain.split('.')[0] || '';
    const inferredCompany = domainNamePart
      .split(/[-_]/)
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || domain;

    extractedList.push({
      email: cleanEmail,
      companyName: inferredCompany,
      sourceUrl: `https://${domain}`,
      country: country || 'N/A',
      isValid: true
    });
  }

  return extractedList;
}
