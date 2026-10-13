const schema = {
  name: 'travel_plan', strict: true, schema: {
    type: 'object', additionalProperties: false,
    required: ['trip', 'budget', 'days', 'checklist', 'safetyCards'],
    properties: {
      trip: { type: 'object', additionalProperties: false, required: ['destination', 'dates', 'travelers', 'tripType', 'style', 'density', 'summary'], properties: { destination: { type: 'string' }, dates: { type: 'string' }, travelers: { type: 'integer' }, tripType: { type: 'string' }, style: { type: 'string' }, density: { type: 'string' }, summary: { type: 'string' } } },
      budget: { type: 'object', additionalProperties: false, required: ['totalKrw', 'airfareKrw', 'lodgingKrw', 'foodKrw', 'transportKrw', 'shoppingKrw', 'emergencyKrw', 'note'], properties: { totalKrw: { type: 'integer' }, airfareKrw: { type: 'integer' }, lodgingKrw: { type: 'integer' }, foodKrw: { type: 'integer' }, transportKrw: { type: 'integer' }, shoppingKrw: { type: 'integer' }, emergencyKrw: { type: 'integer' }, note: { type: 'string' } } },
      days: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['day', 'date', 'theme', 'items'], properties: { day: { type: 'integer' }, date: { type: 'string' }, theme: { type: 'string' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['startTime', 'place', 'category', 'costLocal', 'costKrw', 'note'], properties: { startTime: { type: 'string' }, place: { type: 'string' }, category: { type: 'string' }, costLocal: { type: 'string' }, costKrw: { type: 'integer' }, note: { type: 'string' } } } } } } },
      checklist: { type: 'array', items: { type: 'string' } },
      safetyCards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['country', 'emergencyNumber', 'embassy', 'warning'], properties: { country: { type: 'string' }, emergencyNumber: { type: 'string' }, embassy: { type: 'string' }, warning: { type: 'string' } } } }
    }
  }
};

async function tavilySearch(query, topic, maxResults = 4) {
  const upstream = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: maxResults, include_answer: false })
  });
  const payload = await upstream.json();
  if (!upstream.ok) throw new Error(payload.detail || payload.message || 'Tavily 검색 요청 실패');
  return (Array.isArray(payload.results) ? payload.results : []).map(result => ({
    topic,
    title: String(result.title || '검색 출처'),
    url: String(result.url || ''),
    summary: String(result.content || '').slice(0, 650)
  })).filter(result => result.url);
}

const airportByCity = [
  [/후쿠오카|fukuoka/i, 'FUK'], [/도쿄|tokyo/i, 'HND,NRT'], [/오사카|osaka/i, 'KIX,ITM'], [/삿포로|sapporo/i, 'CTS'], [/교토|kyoto/i, 'KIX,ITM'],
  [/파리|paris/i, 'CDG,ORY'], [/런던|london/i, 'LHR,LGW'], [/로마|rome/i, 'FCO'], [/바르셀로나|barcelona/i, 'BCN'], [/방콕|bangkok/i, 'BKK,DMK'],
  [/싱가포르|singapore/i, 'SIN'], [/타이베이|taipei/i, 'TPE'], [/홍콩|hong kong/i, 'HKG'], [/다낭|da nang/i, 'DAD'], [/하노이|hanoi/i, 'HAN'], [/호치민|ho chi minh/i, 'SGN']
];

function airportForCity(city) {
  return airportByCity.find(([pattern]) => pattern.test(String(city || '')))?.[1] || null;
}

function flightSummary(offer = {}) {
  const segments = Array.isArray(offer.flights) ? offer.flights : [];
  return {
    price: offer.price || offer.price_details?.total || null,
    airline: offer.airline || segments.map(segment => segment.airline).filter(Boolean).join(', ') || null,
    totalDuration: offer.total_duration || null,
    flights: segments.map(segment => ({ flightNumber: segment.flight_number, departureAirport: segment.departure_airport, arrivalAirport: segment.arrival_airport, departureTime: segment.departure_time, arrivalTime: segment.arrival_time }))
  };
}

async function serpFlightRequest(parameters) {
  const search = new URLSearchParams({ engine: 'google_flights', api_key: process.env.SERPAPI_API_KEY, gl: 'kr', hl: 'ko', currency: 'KRW', deep_search: 'false', ...parameters });
  const upstream = await fetch(`https://serpapi.com/search.json?${search.toString()}`);
  const payload = await upstream.json();
  if (!upstream.ok || payload.error) throw new Error(payload.error || 'SerpApi 항공 검색 실패');
  return payload;
}

async function searchSerpFlights(input, destinations) {
  if (!process.env.SERPAPI_API_KEY) return { status: 'SERPAPI_API_KEY가 설정되지 않았습니다.', candidates: [] };
  const firstAirport = airportForCity(destinations[0]);
  const lastAirport = airportForCity(destinations.at(-1));
  if (!firstAirport || !lastAirport) return { status: '선택 도시의 SerpApi 항공 검색용 공항 코드 매핑이 없습니다.', candidates: [] };
  const travelers = { adults: String(Number(input.adults || 1)), children: String(Number(input.children || 0)) };
  try {
    if (destinations.length === 1) {
      const outbound = await serpFlightRequest({ type: '1', departure_id: 'ICN', arrival_id: firstAirport, outbound_date: input.startDate, return_date: input.endDate, ...travelers });
      const offers = [...(outbound.best_flights || []), ...(outbound.other_flights || [])];
      const chosen = offers[0];
      if (!chosen?.departure_token) return { status: 'SerpApi 왕복 출국편 후보 조회 완료', candidates: offers.slice(0, 3).map(flightSummary) };
      const returning = await serpFlightRequest({ type: '1', departure_id: 'ICN', arrival_id: firstAirport, outbound_date: input.startDate, return_date: input.endDate, departure_token: chosen.departure_token, ...travelers });
      return { status: 'SerpApi 왕복 항공 후보 조회 완료', candidates: [...(returning.best_flights || []), ...(returning.other_flights || [])].slice(0, 3).map(flightSummary), outbound: flightSummary(chosen) };
    }
    const legs = [{ departure_id: 'ICN', arrival_id: firstAirport, date: input.startDate }, { departure_id: lastAirport, arrival_id: 'ICN', date: input.endDate }];
    const multiCity = await serpFlightRequest({ type: '3', multi_city_json: JSON.stringify(legs), ...travelers });
    return { status: 'SerpApi 오픈조 다구간 항공 후보 조회 완료', candidates: [...(multiCity.best_flights || []), ...(multiCity.other_flights || [])].slice(0, 5).map(flightSummary), route: legs };
  } catch (error) {
    console.warn('SerpApi flight search failed:', error.message);
    return { status: 'SerpApi 항공 검색을 불러오지 못했습니다.', candidates: [] };
  }
}

function isGenderRestrictedLodging(value = '') {
  return /male\s*only|men\s*only|male-only|men-only|男性専用|男性限定|男士專用|female\s*only|women\s*only|female-only|women-only|女性専用|女性限定|女士專用/i.test(String(value));
}

function isIncompatibleLodging(candidate, input) {
  const text = `${candidate?.name || ''} ${candidate?.address || ''}`;
  return /커플|부부|신혼|couple|honeymoon/i.test(String(input?.tripType || '')) && isGenderRestrictedLodging(text);
}

async function findGoogleLodgingCandidates(destinations, input) {
  if (!process.env.GOOGLE_MAPS_API_KEY) return { status: 'GOOGLE_MAPS_API_KEY가 설정되지 않았습니다.', cities: [] };
  const cities = await Promise.all(destinations.map(async city => {
    try {
      const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.priceLevel,places.location' },
        body: JSON.stringify({ textQuery: `${city} hotel`, includedType: 'lodging', strictTypeFiltering: true, languageCode: 'ko', maxResultCount: 5 })
      });
      const payload = await upstream.json();
      if (!upstream.ok) throw new Error(payload.error?.message || 'Google 숙소 검색 실패');
      const candidates = (payload.places || []).map(place => ({ placeId: place.id, name: place.displayName?.text, address: place.formattedAddress, rating: place.rating, reviewCount: place.userRatingCount, priceLevel: place.priceLevel, mapsUrl: place.googleMapsUri, location: place.location })).filter(place => place.name);
      return { city, candidates: candidates.filter(candidate => !isIncompatibleLodging(candidate, input)) };
    } catch (error) {
      console.warn(`Google lodging search failed for ${city}:`, error.message);
      return { city, candidates: [] };
    }
  }));
  return { status: cities.some(city => city.candidates.length) ? 'Google Maps 숙소 후보 조회 완료' : 'Google Maps 숙소 후보를 찾지 못했습니다.', cities };
}

