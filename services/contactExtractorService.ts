import * as XLSX from 'xlsx';
import { safeFetchJson } from './safeFetch';

export type ContactType = 'email' | 'phone' | 'webmail' | 'website';
export type MXStatus = 'unchecked' | 'checking' | 'valid' | 'invalid';

export interface MXCheckResult {
  hasMx: boolean;
  provider: string;
  servers: string[];
  diagnostic: string;
}

export interface ExtractedContactItem {
  id: string;
  type: ContactType;
  value: string;
  normalizedValue: string;
  category: string;
  source: string;
  domain?: string;
  country?: string;
  mxStatus?: MXStatus;
  mxProvider?: string;
  mxServers?: string[];
  mxDiagnostic?: string;
}

export interface ContactExtractionFilterOptions {
  extractEmail: boolean;
  extractPhone: boolean;
  extractWeb: boolean; // webmail + website ("webit")
  webmailOnly?: boolean;
  deduplicate?: boolean;
  countryHint?: string;
  autoCheckMX?: boolean;
}

// Enterprise & Global MX Pattern Definitions
const MX_PROVIDER_PATTERNS: [string, string[]][] = [
  ['Google Workspace', ['google.com', 'googlemail.com', 'aspmx.l.google.com', 'l.google.com']],
  ['Microsoft 365', ['outlook.com', 'protection.outlook.com', 'hotmail.com', 'microsoft.com', 'office365.com', 'mail.protection.outlook.com']],
  ['Zoho Mail', ['zoho.com', 'zoho.eu', 'zoho.in']],
  ['Mimecast', ['mimecast.com']],
  ['Proofpoint', ['pphosted.com', 'ppe-hosted.com', 'proofpoint.com']],
  ['ProtonMail', ['protonmail.ch', 'proton.me']],
  ['Fastmail', ['fastmail.com', 'messagingengine.com']],
  ['GoDaddy', ['secureserver.net']],
  ['Namecheap / PrivateEmail', ['registrar-servers.com', 'privateemail.com', 'oxcs.net']],
  ['Amazon SES / WorkMail', ['amazonses.com', 'awsapps.com']],
  ['OVHcloud', ['ovh.net', 'ovh.com', 'ovh.ca']],
  ['Rackspace', ['emailsrvr.com']],
  ['Yandex', ['yandex.net', 'yandex.com', 'yandex.ru']],
  ['Mailgun', ['mailgun.org', 'mailgun.com']],
  ['SendGrid', ['sendgrid.net']],
  ['Brevo / Sendinblue', ['sendinblue.com', 'brevo.com']],
  ['Cisco IronPort', ['iphmx.com', 'ironport.com']],
  ['Barracuda', ['barracudanetworks.com', 'ess.barracuda.com']],
  ['Apple iCloud', ['icloud.com', 'apple.com']]
];

/**
 * Check MX DNS records for a given domain via DNS-over-HTTPS (Google & Cloudflare fallback)
 */
