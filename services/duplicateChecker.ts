import type { ExtractedEmail } from '../types';

/**
 * Extracts the clean root domain from an email or URL
 * e.g., 'info@sub.company-name.de' -> 'company-name.de'
 *       'https://www.company-name.cn/contact.html' -> 'company-name.cn'
 */
export function extractRootDomain(text: string): string {
  if (!text) return '';
  let domain = '';

  if (text.includes('@')) {
    domain = text.split('@')[1] || '';
  } else {
    try {
      const urlStr = text.startsWith('http') ? text : `http://${text}`;
      const url = new URL(urlStr);
      domain = url.hostname;
    } catch {
      domain = text;
    }
  }

  domain = domain.toLowerCase().trim().replace(/^www\./, '');
  // Remove port or query params if any
  domain = domain.split(':')[0].split('/')[0];

  // Remove common generic free mail domains from company deduplication
  const genericDomains = new Set([
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
    'icloud.com', 'zoho.com', 'protonmail.com', 'mail.com', 'gmx.com',
    '163.com', 'qq.com', 'sina.com', 'yandex.ru', 'yandex.com', 'daum.net', 'naver.com'
  ]);

  if (genericDomains.has(domain)) {
    return ''; // Do not deduplicate companies solely based on generic public email host
  }

  return domain;
}

/**
 * Normalizes company names to detect duplicates like:
 * "Siemens AG", "Siemens GmbH", "Siemens Ltd.", "Siemens" -> "siemens"
 */
export function normalizeCompanyName(name: string): string {
  if (!name) return '';
  let cleaned = name.toLowerCase().trim();

  // Remove corporate suffixes and legal identifiers
  const corporateSuffixes = [
    /\bcorporation\b/g,
    /\bcorp\.?\b/g,
    /\bincorporated\b/g,
    /\binc\.?\b/g,
    /\blimited\b/g,
    /\bltd\.?\b/g,
    /\bllc\.?\b/g,
    /\bllp\.?\b/g,
    /\bgmbh\b/g,
    /\bag\b/g,
    /\bkg\b/g,
    /\bug\b/g,
    /\bohg\b/g,
    /\be\.k\.?\b/g,
    /\bs\.p\.a\.?\b/g,
    /\bspa\b/g,
    /\bs\.r\.l\.?\b/g,
    /\bsrl\b/g,
    /\bs\.a\.?\b/g,
    /\bsa\b/g,
    /\bs\.l\.?\b/g,
    /\bsl\b/g,
    /\bsarl\b/g,
    /\bsas\b/g,
    /\bpvt\.?\b/g,
    /\bpty\.?\b/g,
    /\bb\.v\.?\b/g,
    /\bn\.v\.?\b/g,
    /\bco\.?,?\s*ltd\.?\b/g,
    /\bco\.?\b/g,
    /\bcompany\b/g,
    /\bgroup\b/g,
    /\bholdings?\b/g,
    /\bholding\b/g,
    /\btechnologies\b/g,
    /\bindustries\b/g,
    /\bindustry\b/g,
    /\benterprises?\b/g,
    /\binternational\b/g,
    /\bintl\.?\b/g
  ];

  for (const suffix of corporateSuffixes) {
    cleaned = cleaned.replace(suffix, ' ');
  }

  // Remove punctuation & special characters
  cleaned = cleaned.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()\"'\[\]]/g, ' ');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Checks if two entries belong to the same company
 */
export function areCompaniesDuplicate(
  a: { companyName?: string; email: string; sourceUrl?: string },
  b: { companyName?: string; email: string; sourceUrl?: string }
): boolean {
  // 1. Same email is always a duplicate
  if (a.email.toLowerCase().trim() === b.email.toLowerCase().trim()) {
    return true;
  }

  // 2. Compare corporate domains (if both have non-generic domain)
  const domainA = extractRootDomain(a.email) || extractRootDomain(a.sourceUrl || '');
  const domainB = extractRootDomain(b.email) || extractRootDomain(b.sourceUrl || '');

  if (domainA && domainB && domainA === domainB) {
    return true;
  }

  // 3. Compare normalized company names
  const normA = normalizeCompanyName(a.companyName || '');
  const normB = normalizeCompanyName(b.companyName || '');

  if (normA && normB && normA.length >= 3 && normB.length >= 3) {
    if (normA === normB) {
      return true;
    }
    // High similarity check (exact start match of significant length)
    if (normA.startsWith(normB) || normB.startsWith(normA)) {
      const minLen = Math.min(normA.length, normB.length);
      if (minLen >= 5) return true;
    }
  }

  return false;
}

/**
 * Filters a list of ExtractedEmail items to prevent duplicate companies
 */
export function filterDuplicateCompanies(
  incoming: ExtractedEmail[],
  existing: ExtractedEmail[] = [],
  avoidDuplicateCompanies: boolean = true
): {
  unique: ExtractedEmail[];
  duplicateEmailsCount: number;
  duplicateCompaniesCount: number;
} {
  const existingEmailSet = new Set(existing.map(e => e.email.toLowerCase().trim()));
  const existingCompanySet = new Set<string>();
  const existingDomainSet = new Set<string>();

  existing.forEach(e => {
    const norm = normalizeCompanyName(e.companyName || '');
    if (norm && norm.length >= 3) existingCompanySet.add(norm);

    const domain = extractRootDomain(e.email) || extractRootDomain(e.sourceUrl || '');
    if (domain) existingDomainSet.add(domain);
  });

  const unique: ExtractedEmail[] = [];
  let duplicateEmailsCount = 0;
  let duplicateCompaniesCount = 0;

  for (const item of incoming) {
    const emailNorm = item.email.toLowerCase().trim();
    if (existingEmailSet.has(emailNorm)) {
      duplicateEmailsCount++;
      continue;
    }

    if (avoidDuplicateCompanies) {
      const normName = normalizeCompanyName(item.companyName || '');
      const domain = extractRootDomain(item.email) || extractRootDomain(item.sourceUrl || '');

      let isCompanyDupe = false;

      if (normName && normName.length >= 3 && existingCompanySet.has(normName)) {
        isCompanyDupe = true;
      } else if (domain && existingDomainSet.has(domain)) {
        isCompanyDupe = true;
      }

      if (isCompanyDupe) {
        duplicateCompaniesCount++;
        continue;
      }

      if (normName && normName.length >= 3) existingCompanySet.add(normName);
      if (domain) existingDomainSet.add(domain);
    }

    existingEmailSet.add(emailNorm);
    unique.push(item);
  }

  return {
    unique,
    duplicateEmailsCount,
    duplicateCompaniesCount
  };
}
