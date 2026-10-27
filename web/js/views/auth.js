// 로그인(아이디 + 비밀코드), 초기 설정, 등록 대기, 설정 필요 화면
import { h, field, formData, toast, busy, alertBox } from '../dom.js';
import { config, login, logout, resetPasswordEmail, createOwnAccount, errorMessage, auth } from '../firebase.js';
import { isSetupDone, registerFirstAdmin } from '../store.js';
import { isValidLoginId, normalizeLoginId, secretCodeProblem, LOGIN_ID_RULE, loginIdFromEmail } from '../logic.js';

export function loadingView() {
  return h('div', { class: 'center-screen' }, h('div', { class: 'spinner', 'aria-label': '불러오는 중' }));
}

export function configNeededView() {
  return h('div', { class: 'auth-wrap' },
    alertBox('warning', '설정이 필요합니다',
      h('p', null, '사이트를 쓰려면 Firebase 연결 정보를 넣어야 합니다.'),
      h('p', null, '저장소의 web/js/config.js 파일에 Firebase 웹 설정을 넣고 다시 배포하세요. 자세한 순서는 README의 "설치 순서"에 있습니다.')));
}

/** 비밀코드 칸 + 보기 버튼 */
function codeInput(name, autocomplete, extra = {}) {
  const input = h('input', { name, type: 'password', required: true, autocomplete, autocapitalize: 'off', spellcheck: 'false', ...extra });
  const toggle = h('button', {
    class: 'btn btn-base btn-sm', type: 'button', 'aria-label': '비밀코드 보기',
    onClick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '숨기기' : '보기';
    },
  }, '보기');
  return h('div', { class: 'input-group' }, input, toggle);
}

function idInput(extra = {}) {
  return h('input', {
    name: 'loginId', required: true, autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', maxlength: 60, ...extra,
  });
}

export function loginView({ navigate }) {
  const form = h('form', { class: 'stack', autocomplete: 'on' },
    field('아이디', idInput()),
    field('비밀코드', codeInput('code', 'current-password')),
    h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, '로그인'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { loginId, code } = formData(form);
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await login(loginId, code);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  const forgot = h('button', {
    class: 'btn btn-unstyled', type: 'button',
    onClick: async () => {
      const id = normalizeLoginId(form.elements.loginId.value);
      // 예전 방식(이메일) 계정만 재설정 메일을 받을 수 있다.
      if (id.includes('@')) {
        try {
          await resetPasswordEmail(id);
          toast('비밀번호 재설정 메일을 보냈습니다.');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
        return;
      }
      toast('비밀코드를 잊었다면 관리자에게 초기화를 요청하세요.', 'warn');
    },
  }, '비밀코드를 잊었어요');

  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 }),
      h('h1', null, '로그인'),
      h('p', { class: 'muted' }, `${config.appName || '우리 가족 비상연락'}에 오신 것을 환영합니다. 관리자에게 받은 아이디와 비밀코드를 입력하세요.`),
      form,
      h('p', { class: 'small', style: { marginTop: '1rem' } }, forgot)),
    alertBox('info', null,
      h('p', null, h('strong', null, '한 번 로그인하면 로그아웃할 때까지 유지됩니다. '), '비상시에 비밀코드가 기억나지 않아도 열리도록, 본인 휴대폰에서는 로그아웃하지 마세요.')),
    h('p', { class: 'small center' }, h('a', { href: '#/setup', onClick: (e) => { e.preventDefault(); navigate('/setup'); } }, '처음 설치하셨나요? 초기 설정')));
}

function adminInfoFields() {
  return [
    field('이름', h('input', { name: 'name', required: true, maxlength: 40, autocomplete: 'name' })),
    field('전화번호', h('input', { name: 'phone', type: 'tel', required: true, maxlength: 30, autocomplete: 'tel', inputmode: 'tel' })),
  ];
}

function checkCredentials(data) {
  const id = normalizeLoginId(data.loginId);
  if (!isValidLoginId(id)) return `아이디는 ${LOGIN_ID_RULE}입니다.`;
  const problem = secretCodeProblem(data.code);
  if (problem) return problem;
  if (data.code !== data.code2) return '비밀코드가 서로 다릅니다.';
  return null;
}

/** 로그인 전: 첫 관리자 계정을 만든다. */
export function setupView({ navigate }) {
  const form = h('form', { class: 'stack' },
    ...adminInfoFields(),
    field('아이디', idInput({ autocomplete: 'off' }), LOGIN_ID_RULE),
    field('비밀코드', codeInput('code', 'new-password', { minlength: 6 }), '6자 이상. 숫자만 써도 되지만 8자 이상을 권장합니다.'),
    field('비밀코드 확인', codeInput('code2', 'new-password', { minlength: 6 })),
    h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, '첫 관리자로 시작하기'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = formData(form);
    const problem = checkCredentials(data);
    if (problem) {
      toast(problem, 'error');
      return;
    }
    const loginId = normalizeLoginId(data.loginId);
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const cred = await createOwnAccount(loginId, data.code);
        await registerOrRollback(cred.user, { ...data, loginId });
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('h1', null, '초기 설정'),
      alertBox('warning', null, h('p', null, '사이트를 처음 설치한 사람이 첫 관리자가 됩니다. 한 번 설정하면 이 화면은 다시 쓸 수 없습니다.')),
      h('div', { style: { marginTop: '1rem' } }, form)),
    h('p', { class: 'small center' }, h('a', { href: '#/', onClick: (e) => { e.preventDefault(); navigate('/'); } }, '← 로그인으로')));
}

async function registerOrRollback(user, data) {
  try {
    await registerFirstAdmin(user.uid, { name: data.name, phone: data.phone, loginId: data.loginId });
    toast('첫 관리자로 등록됐습니다.');
  } catch (err) {
    if (err.code === 'permission-denied') {
      // 이미 다른 사람이 초기 설정을 마쳤다. 방금 만든 빈 계정은 지운다.
      await user.delete().catch(() => {});
      throw new Error('이미 초기 설정이 끝났습니다. 관리자에게 계정을 요청하세요.');
    }
    throw err;
  }
}

/** 로그인은 됐지만 가족으로 등록되지 않은 계정 */
export function notRegisteredView(user) {
  const shownId = loginIdFromEmail(user?.email, config.firebase?.projectId);
  const box = h('div', { class: 'auth-card' },
    h('h1', null, '등록 대기 중'),
    h('p', null, `${shownId} 계정은 아직 가족으로 등록되지 않았거나 접근이 차단됐습니다.`),
    h('p', { class: 'muted' }, '관리자에게 등록을 요청하세요. 등록되면 이 화면이 자동으로 바뀝니다.'));

  // 초기 설정이 아직이면 이 계정을 첫 관리자로 등록할 수 있다.
  isSetupDone().then((done) => {
    if (done) return;
    const form = h('form', { class: 'stack' },
      alertBox('info', null, h('p', null, '아직 초기 설정이 안 됐습니다. 이 계정을 첫 관리자로 등록할 수 있습니다.')),
      ...adminInfoFields(),
      h('button', { class: 'btn', type: 'submit' }, '첫 관리자로 등록'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = formData(form);
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          const id = loginIdFromEmail(auth.currentUser.email, config.firebase.projectId);
          await registerFirstAdmin(auth.currentUser.uid, { ...data, loginId: id.includes('@') ? '' : id, email: id.includes('@') ? id : '' });
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
    });
    box.append(form);
  }).catch(() => {});

  return h('div', { class: 'auth-wrap' },
    box,
    h('button', { class: 'btn btn-outline', onClick: () => logout() }, '로그아웃'));
}