const destinationProfiles = [
  [/후쿠오카|fukuoka|도쿄|tokyo|오사카|osaka|삿포로|sapporo|교토|kyoto|일본|japan/i, { countryCode: 'JP', countryName: 'Japan', countryTerms: ['japan', '일본'] }],
  [/파리|paris|프랑스|france/i, { countryCode: 'FR', countryName: 'France', countryTerms: ['france', '프랑스'] }],
  [/로마|rome|이탈리아|italy/i, { countryCode: 'IT', countryName: 'Italy', countryTerms: ['italy', '이탈리아'] }],
  [/바르셀로나|barcelona|스페인|spain/i, { countryCode: 'ES', countryName: 'Spain', countryTerms: ['spain', '스페인'] }],
  [/런던|london|영국|united kingdom|uk/i, { countryCode: 'GB', countryName: 'United Kingdom', countryTerms: ['united kingdom', 'uk', '영국'] }],
  [/방콕|bangkok|태국|thailand/i, { countryCode: 'TH', countryName: 'Thailand', countryTerms: ['thailand', '태국'] }],
  [/싱가포르|singapore/i, { countryCode: 'SG', countryName: 'Singapore', countryTerms: ['singapore', '싱가포르'] }],
  [/타이베이|taipei|대만|taiwan/i, { countryCode: 'TW', countryName: 'Taiwan', countryTerms: ['taiwan', '대만'] }],
  [/홍콩|hong kong/i, { countryCode: 'HK', countryName: 'Hong Kong', countryTerms: ['hong kong', '홍콩'] }],
  [/다낭|da nang|하노이|hanoi|호치민|ho chi minh|베트남|vietnam/i, { countryCode: 'VN', countryName: 'Vietnam', countryTerms: ['vietnam', '베트남'] }]
];

function destinationProfile(city) {
  return destinationProfiles.find(([pattern]) => pattern.test(String(city || '')))?.[1] || null;
}

function normalizedPlaceName(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
}

function sameVenue(left, right) {
  const a = normalizedPlaceName(left), b = normalizedPlaceName(right);
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

function isGenericVenueName(value = '') {
  const normalized = normalizedPlaceName(value);
  return new Set(['신주쿠', '시부야', '하라주쿠', '긴자', '아사쿠사', '우에노', '이케부쿠로', '하카타', '텐진', '도쿄', '후쿠오카', '오사카', '파리', '로마', '방콕', '런던', 'shinjuku', 'shibuya', 'harajuku', 'ginza', 'asakusa', 'ueno', 'ikebukuro', 'hakata', 'tenjin', 'tokyo', 'fukuoka', 'osaka', 'paris', 'rome', 'bangkok', 'london', '新宿', '渋谷', '原宿', '銀座', '浅草', '上野', '池袋', '博多', '天神']).has(normalized);
}

async function findGoogleVenueCandidates(destinations) {
  if (!process.env.GOOGLE_MAPS_API_KEY) return { status: 'GOOGLE_MAPS_API_KEY가 설정되지 않았습니다.', cities: [] };
  const searchKinds = [
    { kind: '식비', venueType: 'restaurant', type: 'restaurant', label: 'restaurant' },
    { kind: '식비', venueType: 'cafe', type: 'cafe', label: 'cafe' },
    { kind: '쇼핑', venueType: 'shopping', type: 'shopping_mall', label: 'shopping mall' }
  ];
  const cities = await Promise.all(destinations.map(async city => {
    const profile = destinationProfile(city);
    if (!profile) return { city, profile: null, candidates: [] };
    const resultSets = await Promise.all(searchKinds.map(async searchKind => {
      try {
        const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.location,places.businessStatus,places.regularOpeningHours,places.types'
          },
          body: JSON.stringify({ textQuery: `${city}, ${profile.countryName} ${searchKind.label}`, includedType: searchKind.type, strictTypeFiltering: true, languageCode: 'en', regionCode: profile.countryCode, maxResultCount: 4 })
        });
        const payload = await upstream.json();
        if (!upstream.ok) throw new Error(payload.error?.message || 'Google 장소 검색 실패');
        return (payload.places || []).map(place => ({
          kind: searchKind.kind,
          venueType: searchKind.venueType,
          name: place.displayName?.text,
          placeId: place.id,
          address: place.formattedAddress,
          mapsUrl: place.googleMapsUri,
          location: place.location,
          businessStatus: place.businessStatus,
          openingHours: place.regularOpeningHours?.weekdayDescriptions || [],
          countryCode: profile.countryCode,
          city
        })).filter(place => place.name && place.mapsUrl && !isGenericVenueName(place.name) && profile.countryTerms.some(term => String(place.address || '').toLowerCase().includes(term)));
      } catch (error) {
        console.warn(`Google venue search failed for ${city}/${searchKind.type}:`, error.message);
        return [];
      }
    }));
    return { city, profile, candidates: resultSets.flat() };
  }));
  return { status: cities.some(city => city.candidates.length) ? 'Google Maps 국가·도시 검증 장소 후보 조회 완료' : 'Google Maps 검증 장소 후보를 찾지 못했습니다.', cities };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hotelStayWindows(input, destinations) {
  const totalNights = Math.max(1, Math.round((new Date(input.endDate) - new Date(input.startDate)) / 86400000));
  const base = Math.floor(totalNights / Math.max(destinations.length, 1));
  const remainder = totalNights % Math.max(destinations.length, 1);
  let checkIn = input.startDate;
  return destinations.map((city, index) => {
    const nights = base + (index >= destinations.length - remainder ? 1 : 0);
    const checkOut = addDays(checkIn, nights);
    const stay = { city, nights, checkIn, checkOut };
    checkIn = checkOut;
    return stay;
  });
}

async function serpHotelRequest(parameters) {
  const search = new URLSearchParams({
    engine: 'google_hotels',
    api_key: process.env.SERPAPI_API_KEY,
    gl: 'kr',
    hl: 'ko',
    currency: 'KRW',
    sort_by: '3',
    ...parameters
  });
  const upstream = await fetch(`https://serpapi.com/search.json?${search.toString()}`);
  const payload = await upstream.json();
  if (!upstream.ok || payload.error) throw new Error(payload.error || 'SerpApi 호텔 검색 실패');
  return payload;
}

function hotelSummary(property = {}) {
  const nightly = property.rate_per_night || {};
  const total = property.total_rate || {};
  return {
    name: property.name || null,
    nightlyKrw: nightly.extracted_lowest || nightly.extracted_before_taxes_fees || null,
    totalKrw: total.extracted_lowest || total.extracted_before_taxes_fees || null,
    fallbackNightlyKrw: property.extracted_price || null,
    nightlyLabel: nightly.lowest || nightly.before_taxes_fees || null,
    totalLabel: total.lowest || total.before_taxes_fees || null,
    fallbackNightlyLabel: property.price || null,
    rating: property.overall_rating || null,
    reviewCount: property.reviews || null,
    hotelClass: property.hotel_class || null,
    freeCancellation: Boolean(property.free_cancellation),
    source: property.prices?.[0]?.source || null,
    mapsUrl: property.link || null,
    location: property.gps_coordinates || null
  };
}

async function searchSerpHotels(input, destinations) {
  if (!process.env.SERPAPI_API_KEY) return { status: 'SERPAPI_API_KEY가 설정되지 않았습니다.', cities: [] };
  const stays = hotelStayWindows(input, destinations);
  const cities = await Promise.all(stays.map(async stay => {
    try {
      const payload = await serpHotelRequest({
        q: `${stay.city} hotels`,
        check_in_date: stay.checkIn,
        check_out_date: stay.checkOut,
        adults: String(Math.max(1, Number(input.adults || 1))),
        children: String(Math.max(0, Number(input.children || 0)))
      });
      const candidates = (payload.properties || payload.ads || []).map(hotelSummary)
        .map(candidate => {
          const nightlyKrw = Number(candidate.nightlyKrw || candidate.fallbackNightlyKrw || 0);
          const explicitTotalKrw = Number(candidate.totalKrw || 0);
          const totalKrw = explicitTotalKrw || nightlyKrw * stay.nights;
          const pricingBasis = explicitTotalKrw ? '검색된 전체 체류 총액' : `1박 요금 × ${stay.nights}박 계산`;
          return { ...candidate, totalKrw, totalLabel: candidate.totalLabel || (nightlyKrw ? `${candidate.nightlyLabel || candidate.fallbackNightlyLabel || `₩${nightlyKrw.toLocaleString('ko-KR')}`} × ${stay.nights}박` : null), pricingBasis };
        })
        .filter(candidate => candidate.name && candidate.totalKrw && !isIncompatibleLodging(candidate, input))
        .slice(0, 5);
      return { ...stay, candidates };
    } catch (error) {
      console.warn(`SerpApi hotel search failed for ${stay.city}:`, error.message);
      return { ...stay, candidates: [] };
    }
  }));
  return {
    status: cities.some(city => city.candidates.length) ? 'SerpApi Google Hotels 숙박 가격 후보 조회 완료' : 'SerpApi Google Hotels 숙박 가격 후보를 찾지 못했습니다.',
    cities
  };
}

