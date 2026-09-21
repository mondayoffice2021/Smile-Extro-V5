import { isPublicDomain } from '../constants/domains';
import { safeFetchJson, resolveDomainMxClientSide } from './safeFetch';

export type NonBusinessCategory = 
  | 'bank' 
  | 'government' 
  | 'education' 
  | 'news' 
  | 'webmaster_bot' 
  | 'computer_generated'
  | 'public_webmail'
  | 'invalid'
  | 'dead_mx';

export interface BusinessFilterOptions {
  filterBank?: boolean;
  filterGovernment?: boolean;
  filterEducation?: boolean;
  filterNews?: boolean;
  filterWebmasterBot?: boolean;
  filterComputerGenerated?: boolean;
  filterPublicWebmail?: boolean;
  filterBadSyntax?: boolean;
  filterDisposable?: boolean;
}

export const DEFAULT_BUSINESS_FILTER_OPTIONS: BusinessFilterOptions = {
  filterBank: true,
  filterGovernment: true,
  filterEducation: true,
  filterNews: true,
  filterWebmasterBot: true,
  filterComputerGenerated: true,
  filterPublicWebmail: true, // Clean public emails like Gmail by default in sender hygiene
  filterBadSyntax: true,
  filterDisposable: true,
};

export interface BusinessFilterResult {
  isBusiness: boolean;
  category: 'business' | NonBusinessCategory;
  reason?: string;
  matchedRule?: string;
}

// Protected business usernames that should NEVER be filtered as junk or bots
// User requested: "leave info, sales, order" as well as standard commercial prefixes
export const PROTECTED_BUSINESS_USERNAMES = new Set([
  'info', 'information', 'sales', 'order', 'orders', 'orderdesk',
  'contact', 'contacts', 'support', 'help', 'service', 'services',
  'inquiry', 'inquiries', 'enquiry', 'enquiries',
  'export', 'exports', 'import', 'imports',
  'procurement', 'purchasing', 'purchase', 'buyer',
  'billing', 'invoice', 'invoices', 'accounting', 'finance',
  'office', 'hello', 'general', 'commercial', 'marketing',
  'operations', 'logistics', 'quotes', 'quotation', 'rfq', 'rfqs',
  'booking', 'bookings', 'reservations', 'customercare', 'team'
]);

export function isProtectedBusinessUser(user: string): boolean {
  const cleanUser = (user || '').toLowerCase().trim();
  if (PROTECTED_BUSINESS_USERNAMES.has(cleanUser)) return true;
  // Handle dotted, hyphenated or prefixed variations like info.uk, sales-team, order.usa, contact_eu
  const baseUser = cleanUser.split(/[._-]/)[0];
  return PROTECTED_BUSINESS_USERNAMES.has(baseUser);
}

// 1. Bank & Financial institutions
const BANK_KEYWORDS = [
  'bank', 'banco', 'banque', 'banca', 'banking', 'creditunion', 'credit-union',
  'capital', 'finance', 'financial', 'invest', 'investment', 'chase', 'wellsfargo',
  'citi', 'citibank', 'citigroup', 'hsbc', 'barclays', 'santander', 'ubs', 'deutschebank',
  'standardchartered', 'pnc', 'usbank', 'truist', 'schwab', 'fidelity',
  'vanguard', 'paypal', 'stripe', 'visa', 'mastercard', 'amex', 'americanexpress',
  'klarna', 'revolut', 'wise.com', 'monzo', 'n26', 'crypto', 'binance', 'coinbase',
  'kraken', 'blockchain', 'wallet', 'treasury', 'lending', 'mortgage', 'wealth',
  'goldmansachs', 'morganstanley', 'blackrock', 'bofa', 'bankofamerica',
  'jpmorgan', 'credit-agricole', 'societegenerale', 'bnpparibas', 'commerzbank',
  'rabobank', 'abnamro', 'ingbank', 'caixabank', 'bbva', 'unicredit', 'intesasanpaolo'
];

const EXACT_BANK_DOMAINS = new Set([
  'chase.com', 'wellsfargo.com', 'citi.com', 'citibank.com', 'citigroup.com', 'hsbc.com',
  'barclays.com', 'barclays.co.uk', 'santander.com', 'santander.co.uk', 'ubs.com', 'db.com', 'sc.com',
  'pnc.com', 'usbank.com', 'truist.com', 'schwab.com', 'fidelity.com',
  'vanguard.com', 'paypal.com', 'stripe.com', 'visa.com', 'mastercard.com',
  'americanexpress.com', 'revolut.com', 'wise.com', 'binance.com', 'coinbase.com',
  'bankofamerica.com', 'goldmansachs.com', 'morganstanley.com', 'blackrock.com',
  'jpmorgan.com', 'jpmorganchase.com', 'td.com', 'tdbank.com', 'bmo.com', 'rbc.com',
  'scotiabank.com', 'cibc.com', 'commbank.com.au', 'westpac.com.au', 'anz.com', 'nab.com.au',
  'dbs.com', 'ocbc.com', 'uobgroup.com', 'lloydsbank.com', 'natwest.com', 'rbs.co.uk'
]);

