// 영어 번역 (앱 틀, 로그인·접속 코드, 오프라인 준비). 키는 화면의 한국어 원문, 값은 영어. web/js/i18n.js 참고.
export const EN = {
  // ---------- 앱 틀 (app.js) ----------
  '화면을 그리지 못했습니다: {error}': 'Could not display this screen: {error}',
  '연락처': 'Contacts',
  '가족': 'Family',
  '우리 가족 비상연락': 'Family Emergency Network',
  '● 1급 비상': '● Level 1',
  '● 2급 비상': '● Level 2',
  '● 평상시': '● Normal',
  '오프라인 상태입니다. 저장된 정보를 보여주고, 생존신고는 휴대폰에 보관했다가 연결되면 자동 전송합니다. GPS 위치 확인은 계속 됩니다.':
    'You are offline. Saved information is shown, and check-ins are kept on this phone and sent automatically when you reconnect. GPS location still works.',
  '2급 비상 발령 — {type}': 'Level 2 emergency declared — {type}',
  '생존신고를 하고 대비하세요': 'Check in and get ready',
  '1급 비상 — {type}': 'Level 1 emergency — {type}',
  '지금 갈 곳: {rank}순위 {name}': 'Go now: Priority {rank} {name}',
  '비상 상황에서 가족의 안전을 확인하고 다시 모이기 위한 가족 전용 서비스입니다.':
    'A private service for confirming each other’s safety and reuniting as a family in an emergency.',
  '실제 재난 시에는 재난문자와 공공기관의 안내를 함께 확인하세요.':
    'In a real disaster, also follow emergency alert text messages and official guidance.',
  '긴급 신고': 'Emergency numbers',
  '119 화재·구조·구급': '119 Fire · Rescue · Ambulance',
  '112 경찰': '112 Police',
  '1339 질병관리청': '1339 Disease control (KDCA)',
  '버전 {build}': 'Version {build}',
  '인터넷 연결이 필요합니다': 'Internet connection required',
  '처음 들어올 때는 인터넷이 필요합니다. 한 번 들어온 뒤에는 인터넷 없이도 열립니다.':
    'You need the internet the first time you sign in. After that, the app opens without it.',
  '문제가 생겼습니다. 화면을 새로고침해 주세요.': 'Something went wrong. Please reload the page.',
  '본문 바로가기': 'Skip to main content',
  '주 메뉴': 'Main menu',
  '하단 메뉴': 'Bottom menu',

  // ---------- 접속 코드 검사 (logic.js, store.js) ----------
  '가족 코드': 'Family code',
  '관리자 코드': 'Admin code',
  '백업 코드': 'Backup code',
  '{label}는 {n}자 이상이어야 합니다.': '{label} must be at least {n} characters.',
  '접속 코드는 64자 이하여야 합니다.': 'Access codes must be 64 characters or fewer.',
  '너무 쉬운 코드입니다. 다른 조합을 쓰세요.': 'That code is too easy to guess. Choose a different one.',
  '세 코드는 서로 달라야 합니다.': 'The three codes must all be different.',
  '아직 초기 설정이 안 됐습니다.': 'Setup has not been completed yet.',
  '이미 초기 설정이 끝났습니다.': 'Setup has already been completed.',
  '다른 접속 코드와 같습니다. 다른 코드를 쓰세요.': 'That is the same as another access code. Choose a different one.',
  '접속 코드 변경': 'Access code changed',
  '백업 코드로 관리자 코드 변경': 'Admin code changed with backup code',
  '백업 코드로 관리자 추가': 'Admin added with backup code',
  '예전 방식 계정 정리': 'Old-style accounts cleaned up',

  // ---------- 가족 추가·수정 (admin.js) ----------
  '가족은 가족 코드, 관리자는 관리자 코드를 넣은 뒤 목록에서 이 이름을 고릅니다. 같은 이름이 둘이면 헷갈리니 구분되게 적으세요.':
    'Family members enter the family code (admins the admin code), then pick this name from the list. Use distinct names so no two look alike.',
  '같은 이름의 가족이 이미 있습니다. 로그인 목록에서 구분되도록 다르게 적어 주세요.':
    'A family member with this name already exists. Use a different name so it can be told apart in the sign-in list.',
  '{name}님을 추가했습니다. {code}를 알려 주면 목록에서 이름을 골라 들어올 수 있습니다.':
    '{name} has been added. Share the {code} with them and they can pick their name from the list to sign in.',
  '저장하면 바로 로그인 목록에 이름이 올라갑니다. 따로 정할 아이디나 비밀번호는 없습니다.':
    'Once saved, the name appears in the sign-in list right away. There is no separate ID or password to set.',
  '1급 비상 발생 후 (시간)': 'Hours after the emergency starts',
  '1급 비상 중에 시간을 바꿔야 할 때 씁니다. 비워 두면 "1급 비상 발생 후 시간"으로 계산합니다.':
    'Use this to change the time during a Level 1 emergency. Leave empty to use "hours after the emergency starts".',

  // ---------- 로그인 화면 (auth.js) ----------
  '불러오는 중': 'Loading',
  '설정이 필요합니다': 'Configuration needed',
  '사이트를 쓰려면 Firebase 연결 정보를 넣어야 합니다.': 'Firebase connection details must be added before the site can be used.',
  '저장소의 web/js/config.js 파일에 Firebase 웹 설정을 넣고 다시 배포하세요. 자세한 순서는 README의 "설치 순서"에 있습니다.':
    'Put the Firebase web config in web/js/config.js in the repository and deploy again. See "Installation" in the README.',
  '코드 보기': 'Show code',
  '숨기기': 'Hide',
  '보기': 'Show',
  '접속 코드': 'Access code',
  '가족 코드, 관리자 코드, 백업 코드 중 하나를 넣으세요.': 'Enter the family code, admin code, or backup code.',
  '들어가기': 'Sign in',
  '{app}입니다. 가족에게 받은 접속 코드를 넣고, 다음 화면에서 내 이름을 고르세요.':
    'Welcome to {app}. Enter the access code your family gave you, then pick your name on the next screen.',
  '한 번 들어오면 로그아웃할 때까지 유지됩니다. ': 'Once signed in, you stay signed in until you sign out. ',
  '인터넷이 끊겨도, 코드가 기억나지 않아도 열리도록 본인 휴대폰에서는 로그아웃하지 마세요.':
    'Don’t sign out on your own phone, so the app still opens when the internet is down or you forget the code.',
  '등록된 사람이 없습니다': 'No one is registered',
  '관리자가 아직 없습니다. 백업 코드로 관리자를 추가하세요.': 'There is no admin yet. Use the backup code to add one.',
  '관리자에게 가족 등록을 요청하세요.': 'Ask an admin to register you.',
  '관리자 선택': 'Choose admin',
  '내 이름 선택': 'Choose your name',
  '관리자 코드가 확인됐습니다. 본인 이름을 고르세요.': 'Admin code accepted. Choose your name.',
  '가족 코드가 확인됐습니다. 본인 이름을 고르세요.': 'Family code accepted. Choose your name.',
  '← 다른 코드로 들어가기': '← Use a different code',
  '새 관리자 코드': 'New admin code',
  '8자 이상. 기존 관리자 코드는 바로 쓸 수 없게 됩니다.': 'At least 8 characters. The old admin code stops working immediately.',
  '새 관리자 코드 확인': 'Confirm new admin code',
  '관리자 코드 바꾸기': 'Change admin code',
  '두 코드가 서로 다릅니다.': 'The two codes do not match.',
  '관리자 코드를 바꿨습니다. 새 코드로 들어가세요.': 'Admin code changed. Sign in with the new code.',
  '관리자 추가': 'Add admin',
  '{name}님을 관리자로 추가했습니다. 관리자 코드로 들어가 이름을 고르면 됩니다.':
    '{name} has been added as an admin. Sign in with the admin code and pick that name.',
  '관리자 코드를 잊었거나 관리자가 없을 때만 쓰는 화면입니다. 여기서 한 일은 관리 기록에 남습니다.':
    'Use this screen only if the admin code is forgotten or there is no admin. Everything done here is recorded in the admin log.',
  '관리자 코드 다시 정하기': 'Set a new admin code',
  '새 관리자는 관리자 코드로 들어와 이름을 고릅니다.': 'A new admin signs in with the admin code and picks their name.',
  '← 나가기': '← Exit',
  '첫 관리자': 'First admin',
  '접속 코드 3가지': 'The three access codes',
  '일반 가족이 들어올 때 씁니다. 6자 이상.': 'Used by family members to sign in. At least 6 characters.',
  '관리자가 들어올 때 씁니다. 8자 이상, 가족 코드와 달라야 합니다.': 'Used by admins to sign in. At least 8 characters and different from the family code.',
  '관리자 코드를 잊었을 때 씁니다. 8자 이상. 종이에 적어 안전한 곳에 보관하세요.':
    'Used if the admin code is forgotten. At least 8 characters. Write it on paper and keep it somewhere safe.',
  '세 코드를 따로 적어 두었습니다. (코드는 어디에도 저장되지 않아 다시 볼 수 없습니다)':
    'I have written down all three codes. (Codes are not stored anywhere and cannot be shown again.)',
  '설정 완료': 'Finish setup',
  '설정을 마쳤습니다. 첫 관리자로 들어왔습니다.': 'Setup complete. You are signed in as the first admin.',
  '처음 설정': 'First-time setup',
  '이 화면은 처음 한 번만 쓸 수 있습니다. 설정을 마치면 예전에 저장된 관리자와 가족 계정은 더 이상 들어올 수 없습니다.':
    'This screen can be used only once. After setup, any previously saved admin and family accounts can no longer sign in.',
  '들어갈 수 없는 계정입니다': 'This account cannot sign in',
  '이 계정은 삭제·차단됐거나 예전 방식으로 만든 계정입니다.': 'This account was deleted or blocked, or was created the old way.',
  '로그아웃한 뒤 접속 코드로 다시 들어오세요. 등록되면 이 화면이 자동으로 바뀝니다.':
    'Sign out and sign in again with an access code. This screen updates automatically once you are registered.',

  // ---------- 관리자 기록 (records.js) ----------
  '1급·2급 발령과 해제, 테스트 알람, 알림 발송 결과, 생존신고, 집합장소 기록, 관리 작업을 시간순으로 모아 봅니다.':
    'Alerts and emergencies issued and ended, test alarms, notification results, check-ins, meeting-point notes, and admin actions, in time order.',

  // ---------- 설정: 오프라인 준비 (settings.js) ----------
  '확인 중…': 'Checking…',
  '앱 화면 저장': 'App saved on phone',
  '인터넷 없이 열림': 'Opens without internet',
  '한 번 새로고침하세요': 'Reload once',
  '저장 공간 고정': 'Storage protected',
  '브라우저가 지우지 않음': 'The browser won’t clear it',
  '"지금 준비하기"를 누르세요': 'Tap "Prepare now"',
  '지도 미리 받기': 'Maps downloaded',
  '{n}장 저장됨': '{n} tiles saved',
  '위치 권한': 'Location permission',
  '허용됨': 'Allowed',
  '차단됨 — 휴대폰 설정에서 허용하세요': 'Blocked — allow it in your phone settings',
  '"지금 준비하기"를 누르면 묻습니다': 'You’ll be asked when you tap "Prepare now"',
  '아직 없음': 'None yet',
  '가족·집합장소·대처법 데이터': 'Family, meeting point, and guide data',
  '로그인해 있는 동안 휴대폰에 자동 보관': 'Kept on this phone automatically while signed in',
  '마지막 준비: {at}': 'Last prepared: {at}',
  '📴 오프라인 준비': '📴 Offline readiness',
  '비상시에는 인터넷이 끊길 수 있습니다. 앱을 설치하고 인터넷이 될 때 한 번 준비해 두면, 끊겨도 화면·대처법·가족 정보·집합장소 지도·GPS를 쓸 수 있습니다.':
    'The internet may go down in an emergency. Install the app and prepare once while online, and the app, guides, family info, meeting-point maps, and GPS will keep working offline.',
  '인터넷이 될 때 준비할 수 있습니다.': 'You can prepare when you are online.',
  '준비했습니다. 지도 {n}장 저장.': 'Ready. {n} map tiles saved.',
  '📥 지금 준비하기': '📥 Prepare now',

  // ---------- 설정: 접속 코드 관리 ----------
  '새 {label}': 'New {label}',
  '바꾸기': 'Change',
  '{label}를 바꿀까요? 예전 코드로는 더 이상 들어올 수 없습니다. 이미 들어와 있는 휴대폰은 그대로입니다.':
    'Change the {label}? The old code will stop working. Phones that are already signed in stay signed in.',
  '{label}를 바꿨습니다. 새 코드를 적어 두고 필요한 가족에게 알려 주세요.':
    '{label} changed. Write the new code down and share it with the family members who need it.',
  '예전 방식 계정 {n}개': '{n} old-style accounts',
  '예전 아이디 방식으로 만든 계정입니다. 이미 접근이 막혀 있습니다. 정리하면 목록에서 지워집니다.':
    'These accounts were created with the old ID method and are already blocked. Cleaning up removes them from the list.',
  '예전 방식 계정 문서를 정리할까요?': 'Clean up the old-style accounts?',
  '정리했습니다.': 'Cleaned up.',
  '정리하기': 'Clean up',
  '🔑 접속 코드 관리': '🔑 Manage access codes',
  '코드는 어디에도 저장되지 않아 다시 볼 수 없습니다. 잊었다면 여기서 새로 정하세요. 관리자 코드를 잊었다면 백업 코드로 들어와 바꿀 수 있습니다.':
    'Codes are not stored anywhere and cannot be shown again. If one is forgotten, set a new one here. If the admin code is forgotten, sign in with the backup code to change it.',
  '일반 가족이 들어올 때': 'For family members to sign in',
  '관리자가 들어올 때': 'For admins to sign in',
  '관리자 코드를 잊었을 때 (종이에 보관)': 'If the admin code is forgotten (keep on paper)',
  '알림, 앱 설치, 글자 크기, 내 정보를 관리합니다.': 'Manage notifications, app installation, text size, and your information.',
  // 안드로이드 앱
  '앱 권한 화면에서 알림을 허용한 뒤 다시 누르세요.': 'Allow notifications on the app permissions screen, then tap again.',
  '알림 등록을 준비하는 중입니다. 잠시 뒤 다시 누르세요.': 'Notification setup is still getting ready. Tap again in a moment.',
  '📱 앱 전체 화면 경보 시험': '📱 Test the app\'s full-screen alarm',
  '📱 앱 경보 권한': '📱 App alarm permissions',
  '꺼진 권한이 있습니다': 'Some permissions are off',
  '1급 비상 때 잠금 화면 위 전체 화면 경보가 확실히 뜨도록 모두 켜 주세요.': 'Turn them all on so the full-screen alarm reliably appears over the lock screen during a Level 1 emergency.',
  '모든 권한이 켜져 있습니다. 화면이 꺼져 있거나 앱이 닫혀 있어도 1급 경보가 전체 화면으로 뜹니다.': 'All permissions are on. Level 1 alarms appear full screen even when the screen is off or the app is closed.',
  '권한 설정 열기': 'Open permission settings',
  '앱 버전 {v}': 'App version {v}',
  '📱 안드로이드 앱 (권장)': '📱 Android app (recommended)',
  '앱을 설치하면 화면이 꺼져 있거나 앱이 닫혀 있어도, 1급 비상 때 잠금 화면 위에 전체 화면 경보가 뜨고 경보음이 울립니다.': 'With the app installed, a Level 1 emergency shows a full-screen alarm over the lock screen and sounds the siren, even when the screen is off or the app is closed.',
  '아래 버튼으로 앱 파일을 받고, 받은 파일을 눌러 설치합니다. "출처를 알 수 없는 앱" 허용을 물으면 허용합니다.': 'Download the app file with the button below and tap it to install. If asked to allow apps from unknown sources, allow it.',
  '앱을 열면 권한 설정 화면이 나옵니다. 모두 켜 주세요.': 'When you open the app, a permissions screen appears. Turn everything on.',
  '앱에서 접속 코드를 넣고 이름을 고른 뒤, 설정 → 알림 켜기를 누릅니다.': 'In the app, enter the access code, choose your name, then tap Settings → Turn on notifications.',
  '⬇ 안드로이드 앱 받기': '⬇ Download the Android app',
  '알림': 'Notifications',
  '전체 화면 알림 (잠금 화면 위 경보)': 'Full-screen alerts (alarm over the lock screen)',
  '방해 금지 모드 무시': 'Override Do Not Disturb',
  '배터리 최적화 제외': 'Exclude from battery optimization',
};