async function researchTravelContext(input) {
  const retrievedAt = new Date().toISOString();
  const destinations = Array.isArray(input.destinations) ? input.destinations : [];
  const dates = input.startDate && input.endDate ? `${input.startDate}~${input.endDate}` : '날짜 미정';
  const party = `성인 ${Number(input.adults || input.travelers || 1)}명, 어린이 ${Number(input.children || 0)}명`;
  const [lodgingCandidates, venueCandidates, hotels, flights] = await Promise.all([
    findGoogleLodgingCandidates(destinations, input),
    findGoogleVenueCandidates(destinations),
    searchSerpHotels(input, destinations),
    searchSerpFlights(input, destinations)
  ]);
  const queries = [
    { topic: '식당과 카페', query: `${destinations.join(', ')} 현지인 추천 구체적인 식당 이름 주소 대표 메뉴 가격, 꼭 방문할 카페 이름` },
    { topic: '관광지와 현지 비용', query: `${destinations.join(', ')} 대표 관광지 입장료 대중교통 요금 쇼핑 명소 구체적인 장소 이름 최신` },
    { topic: '안전 및 입국', query: `대한민국 출발 ${destinations.join(', ')} ${dates} 최신 입국 준비 여행 안전 현지 이동. 외교부 정부 공식 관광기관 출처 우선` }
  ];
  if (!process.env.TAVILY_API_KEY) return { retrievedAt, queries, sources: [], status: 'Tavily API 키가 설정되지 않았습니다.', lodgingCandidates, venueCandidates, hotels, flights };
  try {
    const results = await Promise.all(queries.map(({ query, topic }) => tavilySearch(query, topic)));
    const sources = results.flat();
    return { retrievedAt, queries, sources, status: sources.length ? '최신 웹 검색 완료' : '검색 결과가 없습니다.', lodgingCandidates, venueCandidates, hotels, flights };
  } catch (error) {
    console.warn('Tavily travel research failed:', error.message);
    return { retrievedAt, queries, sources: [], status: '웹 검색을 불러오지 못했습니다.', lodgingCandidates, venueCandidates, hotels, flights };
  }
}

function budgetKey(category = '') {
  const value = String(category).toLowerCase();
  if (/항공|비행|flight|airfare/.test(value)) return 'airfareKrw';
  if (/숙박|호텔|료칸|hostel|lodging/.test(value)) return 'lodgingKrw';
  if (/식비|식사|음식|카페|food|meal/.test(value)) return 'foodKrw';
  if (/쇼핑|기념품|shopping/.test(value)) return 'shoppingKrw';
  if (/비상|보험|emergency/.test(value)) return 'emergencyKrw';
  return 'transportKrw';
}

function deriveBudgetFromItinerary(days) {
  const budget = { totalKrw: 0, airfareKrw: 0, lodgingKrw: 0, foodKrw: 0, transportKrw: 0, shoppingKrw: 0, emergencyKrw: 0 };
  for (const day of days || []) for (const item of day.items || []) {
    const cost = Math.max(0, Math.round(Number(item.costKrw) || 0));
    budget[budgetKey(item.category)] += cost;
    budget.totalKrw += cost;
  }
  return budget;
}

function budgetGuidance(input) {
  const total = Math.max(0, Number(input.budgetKrw || 0));
  const nights = Math.max(1, Math.round((new Date(input.endDate) - new Date(input.startDate)) / 86400000));
  // 항공권 비중은 장거리 여부에 따라 달라질 수 있으므로 넓게 두되, 숙박이 전체 예산을 잠식하지 않도록 제한한다.
  const lodgingTarget = Math.round(total * 0.25 / 10000) * 10000;
  const lodgingCeiling = Math.round(total * (nights >= 6 ? 0.32 : 0.35) / 10000) * 10000;
  const totalCeiling = Math.floor(total * 0.85 / 10000) * 10000;
  const airfareCeiling = Math.floor(total * 0.45 / 10000) * 10000;
  return {
    total,
    nights,
    lodgingTarget,
    lodgingCeiling,
    totalCeiling,
    airfareCeiling,
    text: `입력 총예산은 ₩${total.toLocaleString('ko-KR')}이며 ${nights}박 일정이다. 쇼핑·비상금에 쓸 여유를 남기기 위해 계획표 유료 항목의 합계는 반드시 ₩${totalCeiling.toLocaleString('ko-KR')} 이하(입력 예산의 85% 이하)로 설계해라. 항공권은 전체 일행 기준 ₩${airfareCeiling.toLocaleString('ko-KR')} 이하, 숙박의 목표 금액은 약 ₩${lodgingTarget.toLocaleString('ko-KR')}, 절대 상한은 ₩${lodgingCeiling.toLocaleString('ko-KR')}이다. 검색 결과가 상한을 넘으면 더 저렴한 실제 항공편·호텔·객실 대안을 선택하고, 항공 또는 숙소 하나가 예산을 잠식하게 하지 마라. 항공·숙박·식비·교통·쇼핑·비상금의 합계가 이 한도를 넘을 것으로 보이면 고가 항공권/호텔/식당/유료 활동부터 예산에 맞는 대안으로 교체하라.`
  };
}

function routeGuidance(input) {
  const cities = (Array.isArray(input.destinations) ? input.destinations : []).map(String).filter(Boolean);
  const nights = Math.max(1, Math.round((new Date(input.endDate) - new Date(input.startDate)) / 86400000));
  const stays = hotelStayWindows(input, cities);
  const route = ['인천국제공항', ...cities, '인천국제공항'].join(' → ');
  return {
    cities, nights, stays, route,
    text: cities.length < 2 ? `단일 도시 ${cities[0] || ''} 일정이다.` : `다도시 기본 동선은 ${route}이다. 도시별 숙박 배분은 ${stays.map(stay => `${stay.city} ${stay.nights}박`).join(', ')}이며 합계는 정확히 ${nights}박이다. 첫 도시에서 마지막 도시로 이동한 뒤 출국을 위해 첫 도시로 되돌아가지 마라. 마지막 도시의 공항에서 인천으로 귀국하는 오픈조(다구간) 항공 동선을 우선 설계하라.`
  };
}

