import { SmtpConfig, EmailHeaderConfig, EmailComposerState } from '../types';

export interface ProviderPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  notes: string;
  userPlaceholder: string;
}

export const SMTP_PRESETS: ProviderPreset[] = [
  {
    id: 'gmail',
    name: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    notes: 'Requires 2-Step Verification + 16-character Google App Password (not your normal password).',
    userPlaceholder: 'yourname@gmail.com or workspace@domain.com',
  },
  {
    id: 'outlook',
    name: 'Microsoft 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    notes: 'Requires Authenticated SMTP (SMTP AUTH) enabled in M365 Admin Center for the user.',
    userPlaceholder: 'you@yourbusiness.com',
  },
  {
    id: 'ses',
    name: 'Amazon SES',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false,
    notes: 'Use IAM SES SMTP Credentials (not AWS Access Keys). Domain must be verified in SES.',
    userPlaceholder: 'AKIAIOSFODNN7EXAMPLE',
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    notes: 'Username is strictly "apikey". Password is your generated SendGrid API Key.',
    userPlaceholder: 'apikey',
  },
  {
    id: 'brevo',
    name: 'Brevo (Sendinblue)',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    notes: 'Get SMTP key from Brevo dashboard -> SMTP & API menu.',
    userPlaceholder: 'your-brevo-login@email.com',
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    notes: 'Use sending credentials from your Mailgun domain settings.',
    userPlaceholder: 'postmaster@yourdomain.mailgun.org',
  },
  {
    id: 'custom',
    name: 'Custom SMTP Server',
    host: '',
    port: 587,
    secure: false,
    notes: 'Specify your own dedicated mail relay, Postfix, Exim, cPanel, or corporate mail server.',
    userPlaceholder: 'user@yourmailserver.com',
  },
];

// Spam trigger phrases that hurt inbox deliverability
export const SPAM_TRIGGER_WORDS = [
  '100% free',
  'act now',
  'apply now',
  'become your own boss',
  'best price',
  'big bucks',
  'billion dollars',
  'bonus',
  'buy direct',
  'cash bonus',
  'cash prizes',
  'claim your discount',
  'click here',
  'click now',
  'congratulations',
  'credit card offers',
  'cure',
  'dear friend',
  'direct marketing',
  'double your income',
  'earn extra cash',
  'earn money',
  'eliminate debt',
  'exclusive deal',
  'expect to earn',
  'extra income',
  'fast cash',
  'financial freedom',
  'free consultation',
  'free gift',
  'free info',
  'free membership',
  'free money',
  'free sample',
  'free trial',
  'full refund',
  'get out of debt',
  'get paid',
  'giveaway',
  'guaranteed',
  'increase sales',
  'instant cash',
  'investment',
  'join millions',
  'limited time offer',
  'make money',
  'millionaire',
  'miracle',
  'money back',
  'no catch',
  'no cost',
  'no credit check',
  'no fees',
  'no gimmick',
  'no hidden costs',
  'no obligation',
  'no purchase necessary',
  'no risk',
  'no strings attached',
  'not spam',
  'once in a lifetime',
  'one time offer',
  'online pharmacy',
  'open immediately',
  'order now',
  'passwords',
  'pennies a day',
  'potential earnings',
  'prize',
  'promise you',
  'pure profit',
  'quote',
  'refund',
  'risk-free',
  'save big',
  'score',
  'secret',
  'see for yourself',
  'send $',
  'special promotion',
  'stop snoring',
  'terms and conditions',
  'this isn\'t spam',
  'unlimited',
  'urgent',
  'valuable',
  'viagra',
  'vicodin',
  'warranty',
  'weight loss',
  'while supplies last',
  'win',
  'winner',
  'winning',
  'you have been selected',
  'zero risk',
];

export interface SpamCheckResult {
  score: number; // 0 to 100 (higher = better deliverability)
  grade: 'Excellent' | 'Good' | 'Moderate' | 'Risky' | 'Spam Danger';
  flaggedWords: string[];
  warnings: string[];
  recommendations: string[];
}

export function analyzeDeliverability(
  subject: string,
  content: string,
  fromEmail: string,
  hasUnsubscribe: boolean,
  isHtml: boolean
): SpamCheckResult {
  const combined = `${subject} ${content}`.toLowerCase();
  const flaggedWords: string[] = [];

  for (const word of SPAM_TRIGGER_WORDS) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(combined)) {
      flaggedWords.push(word);
    }
  }

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Deduct for flagged spam words (5 pts each, max 35)
  const spamDeduction = Math.min(flaggedWords.length * 6, 36);
  score -= spamDeduction;
  if (flaggedWords.length > 0) {
    warnings.push(`Detected ${flaggedWords.length} spam-trigger phrases: "${flaggedWords.slice(0, 4).join('", "')}"${flaggedWords.length > 4 ? ` and ${flaggedWords.length - 4} more` : ''}.`);
    recommendations.push('Replace high-pressure sales jargon with neutral, professional business language.');
  }

  // Check subject line capitalization
  if (subject && subject.length > 5) {
    const uppercaseLetters = subject.replace(/[^A-Z]/g, '').length;
    const totalLetters = subject.replace(/[^a-zA-Z]/g, '').length;
    if (totalLetters > 0 && uppercaseLetters / totalLetters > 0.4) {
      score -= 15;
      warnings.push('Subject contains excessive ALL-CAPS text (triggers spam filters).');
      recommendations.push('Use sentence case or title case in subject lines.');
    }
    if (subject.includes('!!!') || subject.includes('???') || subject.includes('$$$')) {
      score -= 10;
      warnings.push('Subject contains repeated exclamation or punctuation marks.');
    }
  } else if (!subject) {
    score -= 20;
    warnings.push('Email is missing a subject line.');
  }

  // Check unsubscribe compliance
  if (!hasUnsubscribe) {
    score -= 12;
    warnings.push('No List-Unsubscribe header or unsubscribe link detected.');
    recommendations.push('Google & Yahoo require easy 1-click unsubscribe for high inbox reputation.');
  }

  // Check From address validity
  if (!fromEmail || !fromEmail.includes('@')) {
    score -= 15;
    warnings.push('Sender "From" address is invalid or missing.');
  }

  // Check HTML-to-text balance if HTML
  if (isHtml) {
    const plainTextLen = content.replace(/<[^>]+>/g, '').trim().length;
    if (plainTextLen < 30) {
      score -= 15;
      warnings.push('HTML contains almost no readable text (image-only or thin content).');
      recommendations.push('Include informative paragraphs of text alongside any HTML formatting.');
    }
  }

  score = Math.max(10, Math.min(100, score));

  let grade: 'Excellent' | 'Good' | 'Moderate' | 'Risky' | 'Spam Danger' = 'Excellent';
  if (score >= 90) grade = 'Excellent';
  else if (score >= 75) grade = 'Good';
  else if (score >= 60) grade = 'Moderate';
  else if (score >= 40) grade = 'Risky';
  else grade = 'Spam Danger';

  if (recommendations.length === 0) {
    recommendations.push('Content complies with clean B2B transactional & outreach standards.');
  }

  return {
    score,
    grade,
    flaggedWords,
    warnings,
    recommendations,
  };
}