// 2. Government & Military
const GOV_TLD_SUBSTRINGS = [
  '.gov', '.mil', '.gouv.', '.gob.', '.go.jp', '.go.kr', '.go.id', '.go.th',
  '.gv.at', '.admin.ch', '.gov.uk', '.gov.in', '.gov.cn', '.gov.au', '.gov.br',
  '.gov.it', '.gov.za', '.europa.eu', '.belgium.be', '.etat.', '.bund.',
  '.gc.ca', '.gob.mx', '.gov.sg', '.gov.my', '.govt.nz'
];

const GOV_KEYWORDS = [
  'parliament', 'ministry', 'senate', 'congress', 'embassy', 'consulate',
  'police', 'customs', 'irs.gov', 'fbi.gov', 'cia.gov', 'bundeswehr',
  'bundestag', 'prefecture', 'municipality', 'cityhall', 'state.gov',
  'governance', 'department-of-', 'dept-of-', 'gov-', 'whitehouse', 'pentagon'
];

// 3. Education & Academic
const EDU_TLD_SUBSTRINGS = [
  '.edu', '.ac.uk', '.ac.in', '.ac.jp', '.ac.kr', '.ac.nz', '.ac.za',
  '.ac.at', '.ac.be', '.edu.cn', '.edu.au', '.edu.sg', '.edu.hk',
  '.edu.my', '.edu.tw', '.edu.tr', '.edu.eg', '.edu.ng', '.edu.pk',
  '.edu.ph', '.edu.co', '.edu.ar', '.edu.br', '.edu.mx', '.school.nz',
  '.edu.ca', '.k12.', '.school.'
];

const EDU_KEYWORDS = [
  'university', 'universitaet', 'universidad', 'universite', 'universite',
  'college', 'harvard', 'stanford', 'oxford', 'cambridge', 'mit.edu',
  'school', 'academy', 'campus', 'alumni', 'student', 'faculty',
  'professor', 'k12', 'highschool', 'polytechnic', 'kindergarten',
  'yale.edu', 'princeton.edu', 'columbia.edu', 'berkeley.edu'
];

// 4. News & Media
const NEWS_DOMAINS = new Set([
  'cnn.com', 'bbc.com', 'bbc.co.uk', 'reuters.com', 'bloomberg.com', 'nytimes.com',
  'wsj.com', 'washingtonpost.com', 'theguardian.com', 'apnews.com', 'forbes.com',
  'ft.com', 'spiegel.de', 'lefigaro.fr', 'lemonde.fr', 'corriere.it', 'asahi.com',
  'yomiuri.co.jp', 'xinhuanet.com', 'chinadaily.com.cn', 'huffpost.com', 'buzzfeed.com',
  'foxnews.com', 'nbcnews.com', 'cbsnews.com', 'economist.com', 'politico.com',
  'aljazeera.com', 'dw.com', 'zeit.de', 'faz.net', 'bild.de', 'elpais.com'
]);

const NEWS_DOMAIN_KEYWORDS = [
  'news', 'press', 'gazette', 'tribune', 'media', 'journal', 'times', 'post',
  'herald', 'broadcast', 'chronicle', 'daily', 'magazine', 'reporters',
  'editorial', 'journalism', 'pressrelease', 'wire', 'broadcasting', 'tvnews',
  'radiostation', 'newspaper', 'pubblica'
];

const NEWS_USERNAMES = new Set([
  'press', 'media', 'news', 'editor', 'editorial', 'journalism', 'reporters',
  'journalist', 'newsroom', 'anchors', 'desk', 'breakingnews'
]);

// 5. Webmaster & Automated Bot / Technical Mailboxes
const FORBIDDEN_USERNAMES = new Set([
  'webmaster', 'postmaster', 'hostmaster', 'root', 'abuse', 'noc', 'security',
  'admin', 'administrator', 'helpdesk', 'mailer-daemon', 'mailerdaemon', 'daemon',
  'system', 'sysadmin', 'network', 'dns', 'server', 'ssl', 'cert', 'whois',
  'contact-form', 'donotreply', 'do-not-reply', 'no-reply', 'noreply', 'bounce',
  'bounces', 'bouncing', 'bounced', 'mailer', 'notification', 'notifications',
  'alert', 'alerts', 'newsletter', 'newsletters', 'marketing-automation',
  'auto-confirm', 'autoconfirm', 'support-tickets', 'tickets', 'zendesk',
  'jira', 'gitlab', 'github', 'bitbucket', 'tracking', 'spam', 'bulk',
  'unsubscribe', 'optout', 'automatic', 'reply-to', 'null', 'devnull',
  // User requested: "junk email like webmaster, user etc"
  'user', 'users', 'username', 'user1', 'user2', 'test', 'testing', 'demo',
  'sample', 'example', 'anonymous', 'dummy', 'fake', 'nobody', 'temp', 'placeholder'
]);

