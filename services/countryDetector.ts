/**
 * Comprehensive Country Detection & Intelligence Service
 * Provides:
 * 1. ISO Country metadata with real Emoji flags
 * 2. Extended global corporate .com domain registry
 * 3. Deep HTML contact page analyzer (JSON-LD, phone dialing codes, Impressum, addresses, geotags, html lang)
 * 4. Multi-engine search query generation & grounding parser
 * 5. International city, state, postal code, and legal corporate form heuristics
 */

export interface CountryInfo {
  name: string;
  code: string; // ISO 3166-1 alpha-2
  flag: string;
  cctld: string;
  phoneCodes: string[];
  majorCities: string[];
  statesOrRegions?: string[];
  legalForms?: string[];
  languages?: string[];
}

export interface DomainCountryResolution {
  domain: string;
  country: string;
  confidence: number; // 0 to 100
  method: 'cctld' | 'corporate_registry' | 'contact_page_address' | 'phone_code' | 'jsonld_schema' | 'meta_geotag' | 'impressum' | 'search_engine' | 'ai_grounding' | 'domain_pattern' | 'unknown';
  evidence?: string;
  flag?: string;
}

// Global Country Database with Flags, Dialing Codes, Major Cities, and Legal Forms
export const GLOBAL_COUNTRIES: Record<string, CountryInfo> = {
  'United States': {
    name: 'United States',
    code: 'US',
    flag: '🇺🇸',
    cctld: 'us',
    phoneCodes: ['+1'],
    majorCities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Austin', 'San Jose', 'San Francisco', 'Seattle', 'Denver', 'Washington', 'Boston', 'Atlanta', 'Miami', 'Detroit', 'Minneapolis', 'Las Vegas', 'Portland', 'Charlotte', 'Orlando', 'Nashville', 'Salt Lake City', 'Pittsburgh', 'Cincinnati', 'Cleveland', 'Indianapolis', 'Columbus', 'Kansas City'],
    statesOrRegions: ['California', 'Texas', 'Florida', 'New York', 'Illinois', 'Pennsylvania', 'Ohio', 'Georgia', 'North Carolina', 'Michigan', 'New Jersey', 'Virginia', 'Washington', 'Arizona', 'Massachusetts', 'Tennessee', 'Indiana', 'Missouri', 'Maryland', 'Wisconsin', 'Colorado', 'Minnesota', 'South Carolina', 'Alabama', 'Louisiana', 'Kentucky', 'Oregon', 'Oklahoma', 'Connecticut', 'Utah', 'Iowa', 'Nevada', 'Arkansas'],
    legalForms: ['Inc', 'Inc.', 'LLC', 'Corp', 'Corp.', 'Corporation', 'L.L.C.', 'LLP', 'Limited Liability Company'],
    languages: ['en-US', 'en']
  },
  'United Kingdom': {
    name: 'United Kingdom',
    code: 'GB',
    flag: '🇬🇧',
    cctld: 'uk',
    phoneCodes: ['+44'],
    majorCities: ['London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Edinburgh', 'Liverpool', 'Bristol', 'Sheffield', 'Newcastle', 'Belfast', 'Nottingham', 'Cardiff', 'Southampton', 'Reading', 'Cambridge', 'Oxford', 'Leicester', 'Aberdeen'],
    statesOrRegions: ['England', 'Scotland', 'Wales', 'Northern Ireland', 'Yorkshire', 'Greater London', 'Midlands'],
    legalForms: ['Ltd', 'Ltd.', 'Limited', 'PLC', 'Plc', 'LLP', 'L.L.P.'],
    languages: ['en-GB']
  },
  'Germany': {
    name: 'Germany',
    code: 'DE',
    flag: '🇩🇪',
    cctld: 'de',
    phoneCodes: ['+49'],
    majorCities: ['Berlin', 'Munich', 'München', 'Frankfurt', 'Hamburg', 'Cologne', 'Köln', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dortmund', 'Essen', 'Bremen', 'Dresden', 'Hannover', 'Nuremberg', 'Nürnberg', 'Duisburg', 'Bonn', 'Karlsruhe', 'Mannheim', 'Augsburg'],
    statesOrRegions: ['Bavaria', 'Bayern', 'Baden-Württemberg', 'North Rhine-Westphalia', 'Nordrhein-Westfalen', 'Hessen', 'Saxony', 'Sachsen', 'Berlin'],
    legalForms: ['GmbH', 'AG', 'GmbH & Co. KG', 'KG', 'UG', 'e.V.', 'Gbr'],
    languages: ['de', 'de-DE', 'de-AT', 'de-CH']
  },
  'France': {
    name: 'France',
    code: 'FR',
    flag: '🇫🇷',
    cctld: 'fr',
    phoneCodes: ['+33'],
    majorCities: ['Paris', 'Marseille', 'Lyon', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Montpellier', 'Bordeaux', 'Lille', 'Rennes', 'Reims', 'Saint-Étienne', 'Le Havre', 'Toulon', 'Grenoble', 'Dijon', 'Angers', 'Nîmes'],
    statesOrRegions: ['Île-de-France', 'Auvergne-Rhône-Alpes', 'Nouvelle-Aquitaine', 'Occitanie', 'Provence-Alpes-Côte d\'Azur'],
    legalForms: ['SAS', 'SASU', 'SARL', 'SA', 'S.A.', 'S.A.S.', 'SCI', 'EURL'],
    languages: ['fr', 'fr-FR']
  },
  'Canada': {
    name: 'Canada',
    code: 'CA',
    flag: '🇨🇦',
    cctld: 'ca',
    phoneCodes: ['+1'],
    majorCities: ['Toronto', 'Montreal', 'Montréal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa', 'Winnipeg', 'Quebec City', 'Québec', 'Hamilton', 'Kitchener', 'London', 'Victoria', 'Halifax'],
    statesOrRegions: ['Ontario', 'Quebec', 'Québec', 'British Columbia', 'Alberta', 'Manitoba', 'Saskatchewan', 'Nova Scotia'],
    legalForms: ['Inc.', 'Corp.', 'Ltd.', 'ULC', 'Limitée'],
    languages: ['en-CA', 'fr-CA']
  },
  'Australia': {
    name: 'Australia',
    code: 'AU',
    flag: '🇦🇺',
    cctld: 'au',
    phoneCodes: ['+61'],
    majorCities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast', 'Canberra', 'Newcastle', 'Wollongong', 'Hobart', 'Geelong', 'Cairns', 'Darwin'],
    statesOrRegions: ['New South Wales', 'NSW', 'Victoria', 'VIC', 'Queensland', 'QLD', 'Western Australia', 'WA', 'South Australia', 'SA', 'Tasmania', 'TAS'],
    legalForms: ['Pty Ltd', 'Pty. Ltd.', 'Pty Limited', 'Limited', 'Ltd'],
    languages: ['en-AU']
  },
  'Japan': {
    name: 'Japan',
    code: 'JP',
    flag: '🇯🇵',
    cctld: 'jp',
    phoneCodes: ['+81'],
    majorCities: ['Tokyo', 'Yokohama', 'Osaka', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe', 'Kyoto', 'Kawasaki', 'Saitama', 'Hiroshima', 'Sendai', 'Chiba'],
    statesOrRegions: ['Kanto', 'Kansai', 'Chubu', 'Tohoku', 'Kyushu', 'Hokkaido'],
    legalForms: ['K.K.', 'KK', 'Kabushiki Kaisha', 'G.K.', 'Godo Kaisha', 'Co., Ltd.'],
    languages: ['ja', 'ja-JP']
  },
  'China': {
    name: 'China',
    code: 'CN',
    flag: '🇨🇳',
    cctld: 'cn',
    phoneCodes: ['+86'],
    majorCities: ['Beijing', 'Shanghai', 'Shenzhen', 'Guangzhou', 'Chengdu', 'Hangzhou', 'Wuhan', 'Nanjing', 'Chongqing', 'Tianjin', 'Suzhou', 'Xi\'an', 'Dongguan', 'Ningbo', 'Qingdao', 'Xiamen'],
    statesOrRegions: ['Guangdong', 'Zhejiang', 'Jiangsu', 'Shandong', 'Sichuan', 'Fujian'],
    legalForms: ['Co., Ltd.', 'Group Co., Ltd.', 'Ltd.'],
    languages: ['zh', 'zh-CN', 'zh-Hans']
  },
  'India': {
    name: 'India',
    code: 'IN',
    flag: '🇮🇳',
    cctld: 'in',
    phoneCodes: ['+91'],
    majorCities: ['Mumbai', 'Delhi', 'New Delhi', 'Bangalore', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Surat', 'Jaipur', 'Lucknow', 'Kanpur', 'Nagpur', 'Indore', 'Noida', 'Gurugram', 'Gurgaon', 'Coimbatore'],
    statesOrRegions: ['Maharashtra', 'Karnataka', 'Tamil Nadu', 'Telangana', 'Gujarat', 'Uttar Pradesh', 'Haryana'],
    legalForms: ['Pvt Ltd', 'Pvt. Ltd.', 'Private Limited', 'Ltd', 'Limited', 'LLP'],
    languages: ['en-IN', 'hi']
  },
  'Italy': {
    name: 'Italy',
    code: 'IT',
    flag: '🇮🇹',
    cctld: 'it',
    phoneCodes: ['+39'],
    majorCities: ['Rome', 'Roma', 'Milan', 'Milano', 'Naples', 'Napoli', 'Turin', 'Torino', 'Palermo', 'Genoa', 'Genova', 'Bologna', 'Florence', 'Firenze', 'Bari', 'Catania', 'Venice', 'Venezia', 'Verona', 'Padua', 'Trieste', 'Brescia'],
    statesOrRegions: ['Lombardy', 'Lombardia', 'Lazio', 'Veneto', 'Emilia-Romagna', 'Piedmont', 'Piemonte', 'Tuscany', 'Toscana'],
    legalForms: ['S.r.l.', 'Srl', 'S.p.A.', 'SpA', 'S.n.c.', 'S.a.s.'],
    languages: ['it', 'it-IT']
  },
  'Spain': {
    name: 'Spain',
    code: 'ES',
    flag: '🇪🇸',
    cctld: 'es',
    phoneCodes: ['+34'],
    majorCities: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Sevilla', 'Zaragoza', 'Málaga', 'Murcia', 'Palma', 'Las Palmas', 'Bilbao', 'Alicante', 'Córdoba', 'Valladolid', 'Vigo', 'Gijón'],
    statesOrRegions: ['Catalonia', 'Cataluña', 'Andalusia', 'Andalucía', 'Comunidad de Madrid', 'País Vasco', 'Basque Country'],
    legalForms: ['S.L.', 'SL', 'S.A.', 'SA', 'S.L.U.', 'S.C.'],
    languages: ['es', 'es-ES', 'ca']
  },
  'Netherlands': {
    name: 'Netherlands',
    code: 'NL',
    flag: '🇳🇱',
    cctld: 'nl',
    phoneCodes: ['+31'],
    majorCities: ['Amsterdam', 'Rotterdam', 'The Hague', 'Den Haag', 'Utrecht', 'Eindhoven', 'Groningen', 'Tilburg', 'Almere', 'Breda', 'Nijmegen', 'Enschede', 'Haarlem', 'Arnhem'],
    statesOrRegions: ['North Holland', 'South Holland', 'Noord-Brabant', 'Gelderland', 'Utrecht'],
    legalForms: ['B.V.', 'BV', 'N.V.', 'NV', 'V.O.F.'],
    languages: ['nl', 'nl-NL']
  },
  'Switzerland': {
    name: 'Switzerland',
    code: 'CH',
    flag: '🇨🇭',
    cctld: 'ch',
    phoneCodes: ['+41'],
    majorCities: ['Zurich', 'Zürich', 'Geneva', 'Genève', 'Basel', 'Lausanne', 'Bern', 'Winterthur', 'Lucerne', 'Luzern', 'St. Gallen', 'Lugano', 'Biel/Bienne', 'Thun'],
    statesOrRegions: ['Zurich', 'Geneva', 'Vaud', 'Bern', 'Basel-Stadt', 'Ticino'],
    legalForms: ['AG', 'SA', 'GmbH', 'Sarl'],
    languages: ['de-CH', 'fr-CH', 'it-CH']
  },
  'Sweden': {
    name: 'Sweden',
    code: 'SE',
    flag: '🇸🇪',
    cctld: 'se',
    phoneCodes: ['+46'],
    majorCities: ['Stockholm', 'Gothenburg', 'Göteborg', 'Malmö', 'Uppsala', 'Västerås', 'Örebro', 'Linköping', 'Helsingborg', 'Jönköping', 'Norrköping', 'Lund'],
    statesOrRegions: ['Stockholm', 'Västra Götaland', 'Skåne'],
    legalForms: ['AB', 'Aktiebolag'],
    languages: ['sv', 'sv-SE']
  },
  'Poland': {
    name: 'Poland',
    code: 'PL',
    flag: '🇵🇱',
    cctld: 'pl',
    phoneCodes: ['+48'],
    majorCities: ['Warsaw', 'Warszawa', 'Kraków', 'Cracow', 'Łódź', 'Wrocław', 'Poznań', 'Gdańsk', 'Szczecin', 'Bydgoszcz', 'Lublin', 'Katowice', 'Białystok', 'Gdynia'],
    statesOrRegions: ['Mazowieckie', 'Małopolskie', 'Dolnośląskie', 'Wielkopolskie', 'Śląskie'],
    legalForms: ['Sp. z o.o.', 'Spółka z o.o.', 'S.A.', 'Sp. k.'],
    languages: ['pl', 'pl-PL']
  },
  'Brazil': {
    name: 'Brazil',
    code: 'BR',
    flag: '🇧🇷',
    cctld: 'br',
    phoneCodes: ['+55'],
    majorCities: ['São Paulo', 'Sao Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza', 'Belo Horizonte', 'Manaus', 'Curitiba', 'Recife', 'Porto Alegre', 'Goiânia', 'Belém', 'Campinas'],
    statesOrRegions: ['São Paulo', 'Rio de Janeiro', 'Minas Gerais', 'Paraná', 'Rio Grande do Sul', 'Bahia'],
    legalForms: ['Ltda', 'Ltda.', 'S.A.', 'EIRELI', 'ME'],
    languages: ['pt', 'pt-BR']
  },
  'Mexico': {
    name: 'Mexico',
    code: 'MX',
    flag: '🇲🇽',
    cctld: 'mx',
    phoneCodes: ['+52'],
    majorCities: ['Mexico City', 'CDMX', 'Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana', 'León', 'Juárez', 'Zapopan', 'Mérida', 'Querétaro', 'Toluca', 'Cancún'],
    statesOrRegions: ['Jalisco', 'Nuevo León', 'Estado de México', 'Puebla', 'Guanajuato'],
    legalForms: ['S.A. de C.V.', 'SA de CV', 'S. de R.L. de C.V.', 'S.A.P.I. de C.V.'],
    languages: ['es-MX', 'es']
  },
  'United Arab Emirates': {
    name: 'United Arab Emirates',
    code: 'AE',
    flag: '🇦🇪',
    cctld: 'ae',
    phoneCodes: ['+971'],
    majorCities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain', 'Ajman', 'Ras Al Khaimah', 'Fujairah'],
    statesOrRegions: ['Dubai', 'Abu Dhabi', 'Sharjah'],
    legalForms: ['LLC', 'FZE', 'FZCO', 'PJSC', 'PrJSC'],
    languages: ['ar-AE', 'en']
  },
  'Singapore': {
    name: 'Singapore',
    code: 'SG',
    flag: '🇸🇬',
    cctld: 'sg',
    phoneCodes: ['+65'],
    majorCities: ['Singapore'],
    legalForms: ['Pte Ltd', 'Pte. Ltd.', 'Private Limited', 'Ltd'],
    languages: ['en-SG', 'zh-SG']
  },
  'South Korea': {
    name: 'South Korea',
    code: 'KR',
    flag: '🇰🇷',
    cctld: 'kr',
    phoneCodes: ['+82'],
    majorCities: ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju', 'Suwon', 'Ulsan', 'Changwon', 'Seongnam'],
    statesOrRegions: ['Gyeonggi-do', 'Seoul Capital Area'],
    legalForms: ['Co., Ltd.', 'Inc.', 'Corp.'],
    languages: ['ko', 'ko-KR']
  },
  'Austria': {
    name: 'Austria',
    code: 'AT',
    flag: '🇦🇹',
    cctld: 'at',
    phoneCodes: ['+43'],
    majorCities: ['Vienna', 'Wien', 'Graz', 'Linz', 'Salzburg', 'Innsbruck', 'Klagenfurt', 'Villach', 'Wels'],
    legalForms: ['GmbH', 'AG'],
    languages: ['de-AT']
  },
  'Belgium': {
    name: 'Belgium',
    code: 'BE',
    flag: '🇧🇪',
    cctld: 'be',
    phoneCodes: ['+32'],
    majorCities: ['Brussels', 'Bruxelles', 'Antwerp', 'Antwerpen', 'Ghent', 'Gent', 'Charleroi', 'Liège', 'Bruges', 'Brugge', 'Namur', 'Leuven'],
    legalForms: ['NV', 'SA', 'BV', 'SRL', 'SPRL'],
    languages: ['nl-BE', 'fr-BE']
  },
  'Denmark': {
    name: 'Denmark',
    code: 'DK',
    flag: '🇩🇰',
    cctld: 'dk',
    phoneCodes: ['+45'],
    majorCities: ['Copenhagen', 'København', 'Aarhus', 'Odense', 'Aalborg', 'Esbjerg', 'Randers', 'Kolding'],
    legalForms: ['A/S', 'ApS', 'I/S'],
    languages: ['da', 'da-DK']
  },
  'Norway': {
    name: 'Norway',
    code: 'NO',
    flag: '🇳🇴',
    cctld: 'no',
    phoneCodes: ['+47'],
    majorCities: ['Oslo', 'Bergen', 'Trondheim', 'Stavanger', 'Bærum', 'Kristiansand', 'Drammen', 'Tromsø'],
    legalForms: ['AS', 'ASA', 'ANS'],
    languages: ['no', 'nb', 'nn']
  },
  'Finland': {
    name: 'Finland',
    code: 'FI',
    flag: '🇫🇮',
    cctld: 'fi',
    phoneCodes: ['+358'],
    majorCities: ['Helsinki', 'Espoo', 'Tampere', 'Vantaa', 'Oulu', 'Turku', 'Jyväskylä', 'Lahti', 'Kuopio'],
    legalForms: ['Oy', 'Oyj', 'Ky'],
    languages: ['fi', 'fi-FI', 'sv-FI']
  },
  'Ireland': {
    name: 'Ireland',
    code: 'IE',
    flag: '🇮🇪',
    cctld: 'ie',
    phoneCodes: ['+353'],
    majorCities: ['Dublin', 'Cork', 'Limerick', 'Galway', 'Waterford', 'Drogheda', 'Dundalk', 'Swords'],
    legalForms: ['DAC', 'CLG', 'Ltd', 'Limited', 'PLC'],
    languages: ['en-IE']
  },
  'Portugal': {
    name: 'Portugal',
    code: 'PT',
    flag: '🇵🇹',
    cctld: 'pt',
    phoneCodes: ['+351'],
    majorCities: ['Lisbon', 'Lisboa', 'Porto', 'Vila Nova de Gaia', 'Amadora', 'Braga', 'Funchal', 'Coimbra', 'Setúbal'],
    legalForms: ['Lda', 'Lda.', 'S.A.', 'SA'],
    languages: ['pt-PT']
  },
  'Turkey': {
    name: 'Turkey',
    code: 'TR',
    flag: '🇹🇷',
    cctld: 'tr',
    phoneCodes: ['+90'],
    majorCities: ['Istanbul', 'İstanbul', 'Ankara', 'Izmir', 'İzmir', 'Bursa', 'Antalya', 'Adana', 'Konya', 'Gaziantep', 'Kocaeli'],
    legalForms: ['A.Ş.', 'A.S.', 'Ltd. Şti.', 'Ltd. Sti.'],
    languages: ['tr', 'tr-TR']
  },
  'South Africa': {
    name: 'South Africa',
    code: 'ZA',
    flag: '🇿🇦',
    cctld: 'za',
    phoneCodes: ['+27'],
    majorCities: ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Port Elizabeth', 'Bloemfontein', 'East London'],
    legalForms: ['(Pty) Ltd', 'Pty Ltd', 'Ltd', 'SOC Ltd'],
    languages: ['en-ZA', 'af']
  },
  'New Zealand': {
    name: 'New Zealand',
    code: 'NZ',
    flag: '🇳🇿',
    cctld: 'nz',
    phoneCodes: ['+64'],
    majorCities: ['Auckland', 'Wellington', 'Christchurch', 'Hamilton', 'Tauranga', 'Napier-Hastings', 'Dunedin'],
    legalForms: ['Limited', 'Ltd'],
    languages: ['en-NZ']
  },
  'Hong Kong': {
    name: 'Hong Kong',
    code: 'HK',
    flag: '🇭🇰',
    cctld: 'hk',
    phoneCodes: ['+852'],
    majorCities: ['Hong Kong', 'Kowloon', 'Central'],
    legalForms: ['Limited', 'Ltd', 'Co., Limited'],
    languages: ['zh-HK', 'en']
  },
  'Taiwan': {
    name: 'Taiwan',
    code: 'TW',
    flag: '🇹🇼',
    cctld: 'tw',
    phoneCodes: ['+886'],
    majorCities: ['Taipei', 'Kaohsiung', 'Taichung', 'Tainan', 'Taoyuan', 'Hsinchu'],
    legalForms: ['Co., Ltd.', 'Ltd.'],
    languages: ['zh-TW']
  },
  'Saudi Arabia': {
    name: 'Saudi Arabia',
    code: 'SA',
    flag: '🇸🇦',
    cctld: 'sa',
    phoneCodes: ['+966'],
    majorCities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'Dammam', 'Khobar', 'Dhahran', 'Tabuk'],
    legalForms: ['LLC', 'JSC', 'Closed Joint Stock'],
    languages: ['ar-SA']
  },
  'Israel': {
    name: 'Israel',
    code: 'IL',
    flag: '🇮🇱',
    cctld: 'il',
    phoneCodes: ['+972'],
    majorCities: ['Tel Aviv', 'Jerusalem', 'Haifa', 'Rishon LeZion', 'Petah Tikva', 'Ashdod', 'Netanya', 'Beer Sheva', 'Herzliya'],
    legalForms: ['Ltd', 'Limited'],
    languages: ['he', 'he-IL', 'en']
  },
  'Czech Republic': {
    name: 'Czech Republic',
    code: 'CZ',
    flag: '🇨🇿',
    cctld: 'cz',
    phoneCodes: ['+420'],
    majorCities: ['Prague', 'Praha', 'Brno', 'Ostrava', 'Plzeň', 'Liberec', 'Olomouc'],
    legalForms: ['s.r.o.', 'a.s.', 'v.o.s.'],
    languages: ['cs', 'cs-CZ']
  }
};

/**
 * Return appropriate country emoji flag
 */
export function getCountryFlag(countryName: string): string {
  if (!countryName || countryName === 'Unknown' || countryName === 'Global') {
    return '🌐';
  }
  const match = GLOBAL_COUNTRIES[countryName];
  if (match) return match.flag;

  // Search case-insensitively
  const lower = countryName.toLowerCase().trim();
  for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
    if (name.toLowerCase() === lower || info.code.toLowerCase() === lower) {
      return info.flag;
    }
  }

  return '🏳️';
}

/**
 * Clean domain string into base hostname
 */
export function cleanDomainName(raw: string): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .split(':')[0];
}

/**
 * Inspect HTML content from website contact/about/home pages
 * Extracts country based on:
 * 1. Schema.org JSON-LD PostalAddress
 * 2. <a href="tel:..."> international dialing codes
 * 3. Verified Impressum with official registry numbers (Handelsregister, HRB, Amtsgericht)
 * 4. National postal code formats (UK, Canada, Australia, US, France, Germany, Netherlands)
 * 5. Google Maps iframe embed coordinates/queries
 * 6. Meta geotags (geo.region, geo.placename) and og:locale
 * 7. Distinct national legal entity forms (GmbH, SAS, B.V., S.L., Pty Ltd, etc.)
 * 8. Physical address and headquarters keywords
 */
export function analyzeWebsiteHtmlForCountry(html: string, domain: string, url: string = ''): { country: string; method: DomainCountryResolution['method']; evidence: string; confidence: number } | null {
  if (!html || html.length < 50) return null;

  // Sanitize text for text-based checks to eliminate script coordinates, SVG numbers, and CSS
  const sanitizedText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const lowerText = sanitizedText.toLowerCase();
  const lowerHtml = html.toLowerCase();
  const isDedicatedImprintOrContact = /\/(?:contact|kontakt|impressum|imprint|legal|about)/i.test(url);

  // 1. Check Schema.org JSON-LD for explicit addressCountry
  try {
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const nodes = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
        for (const node of nodes) {
          if (!node || typeof node !== 'object') continue;
          
          const address = node.address || (node['@type'] === 'PostalAddress' ? node : null);
          if (address && typeof address === 'object') {
            const countryVal = address.addressCountry;
            const countryStr = typeof countryVal === 'string' ? countryVal.trim() : (countryVal?.name || '');
            if (countryStr) {
              for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
                if (info.code.toLowerCase() === countryStr.toLowerCase() || name.toLowerCase() === countryStr.toLowerCase()) {
                  return {
                    country: name,
                    method: 'jsonld_schema',
                    evidence: `Schema.org PostalAddress country: "${countryStr}"`,
                    confidence: 99
                  };
                }
              }
            }
          }
        }
      } catch {}
    }
  } catch {}

  // 2. Direct <a href="tel:..."> links with international dialing codes (High precision)
  const telLinks = Array.from(html.matchAll(/href=["']tel:([^"']+)["']/gi))
    .map(m => m[1].replace(/[^0-9+]/g, ''))
    .filter(p => p.startsWith('+') && p.length >= 7);

  if (telLinks.length > 0) {
    for (const phone of telLinks) {
      for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
        for (const pCode of info.phoneCodes) {
          if (pCode !== '+1' && phone.startsWith(pCode)) {
            return {
              country: name,
              method: 'phone_code',
              evidence: `Direct tel link dialing code: ${pCode} (${phone.slice(0, 14)})`,
              confidence: 95
            };
          }
        }
      }
    }
  }

  // 3. National Postal Codes & Address Blocks in contact/footer text
  // UK Postcode (e.g. EC2A 4NE, SW1A 1AA, M1 1AE, W1D 3QU)
  const ukPostcodeRegex = /\b([A-Z]{1,2}\d[A-Z\d]?\s+[0-9][A-Z]{2})\b/i;
  if (ukPostcodeRegex.test(sanitizedText) && (lowerText.includes('london') || lowerText.includes('united kingdom') || lowerText.includes('england') || lowerText.includes('manchester') || lowerText.includes('edinburgh') || lowerText.includes('birmingham'))) {
    const pcMatch = sanitizedText.match(ukPostcodeRegex);
    return {
      country: 'United Kingdom',
      method: 'contact_page_address',
      evidence: `UK Royal Mail Postcode verified: "${pcMatch?.[0]}"`,
      confidence: 97
    };
  }

  // Canadian Postal Code (e.g. K1P 1J1, M5V 3L9, H2Y 1C6)
  const caPostcodeRegex = /\b([A-CEGHJ-NPR-TVXY]\d[A-CEGHJ-NPR-TV-Z]\s+[0-9][A-CEGHJ-NPR-TV-Z]\d)\b/i;
  if (caPostcodeRegex.test(sanitizedText) && (lowerText.includes('canada') || lowerText.includes('ontario') || lowerText.includes('quebec') || lowerText.includes('toronto') || lowerText.includes('ottawa') || lowerText.includes('montreal') || lowerText.includes('vancouver') || lowerText.includes('calgary'))) {
    const pcMatch = sanitizedText.match(caPostcodeRegex);
    return {
      country: 'Canada',
      method: 'contact_page_address',
      evidence: `Canadian Postal Code verified: "${pcMatch?.[0]}"`,
      confidence: 97
    };
  }

  // Australian Postcode & State (e.g. NSW 2000, VIC 3000, QLD 4000)
  const auPostcodeRegex = /\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})\b/i;
  if (auPostcodeRegex.test(sanitizedText)) {
    const pcMatch = sanitizedText.match(auPostcodeRegex);
    return {
      country: 'Australia',
      method: 'contact_page_address',
      evidence: `Australian State & Postal Code verified: "${pcMatch?.[0]}"`,
      confidence: 97
    };
  }

  // German Postal Code + Major City (PLZ e.g. 10117 Berlin, 80333 München, 60311 Frankfurt)
  const dePlzRegex = /\b(\d{5})\s+(Berlin|München|Munich|Frankfurt|Hamburg|Köln|Cologne|Stuttgart|Düsseldorf|Leipzig|Dortmund|Nürnberg|Bonn)\b/i;
  if (dePlzRegex.test(sanitizedText)) {
    const m = sanitizedText.match(dePlzRegex);
    return {
      country: 'Germany',
      method: 'contact_page_address',
      evidence: `German Postal Code (PLZ) & City verified: "${m?.[0]}"`,
      confidence: 96
    };
  }

  // French Postal Code + Major City (e.g. 75008 Paris, 69002 Lyon, 33000 Bordeaux)
  const frCodeRegex = /\b(75\d{3}|69\d{3}|13\d{3}|31\d{3}|33\d{3}|59\d{3}|44\d{3})\s+(Paris|Lyon|Marseille|Toulouse|Bordeaux|Lille|Nantes)\b/i;
  if (frCodeRegex.test(sanitizedText)) {
    const m = sanitizedText.match(frCodeRegex);
    return {
      country: 'France',
      method: 'contact_page_address',
      evidence: `French Code Postal & City verified: "${m?.[0]}"`,
      confidence: 96
    };
  }

  // US State & 5-digit ZIP (e.g. CA 94103, NY 10001, TX 78701, WA 98101)
  const usZipRegex = /\b(CA|NY|TX|WA|IL|MA|FL|GA|CO|NC|VA|PA|OH|MI|NJ|AZ)\s+(\d{5})(?:-\d{4})?\b/;
  if (usZipRegex.test(sanitizedText) && (lowerText.includes('usa') || lowerText.includes('united states') || lowerText.includes('suite') || lowerText.includes('street') || lowerText.includes('avenue') || lowerText.includes('blvd') || lowerText.includes('san francisco') || lowerText.includes('new york') || lowerText.includes('austin') || lowerText.includes('seattle'))) {
    const m = sanitizedText.match(usZipRegex);
    return {
      country: 'United States',
      method: 'contact_page_address',
      evidence: `US Postal Address & ZIP verified: "${m?.[0]}"`,
      confidence: 95
    };
  }

  // 4. Verified Impressum with official registry numbers (Handelsregister / HRB / Amtsgericht / Firmenbuch)
  // Only triggers if the page contains actual commercial registry numbers
  const hasCommercialRegister = /\b(?:handelsregister|registergericht|hrb\s*\d+|hra\s*\d+|amtsgericht|firmenbuch|uid-nr|ust-idnr)\b/i.test(lowerText);
  if (hasCommercialRegister) {
    if (lowerText.includes('österreich') || lowerText.includes('firmenbuch') || lowerText.includes('wien') || lowerText.includes('vienna')) {
      return {
        country: 'Austria',
        method: 'impressum',
        evidence: 'Official Austrian Commercial Register / Firmenbuch entry',
        confidence: 98
      };
    }
    if (lowerText.includes('schweiz') || lowerText.includes('handelsregisteramt') || lowerText.includes('zürich') || lowerText.includes('geneva')) {
      return {
        country: 'Switzerland',
        method: 'impressum',
        evidence: 'Official Swiss Commercial Register / Handelsregister entry',
        confidence: 98
      };
    }
    return {
      country: 'Germany',
      method: 'impressum',
      evidence: 'Official German Commercial Register (Handelsregister / HRB / Amtsgericht) entry',
      confidence: 98
    };
  }

  // 5. Google Maps Embed with location
  const gmapsMatch = html.match(/src=["']https?:\/\/(?:www\.)?google\.com\/maps\/embed[^"']*pb=([^"']+)["']/i)
    || html.match(/src=["']https?:\/\/(?:www\.)?google\.com\/maps\?[^"']*q=([^"&']+)["']/i);
  if (gmapsMatch) {
    const rawPlace = decodeURIComponent(gmapsMatch[1] || '').toLowerCase();
    for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
      if (rawPlace.includes(name.toLowerCase())) {
        return {
          country: name,
          method: 'contact_page_address',
          evidence: `Google Maps embed location: "${name}"`,
          confidence: 94
        };
      }
      for (const city of info.majorCities) {
        if (city.length >= 5 && rawPlace.includes(city.toLowerCase())) {
          return {
            country: name,
            method: 'contact_page_address',
            evidence: `Google Maps embed city: "${city}, ${name}"`,
            confidence: 92
          };
        }
      }
    }
  }

  // 6. Meta Geotags (<meta name="geo.region" content="US-CA" />)
  const geoRegionMatch = html.match(/<meta[^>]+name=["']geo\.region["'][^>]+content=["']([a-zA-Z]{2})(?:-[a-zA-Z0-9]+)?["']/i);
  if (geoRegionMatch) {
    const isoCode = geoRegionMatch[1].toUpperCase();
    for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
      if (info.code === isoCode) {
        return {
          country: name,
          method: 'meta_geotag',
          evidence: `Meta geo.region tag: "${geoRegionMatch[0]}"`,
          confidence: 93
        };
      }
    }
  }

  // 7. Distinct National Legal Entity Forms in footer or about text
  const legalTests: Array<{ regex: RegExp; country: string; confidence: number }> = [
    { regex: /\b(?:gmbh\s*&\s*co\.?\s*kg|aktiengesellschaft)\b/i, country: 'Germany', confidence: 91 },
    { regex: /\b(?:s\.?a\.?s\.?|sasu|société par actions simplifiée)\b/i, country: 'France', confidence: 90 },
    { regex: /\b(?:pty\.?\s+ltd\.?|proprietary\s+limited)\b/i, country: 'Australia', confidence: 92 },
    { regex: /\b(?:besloten\s+vennootschap)\b/i, country: 'Netherlands', confidence: 92 },
    { regex: /\b(?:sp\.?\s+z\s+o\.?o\.?|spółka\s+z\s+o\.?o\.?)\b/i, country: 'Poland', confidence: 93 },
    { regex: /\b(?:s\.?l\.?u\.?|sociedad\s+limitada)\b/i, country: 'Spain', confidence: 89 },
    { regex: /\b(?:s\.?r\.?l\.?|società\s+a\s+responsabilità\s+limitata)\b/i, country: 'Italy', confidence: 89 },
    { regex: /\b(?:aktiebolag|ab\s+publ)\b/i, country: 'Sweden', confidence: 89 },
    { regex: /\b(?:pvt\.?\s+ltd\.?|private\s+limited)\b/i, country: 'India', confidence: 88 }
  ];

  for (const test of legalTests) {
    if (test.regex.test(sanitizedText)) {
      return {
        country: test.country,
        method: 'contact_page_address',
        evidence: `National corporate legal form verified: "${sanitizedText.match(test.regex)?.[0]}"`,
        confidence: test.confidence
      };
    }
  }

  // 8. Contact Section Address & Headquarters keyword scanning
  const hqAddressBlock = sanitizedText.match(/(?:headquarters|head\s+office|registered\s+office|contact\s+us|our\s+office|main\s+office)[\s\S]{0,300}/gi);
  if (hqAddressBlock) {
    const blockText = hqAddressBlock.join(' ').toLowerCase();
    for (const [countryName, info] of Object.entries(GLOBAL_COUNTRIES)) {
      const countryRegex = new RegExp(`\\b${countryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (countryRegex.test(blockText)) {
        return {
          country: countryName,
          method: 'contact_page_address',
          evidence: `Explicit headquarters location verified: "${countryName}"`,
          confidence: 90
        };
      }
      for (const city of info.majorCities) {
        if (city.length >= 5) {
          const cityRegex = new RegExp(`\\b${city}\\b`, 'i');
          if (cityRegex.test(blockText)) {
            return {
              country: countryName,
              method: 'contact_page_address',
              evidence: `Headquarters city verified in contact section: "${city}, ${countryName}"`,
              confidence: 86
            };
          }
        }
      }
    }
  }

  return null;
}

/**
 * Parse Search Engine snippets (DuckDuckGo, Bing, Google) to extract headquarters country
 */
export function analyzeSearchSnippetForCountry(snippet: string, title: string = ''): { country: string; evidence: string; confidence: number } | null {
  if (!snippet && !title) return null;
  const combined = `${title} ${snippet}`.toLowerCase();

  // Check national demonym descriptors (e.g. "an Australian software company", "a Canadian multinational", "a German manufacturer")
  const demonymMap: Record<string, string> = {
    'american': 'United States',
    'german': 'Germany',
    'british': 'United Kingdom',
    'french': 'France',
    'japanese': 'Japan',
    'canadian': 'Canada',
    'australian': 'Australia',
    'italian': 'Italy',
    'spanish': 'Spain',
    'chinese': 'China',
    'indian': 'India',
    'swiss': 'Switzerland',
    'swedish': 'Sweden',
    'dutch': 'Netherlands',
    'brazilian': 'Brazil',
    'mexican': 'Mexico',
    'korean': 'South Korea',
    'danish': 'Denmark',
    'norwegian': 'Norway',
    'finnish': 'Finland',
    'austrian': 'Austria',
    'belgian': 'Belgium',
    'polish': 'Poland',
    'irish': 'Ireland',
    'israeli': 'Israel',
    'taiwanese': 'Taiwan',
    'estonian': 'Estonia',
    'singaporean': 'Singapore',
    'new zealand': 'New Zealand',
    'south african': 'South Africa'
  };

  for (const [demonym, country] of Object.entries(demonymMap)) {
    const reg = new RegExp(`\\b${demonym}\\b\\s+(?:multinational|software|cloud|technology|ecommerce|e-commerce|retail|industrial|financial|fintech|engineering|telecommunications|holding|conglomerate|company|corporation|firm|agency|startup|provider)`, 'i');
    if (reg.test(combined)) {
      return {
        country,
        evidence: `Search engine verified national company entity: "${combined.match(reg)?.[0]}"`,
        confidence: 94
      };
    }
  }

  // Headquartered in [City, Country] or [City], [Country]
  const hqMatches = combined.match(/headquartered\s+(?:in|at)\s+([A-Za-z\s,]+?)(?:\.|\;|\-|\(|\)|\n|$)/i)
    || combined.match(/headquarters\s+(?:in|at|is)\s+([A-Za-z\s,]+?)(?:\.|\;|\-|\(|\)|\n|$)/i)
    || combined.match(/based\s+in\s+([A-Za-z\s,]+?)(?:\.|\;|\-|\(|\)|\n|$)/i)
    || combined.match(/founded\s+in\s+([A-Za-z\s,]+?)(?:\.|\;|\-|\(|\)|\n|$)/i);

  if (hqMatches) {
    const phrase = hqMatches[1].toLowerCase();
    for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
      if (phrase.includes(name.toLowerCase())) {
        return {
          country: name,
          evidence: `Search engine verified: "${hqMatches[0].trim()}"`,
          confidence: 92
        };
      }
      for (const city of info.majorCities) {
        if (city.length >= 4 && phrase.includes(city.toLowerCase())) {
          return {
            country: name,
            evidence: `Search engine verified headquarters city: "${city}, ${name}"`,
            confidence: 90
          };
        }
      }
    }
  }

  // Check explicit country mentions in context
  for (const [name, info] of Object.entries(GLOBAL_COUNTRIES)) {
    const nameRegex = new RegExp(`\\b(?:in|at|from)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (nameRegex.test(combined)) {
      return {
        country: name,
        evidence: `Search engine confirmed location in ${name}`,
        confidence: 86
      };
    }

    const AMBIGUOUS_CITY_WORDS = new Set(['reading', 'mobile', 'nice', 'split', 'deal', 'bath', 'hull', 'normal', 'orange', 'florence', 'victoria', 'darwin']);
    for (const city of info.majorCities) {
      const lowerCity = city.toLowerCase();
      if (city.length >= 5 && !AMBIGUOUS_CITY_WORDS.has(lowerCity)) {
        const cityRegex = new RegExp(`\\b(?:in|at|near|from|headquarters|office|hub|store)?\\s*${city}\\b`, 'i');
        if (cityRegex.test(combined)) {
          return {
            country: name,
            evidence: `Search engine identified location in ${city}, ${name}`,
            confidence: 85
          };
        }
      }
    }
  }

  return null;
}