export function substituteTemplateVariables(
  template: string,
  recipient: { email: string; name?: string; company?: string }
): string {
  const email = recipient.email || '';
  const domain = email.includes('@') ? email.split('@')[1] : '';
  const user = email.includes('@') ? email.split('@')[0] : '';
  
  // Format clean fallback name
  const derivedName = recipient.name || user.replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const derivedCompany = recipient.company || (domain ? domain.split('.')[0].replace(/\b\w/g, l => l.toUpperCase()) : 'your team');

  return template
    .replace(/\{\{\s*email\s*\}\}/gi, email)
    .replace(/\{\{\s*name\s*\}\}/gi, derivedName)
    .replace(/\{\{\s*company\s*\}\}/gi, derivedCompany)
    .replace(/\{\{\s*domain\s*\}\}/gi, domain);
}

export const EMAIL_TEMPLATES = [
  {
    id: 'b2b-cold',
    name: 'High-Deliverability B2B Outreach (Plain Text)',
    description: 'Clean text format with 99%+ deliverability. No bloated styles or spam signals.',
    bodyMode: 'plain' as const,
    subject: 'Partnership opportunity with {{company}}',
    content: `Hi {{name}},

I came across {{company}} while reviewing leaders in your industry and was impressed by your work.

We provide dedicated solutions that help companies streamline their operations and increase commercial efficiency. 

Would you have 10 minutes this Thursday or Friday for a quick intro call to see if there is potential alignment?

Best regards,
{{sender_name}}
{{sender_organization}}

If you prefer not to receive further updates, simply reply "Unsubscribe" to this email.`,
  },
  {
    id: 'executive-inquiry',
    name: 'Formal Executive Inquiry',
    description: 'Direct inquiry targeted at leadership, CEOs, and procurement directors.',
    bodyMode: 'plain' as const,
    subject: 'Brief inquiry regarding {{company}}\'s supply chain',
    content: `Dear {{name}},

I am reaching out to discuss potential supplier collaboration with {{company}}.

We specialize in high-volume, verified distribution and manufacturing support with international compliance.

Could you point me to the appropriate director in charge of procurement or strategic partnerships?

Thank you for your time and guidance.

Sincerely,
{{sender_name}}
{{sender_organization}}`,
  },
  {
    id: 'html-modern',
    name: 'Modern Clean HTML Announcement',
    description: 'Responsive, lightweight HTML design tested across Gmail, Outlook, and Apple Mail.',
    bodyMode: 'html' as const,
    subject: 'Important business update for {{company}}',
    content: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Business Update</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden;">
    <tr>
      <td style="padding: 32px 32px 24px 32px; border-bottom: 2px solid #3b82f6;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Executive Briefing for {{company}}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding: 24px 32px; font-size: 15px; line-height: 1.6; color: #334155;">
        <p style="margin-top: 0;">Hello <strong>{{name}}</strong>,</p>
        <p>We are pleased to introduce our specialized services designed to help enterprise teams at <strong>{{company}}</strong> scale their operations with high reliability.</p>
        <p>Our infrastructure delivers verified outcomes, compliant data governance, and priority response times for all clients.</p>
        <div style="margin: 28px 0; text-align: center;">
          <a href="https://{{domain}}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">Schedule 15-Min Consultation</a>
        </div>
        <p style="margin-bottom: 0;">Warm regards,<br><strong>{{sender_name}}</strong><br>{{sender_organization}}</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
        <p style="margin: 0 0 8px 0;">This email was sent to {{email}} because of your affiliation with {{company}}.</p>
        <p style="margin: 0;"><a href="mailto:{{sender_from}}?subject=Unsubscribe" style="color: #64748b; text-decoration: underline;">Unsubscribe from communications</a></p>
      </td>
    </tr>
  </table>
</body>
</html>`,
  },
  {
    id: 'follow-up',
    name: 'Polite Follow-up Note',
    description: 'Short follow-up sequence with high response rate.',
    bodyMode: 'plain' as const,
    subject: 'Following up: {{company}} consultation',
    content: `Hi {{name}},

I wanted to quickly follow up on my previous note to see if you had a chance to review our collaboration proposal for {{company}}.

I understand you are busy, so if another team member handles this, I would greatly appreciate an introduction.

Thank you!

Best,
{{sender_name}}`,
  },
];