const JUNK_USER_PATTERNS = [
  /^image\d+/i,
  /^part\d+/i,
  /^attachment\d+/i,
  /^frame\d+/i,
  /^thumb\d+/i,
  /^clip\d+/i,
  /^img\d+/i,
  /^file\d+/i,
  /^document\d+/i,
  /^scan\d+/i,
  /^button\d+/i,
  /^icon\d+/i,
  /^logo\d+/i,
  /^asset\d+/i
];

// 6. Disposable Domains
const DISPOSABLE_DOMAINS = new Set([
  'temp-mail.org', '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
  'sharklasers.com', 'dispostable.com', 'yopmail.com', 'throwawaymail.com',
  'fakeinbox.com', 'trashmail.com', 'trashmail.net', 'tempmail.net',
  'generator.email', 'crazymailing.com', 'inboxbear.com', 'emailondeck.com',
  'burnermail.io', 'getnada.com', 'maildrop.cc', 'mohmal.com', 'getairmail.com',
  'mytemp.email', 'tempail.com', 'trash-mail.com', 'trashinbox.com'
]);

// 7. Common Webmail Typos (Malformed Domains)
const WEBMAIL_TYPOS = new Set([
  'gamil.com', 'gmal.com', 'gmaill.com', 'gamil.co', 'gmaill.co', 'gamail.com',
  'hotmial.com', 'hotmial.co', 'hotmaill.com', 'hotmil.com', 'hormail.com',
  'outlok.com', 'outloo.com', 'outlock.com', 'outlok.co',
  'yaho.com', 'yahou.com', 'yhaoo.com', 'yahooo.com', 'yhoo.com',
  'icoud.com', 'iclud.com', 'prtonmail.com', 'prton.me'
]);

/**
 * Validates whether an email is a legitimate commercial/business email
 * or falls into excluded non-business categories (Bank, Gov, Edu, News, Webmaster/Bot, Computer Generated, Public Webmail, Invalid).
 */
