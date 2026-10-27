// 로그인, 초기 설정, 등록 대기, 설정 필요 화면
import { h, field, formData, toast, busy, card } from '../dom.js';
import { config, login, logout, resetPasswordEmail, createOwnAccount, errorMessage, auth } from '../firebase.js';
import { isSetupDone, registerFirstAdmin } from '../store.js';

export function loadingView() {
  return h('div', { class: 'center-screen' }, h('div', { class: 'spinner', 'aria-label': '불러오는 중' }));
}

export function configNeededView() {
  return h('div', { class: 'auth-screen' },
    h('h1', null, '설정이 필요합니다'),
    card(
      h('p', null, '사이트를 쓰려면 Firebase 연결 정보를 넣어야 합니다.'),
      h('p', null, '저장소의 web/js/config.js 파일에 Firebase 웹 설정을 넣고 다시 배포하세요. 자세한 순서는 README의 "설치 순서"에 있습니다.')));
}

export function loginView({ navigate }) {
  const form = h('form', { class: 'stack', autocomplete: 'on' },
    field('이메일', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username', inputmode: 'email' })),
    field('비밀번호', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, '로그인'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { email, password } = formData(form);
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await login(email, password);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  const forgot = h('button', {
    class: 'btn btn-link', type: 'button',
    onClick: async () => {
      const email = form.elements.email.value.trim();
      if (!email) {
        toast('이메일을 먼저 입력하세요.', 'error');
        return;
      }
      try {
        await resetPasswordEmail(email);
        toast('비밀번호 재설정 메일을 보냈습니다. 메일이 안 오면 관리자에게 초기화를 요청하세요.');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    },
  }, '비밀번호를 잊었어요');

  return h('div', { class: 'auth-screen' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon.svg', alt: '', width: 72, height: 72 }), h('h1', null, config.appName || '가족 비상연락')),
    card(form, forgot),
    h('p', { class: 'muted small' }, '계정은 관리자가 만들어 줍니다. 한 번 로그인하면 로그아웃할 때까지 유지됩니다.'),
    h('p', { class: 'small' }, h('a', { href: '#/setup', onClick: (e) => { e.preventDefault(); navigate('/setup'); } }, '처음 설치하셨나요? 초기 설정')));
}

function adminInfoFields() {
  return [
    field('이름', h('input', { name: 'name', required: true, maxlength: 40, autocomplete: 'name' })),
    field('전화번호', h('input', { name: 'phone', type: 'tel', required: true, maxlength: 30, autocomplete: 'tel', inputmode: 'tel' })),
  ];
}

/** 로그인 전: 첫 관리자 계정을 만든다. */
export function setupView({ navigate }) {
  const form = h('form', { class: 'stack' },
    ...adminInfoFields(),
    field('이메일 (로그인 아이디)', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username' })),
    field('비밀번호', h('input', { name: 'password', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' }), '8자 이상'),
    field('비밀번호 확인', h('input', { name: 'password2', type: 'password', required: true, minlength: 8, autocomplete: 'new-password' })),
    h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, '첫 관리자로 시작하기'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = formData(form);
    if (data.password !== data.password2) {
      toast('비밀번호가 서로 다릅니다.', 'error');
      return;
    }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const cred = await createOwnAccount(data.email, data.password);
        await registerOrRollback(cred.user, data);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'auth-screen' },
    h('h1', null, '초기 설정'),
    card(
      h('p', null, '사이트를 처음 설치한 사람이 첫 관리자가 됩니다. 한 번 설정하면 이 화면은 다시 쓸 수 없습니다.'),
      form),
    h('p', { class: 'small' }, h('a', { href: '#/', onClick: (e) => { e.preventDefault(); navigate('/'); } }, '← 로그인으로')));
}

async function registerOrRollback(user, data) {
  try {
    await registerFirstAdmin(user.uid, { name: data.name, phone: data.phone, email: user.email });
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
  const box = card(
    h('p', null, `${user?.email || ''} 계정은 아직 가족으로 등록되지 않았거나 비활성화됐습니다.`),
    h('p', { class: 'muted' }, '관리자에게 등록을 요청하세요. 등록되면 이 화면이 자동으로 바뀝니다.'));

  // 초기 설정이 아직이면 이 계정을 첫 관리자로 등록할 수 있다.
  isSetupDone().then((done) => {
    if (done) return;
    const form = h('form', { class: 'stack' },
      h('p', null, '아직 초기 설정이 안 됐습니다. 이 계정을 첫 관리자로 등록할 수 있습니다.'),
      ...adminInfoFields(),
      h('button', { class: 'btn btn-primary', type: 'submit' }, '첫 관리자로 등록'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = formData(form);
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          await registerFirstAdmin(auth.currentUser.uid, { ...data, email: auth.currentUser.email });
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      });
    });
    box.append(form);
  }).catch(() => {});

  return h('div', { class: 'auth-screen' },
    h('h1', null, '등록 대기 중'),
    box,
    h('button', { class: 'btn', onClick: () => logout() }, '로그아웃'));
}