function normalizeLocation(location) {
  const latitude = Number(location?.latitude ?? location?.lat);
  const longitude = Number(location?.longitude ?? location?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function buildAccommodationPlan(input, routePlan, hotels, lodgingCandidates) {
  return routePlan.stays.map((stay, index) => {
    const priceCandidates = (hotels?.cities || []).find(entry => entry.city === stay.city)?.candidates || [];
    const priced = [...priceCandidates].sort((left, right) => Number(left.totalKrw || Infinity) - Number(right.totalKrw || Infinity));
    const hotel = priced[0] || null;
    const mapCandidates = ((lodgingCandidates?.cities || []).find(entry => entry.city === stay.city)?.candidates || [])
      .filter(candidate => !isIncompatibleLodging(candidate, input));
    // Never attach the first unrelated Maps result to a hotel selected from hotel search.
    const mapMatch = hotel ? mapCandidates.find(candidate => sameVenue(candidate.name, hotel.name)) : null;
    const place = mapMatch || (!hotel ? mapCandidates[0] : null);
    const name = hotel?.name || place?.name || `${stay.city} 숙소 후보`;
    return {
      accommodationId: `stay-${index + 1}`,
      city: stay.city,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: stay.nights,
      name,
      placeId: place?.placeId || null,
      address: place?.address || null,
      mapsUrl: place?.mapsUrl || null,
      location: normalizeLocation(place?.location || hotel?.location),
      totalKrw: Math.max(0, Number(hotel?.totalKrw || 0)),
      totalLabel: hotel?.totalLabel || null,
      pricingBasis: hotel?.pricingBasis || null,
      source: hotel ? 'SerpApi Google Hotels' : (place ? 'Google Maps Places' : '숙소 후보 미확보')
    };
  });
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

function minutesToTime(value) {
  const safe = Math.min(23 * 60 + 55, Math.max(0, Math.round(value / 5) * 5));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function latestTime(items, fallback) {
  const latest = (items || []).map(item => timeToMinutes(item.startTime)).filter(Number.isFinite).reduce((max, value) => Math.max(max, value), -1);
  return latest < 0 ? fallback : Math.max(fallback, latest + 45);
}

function hotelItem(stay, action, startTime, options = {}) {
  const paid = action === '체크인' && stay.totalKrw > 0;
  const note = paid
    ? `${stay.city} ${stay.nights}박 · ${stay.pricingBasis || `${stay.source} 검색 총액`} ₩${stay.totalKrw.toLocaleString('ko-KR')} (전 일행 기준)`
    : options.note || `${stay.city} 체류 숙소 고정 · ${stay.checkIn} 체크인 / ${stay.checkOut} 체크아웃`;
  return {
    startTime,
    place: `${stay.name} ${action}`,
    category: paid ? '숙박' : '교통 · 숙소 이동',
    costLocal: paid ? (stay.totalLabel || `₩${stay.totalKrw.toLocaleString('ko-KR')}`) : '포함',
    costKrw: paid ? stay.totalKrw : 0,
    note,
    accommodationId: stay.accommodationId,
    placeId: stay.placeId,
    mapsUrl: stay.mapsUrl,
    address: stay.address,
    city: stay.city,
    location: stay.location
  };
}

function isAccommodationItem(item) {
  return Boolean(item?.accommodationId) || /^숙박/.test(String(item?.category || '')) || /(체크인|체크아웃|숙소 출발|숙소 복귀|호텔.*(?:출발|복귀|체크인|체크아웃))/.test(String(item?.place || ''));
}

function attachAccommodationBoundaries(plan, input, accommodationPlan) {
  const days = plan.days || [];
  if (!days.length || !accommodationPlan.length) return;
  for (const [dayIndex, day] of days.entries()) {
    const date = day.date;
    const entering = accommodationPlan.find(stay => stay.checkIn === date);
    const leaving = accommodationPlan.find(stay => stay.checkOut === date);
    const active = accommodationPlan.find((stay, index) => date >= stay.checkIn && (date < stay.checkOut || (index === accommodationPlan.length - 1 && date === stay.checkOut))) || entering || accommodationPlan.at(-1);
    const activities = (day.items || []).filter(item => !isAccommodationItem(item));

    if (dayIndex === 0 && entering) {
      activities.push(hotelItem(entering, '체크인', minutesToTime(latestTime(activities, 18 * 60)), { note: `${entering.city} 첫 체류 숙소 · 체크인 후 휴식` }));
    } else if (dayIndex === days.length - 1 && active) {
      activities.unshift(hotelItem(active, '체크아웃', '07:30', { note: `${active.city} 마지막 숙박 종료 · 공항 이동 전 체크아웃` }));
    } else if (entering && leaving && entering.accommodationId !== leaving.accommodationId) {
      activities.unshift(hotelItem(leaving, '체크아웃', '08:00', { note: `${leaving.city} 체류 종료 · 도시 간 이동 전 체크아웃` }));
      activities.push(hotelItem(entering, '체크인', minutesToTime(latestTime(activities, 17 * 60)), { note: `${entering.city} 새 체류 시작 · 도시 간 이동 후 체크인` }));
    } else if (active) {
      activities.unshift(hotelItem(active, '출발', '08:30', { note: `${active.city} 동일 숙소에서 당일 동선 시작` }));
      activities.push(hotelItem(active, '복귀', minutesToTime(latestTime(activities, 20 * 60)), { note: `${active.city} 동일 숙소로 당일 동선 마무리` }));
    }
    day.items = activities.sort((left, right) => (timeToMinutes(left.startTime) ?? 0) - (timeToMinutes(right.startTime) ?? 0));
    day.accommodationId = active?.accommodationId || entering?.accommodationId || null;
  }
  plan.accommodations = accommodationPlan;
}

const densityPolicies = {
  1: { label: '매우 낮음', fullDayMin: 1, fullDayMax: 2, edgeDayMax: 1, bufferMinutes: 90 },
  2: { label: '낮음', fullDayMin: 2, fullDayMax: 3, edgeDayMax: 1, bufferMinutes: 60 },
  3: { label: '보통', fullDayMin: 3, fullDayMax: 4, edgeDayMax: 2, bufferMinutes: 45 },
  4: { label: '높음 · 알차게', fullDayMin: 4, fullDayMax: 5, edgeDayMax: 2, bufferMinutes: 30 },
  5: { label: '매우 높음', fullDayMin: 5, fullDayMax: 6, edgeDayMax: 3, bufferMinutes: 30 }
};

function densityPolicy(input) {
  const explicit = Number(input.densityValue);
  if (Number.isInteger(explicit) && densityPolicies[explicit]) return densityPolicies[explicit];
  const density = String(input.density || '');
  if (/매우 높음/.test(density)) return densityPolicies[5];
  if (/매우 낮음/.test(density)) return densityPolicies[1];
  if (/높음|알찬/.test(density)) return densityPolicies[4];
  if (/낮음|느긋/.test(density)) return densityPolicies[2];
  return densityPolicies[3];
}

function citySchedule(input, routePlan) {
  let current = input.startDate;
  return routePlan.stays.map(stay => {
    const startDate = current;
    const endDate = addDays(current, stay.nights);
    current = endDate;
    return { ...stay, startDate, endDate };
  });
}

function cityForDate(date, input, routePlan) {
  const schedule = citySchedule(input, routePlan);
  return schedule.find((stay, index) => date >= stay.startDate && (date < stay.endDate || (index === schedule.length - 1 && date === stay.endDate)))?.city || schedule.at(-1)?.city || routePlan.cities[0] || '';
}

function isCoreVisit(item) {
  const place = String(item.place || '');
  const category = String(item.category || '');
  return !/^(항공|숙박)/.test(category) && !(/^교통/.test(category) && !/관광/.test(category)) && !/(인천.*공항|국제공항|출국 수속|입국 수속|체크인|체크아웃|숙소 출발|숙소 복귀|호텔.*(?:출발|복귀))/i.test(place);
}

function densityProblems(days, policy) {
  return (days || []).flatMap((day, index, allDays) => {
    const count = (day.items || []).filter(isCoreVisit).length;
    const edgeDay = index === 0 || index === allDays.length - 1;
    const min = edgeDay ? 0 : policy.fullDayMin;
    const max = edgeDay ? policy.edgeDayMax : policy.fullDayMax;
    return count < min || count > max ? [{ day: day.day, date: day.date, coreVisitCount: count, min, max }] : [];
  });
}

function mealCoverageProblems(days) {
  return (days || []).flatMap((day, index, allDays) => {
    // Arrival and departure days are allowed to be irregular because of flights.
    if (index === 0 || index === allDays.length - 1) return [];
    const foodTimes = (day.items || [])
      .filter(item => /^식비/.test(String(item.category || '')))
      .map(item => timeToMinutes(item.startTime))
      .filter(Number.isFinite);
    const hasLunch = foodTimes.some(time => time >= 11 * 60 && time <= 14 * 60 + 30);
    const hasDinner = foodTimes.some(time => time >= 17 * 60 && time <= 21 * 60 + 30);
    return hasLunch && hasDinner ? [] : [{ day: day.day, date: day.date, missing: [!hasLunch && '점심', !hasDinner && '저녁'].filter(Boolean) }];
  });
}

function requestedVenueType(item) {
  const text = `${item?.category || ''} ${item?.note || ''} ${item?.place || ''}`;
  if (/^쇼핑/.test(String(item?.category || ''))) return 'shopping';
  if (/^식비/.test(String(item?.category || ''))) return /카페|커피|coffee/i.test(text) ? 'cafe' : 'restaurant';
  return null;
}

function venueForItem(item, day, input, routePlan, venueCandidates) {
  const city = cityForDate(day.date, input, routePlan);
  const kind = /^식비/.test(String(item.category || '')) ? '식비' : /^쇼핑/.test(String(item.category || '')) ? '쇼핑' : null;
  if (!kind) return null;
  if (isGenericVenueName(item.place)) return null;
  const requestedType = requestedVenueType(item);
  const cityData = (venueCandidates?.cities || []).find(entry => entry.city === city);
  const candidates = (cityData?.candidates || []).filter(candidate => candidate.kind === kind && (!requestedType || candidate.venueType === requestedType));
  return candidates.find(candidate => sameVenue(candidate.name, item.place)) || null;
}

function venueVerificationProblems(days, input, routePlan, venueCandidates) {
  return (days || []).flatMap(day => (day.items || []).flatMap(item => {
    if (!/^(식비|쇼핑)/.test(String(item.category || ''))) return [];
    return venueForItem(item, day, input, routePlan, venueCandidates) ? [] : [{ day: day.day, date: day.date, place: item.place, category: item.category, city: cityForDate(day.date, input, routePlan) }];
  }));
}

function attachVerifiedVenueMetadata(plan, input, routePlan, venueCandidates) {
  for (const day of plan.days || []) for (const item of day.items || []) {
    const venue = venueForItem(item, day, input, routePlan, venueCandidates);
    if (!venue) continue;
    item.placeId = venue.placeId;
    item.mapsUrl = venue.mapsUrl;
    item.address = venue.address;
    item.city = venue.city;
    item.countryCode = venue.countryCode;
    item.location = venue.location;
  }
}

function replaceUnverifiedVenues(plan, input, routePlan, venueCandidates) {
  const used = new Set();
  for (const day of plan.days || []) for (const item of day.items || []) {
    const kind = /^식비/.test(String(item.category || '')) ? '식비' : /^쇼핑/.test(String(item.category || '')) ? '쇼핑' : null;
    if (!kind || (venueForItem(item, day, input, routePlan, venueCandidates) && !isGenericVenueName(item.place))) continue;
    const city = cityForDate(day.date, input, routePlan);
    const cityData = (venueCandidates?.cities || []).find(entry => entry.city === city);
    const requestedType = requestedVenueType(item);
    const replacement = (cityData?.candidates || []).find(candidate => candidate.kind === kind && (!requestedType || candidate.venueType === requestedType) && !used.has(candidate.placeId));
    if (!replacement) continue;
    item.place = replacement.name;
    item.note = `${item.note || ''}${item.note ? ' · ' : ''}Google Maps 국가·도시 검증 장소로 교체`;
    item.placeId = replacement.placeId;
    item.mapsUrl = replacement.mapsUrl;
    item.address = replacement.address;
    item.city = replacement.city;
    item.countryCode = replacement.countryCode;
    item.location = replacement.location;
    used.add(replacement.placeId);
  }
}

function includedTransfer(place, note) {
  return { startTime: '', place, category: '교통 · 포함 이동', costLocal: '포함', costKrw: 0, note };
}

function currencyHint(destination = '') {
  const value = String(destination);
  if (/일본|도쿄|오사카|후쿠오카|교토|삿포로/.test(value)) return { symbol: '¥', krwPerUnit: 9.2 };
  if (/유럽|프랑스|파리|이탈리아|로마|스페인|바르셀로나|독일|포르투갈/.test(value)) return { symbol: '€', krwPerUnit: 1600 };
  if (/영국|런던/.test(value)) return { symbol: '£', krwPerUnit: 1900 };
  if (/태국|방콕/.test(value)) return { symbol: '฿', krwPerUnit: 42 };
  if (/베트남|하노이|다낭|호치민/.test(value)) return { symbol: '₫', krwPerUnit: 0.056 };
  if (/대만|타이베이|가오슝|타이중|taiwan|taipei|kaohsiung|taichung/i.test(value)) return { symbol: 'NT$', krwPerUnit: 45 };
  if (/홍콩/.test(value)) return { symbol: 'HK$', krwPerUnit: 185 };
  if (/싱가포르/.test(value)) return { symbol: 'S$', krwPerUnit: 1070 };
  if (/미국|미합중국|뉴욕|로스앤젤레스|라스베이거스|하와이|샌프란시스코|united states|usa|new york|los angeles|las vegas|hawaii|san francisco/i.test(value)) return { symbol: 'US$', krwPerUnit: 1450 };
  return { symbol: 'US$', krwPerUnit: 1450 };
}

function normalizeItineraryDetails(days, destination) {
  const currency = currencyHint(destination);
  const fallbackTimes = ['06:00', '08:30', '10:00', '12:30', '15:00', '18:00', '20:30', '22:00'];
  for (const day of days || []) for (const [index, item] of (day.items || []).entries()) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.startTime || ''))) item.startTime = fallbackTimes[Math.min(index, fallbackTimes.length - 1)];
    const cost = Math.max(0, Math.round(Number(item.costKrw) || 0));
    if (cost > 0 && (!item.costLocal || /^(0|—|-|확인 필요)$/i.test(String(item.costLocal).trim()))) {
      item.costLocal = `${currency.symbol}${Math.max(1, Math.round(cost / currency.krwPerUnit)).toLocaleString('en-US')}`;
      item.note = `${item.note || ''}${item.note ? ' · ' : ''}검색 기반 추정`;
    }
    if (cost === 0 && !item.costLocal) item.costLocal = '무료';
  }
}