export function classifyBusinessEmail(
  email: string, 
  options: BusinessFilterOptions = DEFAULT_BUSINESS_FILTER_OPTIONS
): BusinessFilterResult {
  const trimmed = (email || '').trim().replace(/^[<"']+|[>"']+$/g, '');
  
  // Syntax check
  if (!trimmed || !trimmed.includes('@')) {
    return { isBusiness: false, category: 'invalid', reason: 'Missing @ symbol' };
  }

  const parts = trimmed.split('@');
  if (parts.length !== 2) {
    return { isBusiness: false, category: 'invalid', reason: 'Multiple @ symbols' };
  }

  const user = parts[0].trim().toLowerCase();
  const domain = parts[1].trim().toLowerCase();

  if (!user || !domain) {
    return { isBusiness: false, category: 'invalid', reason: 'Empty username or domain' };
  }

  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    return { isBusiness: false, category: 'invalid', reason: 'Invalid or missing domain TLD' };
  }

  // Check email syntax regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { isBusiness: false, category: 'invalid', reason: 'Malformed email syntax characters' };
  }

  // 1. Webmail Typos & Disposable Email Filter
  if (options.filterDisposable !== false) {
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return { 
        isBusiness: false, 
        category: 'invalid', 
        reason: 'Temporary / disposable throwaway email service', 
        matchedRule: `Disposable domain ${domain}` 
      };
    }
  }

  if (options.filterBadSyntax !== false) {
    if (WEBMAIL_TYPOS.has(domain)) {
      return { 
        isBusiness: false, 
        category: 'invalid', 
        reason: `Misspelled webmail domain (@${domain})`, 
        matchedRule: `Typo domain` 
      };
    }
  }

  // Check if username is an explicitly protected commercial/business mailbox (e.g. info, sales, order)
  const isProtected = isProtectedBusinessUser(user);

  // 2. Webmaster, Technical & Bot Filter
  // User requested: "remove junk email like webmaster, user etc, but leave info, sales, order"
  if (options.filterWebmasterBot !== false && !isProtected) {
    if (FORBIDDEN_USERNAMES.has(user)) {
      return { 
        isBusiness: false, 
        category: 'webmaster_bot', 
        reason: 'Technical, generic, or automated system mailbox', 
        matchedRule: `Username "${user}"` 
      };
    }

    if (
      user.includes('noreply') || 
      user.includes('no-reply') || 
      user.includes('donotreply') || 
      user.includes('do-not-reply') || 
      user.includes('newsletter') ||
      user.includes('bounce') ||
      user.startsWith('daemon')
    ) {
      return { 
        isBusiness: false, 
        category: 'webmaster_bot', 
        reason: 'Automated notification mailbox', 
        matchedRule: `Contains automated marker "${user}"` 
      };
    }
  }

  // 3. Computer-Generated / Scraping Artifact / Hash Filter
  if (options.filterComputerGenerated !== false && !isProtected) {
    // Check junk / file attachments / scrap artifacts
    const isJunkPattern = JUNK_USER_PATTERNS.some(re => re.test(user));
    const hasFileExt = /\.(gif|jpg|jpeg|png|bmp|svg|pdf|doc|docx|zip|rar|exe|dll|bin|ico|webp)$/i.test(user);
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user);
    const numDigits = (user.match(/\d/g) || []).length;
    
    // Too many consecutive digits or high digit ratio (>50%)
    const isOverlyNumeric = user.length >= 7 && (numDigits / user.length) >= 0.5;
    const hasTooManyDigits = numDigits >= 6;

    // Alphanumeric hash-like string: long (>= 12), no dots/hyphens, very few vowels
    const vowelCount = (user.match(/[aeiou]/gi) || []).length;
    const isHashLike = user.length >= 10 && /^[a-z0-9]+$/i.test(user) && !user.includes('.') && !user.includes('_') && vowelCount <= 1;

    // Dummy test accounts
    const isDummyAccount = /^(test|demo|sample|asdf|qwerty|123456|testing|fake|foo|bar|null|none)$/i.test(user);

    if (isJunkPattern || hasFileExt || isUUID || isOverlyNumeric || hasTooManyDigits || isHashLike || isDummyAccount) {
      return { 
        isBusiness: false, 
        category: 'computer_generated', 
        reason: 'Machine-generated, automated hash, or scrap artifact', 
        matchedRule: isUUID ? 'UUID pattern' : isJunkPattern ? 'Attachment/scrap artifact' : isHashLike ? 'Hash string' : 'Numeric bot pattern' 
      };
    }
  }

  // 4. Public Webmail Filter (Gmail, Yahoo, Outlook, Hotmail, etc.)
  if (options.filterPublicWebmail === true) {
    if (isPublicDomain(domain)) {
      return { 
        isBusiness: false, 
        category: 'public_webmail', 
        reason: 'Free consumer public webmail provider (Gmail/Yahoo/Outlook/etc.)', 
        matchedRule: `Public domain ${domain}` 
      };
    }
  }

  // 5. Government & Military Filter
  if (options.filterGovernment !== false) {
    const isGovTLD = domain.endsWith('.gov') || domain.includes('.gov.') || domain.endsWith('.mil') || GOV_TLD_SUBSTRINGS.some(tld => domain.endsWith(tld) || domain.includes(tld));
    if (isGovTLD) {
      return { 
        isBusiness: false, 
        category: 'government', 
        reason: 'Government or military agency domain (.gov/.mil)', 
        matchedRule: 'Gov TLD' 
      };
    }

    const isGovKeyword = GOV_KEYWORDS.some(kw => domain.includes(kw));
    if (isGovKeyword) {
      return { 
        isBusiness: false, 
        category: 'government', 
        reason: 'Government organization keyword', 
        matchedRule: 'Gov domain keyword' 
      };
    }
  }

  // 6. Education & Academic Filter
  if (options.filterEducation !== false) {
    const isEduTLD = domain.endsWith('.edu') || domain.includes('.edu.') || EDU_TLD_SUBSTRINGS.some(tld => domain.endsWith(tld) || domain.includes(tld));
    if (isEduTLD) {
      return { 
        isBusiness: false, 
        category: 'education', 
        reason: 'Educational or academic institution domain (.edu/.ac)', 
        matchedRule: 'Edu TLD' 
      };
    }

    const isEduKeyword = EDU_KEYWORDS.some(kw => domain.includes(kw) || user.includes(kw));
    if (isEduKeyword) {
      return { 
        isBusiness: false, 
        category: 'education', 
        reason: 'Academic institution or university keyword', 
        matchedRule: 'Edu keyword' 
      };
    }
  }

  // 7. Bank & Financial Institutions Filter
  if (options.filterBank !== false) {
    if (domain.endsWith('.bank') || domain.endsWith('.creditunion') || EXACT_BANK_DOMAINS.has(domain)) {
      return { 
        isBusiness: false, 
        category: 'bank', 
        reason: 'Banking or financial service institution', 
        matchedRule: `Financial domain ${domain}` 
      };
    }

    const isBankKeyword = BANK_KEYWORDS.some(kw => domain.includes(kw));
    if (isBankKeyword) {
      return { 
        isBusiness: false, 
        category: 'bank', 
        reason: 'Bank or financial institution keyword', 
        matchedRule: `Bank keyword in ${domain}` 
      };
    }
  }

  // 8. News & Media Outlets Filter
  if (options.filterNews !== false) {
    if (NEWS_DOMAINS.has(domain)) {
      return { 
        isBusiness: false, 
        category: 'news', 
        reason: 'News or media outlet domain', 
        matchedRule: `News publication ${domain}` 
      };
    }

    if (NEWS_USERNAMES.has(user)) {
      return { 
        isBusiness: false, 
        category: 'news', 
        reason: 'Press/media desk mailbox', 
        matchedRule: `Press mailbox "${user}@"` 
      };
    }

    const isNewsDomainKeyword = NEWS_DOMAIN_KEYWORDS.some(kw => domain.includes(kw));
    if (isNewsDomainKeyword) {
      return { 
        isBusiness: false, 
        category: 'news', 
        reason: 'News, media, or press agency', 
        matchedRule: `Media keyword in ${domain}` 
      };
    }
  }

  // Passed all filters -> Genuine business email
  return { 
    isBusiness: true, 
    category: 'business' 
  };
}

