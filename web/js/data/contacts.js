// 국내 공공 비상 연락처 (앱에 내장되어 오프라인에서도 보인다).
// 번호를 고칠 때는 해당 기관의 공식 안내로 확인한다.

export const HOTLINE_GROUPS = [
  {
    title: '긴급 신고',
    items: [
      { number: '119', name: '소방 (화재·구조·구급)', note: '불, 사고, 응급환자. 문자·영상 신고도 가능' },
      { number: '112', name: '경찰', note: '범죄, 실종, 위급 상황' },
      { number: '122', name: '해양경찰', note: '바다·해안 사고' },
    ],
  },
  {
    title: '재난·생활 안전',
    items: [
      { number: '110', name: '정부민원안내콜센터', note: '어느 기관에 물어야 할지 모를 때' },
      { number: '1339', name: '질병관리청 콜센터', note: '감염병 증상·검사·격리 안내' },
      { number: '123', name: '한국전력 (전기 고장)', note: '정전, 전선 사고' },
      { number: '121', name: '상수도 고장 신고', note: '단수, 수도관 파열 (지역 상수도사업본부 연결)' },
      { number: '1544-4500', name: '한국가스안전공사', note: '가스 누출 의심' },
    ],
  },
  {
    title: '가족·상담',
    items: [
      { number: '182', name: '실종아동찾기센터', note: '아이·치매 어르신을 잃어버렸을 때' },
      { number: '129', name: '보건복지상담센터', note: '긴급 복지 지원, 생계 지원' },
      { number: '109', name: '자살예방 상담전화', note: '재난 후 마음이 힘들 때, 24시간' },
    ],
  },
];

export const USEFUL_LINKS = [
  { name: '국민재난안전포털', href: 'https://www.safekorea.go.kr', note: '대피소 찾기, 재난 행동요령' },
  { name: '안전디딤돌 앱', href: 'https://www.safekorea.go.kr', note: '재난문자 다시 보기, 가까운 대피소 (앱스토어에서 "안전디딤돌" 검색)' },
  { name: '기상청 날씨누리', href: 'https://www.weather.go.kr', note: '태풍·호우·지진 특보' },
];
