// 영어 번역 (core). 키는 화면의 한국어 원문, 값은 영어. web/js/i18n.js 참고.
export const EN = {
  // ---------- logic.js: 경보 단계 (EMERGENCY_LEVELS) ----------
  '경계': 'Alert',
  '경계 발령': 'Alert issued',
  '실제': 'Emergency',
  '실제 상황': 'Real emergency',
  '비상': 'Emergency',

  // ---------- logic.js: 집합장소 일정·시간 ----------
  '{rank}순위 시간이 {prev}순위의 대기 종료보다 빠릅니다.': 'Meeting point #{rank} starts before the waiting time at #{prev} ends.',
  '비상 발생 직후': 'Right at the start',
  '지남': 'Passed',
  '기록 없음': 'No record',
  '방금': 'Just now',
  '{n}분 전': '{n} min ago',
  '{n}시간 전': '{n} h ago',

  // ---------- logic.js: 생존신고 상태 (CHECKIN_LABEL, memberStatus) ----------
  '무사함': 'Safe',
  '도움 필요': 'Need help',
  '체크포인트': 'Checkpoint',
  '확인 안 됨': 'Not confirmed',
  '신고 기록 없음': 'No check-ins yet',
  '마지막: {label}': 'Last: {label}',

  // ---------- logic.js: 길찾기·문자 ----------
  '목적지': 'Destination',
  '카카오맵': 'Kakao Map',
  '구글지도': 'Google Maps',
  '위치: {url}': 'Location: {url}',
  '(위치 확인 안 됨)': '(location unavailable)',
  '[가족 비상연락] {name} 무사합니다. {time}{where}': '[Family Emergency] {name} is safe. {time}{where}',
  '걸어서 약 {time}': 'About {time} on foot',

  // ---------- logic.js: 기록 종류 (LOG_KINDS) ----------
  '테스트 알람': 'Test alarm',
  '생존신고': 'Safety check-in',
  '도움 요청': 'Need help',
  '집합 기록': 'Meeting point log',
  '알림 발송': 'Notification sent',
  '관리 작업': 'Admin action',

  // ---------- logic.js: 관리 기록 (AUDIT_LABELS) ----------
  '가족 추가': 'Family member added',
  '가족 정보 수정': 'Family member updated',
  '가족 삭제': 'Family member removed',
  '접근 허용': 'Access allowed',
  '접근 차단': 'Access blocked',
  '비상선언권 다시 줌': 'Declaration credit restored',
  '비밀코드 초기화': 'Secret code reset',
  '신고 기록 삭제': 'Check-in record deleted',
  '집합장소 저장': 'Meeting point saved',
  '집합장소 삭제': 'Meeting point deleted',
  '대처법 저장': 'Instructions saved',
  '대처법 삭제': 'Instructions deleted',
  '기본 대처법 불러옴': 'Default instructions loaded',
  '연락처 저장': 'Contact saved',
  '연락처 삭제': 'Contact deleted',
  '비상 알림 발송': 'Emergency notification sent',
  '해제 알림 발송': 'All-clear notification sent',
  '테스트 알림 발송': 'Test notification sent',
  '테스트 알람 발송': 'Test alarm sent',

  // ---------- logic.js: 비상 기록 제목·타임라인 ----------
  '비상 해제': 'Emergency ended',
  '실제 상황 전환: {type}': 'Escalated to real emergency: {type}',
  '경계 발령: {type}': 'Alert issued: {type}',
  '실제 상황 선언: {type}': 'Real emergency declared: {type}',
  '가족 전체 테스트 알람 ({sound})': 'Family-wide test alarm ({sound})',
  '경계음': 'alert tone',
  '실제음': 'emergency tone',
  '{rank}순위 집합장소 기록': 'Meeting point #{rank} check-in',

  // ---------- logic.js: 아이디·비밀코드 ----------
  '영문 소문자·숫자로 시작하는 3~20자 (영문 소문자, 숫자, . _ - 사용 가능)': '3–20 characters starting with a lowercase letter or number (lowercase letters, numbers, . _ - allowed)',
  '비밀코드는 6자 이상이어야 합니다.': 'Secret code must be at least 6 characters.',
  '비밀코드는 64자 이하여야 합니다.': 'Secret code must be 64 characters or fewer.',
  '너무 쉬운 비밀코드입니다. 다른 조합을 쓰세요.': 'That secret code is too easy to guess. Choose a different one.',

  // ---------- logic.js: 선택지 (화면에서 표시용으로 번역. 저장 값은 한국어 그대로) ----------
  '모름': 'Unknown',
  '남': 'Male',
  '여': 'Female',
  '기타': 'Other',

  // ---------- logic.js: 비상 종류 (EMERGENCY_TYPES) ----------
  '전쟁·공습': 'War / air raid',
  '화생방·핵': 'CBRN / nuclear',
  '지진': 'Earthquake',
  '태풍·홍수': 'Typhoon / flood',
  '지진해일': 'Tsunami',
  '산사태': 'Landslide',
  '화재·산불': 'Fire / wildfire',
  '폭염': 'Heat wave',
  '한파·폭설': 'Cold wave / heavy snow',
  '감염병': 'Infectious disease',
  '정전·통신두절': 'Power / communications outage',
  '비상 상황': 'Emergency',

  // ---------- firebase.js ----------
  '알림 서버(Worker) 주소가 설정되지 않았습니다.': 'The notification server (Worker) address is not configured.',
  '서버 오류 ({status})': 'Server error ({status})',
  '아이디 또는 비밀코드가 맞지 않습니다.': 'Incorrect ID or secret code.',
  '비밀코드가 맞지 않습니다.': 'Incorrect secret code.',
  '등록되지 않은 아이디입니다.': 'This ID is not registered.',
  '아이디 형식이 올바르지 않습니다.': 'This ID is not in a valid format.',
  '비밀코드를 입력하세요.': 'Enter your secret code.',
  '시도가 너무 많습니다. 잠시 후 다시 시도하세요.': 'Too many attempts. Please wait a moment and try again.',
  '인터넷 연결을 확인하세요.': 'Check your internet connection.',
  '이미 사용 중인 아이디입니다.': 'This ID is already in use.',
  '보안을 위해 다시 로그인한 뒤 시도하세요.': 'For security, sign in again and then retry.',
  '권한이 없습니다.': 'You do not have permission.',
  '서버에 연결할 수 없습니다. 연결되면 자동으로 다시 시도합니다.': 'Cannot reach the server. It will retry automatically once connected.',

  // ---------- push.js ----------
  '알림 키(vapidKey)가 설정되지 않았습니다.': 'The notification key (vapidKey) is not configured.',
  '아이폰은 먼저 공유 버튼 → "홈 화면에 추가"를 한 뒤, 홈 화면 아이콘으로 열어서 알림을 켜세요.': 'On iPhone, first tap Share → "Add to Home Screen", then open the app from the home screen icon and turn on notifications.',
  '이 브라우저는 알림을 지원하지 않습니다.': 'This browser does not support notifications.',
  '알림 권한이 거부됐습니다. 휴대폰 설정에서 이 사이트의 알림을 허용하세요.': 'Notification permission was denied. Allow notifications for this site in your phone settings.',

  // ---------- geo.js ----------
  '위치 권한이 꺼져 있습니다. 휴대폰 설정에서 이 사이트(또는 브라우저)의 위치 권한을 허용하세요.': 'Location permission is off. Allow location access for this site (or browser) in your phone settings.',
  '위치를 찾을 수 없습니다. 하늘이 보이는 건물 밖이나 창가에서 다시 시도하세요.': 'Unable to find your location. Try again outdoors or near a window with a clear view of the sky.',
  '위치 확인 시간이 초과됐습니다. 하늘이 보이는 곳에서 다시 시도하세요.': 'Location request timed out. Try again where you can see the sky.',
  '이 기기는 위치 기능을 지원하지 않습니다.': 'This device does not support location services.',

  // ---------- map.js ----------
  '지도를 불러올 수 없습니다 (오프라인). 주소와 길찾기 링크를 이용하세요.': 'Unable to load the map (offline). Use the address and directions links instead.',
};
