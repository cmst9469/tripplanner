(() => {
  let data; try { data = JSON.parse(localStorage.getItem('balanceTripPlan') || 'null'); } catch { return; }
  if (!data?.budget || !Array.isArray(data.days)) return;
  const won = value => '₩' + Number(value || 0).toLocaleString('ko-KR');
  const escapeHtml = value => String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const mapsUrl = item => item.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.place, item.address || item.city || data.trip?.destination].filter(Boolean).join(', '))}`;
  const isUncertainCost = item => Number(item.costKrw || 0) === 0 && /^(쇼핑|비상금)/.test(String(item.category || '')) && !/(무료|도보|포함)/.test(String(item.costLocal || ''));
  const budgetKey = category => /항공/.test(category) ? 'airfareKrw' : /숙박/.test(category) ? 'lodgingKrw' : /식비/.test(category) ? 'foodKrw' : /쇼핑/.test(category) ? 'shoppingKrw' : /비상/.test(category) ? 'emergencyKrw' : 'transportKrw';
  let warningShown = false;
  let exchangeRates = {};
  let mapsPromise = null;
  let routeMap = null;
  let routeOverlays = [];
  const routeCache = new Map();

  function recalculateBudget() {
    const budget = { totalKrw: 0, airfareKrw: 0, lodgingKrw: 0, foodKrw: 0, transportKrw: 0, shoppingKrw: 0, emergencyKrw: 0 };
    data.days.forEach(day => day.items.forEach(item => { const value = Math.max(0, Number(item.costKrw || 0)); budget.totalKrw += value; budget[budgetKey(String(item.category || ''))] += value; }));
    const manualEmergency = Math.max(0, Number(data.manualEmergencyKrw || 0));
    budget.emergencyKrw += manualEmergency;
    budget.totalKrw += manualEmergency;
    budget.note = data.planningWarning || '일정표의 항목별 비용 합계입니다. 직접 입력한 예상 비용은 즉시 반영됩니다.';
    data.budget = budget;
  }

  function render() {
    const trip = data.trip, budget = data.budget;
    document.querySelector('#title').textContent = `${trip.destination.replace(/,/g, '·')} 맞춤 여행 계획`;
    document.querySelector('#sub').textContent = `${trip.dates} · ${trip.partyLabel || `${trip.travelers}인`} · ${trip.tripType} · ${trip.style}`;
    document.querySelector('#expected').textContent = won(budget.totalKrw);
    document.querySelector('#inputBudget').textContent = won(trip.budgetKrw);
    document.querySelector('#ratio').textContent = `예산 ${trip.budgetKrw ? Math.round(budget.totalKrw / trip.budgetKrw * 100) : '확인 필요'}%`;
    const remaining = document.querySelector('#remaining');
    remaining.textContent = budget.note;
    remaining.classList.toggle('budget-warning', Boolean(data.planningWarning));
    const categories = [['항공', budget.airfareKrw, '#075b60'], ['숙박', budget.lodgingKrw, '#967329'], ['식비', budget.foodKrw, '#bf4638'], ['교통', budget.transportKrw, '#547f9c'], ['쇼핑', budget.shoppingKrw, '#996a9b'], ['비상금', budget.emergencyKrw, '#6f9b6c']];
    renderBudgetBreakdown(categories, budget.totalKrw);
    document.querySelector('#emergencyAmount').textContent = won(budget.emergencyKrw);
    const emergencyInput = document.querySelector('#emergencyInput');
    emergencyInput.textContent = data.manualEmergencyLocal ? '비상금 예상 비용 수정' : '비상금 예상 비용 입력하기';
    emergencyInput.onclick = editEmergency;
    document.querySelector('#itinerary').innerHTML = data.days.map((day, dayIndex) => `<section class="day"><h2>DAY ${day.day} · ${escapeHtml(day.theme)}</h2><p>${escapeHtml(day.date)}</p><div class="table-wrap"><table><thead><tr><th>시간</th><th>장소 / 활동</th><th>카테고리</th><th>현지 비용</th><th>원화 예상</th></tr></thead><tbody>${day.items.map((item, itemIndex) => `<tr><td>${escapeHtml(item.startTime)}</td><td><b><a class="place-link" href="${mapsUrl(item)}" target="_blank" rel="noreferrer" title="Google Maps에서 장소 확인">${escapeHtml(item.place)}</a></b><small>${escapeHtml(item.note)}</small></td><td><small>${escapeHtml(item.category)}</small></td><td>${/^(쇼핑|비상금)/.test(String(item.category || '')) ? `<div class="editable-cost"><b>${escapeHtml(item.costLocal || '금액 미입력')}</b><button class="cost-input" data-day="${dayIndex}" data-item="${itemIndex}">${Number(item.costKrw || 0) ? '예상 비용 수정' : '예상 비용 입력하기'}</button></div>` : escapeHtml(item.costLocal)}</td><td>${won(item.costKrw)}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
    document.querySelectorAll('.cost-input').forEach(button => button.addEventListener('click', () => editCost(Number(button.dataset.day), Number(button.dataset.item))));
    document.querySelector('#dayChip').textContent = `${data.days.length}일 일정`;
    document.querySelector('#checklist').innerHTML = data.checklist.map(item => `<label class="check"><input type="checkbox" onchange="progress()">${escapeHtml(item)}</label>`).join('');
    document.querySelector('#progress').textContent = `0 / ${data.checklist.length} 완료`;
    const safety = data.safetyCards.map(card => `<div class="safebox"><b>${escapeHtml(card.country)} · 긴급 연락</b>${escapeHtml(card.emergencyNumber)}<br>${escapeHtml(card.embassy)}</div><div class="safebox warn"><b>${escapeHtml(card.country)} · 주의사항</b>${escapeHtml(card.warning)}</div>`).join('');
    const sources = (data.research?.sources || []).slice(0, 7);
    const research = `<div class="research-box"><b>웹 검색 출처</b><small>${escapeHtml(data.research?.status || '검색 정보 없음')} · ${data.research?.retrievedAt ? new Date(data.research.retrievedAt).toLocaleString('ko-KR') : '조회 시각 없음'}</small>${sources.length ? `<ul>${sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a></li>`).join('')}</ul>` : '<p>공식 안내는 출발 전 다시 확인해 주세요.</p>'}</div>`;
    document.querySelector('.safe').innerHTML = safety + research;
    localStorage.setItem('balanceTripPlan', JSON.stringify(data));
  }

  function renderBudgetBreakdown(categories, total) {
    const positive = categories.filter(([, value]) => Number(value) > 0);
    document.querySelector('#budgetBars').innerHTML = `<div class="stacked-budget-bar" aria-label="카테고리별 예상 경비 누적 막대">${positive.map(([, value, color]) => `<span style="width:${total ? Number(value) / total * 100 : 0}%;background:${color}"></span>`).join('')}</div>`;
    document.querySelector('#costRows').innerHTML = categories.map(([name, value, color]) => {
      const ratio = total ? Math.round(Number(value) / total * 100) : 0;
      return `<div class="costrow"><span><i style="background:${color}"></i>${name}</span><b>${won(value)}</b><small>${ratio}%</small></div>`;
    }).join('');
  }

  function editCost(dayIndex, itemIndex) {
    const item = data.days[dayIndex]?.items[itemIndex]; if (!item) return;
    const currency = currencyForItem(item);
    const typed = window.prompt(`${item.place}의 현지 예상 비용을 숫자만 입력하세요. (${currency.symbol})`, String(item.costLocal || '').replace(/[^0-9.]/g, ''));
    if (typed === null) return;
    const amount = Number(String(typed).replaceAll(',', ''));
    const rate = exchangeRates[currency.unit];
    if (!Number.isFinite(amount) || amount < 0) { window.alert('현지 통화 금액을 숫자로 입력해 주세요.'); return; }
    if (!rate) { window.alert('실시간 환율을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
    item.costLocal = formatLocalCost(currency, amount);
    item.costKrw = Math.round(amount * ratePerUnit(currency.unit));
    item.note = `${item.note || ''}${item.note ? ' · ' : ''}사용자 입력 예상 비용`;
    recalculateBudget(); render();
  }

  function editEmergency() {
    const currency = currencyForItem({ costLocal: data.manualEmergencyLocal || '' });
    const typed = window.prompt(`비상금의 현지 예상 비용을 숫자만 입력하세요. (${currency.symbol})`, String(data.manualEmergencyLocal || '').replace(/[^0-9.]/g, ''));
    if (typed === null) return;
    const amount = Number(String(typed).replaceAll(',', ''));
    const rate = exchangeRates[currency.unit];
    if (!Number.isFinite(amount) || amount < 0) { window.alert('현지 통화 금액을 숫자로 입력해 주세요.'); return; }
    if (!rate) { window.alert('실시간 환율을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
    data.manualEmergencyLocal = formatLocalCost(currency, amount);
    data.manualEmergencyKrw = Math.round(amount * ratePerUnit(currency.unit));
    recalculateBudget(); render();
  }

  function exchangeDate() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', ''); }
  const currencyMeta = {
    'JPY(100)': { unit: 'JPY(100)', symbol: '¥' }, EUR: { unit: 'EUR', symbol: '€' }, GBP: { unit: 'GBP', symbol: '£' }, THB: { unit: 'THB', symbol: '฿' }, SGD: { unit: 'SGD', symbol: 'S$' }, TWD: { unit: 'TWD', symbol: 'NT$' }, HKD: { unit: 'HKD', symbol: 'HK$' }, 'VND(100)': { unit: 'VND(100)', symbol: '₫' }, USD: { unit: 'USD', symbol: 'US$' }
  };
  function formatLocalCost(currency, amount) { return `${currency.symbol}${Math.round(Number(amount || 0)).toLocaleString('en-US')}`; }
  function ratePerUnit(unit, rates = exchangeRates) { const rate = Number(rates[unit] || 0); return /\(100\)$/.test(unit) ? rate / 100 : rate; }
  function destinationCurrency() {
    const destination = String(data.trip?.destination || '');
    if (/일본|도쿄|오사카|후쿠오카|교토|삿포로/.test(destination)) return currencyMeta['JPY(100)'];
    if (/프랑스|파리|이탈리아|로마|스페인|바르셀로나|독일|포르투갈/.test(destination)) return currencyMeta.EUR;
    if (/영국|런던/.test(destination)) return currencyMeta.GBP;
    if (/태국|방콕/.test(destination)) return currencyMeta.THB;
    if (/싱가포르/.test(destination)) return currencyMeta.SGD;
    if (/대만|타이베이|가오슝|타이중|taiwan|taipei|kaohsiung|taichung/i.test(destination)) return currencyMeta.TWD;
    if (/홍콩|hong kong/i.test(destination)) return currencyMeta.HKD;
    if (/베트남|하노이|다낭|호치민|vietnam|hanoi|da nang|ho chi minh/i.test(destination)) return currencyMeta['VND(100)'];
    return currencyMeta.USD;
  }
  function parseLocalCost(value) {
    const text = String(value || '').replaceAll(',', '');
    const amount = Number((text.match(/[0-9]+(?:\.[0-9]+)?/) || [])[0]);
    if (!Number.isFinite(amount)) return null;
    if (/€|EUR/i.test(text)) return { unit: 'EUR', amount };
    if (/¥|JPY/i.test(text)) return { unit: 'JPY(100)', amount };
    if (/£|GBP/i.test(text)) return { unit: 'GBP', amount };
    if (/฿|THB/i.test(text)) return { unit: 'THB', amount };
    if (/S\$|SGD/i.test(text)) return { unit: 'SGD', amount };
    if (/NT\$|TWD/i.test(text)) return { unit: 'TWD', amount };
    if (/HK\$|HKD/i.test(text)) return { unit: 'HKD', amount };
    if (/₫|VND/i.test(text)) return { unit: 'VND(100)', amount };
    if (/US\$|USD|\$/i.test(text)) return { unit: 'USD', amount };
    return null;
  }
  function currencyForItem(item) {
    const parsed = parseLocalCost(item.costLocal);
    return parsed ? currencyMeta[parsed.unit] || destinationCurrency() : destinationCurrency();
  }
  async function applyLiveExchangeRates() {
    try {
      const response = await fetch(`/api/exchange?searchdate=${exchangeDate()}`);
      const payload = await response.json(); if (!response.ok || !Array.isArray(payload.items)) return;
      const rates = Object.fromEntries(payload.items.map(item => [item.cur_unit, Number(String(item.deal_bas_r).replaceAll(',', ''))])); exchangeRates = rates;
      let changed = false;
      const destinationCurrencyMeta = destinationCurrency();
      data.days.forEach(day => day.items.forEach(item => {
        const local = parseLocalCost(item.costLocal);
        const shouldUseDestinationCurrency = !isAirportOrFlight(item) && Number(item.costKrw || 0) > 0 && !/(무료|도보|포함)/.test(String(item.costLocal || ''));
        if (shouldUseDestinationCurrency && (!local || local.unit !== destinationCurrencyMeta.unit) && ratePerUnit(destinationCurrencyMeta.unit, rates)) {
          item.costLocal = formatLocalCost(destinationCurrencyMeta, Number(item.costKrw) / ratePerUnit(destinationCurrencyMeta.unit, rates));
          changed = true;
          return;
        }
        const rate = local && ratePerUnit(local.unit, rates);
        if (!rate) return;
        item.costKrw = Math.round(local.amount * rate); changed = true;
      }));
      const emergency = parseLocalCost(data.manualEmergencyLocal);
      if (emergency && rates[emergency.unit]) {
        data.manualEmergencyKrw = Math.round(emergency.amount * ratePerUnit(emergency.unit, rates));
        changed = true;
      }
      if (changed) {
        recalculateBudget();
        if (!data.planningWarning) data.budget.note = `한국수출입은행 기준환율(${payload.searchdate})을 반영한 일정표 비용 합계입니다.`;
        render();
      }
    } catch { /* 기존 생성 비용을 유지합니다. */ } finally { showBudgetWarning(); }
  }

  function showBudgetWarning() {
    if (warningShown || !data.trip?.budgetKrw || data.budget.totalKrw <= data.trip.budgetKrw) return;
    warningShown = true;
    const excess = data.budget.totalKrw - data.trip.budgetKrw;
    window.alert(`예산 경고\n현재 예상 지출이 입력 예산보다 ${won(excess)} 높습니다. 쇼핑·비상금 등의 예상 비용을 조정하거나 계획을 다시 만들어 보세요.`);
  }

  function isAirportOrFlight(item) {
    return /^(항공|교통\s*·?\s*항공)/.test(String(item.category || '')) || /인천.*공항|국제공항|공항.*(?:출국|입국)|항공편|비행/.test(String(item.place || ''));
  }

  function pointFromItem(item, fallbackCity) {
    const location = item.location && Number.isFinite(Number(item.location.latitude ?? item.location.lat)) && Number.isFinite(Number(item.location.longitude ?? item.location.lng))
      ? { latitude: Number(item.location.latitude ?? item.location.lat), longitude: Number(item.location.longitude ?? item.location.lng) }
      : null;
    return { place: item.place, address: item.address || '', city: item.city || fallbackCity || '', location };
  }

  function samePoint(left, right) {
    if (!left || !right) return false;
    if (left.location && right.location) return left.location.latitude === right.location.latitude && left.location.longitude === right.location.longitude;
    return String(left.place || '').trim().toLowerCase() === String(right.place || '').trim().toLowerCase();
  }

  function routePointsForDay(day) {
    const items = Array.isArray(day.items) ? day.items : [];
    const fallbackCity = items.find(item => item.city)?.city || String(data.trip?.destination || '').split(',')[0].trim();
    const accommodationItems = items.filter(item => item.accommodationId);
    const accommodationIds = [...new Set(accommodationItems.map(item => item.accommodationId))];
    const activeAccommodation = (data.accommodations || []).find(stay => stay.accommodationId === (day.accommodationId || accommodationIds.at(-1)));
    const exterior = items.filter(item => !item.accommodationId && !isAirportOrFlight(item)).map(item => pointFromItem(item, fallbackCity));
    if (activeAccommodation && accommodationIds.length <= 1 && exterior.length) {
      const hotel = pointFromItem({ place: activeAccommodation.name, address: activeAccommodation.address, city: activeAccommodation.city, location: activeAccommodation.location }, activeAccommodation.city);
      return [hotel, ...exterior, hotel].filter((point, index, all) => index === 0 || index === all.length - 1 || !samePoint(point, all[index - 1]));
    }
    const ordered = items.filter(item => !isAirportOrFlight(item)).map(item => pointFromItem(item, fallbackCity));
    return ordered.filter((point, index) => !index || !samePoint(point, ordered[index - 1]));
  }

  async function loadGoogleMaps() {
    if (window.google?.maps?.Map) return window.google.maps;
    if (mapsPromise) return mapsPromise;
    mapsPromise = (async () => {
      const configResponse = await fetch('/api/maps-config');
      const config = await configResponse.json();
      if (!configResponse.ok || !config.apiKey) throw new Error(config.message || '지도 API 키를 불러오지 못했습니다.');
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.apiKey)}&libraries=geometry&language=ko&region=KR&v=weekly`;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Google Maps JavaScript API를 불러오지 못했습니다.'));
        document.head.appendChild(script);
      });
      return window.google.maps;
    })();
    return mapsPromise;
  }

  function clearRouteOverlays() {
    routeOverlays.forEach(overlay => overlay.setMap?.(null));
    routeOverlays = [];
  }

  function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`;
  }

  function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
  }

  function toMapLatLng(location) {
    const lat = Number(location?.lat ?? location?.latitude);
    const lng = Number(location?.lng ?? location?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('경로 좌표를 지도에 표시할 수 없습니다.');
    return { lat, lng };
  }

  async function renderRouteForDay(dayIndex) {
    const day = data.days[dayIndex];
    const status = document.querySelector('#routeStatus');
    const meta = document.querySelector('#routeMeta');
    const mapElement = document.querySelector('#routeMap');
    document.querySelectorAll('.route-day').forEach((button, index) => button.classList.toggle('is-active', index === dayIndex));
    document.querySelector('#routeDayLabel').textContent = `DAY ${day.day}`;
    const points = routePointsForDay(day);
    if (points.length < 2) {
      mapElement.innerHTML = '';
      status.textContent = '이 날짜에는 같은 도시 안에서 이어 표시할 장소가 부족합니다.';
      status.className = 'route-status error';
      meta.textContent = '';
      return;
    }
    status.textContent = '실제 도로 경로를 계산하고 있습니다.';
    status.className = 'route-status';
    meta.textContent = '숙소를 기준으로 방문 순서에 맞춰 경로를 계산합니다.';
    try {
      const cacheKey = `${day.date}|${JSON.stringify(points)}`;
      let result = routeCache.get(cacheKey);
      if (!result) {
        const response = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ points }) });
        result = await response.json();
        if (!response.ok) throw new Error(result.message || '경로를 계산하지 못했습니다.');
        routeCache.set(cacheKey, result);
      }
      const maps = await loadGoogleMaps();
      if (!routeMap) routeMap = new maps.Map(mapElement, { center: toMapLatLng(result.stops[0].location), zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      clearRouteOverlays();
      const path = result.encodedPolyline ? maps.geometry.encoding.decodePath(result.encodedPolyline) : result.stops.map(stop => toMapLatLng(stop.location));
      const line = new maps.Polyline({ path, geodesic: true, strokeColor: '#075b60', strokeOpacity: .9, strokeWeight: 5, map: routeMap });
      routeOverlays.push(line);
      const bounds = new maps.LatLngBounds();
      result.stops.forEach((stop, index) => {
        const last = index === result.stops.length - 1;
        const location = toMapLatLng(stop.location);
        const marker = new maps.Marker({ map: routeMap, position: location, label: { text: last ? '✓' : String(index + 1), color: '#ffffff', fontWeight: '700' }, title: stop.place, icon: { path: maps.SymbolPath.CIRCLE, scale: last ? 10 : 8, fillColor: last ? '#075b60' : '#bf4638', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } });
        routeOverlays.push(marker);
        bounds.extend(location);
      });
      routeMap.fitBounds(bounds, 52);
      const origin = result.stops[0].place;
      const destination = result.stops.at(-1).place;
      meta.innerHTML = `<span>출발 · ${escapeHtml(origin)}</span><span>총 ${formatDistance(result.distanceMeters)} · 약 ${formatDuration(result.durationSeconds)}</span><span>도착 · ${escapeHtml(destination)}</span>`;
      status.textContent = `${result.stops.length}개 장소의 실제 도로 경로를 표시했습니다.`;
    } catch (error) {
      mapElement.innerHTML = '';
      routeMap = null;
      status.textContent = error.message || '지도 경로를 표시하지 못했습니다.';
      status.className = 'route-status error';
      meta.textContent = 'Routes API 및 Google Maps JavaScript API 설정을 확인해 주세요.';
    }
  }

  function setupRouteMap() {
    const routeDays = document.querySelector('#routeDays');
    if (!routeDays) return;
    routeDays.innerHTML = data.days.map((day, index) => `<button class="route-day${index === 0 ? ' is-active' : ''}" type="button" data-day="${index}">DAY ${escapeHtml(day.day)} · ${escapeHtml(day.date)}</button>`).join('');
    routeDays.querySelectorAll('.route-day').forEach(button => button.addEventListener('click', () => renderRouteForDay(Number(button.dataset.day))));
    renderRouteForDay(0);
  }

  recalculateBudget(); render(); setupRouteMap(); applyLiveExchangeRates(); setTimeout(showBudgetWarning, 1800);
})();