/**
 * Checks DNS MX records for multiple domains via the server batch endpoint,
 * with automatic fallback to client-side DNS-over-HTTPS (DoH) if hosted on Cloudflare
 * or when the backend server is unreachable.
 */
export async function checkDomainsMxBatch(
  domains: string[]
): Promise<Record<string, { isLive: boolean; hasMx: boolean; mxHost?: string; error?: string }>> {
  if (!domains || domains.length === 0) return {};
  
  // Deduplicate and normalize
  const uniqueDomains = Array.from(
    new Set(
      domains
        .filter(d => typeof d === 'string')
        .map(d => d.toLowerCase().replace(/^(?:https?:\/\/)?(?:www\.)?/, '').split('/')[0].trim())
        .filter(d => d && d.includes('.') && !d.includes(' '))
    )
  );

  if (uniqueDomains.length === 0) return {};

  // 1. Try server-side batch endpoint using safeFetchJson (handles empty/HTML responses safely)
  try {
    const res = await safeFetchJson<{ results?: Record<string, { isLive: boolean; hasMx: boolean; mxHost?: string; error?: string }> }>(
      '/api/verify-mx-batch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: uniqueDomains })
      }
    );

    if (res.ok && res.data && res.data.results && Object.keys(res.data.results).length > 0) {
      return res.data.results;
    }
  } catch (err) {
    console.warn('[MX Batch Check] Server endpoint notice, engaging browser DoH fallback:', err);
  }

  // 2. Browser-side DNS-over-HTTPS fallback (Cloudflare Pages / Static host resilience)
  console.info(`[MX Batch Check] Resolving ${uniqueDomains.length} domains via client-side DNS-over-HTTPS (Cloudflare / DoH mode)...`);
  const clientResults: Record<string, { isLive: boolean; hasMx: boolean; mxHost?: string; error?: string }> = {};
  
  const CHUNK_SIZE = 5;
  for (let i = 0; i < uniqueDomains.length; i += CHUNK_SIZE) {
    const chunk = uniqueDomains.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (domain) => {
        try {
          const res = await resolveDomainMxClientSide(domain);
          clientResults[domain] = res;
        } catch (e: any) {
          clientResults[domain] = {
            isLive: false,
            hasMx: false,
            error: e?.message || 'Resolution failed'
          };
        }
      })
    );
  }

  return clientResults;
}

export interface AdvancedHygieneSummary {
  cleanEmails: string[];
  removedEmails: {
    email: string;
    category: NonBusinessCategory;
    reason?: string;
    matchedRule?: string;
  }[];
  counts: {
    total: number;
    clean: number;
    publicWebmail: number;
    bank: number;
    government: number;
    education: number;
    news: number;
    webmasterBot: number;
    computerGenerated: number;
    invalidSyntax: number;
    deadMx: number;
  };
}

/**
 * High-performance full queue hygiene scanner:
 * Checks public webmails, gov, edu, bank, junk, computer generated, syntax, AND live DNS MX records.
 */