function genericVenueItems(days) {
  const generic = /(?:현지\s*(?:식당|호텔|카페|숙소|공항)|(?:도쿄|오사카|후쿠오카|파리|로마|방콕|런던)\s*(?:호텔|식당|카페)|(?:근처|인근|주변)\s*(?:식당|이자카야|카페|호텔)|^(?:숙소|호텔|식당|카페|공항)\s*(?:체크인|체크아웃|출발|복귀|이동)?$)/;
  return (days || []).flatMap(day => (day.items || []).filter(item => generic.test(String(item.place || '').trim())));
}

function duplicateFoodPlaces(days) {
  const seen = new Map();
  for (const day of days || []) for (const item of day.items || []) {
    if (!/^식비/.test(String(item.category || ''))) continue;
    const key = String(item.place || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    if (!key) continue;
    seen.set(key, [...(seen.get(key) || []), item.place]);
  }
  return [...seen.values()].filter(places => places.length > 1).map(places => places[0]);
}

function stayAllocationProblems(days, routePlan) {
  if (routePlan.stays.length < 2) return [];
  const lodgingText = (days || []).flatMap(day => (day.items || [])).filter(item => /^숙박/.test(String(item.category || ''))).map(item => `${item.place || ''} ${item.note || ''}`);
  return routePlan.stays.filter(stay => !lodgingText.some(text => text.includes(stay.city) && new RegExp(`${stay.nights}\\s*박`).test(text)));
}

function partyCostProblems(days, travelers) {
  return (days || []).flatMap(day => (day.items || []).filter(item => {
    const paid = Number(item.costKrw || 0) > 0;
    const needsPartyCheck = /^(식비|관광|교통|쇼핑)/.test(String(item.category || ''));
    if (!paid || !needsPartyCheck) return false;
    const note = String(item.note || '');
    const formula = note.match(/[¥€£₩$]\s*([0-9][0-9,]*)\s*[×x*]\s*(\d+)\s*(?:명|인)?/i);
    const localAmount = String(item.costLocal || '').match(/[¥€£₩$]\s*([0-9][0-9,]*)/);
    if (!formula || !new RegExp(`(?:${travelers}명|전 일행|전체 일행|성인)`).test(note)) return true;
    return Boolean(localAmount && Number(localAmount[1].replaceAll(',', '')) < Number(formula[1].replaceAll(',', '')) * Number(formula[2]));
  }));
}

function lodgingCalculationProblems(days) {
  return (days || []).flatMap(day => (day.items || []).filter(item => {
    if (!/^숙박/.test(String(item.category || '')) || Number(item.costKrw || 0) <= 0) return false;
    const note = String(item.note || '');
    const localAmount = String(item.costLocal || '').match(/[¥€£₩$]\s*([0-9][0-9,]*)/);
    if (/SerpApi Google Hotels 검색 총액/.test(note)) return !localAmount;
    const formula = note.match(/[¥€£₩$]\s*([0-9][0-9,]*)\s*[×x*]\s*(\d+)\s*박/i);
    if (!formula || !localAmount) return true;
    const expected = Number(formula[1].replaceAll(',', '')) * Number(formula[2]);
    return Number(localAmount[1].replaceAll(',', '')) < expected;
  }));
}

function flightCostProblems(days) {
  const flights = (days || []).flatMap(day => day.items || []).filter(item => /^항공/.test(String(item.category || '')));
  return !flights.some(item => Number(item.costKrw || 0) > 0 && /[₩]/.test(String(item.costLocal || '')));
}

function extractKrwPrice(value = '') {
  const text = String(value);
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  if (man) return Math.round(Number(man[1]) * 10000);
  const symbol = text.match(/₩\s*(\d{1,3}(?:,\d{3})+|\d+)/);
  if (symbol) return Number(symbol[1].replaceAll(',', ''));
  const won = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*원/);
  return won ? Number(won[1].replaceAll(',', '')) : 0;
}

function materializeFlightCosts(days) {
  const flightItems = (days || []).flatMap(day => day.items || []).filter(item => /^항공/.test(String(item.category || '')));
  const priced = flightItems.map(item => ({ item, price: Math.max(Number(item.costKrw || 0), extractKrwPrice(item.costLocal), extractKrwPrice(item.note)) })).filter(entry => entry.price > 0);
  if (!priced.length) return;
  const selected = priced.find(entry => /출발/.test(String(entry.item.place || '')) && !/수속/.test(String(entry.item.place || ''))) || priced[0];
  if (Number(selected.item.costKrw || 0) <= 0) {
    selected.item.costKrw = selected.price;
    selected.item.costLocal = `₩${selected.price.toLocaleString('ko-KR')}`;
  }
  for (const entry of priced) {
    if (entry.item === selected.item) continue;
    if (Number(entry.item.costKrw || 0) <= 0) entry.item.costLocal = '항공권 행에 포함';
  }
}

function consolidateRoundTripAirfare(days, destination) {
  if (!Array.isArray(days) || !days.length) return;
  const flightItems = days.flatMap((day, dayIndex) => (day.items || []).map((item, itemIndex) => ({ item, dayIndex, itemIndex }))).filter(entry => /^항공/.test(String(entry.item.category || '')));
  const priced = flightItems.filter(entry => Number(entry.item.costKrw || 0) > 0);
  if (!priced.length) return;
  const outbound = flightItems.find(entry => entry.dayIndex === 0 && /출발|인천/.test(String(entry.item.place || ''))) || priced[0];
  const total = priced.reduce((sum, entry) => sum + Number(entry.item.costKrw || 0), 0);
  outbound.item.costKrw = total;
  outbound.item.costLocal = `₩${total.toLocaleString('ko-KR')}`;
  outbound.item.place = `왕복 항공권 · 인천↔${destination}`;
  outbound.item.note = `${outbound.item.note || ''}${outbound.item.note ? ' · ' : ''}왕복 항공료(전체 일행 기준)`;
  for (const entry of priced) if (entry.item !== outbound.item) { entry.item.costKrw = 0; entry.item.costLocal = '왕복 항공권에 포함'; }
}

function enforceDayBoundaries(days) {
  if (!Array.isArray(days) || !days.length) return;
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  firstDay.items = Array.isArray(firstDay.items) ? firstDay.items : [];
  lastDay.items = Array.isArray(lastDay.items) ? lastDay.items : [];
  const firstPlace = firstDay.items[0]?.place || '';
  const lastPlace = lastDay.items.at(-1)?.place || '';
  if (/인천.*공항|icn/i.test(firstPlace)) firstDay.items[0].place = '인천국제공항 출국 수속';
  else firstDay.items.unshift(includedTransfer('인천국제공항 출국 수속', '항공편 출발 3시간 전 도착 기준 · 항공권 비용은 항공 일정 행에 포함'));
  if (/인천.*공항|icn/i.test(lastPlace)) lastDay.items[lastDay.items.length - 1].place = '인천국제공항 도착 · 귀가';
  else lastDay.items.push(includedTransfer('인천국제공항 도착 · 귀가', '입국 수속 및 귀가 · 항공권 비용은 항공 일정 행에 포함'));
  for (let index = 1; index < days.length - 1; index += 1) {
    const day = days[index];
    day.items = Array.isArray(day.items) ? day.items : [];
    if (!/숙소.*출발/.test(day.items[0]?.place || '')) day.items.unshift(includedTransfer('숙소 출발', '당일 동선 시작 · 첫 이동 비용에 포함'));
    const finalPlace = day.items.at(-1)?.place || '';
    if (/숙소.*체크인/.test(finalPlace)) continue;
    if (/숙소/.test(finalPlace)) day.items[day.items.length - 1].place = `${finalPlace} 복귀`;
    else day.items.push(includedTransfer('숙소 복귀', '당일 동선 마무리 · 마지막 이동 비용에 포함'));
  }
}

