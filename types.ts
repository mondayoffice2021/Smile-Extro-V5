export interface ExtractedEmail {
  email: string;
  sourceUrl: string;
  companyName?: string;
  country?: string;
  isValid?: boolean;
}

export interface CompanyIntel {
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
  emails: string[];
}

export interface IndustryGroupIntel {
  industry: string;
  emails: string[];
  companies: CompanyIntel[];
}

export interface ProductGroupIntel {
  productCategory: string;
  emails: string[];
  companies: CompanyIntel[];
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  preset?: string;
}

export interface EmailHeaderConfig {
  senderName: string;
  fromEmail: string;
  replyTo: string;
  cc: string;
  bcc: string;
  listUnsubscribe: string;
  organization: string;
  precedence: string;
  priority: 'normal' | 'high' | 'low';
  customMessageId: boolean;
}

export interface EmailComposerState {
  subject: string;
  bodyMode: 'plain' | 'html';
  plainText: string;
  htmlContent: string;
}

export interface RecipientItem {
  id: string;
  email: string;
  name?: string;
  company?: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  timestamp?: string;
  messageId?: string;
  error?: string;
  response?: string;
  latencyMs?: number;
}

export interface DeliverabilityAudit {
  domain: string;
  hasMx: boolean;
  mxRecords: string[];
  hasSpf: boolean;
  spfRecord?: string;
  hasDmarc: boolean;
  dmarcRecord?: string;
  dmarcPolicy?: string;
  score: number;
  recommendations: string[];
}

