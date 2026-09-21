import { safeFetchJson } from './safeFetch';

export interface SupplyChainContact {
  companyName: string;
  websiteUrl?: string;
  type: 'Manufacturer' | 'Brand' | 'Supplier' | 'Distributor' | 'Partner' | 'Reseller' | string;
  country: string;
  ceoName: string;
  ceoEmail: string;
  emailStatus: 'found' | 'derived';
  isVerified?: boolean;
  distributesFor?: string;
  sourceUrl?: string;
  role?: string;
}

/**
 * Native Direct Supply Chain & Executive Search
 * Discovers brand leadership and distributors via direct web search & corporate pattern intelligence.
 */
export async function researchSupplyChain(query: string, country?: string): Promise<SupplyChainContact[]> {
  try {
    const res = await safeFetchJson<any>('/api/ceo-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        country: country || 'All'
      })
    });

    if (!res.ok || !res.data) {
      throw new Error(res.error || `Server returned status ${res.status}`);
    }

    return (res.data.contacts || []) as SupplyChainContact[];
  } catch (error: any) {
    console.error("Native Supply Chain Research error:", error);
    
    // Graceful offline fallback if server search was interrupted
    const clean = query.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
    const targetDomain = clean.includes('.') ? clean : `${clean.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const compName = clean.split('.')[0];

    return [
      {
        companyName: compName.charAt(0).toUpperCase() + compName.slice(1),
        websiteUrl: `https://${targetDomain}`,
        type: 'Manufacturer',
        country: country !== 'All' && country ? country : 'Global',
        ceoName: `Executive Office (${targetDomain})`,
        role: 'Chief Executive Officer (CEO)',
        ceoEmail: `ceo@${targetDomain}`,
        emailStatus: 'derived',
        isVerified: false,
        sourceUrl: `https://${targetDomain}`
      }
    ];
  }
}

/**
 * 100% Original Distributor Search
 */
export async function researchDistributorsForCompany(manufacturerName: string): Promise<SupplyChainContact[]> {
  return researchSupplyChain(`${manufacturerName} authorized distributors`, 'All');
}

/**
 * Deterministic Executive Email Pattern Generator
 * Generates professional email addresses with zero rate limits or token exhaustion.
 */
export async function generateCeoEmailPattern(ceoName: string, companyWebsite?: string): Promise<string> {
  if (!ceoName || !companyWebsite) return '';

  const cleanDomain = companyWebsite.toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .split('/')[0]
    .trim();

  if (!cleanDomain || !cleanDomain.includes('.')) return '';

  const nameParts = ceoName.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) return `ceo@${cleanDomain}`;

  const first = nameParts[0].toLowerCase().replace(/[^a-z]/g, '');
  const last = nameParts.length > 1 ? nameParts[nameParts.length - 1].toLowerCase().replace(/[^a-z]/g, '') : '';

  if (first && last) {
    return `${first}.${last}@${cleanDomain}`;
  }
  if (first) {
    return `${first}@${cleanDomain}`;
  }

  return `ceo@${cleanDomain}`;
}

/**
 * Single Executive Lookup
 */
export async function researchSingleCompanyExecutive(companyOrUrl: string, country?: string): Promise<SupplyChainContact> {
  const contacts = await researchSupplyChain(companyOrUrl, country);
  if (contacts.length > 0) {
    return contacts[0];
  }

  const clean = companyOrUrl.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
  const targetDomain = clean.includes('.') ? clean : `${clean.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
  const compName = clean.split('.')[0];

  return {
    companyName: compName.charAt(0).toUpperCase() + compName.slice(1),
    websiteUrl: `https://${targetDomain}`,
    type: 'Brand',
    country: country && country !== 'All' ? country : 'Global',
    ceoName: `Corporate Leadership`,
    role: 'CEO / Managing Director',
    ceoEmail: `ceo@${targetDomain}`,
    emailStatus: 'derived',
    isVerified: false,
    sourceUrl: `https://${targetDomain}`
  };
}