export async function runFullQueueHygiene(
  emails: string[],
  options: BusinessFilterOptions & { checkLiveMx?: boolean },
  onProgress?: (progress: number, stage: string) => void
): Promise<AdvancedHygieneSummary> {
  const cleanEmails: string[] = [];
  const removedEmails: AdvancedHygieneSummary['removedEmails'] = [];

  const counts: AdvancedHygieneSummary['counts'] = {
    total: emails.length,
    clean: 0,
    publicWebmail: 0,
    bank: 0,
    government: 0,
    education: 0,
    news: 0,
    webmasterBot: 0,
    computerGenerated: 0,
    invalidSyntax: 0,
    deadMx: 0,
  };

  onProgress?.(15, 'Scanning syntax, public webmails, gov, edu, bank, junk & bot patterns...');

  // Phase 1: Client heuristics
  const survivingCandidates: string[] = [];

  for (const email of emails) {
    const res = classifyBusinessEmail(email, options);
    if (res.isBusiness) {
      survivingCandidates.push(email);
    } else {
      removedEmails.push({
        email,
        category: res.category as NonBusinessCategory,
        reason: res.reason,
        matchedRule: res.matchedRule,
      });

      switch (res.category) {
        case 'public_webmail': counts.publicWebmail++; break;
        case 'bank': counts.bank++; break;
        case 'government': counts.government++; break;
        case 'education': counts.education++; break;
        case 'news': counts.news++; break;
        case 'webmaster_bot': counts.webmasterBot++; break;
        case 'computer_generated': counts.computerGenerated++; break;
        case 'invalid': counts.invalidSyntax++; break;
        default: counts.invalidSyntax++; break;
      }
    }
  }

  // Phase 2: Live DNS MX Resolution (if requested)
  if (options.checkLiveMx !== false && survivingCandidates.length > 0) {
    onProgress?.(45, `Verifying live DNS MX records for ${survivingCandidates.length} domains...`);

    // Extract unique domains
    const domainToEmails = new Map<string, string[]>();
    for (const email of survivingCandidates) {
      const parts = email.split('@');
      if (parts[1]) {
        const d = parts[1].toLowerCase().trim();
        const existing = domainToEmails.get(d) || [];
        existing.push(email);
        domainToEmails.set(d, existing);
      }
    }

    const uniqueDomains = Array.from(domainToEmails.keys());
    
    // Batch query server in chunks of 50 domains
    const CHUNK_SIZE = 50;
    const mxResultsMap: Record<string, { isLive: boolean; hasMx: boolean; mxHost?: string; error?: string }> = {};

    for (let i = 0; i < uniqueDomains.length; i += CHUNK_SIZE) {
      const slice = uniqueDomains.slice(i, i + CHUNK_SIZE);
      const percent = Math.min(90, Math.round(45 + (i / uniqueDomains.length) * 45));
      onProgress?.(percent, `DNS MX queries in flight: ${i}/${uniqueDomains.length} domains checked...`);
      
      const batchResult = await checkDomainsMxBatch(slice);
      Object.assign(mxResultsMap, batchResult);
    }

    // Now evaluate surviving candidates against MX results
    for (const email of survivingCandidates) {
      const d = email.split('@')[1]?.toLowerCase().trim();
      const mxInfo = mxResultsMap[d];

      // If MX check explicitly failed (domain is dead / has no MX records)
      if (mxInfo && !mxInfo.isLive) {
        removedEmails.push({
          email,
          category: 'dead_mx',
          reason: mxInfo.error || 'No active DNS MX mail servers (Domain is dead/unresponsive)',
          matchedRule: `Dead MX: ${d}`,
        });
        counts.deadMx++;
      } else {
        cleanEmails.push(email);
        counts.clean++;
      }
    }
  } else {
    // No MX check requested, surviving candidates are clean
    for (const email of survivingCandidates) {
      cleanEmails.push(email);
      counts.clean++;
    }
  }

  onProgress?.(100, 'Queue hygiene audit complete.');

  return {
    cleanEmails,
    removedEmails,
    counts,
  };
}

export interface BusinessBatchFilterSummary {
  businessEmails: string[];
  excludedEmails: {
    email: string;
    category: NonBusinessCategory;
    reason?: string;
  }[];
  counts: {
    total: number;
    business: number;
    bank: number;
    government: number;
    education: number;
    news: number;
    webmaster_bot: number;
    public_webmail: number;
    invalid: number;
  };
}

/**
 * Filters a list of emails in bulk, separating business contacts from non-relevant emails.
 */
export function filterBusinessEmailsBulk(
  emails: string[], 
  options: BusinessFilterOptions = DEFAULT_BUSINESS_FILTER_OPTIONS
): BusinessBatchFilterSummary {
  const businessEmails: string[] = [];
  const excludedEmails: BusinessBatchFilterSummary['excludedEmails'] = [];

  const counts = {
    total: emails.length,
    business: 0,
    bank: 0,
    government: 0,
    education: 0,
    news: 0,
    webmaster_bot: 0,
    public_webmail: 0,
    invalid: 0
  };

  emails.forEach(email => {
    const res = classifyBusinessEmail(email, options);
    if (res.isBusiness) {
      businessEmails.push(email);
      counts.business++;
    } else {
      excludedEmails.push({
        email,
        category: res.category as NonBusinessCategory,
        reason: res.reason
      });
      if (res.category in counts) {
        (counts as any)[res.category]++;
      }
    }
  });

  return {
    businessEmails,
    excludedEmails,
    counts
  };
}

export interface CleanFilterConfig {
  removePublicEmails: boolean; // gmail, yahoo, hotmail, etc.
  removeBanks: boolean;        // banks & financial institutions
  removeJunkUsers: boolean;    // webmaster, user, admin, etc. (BUT leaves info, sales, order)
  removeGovEdu: boolean;       // .gov, .edu, .mil, .ac.*
  removeDuplicates: boolean;   // remove duplicate entries
}