export const checkDomainMX = async (
  domain: string,
  cache?: Map<string, MXCheckResult>
): Promise<MXCheckResult> => {
  if (!domain) {
    return { hasMx: false, provider: 'Unknown', servers: [], diagnostic: 'No domain specified' };
  }

  const cleanDomain = domain.toLowerCase().trim();
  if (cache && cache.has(cleanDomain)) {
    return cache.get(cleanDomain)!;
  }

  try {
    let data: any = null;

    // 1. Primary: Google DNS-over-HTTPS
    try {
      const gRes = await safeFetchJson<any>(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=MX`);
      if (gRes.ok && gRes.data) {
        data = gRes.data;
      }
    } catch {
      // Fallback
    }

    // 2. Fallback: Cloudflare DNS-over-HTTPS
    if (!data || !Array.isArray(data.Answer) || data.Answer.length === 0) {
      try {
        const cfRes = await safeFetchJson<any>(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(cleanDomain)}&type=MX`,
          { headers: { Accept: 'application/dns-json' } }
        );
        if (cfRes.ok && cfRes.data) {
          data = cfRes.data;
        }
      } catch {
        // Fallback failed
      }
    }

    if (data && Array.isArray(data.Answer) && data.Answer.length > 0) {
      const servers: string[] = data.Answer
        .map((ans: any) => (ans.data || '').toLowerCase())
        .filter(Boolean);

      let detectedProvider = 'Custom / Private MX';
      for (const [provider, patterns] of MX_PROVIDER_PATTERNS) {
        if (servers.some(srv => patterns.some(pat => srv.includes(pat)))) {
          detectedProvider = provider;
          break;
        }
      }

      const result: MXCheckResult = {
        hasMx: true,
        provider: detectedProvider,
        servers,
        diagnostic: `Active MX (${detectedProvider})`
      };

      if (cache) cache.set(cleanDomain, result);
      return result;
    }

    // If no MX records, check if the domain has an A record (active website without mail server vs completely dead domain)
    let hasA = false;
    try {
      const aRes = await safeFetchJson<any>(`https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=A`);
      if (aRes.ok && aRes.data) {
        hasA = !!(aRes.data && Array.isArray(aRes.data.Answer) && aRes.data.Answer.length > 0);
      }
    } catch {
      // ignore A check error
    }

    const result: MXCheckResult = {
      hasMx: false,
      provider: hasA ? 'No MX (Web Only)' : 'Dead / Inactive Domain',
      servers: [],
      diagnostic: hasA 
        ? 'Domain resolves web IP (A record), but has no MX email exchange server configured.' 
        : 'Domain has neither MX nor A DNS records (dead or unregistered).'
    };

    if (cache) cache.set(cleanDomain, result);
    return result;
  } catch (err: any) {
    const result: MXCheckResult = {
      hasMx: false,
      provider: 'DNS Query Failed',
      servers: [],
      diagnostic: err?.message || 'DNS request error'
    };
    return result;
  }
};

/**
 * Robust Email Extractor
 */
export const extractEmailsFromText = (text: string, source = 'Text'): ExtractedContactItem[] => {
  if (!text) return [];

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];

  const junkExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.css', '.js'];
  const results: ExtractedContactItem[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    let clean = raw.trim().toLowerCase();
    // remove trailing dots or punctuation
    clean = clean.replace(/[.,;:)>\]"']+$/, '');

    if (clean.length < 5 || !clean.includes('@') || !clean.includes('.')) continue;

    const parts = clean.split('@');
    if (parts.length !== 2) continue;
    const [user, domain] = parts;

    // Filter out common junk
    if (junkExtensions.some(ext => clean.endsWith(ext))) continue;
    if (user.length > 64 || domain.length > 255) continue;
    if (user.startsWith('image00') || user.startsWith('clip_image')) continue;

    if (seen.has(clean)) continue;
    seen.add(clean);

    results.push({
      id: `email-${clean}`,
      type: 'email',
      value: clean,
      normalizedValue: clean,
      category: clean.startsWith('info@') || clean.startsWith('sales@') || clean.startsWith('contact@')
        ? 'Business Mail'
        : 'Direct Email',
      source,
      domain,
      mxStatus: 'unchecked'
    });
  }

  return results;
};

/**
 * Robust Phone Number Extractor
 * Matches international (+1, +44, +49, +86, etc.), domestic, area codes, toll-free, and common formats
 * Automatically filters out dates (2024-05-12), IP addresses, timestamps, CSS sizes, and arbitrary numbers
 */