function validateAndNormalizeInput(input) {
  const destinations = Array.isArray(input.destinations) ? input.destinations.filter(Boolean) : [];
  if (!destinations.length) return '여행지를 한 곳 이상 입력해 주세요.';
  if (!input.startDate || !input.endDate) return '여행 기간의 출발일과 귀국일을 모두 선택해 주세요.';
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return '귀국일은 출발일 이후로 선택해 주세요.';
  if (Number(input.budgetKrw) <= 0) return '총 예산은 0원보다 크게 입력해 주세요.';
  const adults = Number(input.adults);
  const children = Number(input.children || 0);
  if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0) return '어린이만 단독으로 여행할 수 없으며 성인 1명 이상이 필요해요.';
  if (!Array.isArray(input.styles) || !input.styles.filter(Boolean).length) return '여행 스타일을 한 가지 이상 선택해 주세요.';
  input.destinations = destinations;
  input.adults = adults;
  input.children = children;
  input.travelers = adults + children;
  input.tripType = input.tripType || '기타';
  input.styles = input.styles.filter(Boolean);
  return null;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'POST 요청만 지원합니다.' });
  try {
    const input = request.body || {};
    const validationError = validateAndNormalizeInput(input);
    if (validationError) return response.status(400).json({ message: validationError });
    if (!process.env.OPENAI_API_KEY) return response.status(503).json({ message: 'OPENAI_API_KEY 설정이 필요합니다.' });
    const destinations = Array.isArray(input.destinations) ? input.destinations : [];
    const budgetPlan = budgetGuidance(input);
    const routePlan = routeGuidance(input);
    const densityPlan = densityPolicy(input);
    const research = await researchTravelContext(input);
    const accommodationPlan = buildAccommodationPlan(input, routePlan, research.hotels, research.lodgingCandidates);
    const sourceContext = research.sources.map(source => ({ topic: source.topic, title: source.title, url: source.url, content: source.summary }));
    const prompt = `여행 조건: ${JSON.stringify(input)}. 예산 설계 제약: ${budgetPlan.text} 다도시 동선·숙박 제약: ${routePlan.text} 일정 밀도 정책: ${densityPlan.label}. 일반일에는 핵심 방문을 반드시 ${densityPlan.fullDayMin}~${densityPlan.fullDayMax}개, 도착일·출국일에는 최대 ${densityPlan.edgeDayMax}개만 배치하고, 서로 다른 외부 일정 사이에는 최소 ${densityPlan.bufferMinutes}분의 이동·휴식 버퍼를 남겨라. SerpApi Google Flights 항공 후보: ${JSON.stringify(research.flights)}. SerpApi Google Hotels 날짜·인원별 숙박 가격 후보: ${JSON.stringify(research.hotels)}. Google Maps 실제 숙소 후보·지도 정보: ${JSON.stringify(research.lodgingCandidates)}. 이번 여행에서 확정된 도시별 숙소 체인(이름·체류기간·비용·지도 정보)은 ${JSON.stringify(accommodationPlan)}이다. Google Maps에서 국가·도시를 검증한 식당·카페·쇼핑 장소 후보: ${JSON.stringify(research.venueCandidates)}. Tavily가 방금 검색한 현지 팁·안전 웹 컨텍스트: ${JSON.stringify(sourceContext)}. 한국어로 현실적인 해외여행 계획을 작성하라.

가장 중요한 규칙:
1. SerpApi Google Flights 항공 후보가 있으면 그것을 최우선으로 사용한다. 선택한 후보의 항공사·출발/도착 시각·전체 일행 가격을 항공 행의 note, costLocal, costKrw에 그대로 반영한다. SerpApi 후보가 비어 있으면 임의의 항공편·가격을 지어내지 말고 예산 범위 안의 보수적 추정치를 쓰되 note에 '검색 결과 미확보 추정'이라고 밝힌다. Tavily는 항공·숙박 가격 근거로 사용하지 않는다. 첫 일정은 '인천국제공항 출국 수속', 마지막 일정은 '인천국제공항 도착 · 귀가'다. 목적지가 일본이어도 '도쿄 도착'이 첫 항목이거나 '일본 출국'이 마지막 항목이면 안 된다.
2. 모든 startTime은 반드시 24시간제 HH:MM 형식의 구체적인 시각이다. '항공편 기준 -3시간', '항공편 도착 후', '시간 미정' 같은 문구는 절대 쓰지 마라. 항공 검색 결과가 있으면 그 항공편 시각을 쓰고, 출국 수속은 그 출발시각보다 3시간 앞선 HH:MM으로 계산하라. 검색 결과가 여러 개면 하나를 골라 항공편명·출발/도착 시각·가격을 note에 명시하라.
3. 위의 확정 숙소 체인은 절대 변경하거나 새 호텔명으로 대체하지 마라. 첫째 날은 인천공항 출국 수속 → 항공 이동 → 현지 공항 입국 → 확정 숙소 체크인 → 저녁 일정 순서다. 마지막 날은 확정 숙소 체크아웃 → 현지 공항 이동·출국 수속 → 항공 이동 → 인천공항 도착·귀가 순서다. 일반 체류일은 그날의 확정 숙소에서 출발해 모든 외부 일정을 마친 뒤 **같은 확정 숙소로 복귀**해야 한다. 도시 간 이동으로 숙소를 바꾸는 날에만 이전 확정 숙소 체크아웃 → 이동 → 다음 확정 숙소 체크인을 명시한다. 같은 도시에서 호텔을 바꾸거나, 체크아웃·공항 이동 뒤 이전 호텔로 복귀하는 일정은 절대 만들지 마라. 다도시라면 첫 방문 도시에서 마지막 방문 도시까지 한 방향으로 이동하고, 마지막 도시에서 바로 인천으로 귀국하라. 출국을 위해 이미 방문한 첫 도시로 되돌아가는 동선은 금지다. 모든 행은 시각 오름차순이어야 한다.
4. place에는 일반명사를 쓰지 마라. '숙소', '현지 식당', '도쿄 호텔', '파리 카페', '라멘 전문점', '카페', '공항', '**~근처 식당**', '**~근처 이자카야**', '**인근/주변 식당**'은 금지다. 반드시 **실제 고유 상호명 또는 공식 장소명** 하나를 써라. 숙박의 가격·숙박일수는 SerpApi Google Hotels 후보의 해당 도시 check-in/check-out·인원 기준 totalKrw를 최우선으로 쓰고, 같은 이름이 Google Maps 후보에 있으면 주소·지도 정보로 검증한다. Google Maps 이름이 정확히 일치하지 않아도 SerpApi의 실제 호텔명을 유지하고 지도 링크는 호텔명 검색으로 연결되게 한다. 예: '도쿄 호텔'이 아니라 'Hotel Metropolitan Tokyo Marunouchi', '현지 식당'이 아니라 'Ginza Hachigou'처럼 써야 한다. 공항도 '공항'이 아니라 '도쿄 하네다공항 제3터미널'처럼 공식명으로 쓴다. 호텔 출발/복귀/체크인 행도 실제 호텔 상호를 반복해 쓴다. Tavily 검색 컨텍스트에서 찾아낸 실제 식당명, 실제 카페명, 실제 관광지명을 정확히 한 곳씩 쓴다. 식비 일정에서 같은 식당을 두 번 이상 쓰는 것은 금지이며, 매 식사는 서로 다른 실제 상호명을 선택한다. 검색 결과에서 꼭 방문할 가치가 있는 특정 카페를 찾았을 때만 카페를 별도 일정으로 넣고, 쇼핑 장소에서 잠깐 커피를 마시는 정도는 쇼핑 항목의 note에만 쓴다.
5. 한 일정 행은 한 가지 주목적만 가진다. 캐널시티 하카타 방문의 목적이 쇼핑이면 category는 '쇼핑'만 쓰고 note도 쇼핑 중심으로 쓴다. 식사는 실제 식당명을 가진 별도 '식비' 행으로 넣는다. '숙소 저녁 식사 복귀'처럼 여러 활동을 붙여 쓴 place나 note는 금지한다. 숙소 복귀 후 식사가 필요하면 특정 호텔 레스토랑 또는 특정 인근 식당을 독립된 시간·장소·식비 행으로 넣는다.
6. 숙박비는 실제 호텔 체크인/투숙 항목에 해당 도시의 숙박 박수만 반영한 전체 숙박비를 반드시 넣어라. 다도시에서는 전체 여행 박수를 각 호텔에 반복 적용하면 안 된다. 예를 들어 후쿠오카 3박·도쿄 4박(총 7박)이면 후쿠오카 호텔은 정확히 3박 금액만, 도쿄 호텔은 정확히 4박 금액만 넣는다. SerpApi Google Hotels 후보에서 totalKrw가 있으면 그것은 그 도시의 check-in~check-out 전체 투숙 금액이므로 절대로 다시 N박만큼 곱하지 말고 그대로 costKrw로 넣어라. 이때 note에는 '후쿠오카 3박 · SerpApi Google Hotels 검색 총액 ₩123,000 (성인 2명·어린이 1명 기준)'처럼 날짜·박수·전 일행 기준을 명시한다. 1박 가격만 있는 후보일 때만 '1박 요금 × 해당 도시 박수 = 총액' 산식을 쓴다. 도시별 숙박 박수의 합은 전체 숙박 박수와 정확히 같아야 한다. 일본 숙소도 ¥71이나 ¥150처럼 축약된 숫자를 쓰지 말고 ¥71,000처럼 전체 금액을 명시한다. 다도시의 국제선은 인천→첫 도시, 마지막 도시→인천의 오픈조 왕복 총액으로 첫날 항공 행에 한 번만 넣는다. 항공 행의 costKrw와 costLocal에는 반드시 왕복 항공료를 넣고 0 또는 빈 값으로 두지 마라. 도시 간 기차·국내선·버스는 각각 별도 교통 행과 비용으로 넣어라. 식사·현지 교통·유료 관광·쇼핑도 각 일정 행에 비용을 넣어라. costKrw가 0인 경우는 무료 입장·도보 등 실제 무료인 경우만 가능하다. 모든 유료 행의 costLocal에는 해당 국가 통화 기호와 숫자를 반드시 쓴다(예: ¥4,000, €25). 빈 값, '0', '—', '확인 필요'는 금지다.
7. category는 반드시 '항공', '숙박', '식비', '교통', '쇼핑', '비상금' 중 하나로 시작한다. 비용은 반드시 travelers 전체 일행 기준이며, adults와 children을 반영한다. 1인 가격을 그대로 costKrw에 쓰는 것은 금지다. 식비·입장료·인원별 교통은 note에 반드시 '¥1,500 × 성인 2명 = ¥3,000 (전 일행 2명 기준)'처럼 1인 가격 × 인원 = 총액 산식을 쓰고, costLocal/costKrw에는 그 총액을 넣어라. 입력 budgetKrw는 반드시 지켜야 하는 총 한도다. 특히 숙박비는 위 예산 설계 제약의 숙박 상한을 넘기지 말고, 상한을 넘는 호텔 검색 결과는 선택하지 마라. budget 객체는 일정표 items의 costKrw를 카테고리별로 합산한 값이어야 한다.
8. 검색 컨텍스트에 요금이 있으면 해당 요금을 우선 반영하고 note에 검색 출처의 제목을 짧게 적어라. 항공권 가격은 반드시 실제 '항공 이동' 한 행의 costKrw와 costLocal에 넣고, 출국 수속·공항 도착 행에는 중복으로 넣지 마라. 검색에 요금이 없더라도 현지 통화 금액과 원화 추정액을 채워야 하며 note에는 '검색 기반 추정'이라고 적어라. travelers는 전체 일행 수, adults는 성인 수, children은 어린이 수다. safetyCards에는 국가별 긴급전화, 대한민국 공관/영사 연락 확인 안내, 현지 주의사항을 넣되 확실하지 않은 전화나 주소는 '공식 확인 필요'로 표시하라.
9. 식비와 쇼핑 일정의 place는 반드시 Google Maps 국가·도시 검증 장소 후보에 있는 **정확한 상호명**을 그대로 사용하라. 후보에 없는 상호명, 다른 나라·도시의 동명 상호명, 검색 컨텍스트에만 있고 Google Maps 후보로 검증되지 않은 상호명은 금지다. 후보 객체의 city와 countryCode가 일정의 도시·국가를 뜻한다. 예를 들어 후쿠오카 일정에는 city가 후쿠오카이고 countryCode가 JP인 후보만 쓴다. 같은 이름이 서울에도 있어도 한국 후보를 절대 쓰지 마라.
10. 일정 밀도 정책은 선택 사항이 아니라 하드 제약이다. 일반일 핵심 방문 수가 정책 범위를 벗어나면 안 된다. 핵심 방문은 식사·관광·쇼핑·예약 카페처럼 실제 방문하는 장소이고, 공항 수속·항공·호텔 체크인/체크아웃·호텔 출발/복귀는 핵심 방문 수에 포함하지 않는다. 알차게(높음)라면 일반일에 4~5개의 실제 핵심 방문을, 매우 높음이라면 5~6개를 넣되, 무리한 장거리 이동으로 숫자만 채우면 안 된다.
11. 도착일·출국일을 제외한 모든 일반 체류일에는 실제 고유 상호명의 점심 식사(11:00~14:30)와 저녁 식사(17:00~21:30)를 각각 별도 '식비' 행으로 반드시 넣어라. 카페·쇼핑·숙소 복귀로 식사를 대체하지 말고, 두 식사는 서로 다른 실제 식당이어야 한다.`;
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'You are a meticulous travel planner. Return only structured JSON.' }, { role: 'user', content: prompt }], response_format: { type: 'json_schema', json_schema: schema }, temperature: 0.5 }) });
    const payload = await upstream.json();
    if (!upstream.ok) throw new Error(payload.error?.message || 'OpenAI 요청 실패');
    let plan = JSON.parse(payload.choices[0].message.content);
    const genericPlaces = genericVenueItems(plan.days);
    const invalidStays = stayAllocationProblems(plan.days, routePlan);
    const invalidPartyCosts = partyCostProblems(plan.days, Number(input.adults) + Number(input.children));
    const invalidLodgingCosts = lodgingCalculationProblems(plan.days);
    const duplicateFoods = duplicateFoodPlaces(plan.days);
    const missingFlightCost = flightCostProblems(plan.days);
    const invalidDensity = densityProblems(plan.days, densityPlan);
    const mealProblems = mealCoverageProblems(plan.days);
    const invalidVenues = venueVerificationProblems(plan.days, input, routePlan, research.venueCandidates);
    // Exactly one review pass catches implausible first drafts without restoring
    // the former multi-pass generation delay.
    {
      const repairPrompt = `아래 여행 계획 JSON을 한 번만 최종 검토하고 고쳐라. 일반명/모호한 place: ${JSON.stringify(genericPlaces.map(item => item.place))}. 중복 식당(각각 다른 실제 식당으로 교체): ${JSON.stringify(duplicateFoods)}. 국가·도시 Google Maps 검증 실패 식비/쇼핑 장소: ${JSON.stringify(invalidVenues)}. 일정 밀도 위반: ${JSON.stringify(invalidDensity)}. 일반 체류일의 누락 식사: ${JSON.stringify(mealProblems)}. 누락/오류 숙박 배분: ${JSON.stringify(invalidStays)}. 숙박 총액 산식 오류: ${JSON.stringify(invalidLodgingCosts.map(item => ({ place: item.place, costLocal: item.costLocal, note: item.note })))}. 일행 인원 산식이 누락된 유료 항목: ${JSON.stringify(invalidPartyCosts.map(item => ({ place: item.place, category: item.category, costLocal: item.costLocal, note: item.note })))}. 항공료 누락: ${missingFlightCost}. SerpApi 항공 후보: ${JSON.stringify(research.flights)}. SerpApi Google Hotels 날짜·인원별 총액 후보: ${JSON.stringify(research.hotels)}. Google Maps 숙소·지도 후보: ${JSON.stringify(research.lodgingCandidates)}. Google Maps 국가·도시 검증 식당·쇼핑 후보: ${JSON.stringify(research.venueCandidates)}. 다도시 동선·숙박 제약: ${routePlan.text}. 일정 밀도 제약: 일반일 핵심 방문 ${densityPlan.fullDayMin}~${densityPlan.fullDayMax}개, 도착·출국일 최대 ${densityPlan.edgeDayMax}개, 외부 일정 사이 최소 ${densityPlan.bufferMinutes}분 버퍼. 전체 JSON 형식을 유지하되, 각 place를 해당 도시의 실제 고유 상호명·공식 장소명으로 교체하라. 식비와 쇼핑은 반드시 Google Maps 국가·도시 검증 후보의 정확한 이름만 쓰고, 다른 나라·도시의 동명 장소는 절대 쓰지 마라. 일반 체류일에는 11:00~14:30 사이의 실제 식당 점심과 17:00~21:30 사이의 실제 식당 저녁을 각각 한 행씩 반드시 넣고, 카페·쇼핑·숙소 복귀로 대체하지 마라. 숙박은 SerpApi Google Hotels 후보의 실제 호텔과 해당 check-in/check-out 총액을 우선 사용한다. totalKrw는 이미 해당 도시 전체 N박·입력 인원 기준이므로 다시 N박을 곱하지 않는다. 항공은 SerpApi 후보가 있으면 그 시각·가격을 사용한다. '현지 식당', '도쿄 호텔', '숙소', '카페', '공항', '식당', '호텔', '~근처 식당', '~근처 이자카야', '인근/주변 식당' 같은 일반명은 절대 남기지 마라. 모든 식비 행은 서로 다른 실제 식당 상호명을 써라. 호텔 출발/복귀/체크인/체크아웃은 같은 실제 호텔명을 써라. 숙박 항목 note에는 SerpApi 총액이면 '도시명 N박 · SerpApi Google Hotels 검색 총액 ₩123,000 (전 일행 기준)'을, 1박 가격만 있을 때는 '도시명 N박 · ¥12,000 × 3박 = ¥36,000' 형태의 산식을 쓰고 costLocal/costKrw에는 총액을 넣어라. 항공 행에는 왕복 총항공료를 반드시 costLocal/costKrw에 넣어라. 유료 식비·입장료·교통·쇼핑은 성인 ${input.adults}명·어린이 ${input.children}명, 총 ${Number(input.adults) + Number(input.children)}명 기준으로 '1인 가격 × 인원 = 총액' 산식을 note에 넣어라. 검색 컨텍스트: ${JSON.stringify(sourceContext)}. 예산과 시간, 카테고리, 비용은 가능한 유지하라. 원본 JSON: ${JSON.stringify(plan)}`;
      const repaired = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'You repair travel JSON. Return only structured JSON with specific real venue names.' }, { role: 'user', content: repairPrompt }], response_format: { type: 'json_schema', json_schema: schema }, temperature: 0.2 }) });
      const repairedPayload = await repaired.json();
      if (repaired.ok) plan = JSON.parse(repairedPayload.choices[0].message.content);
    }
    let derivedBudget;
    let planningWarning = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attachAccommodationBoundaries(plan, input, accommodationPlan);
      materializeFlightCosts(plan.days);
      consolidateRoundTripAirfare(plan.days, plan.trip.destination);
      normalizeItineraryDetails(plan.days, plan.trip.destination);
      derivedBudget = deriveBudgetFromItinerary(plan.days);
      const overTotal = derivedBudget.totalKrw > budgetPlan.totalCeiling;
      const overAirfare = derivedBudget.airfareKrw > budgetPlan.airfareCeiling;
      const overLodging = derivedBudget.lodgingKrw > budgetPlan.lodgingCeiling;
      const invalidLodging = lodgingCalculationProblems(plan.days);
      const invalidParty = partyCostProblems(plan.days, Number(input.adults) + Number(input.children));
      const missingFlight = flightCostProblems(plan.days);
      const invalidDensity = densityProblems(plan.days, densityPlan);
      const invalidVenues = venueVerificationProblems(plan.days, input, routePlan, research.venueCandidates);
      const exceedsBudget = overTotal || overAirfare || overLodging;
      // Do not ask the model to regenerate a plan that already fits the budget.
      // The remaining deterministic checks are surfaced/repaired locally later.
      if (!exceedsBudget) break;
      if (attempt === 1) {
        const issues = [
          overTotal && `일정표 합계가 권장 상한 ₩${budgetPlan.totalCeiling.toLocaleString('ko-KR')}을 초과`,
          overAirfare && `항공료가 권장 상한 ₩${budgetPlan.airfareCeiling.toLocaleString('ko-KR')}을 초과`,
          overLodging && `숙박비가 권장 상한 ₩${budgetPlan.lodgingCeiling.toLocaleString('ko-KR')}을 초과`,
          invalidLodging.length && '숙박 금액 산식 추가 확인 필요',
          invalidParty.length && '일부 인원별 비용 산식 추가 확인 필요',
          missingFlight && '항공료 추가 확인 필요',
          invalidDensity.length && `일정 밀도(${densityPlan.label}) 제약 미충족`,
          invalidVenues.length && '일부 식당·쇼핑 장소의 국가·도시 검증 실패'
        ].filter(Boolean);
        planningWarning = `검색된 항공·숙박·일정 결과를 우선 표시합니다. ${issues.join(' · ')}. 결과에서 비용을 확인·수정하거나 예산을 조정해 주세요.`;
        break;
      }
      const correctionPrompt = `아래 여행 계획 JSON은 예산 또는 필수 비용 검증에 실패했다. 전체 일행 기준 총액은 ₩${derivedBudget.totalKrw.toLocaleString('ko-KR')}인데 반드시 ₩${budgetPlan.totalCeiling.toLocaleString('ko-KR')} 이하로 낮춰야 하고, 항공은 ₩${derivedBudget.airfareKrw.toLocaleString('ko-KR')}인데 반드시 ₩${budgetPlan.airfareCeiling.toLocaleString('ko-KR')} 이하여야 한다. 항공료 누락=${missingFlight}; 숙박 N박 총액 오류=${JSON.stringify(invalidLodging.map(item => item.place))}; 인원별 비용 산식 오류=${JSON.stringify(invalidParty.map(item => item.place))}; 일정 밀도 위반=${JSON.stringify(invalidDensity)}; 국가·도시 검증 실패 식당/쇼핑=${JSON.stringify(invalidVenues)}. SerpApi 항공 후보: ${JSON.stringify(research.flights)}. SerpApi Google Hotels 날짜·인원별 총액 후보: ${JSON.stringify(research.hotels)}. Google Maps 국가·도시 검증 식당·쇼핑 후보: ${JSON.stringify(research.venueCandidates)}. 실제 장소명·도시별 숙박 박수·시간 순서를 유지하면서, 더 저렴한 검색 기반 항공편/숙소/활동으로 교체해 모든 item의 costKrw와 costLocal을 다시 계산하라. 식비·쇼핑의 place는 반드시 Google Maps 검증 후보 중 동일 도시·국가의 정확한 이름으로 교체하라. 서울 등 다른 국가·도시의 동명 장소를 쓰면 안 된다. 일반일 핵심 방문은 ${densityPlan.fullDayMin}~${densityPlan.fullDayMax}개, 도착·출국일은 최대 ${densityPlan.edgeDayMax}개이며 외부 일정 사이 ${densityPlan.bufferMinutes}분 이상의 버퍼를 둬야 한다. 숙박은 SerpApi Google Hotels 후보에서 선택하고 totalKrw가 있으면 그 해당 도시 전체 투숙 총액을 그대로 한 번만 쓴다. SerpApi 항공 후보가 있으면 해당 가격·시각을 항공 행에 반영하라. 왕복 항공료는 첫날 항공 행의 costLocal/costKrw에 반드시 넣어라. 숙박은 SerpApi 총액일 때 note에 '후쿠오카 3박 · SerpApi Google Hotels 검색 총액 ₩123,000 (전 일행 기준)'처럼 쓰고, 1박 가격만 있을 때만 '¥12,000 × 3박 = ¥36,000' 산식을 쓴다. 유료 식비·입장료·교통은 '1인 가격 × 성인/어린이 인원 = 총액'을 note에 쓰고 costLocal은 전체 일행 총액으로 써라. 쇼핑·비상금 여유를 남겨야 하므로 총액이 입력 예산의 85%를 넘으면 안 된다. 모든 식비 행은 서로 다른 실제 식당 고유명이어야 하며 '~근처 식당', '~근처 이자카야', '인근 식당' 같은 모호한 이름은 금지다. 원본 JSON: ${JSON.stringify(plan)}. 검색 컨텍스트: ${JSON.stringify(sourceContext)}`;
      const corrected = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'You repair a travel plan to meet hard budget caps. Return only structured JSON.' }, { role: 'user', content: correctionPrompt }], response_format: { type: 'json_schema', json_schema: schema }, temperature: 0.15 }) });
      const correctedPayload = await corrected.json();
      if (!corrected.ok) {
        planningWarning = '검색된 결과를 표시합니다. 예산 보정 요청이 완료되지 않아 일부 비용은 결과 화면에서 확인·수정이 필요합니다.';
        break;
      }
      plan = JSON.parse(correctedPayload.choices[0].message.content);
    }
    plan.research = research;
    plan.trip.budgetKrw = Number(input.budgetKrw || 0);
    plan.trip.adults = Number(input.adults || input.travelers || 1);
    plan.trip.children = Number(input.children || 0);
    plan.trip.travelers = plan.trip.adults + plan.trip.children;
    plan.trip.partyLabel = `성인 ${plan.trip.adults}명${plan.trip.children ? ` · 어린이 ${plan.trip.children}명` : ''} · 총 ${plan.trip.travelers}명`;
    attachAccommodationBoundaries(plan, input, accommodationPlan);
    replaceUnverifiedVenues(plan, input, routePlan, research.venueCandidates);
    attachVerifiedVenueMetadata(plan, input, routePlan, research.venueCandidates);
    derivedBudget = deriveBudgetFromItinerary(plan.days);
    const lodgingOverLimit = derivedBudget.lodgingKrw > budgetPlan.lodgingCeiling;
    if (!planningWarning && lodgingOverLimit) planningWarning = `숙박비가 권장 상한(₩${budgetPlan.lodgingCeiling.toLocaleString('ko-KR')})을 넘었습니다. 더 저렴한 숙소 후보를 확인해 보세요.`;
    plan.planningWarning = planningWarning;
    plan.budget = { ...plan.budget, ...derivedBudget, note: planningWarning || `입력 예산의 85% 이내를 목표로 일정표의 항공·숙박·식비·교통·쇼핑·비상금 행을 합산한 전체 일행 기준 예상 지출입니다.` };
    return response.status(200).json(plan);
  } catch (error) { return response.status(502).json({ message: '여행 계획 생성에 실패했습니다.', detail: error.message }); }
}
