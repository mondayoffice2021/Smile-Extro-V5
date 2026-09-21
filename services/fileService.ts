import * as XLSX from 'xlsx';
import { streamExtractEmailsFromFile, StreamParserOptions, StreamProgressStats } from './streamingFileParser';

export * from './streamingFileParser';

/**
 * Extracts emails from a string using a robust regex.
 * Filters out common junk patterns like image001.gif, part1, etc.
 */
export const extractEmailsFromString = (
  text: string,
  options?: { preserveRoleAccounts?: boolean }
): string[] => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  
  if (!matches) return [];

  const junkPrefixes = ['image', 'part', 'attachment', 'frame', 'thumb', 'clip', 'img', 'file'];
  const fileExtensions = ['.gif', '.jpg', '.jpeg', '.png', '.bmp', '.svg', '.pdf', '.doc', '.docx', '.zip', '.rar'];
  const forbiddenUsernames = new Set(['postmaster', 'privacy', 'webmaster', 'abuse', 'mailer-daemon', 'root', 'admin', 'administrator']);

  return Array.from(new Set(matches.map(e => e.toLowerCase()))).filter(email => {
    const [user] = email.split('@');
    
    // Filter out forbidden role-based usernames or anything related to noreply/news unless preserved
    if (!options?.preserveRoleAccounts) {
      if (forbiddenUsernames.has(user) || 
          user.includes('noreply') || 
          user.includes('no-reply') || 
          user.includes('news') || 
          user.includes('newsletter')) return false;
    }
    
    // Filter out usernames that are just junk prefixes followed by numbers
    const isJunkPrefix = junkPrefixes.some(prefix => {
      const regex = new RegExp(`^${prefix}\\d+`, 'i');
      return regex.test(user);
    });
    
    // Filter out usernames that end in common file extensions
    const isFile = fileExtensions.some(ext => user.endsWith(ext));
    
    // Filter out UUIDs
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user);

    return !isJunkPrefix && !isFile && !isUUID;
  });
};

/**
 * Reads a file and extracts all emails found within it.
 * Uses streaming chunk parser for files > 2MB or when streaming options are provided.
 * Supports .txt, .csv, .xlsx, .xls
 */
export const extractEmailsFromFile = async (
  file: File,
  options?: StreamParserOptions
): Promise<string[]> => {
  // If file is bulky (> 2MB) or streaming options provided, use thread-safe stream parser
  if (file.size > 2 * 1024 * 1024 || options?.onProgress || options?.signal) {
    const result = await streamExtractEmailsFromFile(file, options);
    return result.emails;
  }

  const extension = file.name.split('.').pop()?.toLowerCase();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          resolve([]);
          return;
        }

        let text = '';

        if (extension === 'xlsx' || extension === 'xls') {
          const workbook = XLSX.read(data, { type: 'binary' });
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            // Convert to CSV to easily extract text
            text += XLSX.utils.sheet_to_csv(worksheet) + '\n';
          });
        } else {
          // For .txt and .csv, we treat as text
          text = data as string;
        }

        resolve(extractEmailsFromString(text, { preserveRoleAccounts: options?.preserveRoleAccounts }));
      } catch (error) {
        console.error("Error parsing file:", error);
        reject(new Error("Failed to parse file. Please ensure it's a valid text, CSV, or Excel file."));
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file."));
    };

    if (extension === 'xlsx' || extension === 'xls') {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsText(file);
    }
  });
};

export interface MXFileExtractResult {
  items: string[];
  totalUnique: number;
  emailsCount: number;
  domainsCount: number;
  fileName: string;
  fileSize: number;
  fileType: 'excel' | 'csv' | 'txt' | 'other';
}

/**
 * Extracts emails and standalone domains from uploaded Excel (.xlsx, .xls), CSV (.csv, .cvs), or TXT (.txt) files.
 * Preserves user contacts (including role accounts) and parses tabular spreadsheet columns.
 */
export const extractTargetsForMXFromFile = async (file: File): Promise<MXFileExtractResult> => {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const isExcel = ext === 'xlsx' || ext === 'xls';
  const isCsv = ext === 'csv' || ext === 'cvs';
  const isTxt = ext === 'txt' || ext === 'text';

  const fileType: 'excel' | 'csv' | 'txt' | 'other' = isExcel 
    ? 'excel' 
    : isCsv 
    ? 'csv' 
    : isTxt 
    ? 'txt' 
    : 'other';

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          resolve({
            items: [],
            totalUnique: 0,
            emailsCount: 0,
            domainsCount: 0,
            fileName: file.name,
            fileSize: file.size,
            fileType
          });
          return;
        }

        let rawText = '';

        if (isExcel) {
          const workbook = XLSX.read(data, { type: 'array' });
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            rawText += XLSX.utils.sheet_to_csv(worksheet) + '\n';
          });
        } else {
          rawText = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data as ArrayBuffer);
        }

        // 1. Extract valid emails (preserving legitimate mailbox usernames)
        const emails = extractEmailsFromString(rawText, { preserveRoleAccounts: true });
        const emailSet = new Set(emails);

        // 2. Extract standalone domains (from CSV columns or text lines that only contain domain/URL)
        const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
        const ignoredExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'zip', 'rar', 'tar', 'gz', 'mp3', 'mp4', 'exe', 'dmg', 'apk', 'iso', 'csv', 'xlsx', 'xls', 'txt', 'json', 'xml', 'css', 'js', 'html', 'htm']);

        const tokens = rawText
          .split(/[\r\n\t,;"']|\s+/)
          .map(t => t.trim())
          .filter(Boolean);

        const standaloneDomains = new Set<string>();

        tokens.forEach(tok => {
          if (tok.includes('@')) return; // Already handled by email extractor
          
          // Clean token (strip http://, https://, www., trailing slash or path)
          let cleaned = tok.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0].split('?')[0].split('#')[0].toLowerCase().trim();
          
          // Remove enclosing punctuation
          cleaned = cleaned.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');

          if (cleaned && domainPattern.test(cleaned)) {
            const tld = cleaned.split('.').pop() || '';
            if (!ignoredExtensions.has(tld) && cleaned.length <= 120 && cleaned.includes('.')) {
              standaloneDomains.add(cleaned);
            }
          }
        });

        const allItems = Array.from(new Set([...emailSet, ...standaloneDomains]));

        resolve({
          items: allItems,
          totalUnique: allItems.length,
          emailsCount: emailSet.size,
          domainsCount: standaloneDomains.size,
          fileName: file.name,
          fileSize: file.size,
          fileType
        });
      } catch (err: any) {
        console.error("Error extracting targets for MX from file:", err);
        reject(new Error(`Failed to parse ${file.name}: ${err?.message || 'Unsupported file structure'}`));
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