export const extractPhonesFromText = (text: string, source = 'Text', countryHint?: string): ExtractedContactItem[] => {
  if (!text) return [];

  // Patterns for phones:
  // 1. Explicitly prefixed (Tel, Phone, Mobile, Call, WhatsApp, Cell)
  // 2. International + format e.g. +1 555-123-4567, +49 30 1234567, +44 20 7946 0919
  // 3. Parenthesized area codes: (555) 123-4567, (020) 7946 0919, (030) 12345678
  // 4. Standard 10-12 digit delimiters: 555-123-4567, 0800 123 4567
  const phoneCandidateRegex = /(?:(?:tel|phone|mobile|cell|fax|whatsapp|call|contact)[:\s]*)?(\+?\b[0-9][0-9()\-.\s/]{6,22}[0-9]\b)/gi;

  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = phoneCandidateRegex.exec(text)) !== null) {
    if (match[1]) {
      matches.push(match[1]);
    }
  }

  const results: ExtractedContactItem[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    let clean = raw.trim();

    // Strip extraneous enclosing punctuation
    clean = clean.replace(/^[.,;:\s/\\-]+|[.,;:\s/\\-]+$/g, '');

    // Skip if it looks like an ISO date e.g. 2024-05-12 or 2024/05/12 or 12.05.2024
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(clean) || /^\d{1,2}[-./]\d{1,2}[-./]\d{4}$/.test(clean)) {
      continue;
    }

    // Skip if it's an IPv4 address e.g. 192.168.1.1
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
      continue;
    }

    // Skip if it's a timestamp or time range e.g. 12:30:45
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(clean)) {
      continue;
    }

    // Count pure digits
    const digitsOnly = clean.replace(/\D/g, '');

    // Phone numbers must be between 7 and 15 digits (standard E.164 format)
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
      continue;
    }

    // Skip repeated identical digits (e.g. 0000000, 11111111, 99999999)
    if (/^(\d)\1+$/.test(digitsOnly)) {
      continue;
    }

    // Skip sequential numbers (e.g. 12345678, 98765432)
    if (digitsOnly === '123456789' || digitsOnly === '12345678' || digitsOnly === '987654321') {
      continue;
    }

    // If starts with + (international), standard normalized form
    const isInternational = clean.startsWith('+');
    let normalized = clean;

    // Formatting normalization
    if (isInternational) {
      normalized = '+' + digitsOnly;
    } else if (digitsOnly.length === 10) {
      normalized = `(${digitsOnly.slice(0, 3)}) ${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
    } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      normalized = `+1 (${digitsOnly.slice(1, 4)}) ${digitsOnly.slice(4, 7)}-${digitsOnly.slice(7)}`;
    } else {
      normalized = clean.replace(/\s+/g, ' ');
    }

    // Deduplication check
    const dedupKey = digitsOnly;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    let category = 'Local / Domestic Phone';
    if (isInternational) {
      category = 'International (+ Format)';
    } else if (digitsOnly.startsWith('800') || digitsOnly.startsWith('888') || digitsOnly.startsWith('877') || digitsOnly.startsWith('0800')) {
      category = 'Toll-Free Phone';
    } else if (digitsOnly.length >= 10) {
      category = 'Direct Phone';
    }

    results.push({
      id: `phone-${digitsOnly}`,
      type: 'phone',
      value: clean,
      normalizedValue: normalized,
      category,
      source,
      country: countryHint || undefined
    });
  }

  return results;
};

/**
 * Robust Webmail & Website / "Webit" Extractor
 * Identifies:
 * 1. Webmail links & servers (e.g. webmail.*, mail.*, owa.*, Outlook/Gmail portal links, roundcube, cpanel)
 * 2. Corporate websites & domains (e.g. https://www.example.com, www.example.org, example.de)
 */
export const extractWebsitesAndWebmailFromText = (
  text: string, 
  source = 'Text', 
  webmailOnly = false
): ExtractedContactItem[] => {
  if (!text) return [];

  // Match full URLs or domain-like entries
  const urlRegex = /(?:https?:\/\/|www\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s<>"')]*)*|(?:\b[a-zA-Z0-9.-]+\.(?:com|org|net|de|co\.uk|io|ai|cn|fr|it|es|ca|au|in|jp|nl|se|pl|ch|at|be|eu|biz|info|mobi|tech|pro|agency|co)\b(?:\/[^\s<>"')]*)?)/gi;

  const matches = text.match(urlRegex) || [];
  const results: ExtractedContactItem[] = [];
  const seen = new Set<string>();

  const webmailKeywords = ['webmail', 'mail.', 'owa', 'exchange', 'roundcube', 'cpanel', 'horde', 'squirrelmail', 'zimbra', 'email.', 'mail-login', 'webmail/'];
  const junkExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'pdf', 'zip', 'rar', 'woff', 'ttf']);

  for (const raw of matches) {
    let clean = raw.trim();

    // Remove trailing punctuation
    clean = clean.replace(/[.,;:)>\]"']+$/, '');

    // Skip emails if caught by URL regex
    if (clean.includes('@')) continue;

    // Skip file resources
    const ext = clean.split('.').pop()?.split('/')[0]?.split('?')[0]?.toLowerCase() || '';
    if (junkExtensions.has(ext)) continue;

    let fullUrl = clean;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      fullUrl = 'https://' + fullUrl;
    }

    let parsedHost = '';
    try {
      const parsed = new URL(fullUrl);
      parsedHost = parsed.hostname.toLowerCase();
    } catch {
      parsedHost = clean.split('/')[0].toLowerCase();
    }

    if (!parsedHost || !parsedHost.includes('.') || parsedHost.length < 4) continue;

    // Check if webmail
    const isWebmail = webmailKeywords.some(kw => 
      clean.toLowerCase().includes(kw) || 
      parsedHost.toLowerCase().includes(kw)
    );

    if (webmailOnly && !isWebmail) {
      continue;
    }

    const type: ContactType = isWebmail ? 'webmail' : 'website';
    const category = isWebmail ? 'Webmail Portal / Server' : 'Corporate Website';

    const dedupKey = clean.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    results.push({
      id: `${type}-${parsedHost}-${seen.size}`,
      type,
      value: clean.startsWith('http') ? clean : `https://${clean}`,
      normalizedValue: parsedHost,
      category,
      source,
      domain: parsedHost
    });
  }

  return results;
};

