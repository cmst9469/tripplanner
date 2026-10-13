/**
 * 한국수출입은행 환율 API 프록시 예시 (Cloudflare Worker / Pages Functions 형태).
 *
 * 서버 환경변수에 EXIM_AUTH_KEY를 설정하세요.
 * 브라우저 코드에는 인증키를 넣지 않습니다.
 *
 * 요청: GET /api/exchange?searchdate=YYYYMMDD
 */
export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    const searchdate = requestUrl.searchParams.get('searchdate') ||
      new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');

    if (!/^\d{8}$/.test(searchdate)) {
      return Response.json({ message: 'searchdate는 YYYYMMDD 형식이어야 합니다.' }, { status: 400 });
    }
    if (!env.EXIM_AUTH_KEY) {
      return Response.json({ message: '서버의 EXIM_AUTH_KEY가 설정되지 않았습니다.' }, { status: 503 });
    }

    const upstream = new URL('https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON');
    upstream.searchParams.set('authkey', env.EXIM_AUTH_KEY);
    upstream.searchParams.set('searchdate', searchdate);
    upstream.searchParams.set('data', 'AP01');

    const response = await fetch(upstream, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return Response.json({ message: '한국수출입은행 API 호출에 실패했습니다.' }, { status: 502 });
    }

    const items = await response.json();
    if (!Array.isArray(items)) {
      return Response.json({ message: '조회 가능한 환율 데이터가 없습니다. 영업일을 확인해 주세요.' }, { status: 404 });
    }

    return Response.json(
      { searchdate, items: items.filter((item) => ['USD', 'EUR', 'JPY(100)'].includes(item.cur_unit)) },
      { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
  },
};
