export const PUBLIC_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Yahoo
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.es', 'yahoo.it', 'yahoo.de', 
  'yahoo.com.br', 'yahoo.com.ar', 'yahoo.com.mx', 'yahoo.co.jp', 'yahoo.com.au', 'yahoo.com.ph', 'yahoo.co.in', 'yahoo.ca',
  // Microsoft
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.es', 'hotmail.it', 'hotmail.de',
  'outlook.com', 'outlook.co.uk', 'outlook.fr', 'outlook.es', 'outlook.de', 'outlook.jp', 'outlook.com.au',
  'live.com', 'live.co.uk', 'live.fr', 'live.it', 'live.de', 'live.ca', 'windowslive.com', 'msn.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // AOL
  'aol.com', 'aim.com', 'aol.co.uk', 'aol.de',
  // Privacy Webmails
  'protonmail.com', 'proton.me', 'pm.me', 'tutanota.com', 'tuta.io', 'tuta.com', 'mailfence.com',
  // Zoho & Mail.com
  'zoho.com', 'zohomail.com', 'mail.com', 'email.com', 'usa.com',
  // German & Central European
  'gmx.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'web.de', 'freenet.de', 't-online.de', 'posteo.de',
  // Russian
  'yandex.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'rambler.ru', 'list.ru', 'bk.ru', 'inbox.ru',
  // Italian
  'libero.it', 'virgilio.it', 'alice.it', 'tin.it', 'fastwebnet.it',
  // French
  'wanadoo.fr', 'orange.fr', 'sfr.fr', 'free.fr', 'laposte.net', 'numericable.fr', 'neuf.fr',
  // North American ISPs & Telcos
  'comcast.net', 'sbcglobal.net', 'verizon.net', 'att.net', 'bellsouth.net', 'cox.net', 'charter.net',
  'earthlink.net', 'optonline.net', 'frontier.com', 'windstream.net', 'centurytel.net',
  // Canadian Telcos
  'shaw.ca', 'rogers.com', 'sympatico.ca', 'telus.net', 'bell.net',
  // UK ISPs
  'btinternet.com', 'virginmedia.com', 'sky.com', 'talktalk.net', 'plus.net',
  // Latin America
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com',
  // Asian Webmails (China, Korea, Japan, India)
  'qq.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sina.cn', 'sohu.com', 'aliyun.com', 'foxmail.com',
  'naver.com', 'daum.net', 'hanmail.net', 'nate.com',
  'rediffmail.com', 'indiatimes.com',
  // Polish & Eastern Europe
  'wp.pl', 'onet.pl', 'interia.pl', 'o2.pl', 'seznam.cz', 'centrum.cz', 'abv.bg', 'mail.bg', 'ukr.net', 'i.ua',
  // Consumer shopping domains
  'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.in', 'amazon.ca'
]);

/**
 * Checks if a domain is a public/consumer domain, including subdomains.
 */
export const isPublicDomain = (domain: string): boolean => {
  const d = domain.toLowerCase();
  if (PUBLIC_DOMAINS.has(d)) return true;
  
  // Check if it's a subdomain of a public domain (e.g., mail.gmail.com)
  for (const publicDomain of PUBLIC_DOMAINS) {
    if (d.endsWith('.' + publicDomain)) return true;
  }
  
  return false;
};
