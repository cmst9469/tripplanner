const dateOffset = (date, offset) => {
  const value = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10).replaceAll('-', '');
};

export default async function handler(request, response) {
  const requestedDate = request.query.searchdate ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');

  if (!/^\d{8}$/.test(requestedDate)) {
    return response.status(400).json({ message: 'searchdate는 YYYYMMDD 형식이어야 합니다.' });
  }
  if (!process.env.EXIM_AUTH_KEY) {
    return response.status(503).json({ message: '환율 서비스 설정이 필요합니다.' });
  }

  try {
    for (let offset = 0; offset <= 10; offset += 1) {
      const searchdate = dateOffset(requestedDate, offset);
      const upstream = new URL('https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON');
      upstream.searchParams.set('authkey', process.env.EXIM_AUTH_KEY);
      upstream.searchParams.set('searchdate', searchdate);
      upstream.searchParams.set('data', 'AP01');
      const apiResponse = await fetch(upstream, { headers: { Accept: 'application/json' } });
      const items = await apiResponse.json();
      const selected = Array.isArray(items)
        ? items.filter((item) => ['USD', 'EUR', 'JPY(100)', 'GBP', 'THB', 'SGD'].includes(item.cur_unit))
        : [];
      if (selected.length) {
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
        return response.status(200).json({ searchdate, items: selected });
      }
    }
    return response.status(404).json({ message: '최근 10일 내 조회 가능한 환율 데이터가 없습니다.' });
  } catch {
    return response.status(502).json({ message: '한국수출입은행 환율 API 호출에 실패했습니다.' });
  }
}