/**
 * Unified Contact Extractor for Text
 * Extracts based on checked filters (email, phone, web/webmail)
 */
export const extractContactsFromText = (
  text: string,
  options: ContactExtractionFilterOptions,
  source = 'Pasted Text'
): ExtractedContactItem[] => {
  const list: ExtractedContactItem[] = [];

  if (options.extractEmail) {
    list.push(...extractEmailsFromText(text, source));
  }

  if (options.extractPhone) {
    list.push(...extractPhonesFromText(text, source, options.countryHint));
  }

  if (options.extractWeb) {
    list.push(...extractWebsitesAndWebmailFromText(text, source, options.webmailOnly));
  }

  if (options.deduplicate) {
    const seenValues = new Set<string>();
    return list.filter(item => {
      const key = `${item.type}:${item.normalizedValue.toLowerCase()}`;
      if (seenValues.has(key)) return false;
      seenValues.add(key);
      return true;
    });
  }

  return list;
};

/**
 * Extracts contacts from an uploaded File (TXT, CSV, XLSX, XLS, JSON, HTML, LOG, etc.)
 */
export const extractContactsFromFile = async (
  file: File,
  options: ContactExtractionFilterOptions
): Promise<{ contacts: ExtractedContactItem[]; rawText: string; fileName: string; fileSize: number }> => {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isExcel = ext === 'xlsx' || ext === 'xls';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          resolve({ contacts: [], rawText: '', fileName: file.name, fileSize: file.size });
          return;
        }

        let rawText = '';
        if (isExcel) {
          const workbook = XLSX.read(data, { type: 'array' });
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            rawText += XLSX.utils.sheet_to_csv(worksheet) + '\n';
          });
        } else if (typeof data === 'string') {
          rawText = data;
        } else {
          rawText = new TextDecoder('utf-8').decode(data as ArrayBuffer);
        }

        const contacts = extractContactsFromText(rawText, options, file.name);

        resolve({
          contacts,
          rawText,
          fileName: file.name,
          fileSize: file.size
        });
      } catch (err: any) {
        console.error("Error reading file for contact extraction:", err);
        reject(new Error(`Failed to parse ${file.name}: ${err?.message || 'Unsupported file format'}`));
      }
    };

    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`));
    };

    if (isExcel) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  });
};