export const DEFAULT_CLEAN_FILTER_CONFIG: CleanFilterConfig = {
  removePublicEmails: true,
  removeBanks: true,
  removeJunkUsers: true,
  removeGovEdu: true,
  removeDuplicates: true
};

export interface CleanEvaluationResult {
  isClean: boolean;
  category?: 'public_webmail' | 'bank' | 'government' | 'education' | 'webmaster_bot' | 'invalid' | 'duplicate';
  reason?: string;
  matchedRule?: string;
}

/**
 * Universal evaluator for emails, domains, and URLs following strict user rules:
 * - Removes public email domains (gmail, yahoo, etc.)
 * - Removes banks & financial institutions
 * - Removes junk email/user prefixes (webmaster, user, etc.) BUT strictly leaves info, sales, order!
 * - Removes .gov and .edu domains
 */
export function evaluateCleanTarget(
  target: string,
  config: CleanFilterConfig = DEFAULT_CLEAN_FILTER_CONFIG
): CleanEvaluationResult {
  const trimmed = (target || '').trim().replace(/^[<"'\(\[]+|[>"'\)\];,]+$/g, '');
  if (!trimmed) {
    return { isClean: false, category: 'invalid', reason: 'Empty target' };
  }

  // 1. Email format evaluation
  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    if (parts.length !== 2) {
      return { isClean: false, category: 'invalid', reason: 'Malformed email address' };
    }
    const user = parts[0].toLowerCase().trim();
    const domain = parts[1].toLowerCase().trim();

    if (!user || !domain || !domain.includes('.')) {
      return { isClean: false, category: 'invalid', reason: 'Incomplete email address' };
    }

    const isProtected = isProtectedBusinessUser(user);

    // Junk username check: webmaster, user, admin, bot, test, demo, etc. (Strictly preserved: info, sales, order)
    if (config.removeJunkUsers && !isProtected) {
      if (FORBIDDEN_USERNAMES.has(user)) {
        return {
          isClean: false,
          category: 'webmaster_bot',
          reason: `Junk email prefix ("${user}@") removed. (info, sales, order preserved)`,
          matchedRule: `Junk user "${user}"`
        };
      }
      if (
        user.includes('noreply') ||
        user.includes('no-reply') ||
        user.includes('donotreply') ||
        user.includes('do-not-reply') ||
        user.includes('newsletter') ||
        user.includes('bounce') ||
        user.startsWith('daemon')
      ) {
        return {
          isClean: false,
          category: 'webmaster_bot',
          reason: `Automated notification/junk address ("${user}@") removed`,
          matchedRule: `Automated pattern "${user}"`
        };
      }
      // Check attachment/computer generated prefixes
      if (JUNK_USER_PATTERNS.some(re => re.test(user))) {
        return {
          isClean: false,
          category: 'webmaster_bot',
          reason: `Attachment or scrap artifact ("${user}@") removed`,
          matchedRule: `Scrap pattern "${user}"`
        };
      }
    }

    // Public email check (e.g. @gmail.com, @yahoo.com)
    if (config.removePublicEmails && isPublicDomain(domain)) {
      return {
        isClean: false,
        category: 'public_webmail',
        reason: `Public webmail domain (@${domain}) removed`,
        matchedRule: `Public domain ${domain}`
      };
    }

    // Bank & Financial institutions check
    if (config.removeBanks) {
      if (domain.endsWith('.bank') || domain.endsWith('.creditunion') || EXACT_BANK_DOMAINS.has(domain)) {
        return {
          isClean: false,
          category: 'bank',
          reason: `Financial institution domain (@${domain}) removed`,
          matchedRule: `Bank domain ${domain}`
        };
      }
      if (BANK_KEYWORDS.some(kw => domain.includes(kw))) {
        return {
          isClean: false,
          category: 'bank',
          reason: `Bank/financial keyword in domain (@${domain}) removed`,
          matchedRule: `Bank keyword in ${domain}`
        };
      }
    }

    // Government & Military check (.gov, .mil, .gov.*)
    if (config.removeGovEdu) {
      const isGov = domain.endsWith('.gov') || domain.includes('.gov.') || domain.endsWith('.mil') || GOV_TLD_SUBSTRINGS.some(tld => domain.endsWith(tld) || domain.includes(tld));
      if (isGov || GOV_KEYWORDS.some(kw => domain.includes(kw))) {
        return {
          isClean: false,
          category: 'government',
          reason: `Government/military domain (@${domain}) removed (.gov/.mil)`,
          matchedRule: `Government domain ${domain}`
        };
      }

      // Education & Academic check (.edu, .ac.*, .edu.*)
      const isEdu = domain.endsWith('.edu') || domain.includes('.edu.') || EDU_TLD_SUBSTRINGS.some(tld => domain.endsWith(tld) || domain.includes(tld));
      if (isEdu || EDU_KEYWORDS.some(kw => domain.includes(kw))) {
        return {
          isClean: false,
          category: 'education',
          reason: `Educational institution domain (@${domain}) removed (.edu/.ac)`,
          matchedRule: `Education domain ${domain}`
        };
      }
    }

    return { isClean: true };
  }

  // 2. Domain or URL evaluation
  let domain = trimmed.toLowerCase();
  // Strip protocol
  domain = domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].split('?')[0].split('#')[0].trim();
  domain = domain.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');

  if (!domain || !domain.includes('.')) {
    return { isClean: false, category: 'invalid', reason: 'Invalid domain syntax' };
  }

  // Public webmail domain check
  if (config.removePublicEmails && isPublicDomain(domain)) {
    return {
      isClean: false,
      category: 'public_webmail',
      reason: `Public webmail/portal domain (${domain}) removed`,
      matchedRule: `Public domain ${domain}`
    };
  }

  // Bank & Financial institutions check
  if (config.removeBanks) {
    if (domain.endsWith('.bank') || domain.endsWith('.creditunion') || EXACT_BANK_DOMAINS.has(domain)) {
      return {
        isClean: false,
        category: 'bank',
        reason: `Banking/financial domain (${domain}) removed`,
        matchedRule: `Bank domain ${domain}`
      };
    }
    if (BANK_KEYWORDS.some(kw => domain.includes(kw))) {
      return {
        isClean: false,
        category: 'bank',
        reason: `Bank keyword in domain (${domain}) removed`,
        matchedRule: `Bank keyword in ${domain}`
      };
    }
  }

  // Government & Education check
  if (config.removeGovEdu) {
    const isGov = domain.endsWith('.gov') || domain.includes('.gov.') || domain.endsWith('.mil') || GOV_TLD_SUBSTRINGS.some(tld => domain.endsWith(tld) || domain.includes(tld));
    if (isGov || GOV_KEYWORDS.some(kw => domain.includes(kw))) {
      return {
        isClean: false,
        category: 'government',
        reason: `Government/military domain (${domain}) removed (.gov/.mil)`,
        matchedRule: `Government domain ${domain}`
      };
    }

    const isEdu = domain.endsWith('.edu') || domain.includes('.edu.') || EDU_TLD_SUBSTRINGS.some(tld => domain.endsWith(tld) || domain.includes(tld));
    if (isEdu || EDU_KEYWORDS.some(kw => domain.includes(kw))) {
      return {
        isClean: false,
        category: 'education',
        reason: `Educational institution domain (${domain}) removed (.edu/.ac)`,
        matchedRule: `Education domain ${domain}`
      };
    }
  }

  return { isClean: true };
}

