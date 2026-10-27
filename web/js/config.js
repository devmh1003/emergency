// 사이트 설정. 이 파일은 공개 저장소에 올라가므로 공개돼도 괜찮은 값만 넣는다.
// Firebase 웹 설정(apiKey 포함)은 비밀이 아니다. 데이터 보호는 firestore.rules 가 한다.
// 비밀 키(서비스 계정)는 절대 여기에 넣지 말고 Cloudflare Worker 비밀 변수에만 둔다.
// 서비스 워커(sw.js)도 이 파일을 읽기 때문에 모듈이 아닌 일반 스크립트로 둔다.
self.FAMILY_CONFIG = {
  appName: '우리 가족 비상연락',

  // Firebase 콘솔 → 프로젝트 설정 → 내 앱 → 웹 앱 → SDK 설정 및 구성
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: '',
  },

  // Firebase 콘솔 → 프로젝트 설정 → 클라우드 메시징 → 웹 푸시 인증서 → 키 쌍
  vapidKey: '',

  // Cloudflare Worker 주소 (예: https://family-emergency.내계정.workers.dev)
  workerUrl: '',

  // 로컬 개발용: true 이고 localhost 에서 열면 Firebase 에뮬레이터에 연결한다.
  useEmulators: false,
};