export interface CleanAndDeduplicateResult {
  cleanTargets: string[];
  excludedTargets: { item: string; reason: string; category: string }[];
  counts: {
    total: number;
    clean: number;
    duplicates: number;
    publicWebmail: number;
    bank: number;
    junkUser: number;
    govEdu: number;
    invalid: number;
  };
}

/**
 * Filters and deduplicates any list of items (emails, domains, or URLs).
 * Produces a unified clean set and comprehensive breakdown.
 */
export function cleanAndDeduplicateTargets(
  targets: string[],
  config: CleanFilterConfig = DEFAULT_CLEAN_FILTER_CONFIG
): CleanAndDeduplicateResult {
  const cleanTargets: string[] = [];
  const excludedTargets: { item: string; reason: string; category: string }[] = [];
  const seen = new Set<string>();

  const counts = {
    total: targets.length,
    clean: 0,
    duplicates: 0,
    publicWebmail: 0,
    bank: 0,
    junkUser: 0,
    govEdu: 0,
    invalid: 0
  };

  for (const raw of targets) {
    const item = (raw || '').trim();
    if (!item) continue;

    const normalizedKey = item.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '');

    // Duplicate check
    if (config.removeDuplicates) {
      if (seen.has(normalizedKey)) {
        counts.duplicates++;
        excludedTargets.push({
          item,
          reason: 'Duplicate entry removed',
          category: 'duplicate'
        });
        continue;
      }
      seen.add(normalizedKey);
    }

    // Evaluation
    const evalResult = evaluateCleanTarget(item, config);
    if (evalResult.isClean) {
      cleanTargets.push(item);
      counts.clean++;
    } else {
      const cat = evalResult.category || 'invalid';
      if (cat === 'public_webmail') counts.publicWebmail++;
      else if (cat === 'bank') counts.bank++;
      else if (cat === 'webmaster_bot') counts.junkUser++;
      else if (cat === 'government' || cat === 'education') counts.govEdu++;
      else counts.invalid++;

      excludedTargets.push({
        item,
        reason: evalResult.reason || 'Filtered by clean criteria',
        category: cat
      });
    }
  }

  return {
    cleanTargets,
    excludedTargets,
    counts
  };
}
