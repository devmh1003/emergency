// 로그인 화면: 접속 코드 → 이름 고르기, 백업 코드 화면, 처음 설정, 등록 안 된 계정, 설정 필요
// 접속 코드는 3가지다: 가족 코드(일반 가족), 관리자 코드(관리자), 백업 코드(관리자 코드를 잊었을 때).
import { h, field, formData, toast, busy, alertBox } from '../dom.js';
import { config, logout, errorMessage } from '../firebase.js';
import { loginWithCode, loginAsPerson, getAccess, setupAccess, changeAccessCode, rekeyAccess, backupAddAdmin } from '../store.js';
import { accessCodeProblem, accessCodesProblem, codeLabel, randomDigits, formatDateTime } from '../logic.js';
import { t, lang, setLang } from '../i18n.js';

const LAST_PERSON_KEY = 'family.lastPerson';

export function loadingView() {
  return h('div', { class: 'center-screen' }, h('div', { class: 'spinner', 'aria-label': t('불러오는 중') }));
}

export function configNeededView() {
  return h('div', { class: 'auth-wrap' },
    alertBox('warning', t('설정이 필요합니다'),
      h('p', null, t('사이트를 쓰려면 Firebase 연결 정보를 넣어야 합니다.')),
      h('p', null, t('저장소의 web/js/config.js 파일에 Firebase 웹 설정을 넣고 다시 배포하세요. 자세한 순서는 README의 "설치 순서"에 있습니다.'))));
}

/** 언어 전환 버튼 (로그인 전에도 보이게) */
export function langToggle(cls = 'btn btn-outline btn-sm') {
  const label = lang === 'en' ? '한국어' : 'English';
  return h('button', {
    type: 'button', class: cls, lang: lang === 'en' ? 'ko' : 'en', 'aria-label': label,
    onClick: () => setLang(lang === 'en' ? 'ko' : 'en'),
  },
  h('span', { class: 'lang-long' }, label),
  h('span', { class: 'lang-short', 'aria-hidden': 'true' }, lang === 'en' ? '한' : 'EN'));
}

/** 코드 칸 + 보기 버튼 (+ 자동 생성) */
function codeInput(name, { autocomplete = 'off', generate = false, minlength = 6 } = {}) {
  const input = h('input', {
    name, type: 'password', required: true, autocomplete, autocapitalize: 'off', spellcheck: 'false', minlength, maxlength: 64,
  });
  const toggle = h('button', {
    class: 'btn btn-base btn-sm', type: 'button', 'aria-label': t('코드 보기'),
    onClick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? t('숨기기') : t('보기');
    },
  }, t('보기'));
  const gen = generate ? h('button', {
    class: 'btn btn-base btn-sm', type: 'button',
    onClick: () => {
      input.value = randomDigits(8);
      input.type = 'text';
      toggle.textContent = t('숨기기');
    },
  }, t('자동 생성')) : null;
  return h('div', { class: 'input-group' }, input, toggle, gen);
}

function authCard(title, ...children) {
  return h('div', { class: 'auth-card' },
    h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 }),
    h('h1', null, title),
    ...children);
}

// ---------- 1단계: 접속 코드 ----------

/** 틀렸을 때·잠겼을 때 코드 칸 아래에 남기는 안내 */
function loginProblem(err) {
  if (err.lockedUntil) {
    return alertBox('error', t('접속이 잠겼습니다'),
      h('p', null, t('접속 코드를 3번 틀려 {time}까지 이 기기와 인터넷에서는 들어올 수 없습니다.', { time: formatDateTime(err.lockedUntil) })),
      h('p', null, t('급하면 관리자에게 잠금 해제를 부탁하세요 (관리자 설정 → 접속 잠금).')));
  }
  if (Number.isInteger(err.left)) {
    return alertBox('warning', null, h('p', null, t('접속 코드가 맞지 않습니다. {left}번 더 틀리면 하루 동안 들어올 수 없습니다.', { left: err.left })));
  }
  return alertBox('error', null, h('p', null, errorMessage(err)));
}

export function loginView() {
  const problem = h('div', { role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'stack', autocomplete: 'off' },
    field(t('접속 코드'), codeInput('code', { autocomplete: 'current-password' }), t('가족 코드, 관리자 코드, 백업 코드 중 하나를 넣으세요. 3번 틀리면 하루 동안 잠깁니다.')),
    problem,
    h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, t('들어가기')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { code } = formData(form);
    problem.replaceChildren();
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await loginWithCode(code);
        // 다음 화면(이름 고르기 또는 백업 화면)은 로그인 상태가 바뀌면 app.js가 띄운다.
      } catch (err) {
        problem.replaceChildren(loginProblem(err));
        form.querySelector('input[name=code]').select();
      }
    });
  });

  return h('div', { class: 'auth-wrap' },
    authCard(t('들어가기'),
      h('p', { class: 'muted' }, t('{app}입니다. 가족에게 받은 접속 코드를 넣고, 다음 화면에서 내 이름을 고르세요.', { app: t(config.appName || '우리 가족 비상연락') })),
      form),
    alertBox('info', null,
      h('p', null, h('strong', null, t('한 번 들어오면 로그아웃할 때까지 유지됩니다. ')),
        t('인터넷이 끊겨도, 코드가 기억나지 않아도 열리도록 본인 휴대폰에서는 로그아웃하지 마세요.'))));
}

// ---------- 2단계: 이름 고르기 ----------

export function pickerView({ kind }) {
  const list = h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('불러오는 중…')));
  let last = null;
  try { last = localStorage.getItem(LAST_PERSON_KEY); } catch { /* 무시 */ }

  getAccess(kind).then((people) => {
    if (!people.length) {
      list.replaceChildren(alertBox('warning', t('등록된 사람이 없습니다'),
        h('p', null, kind === 'admin' ? t('관리자가 아직 없습니다. 백업 코드로 관리자를 추가하세요.') : t('관리자에게 가족 등록을 요청하세요.'))));
      return;
    }
    const sorted = [...people].sort((a, b) => (b.uid === last) - (a.uid === last) || a.name.localeCompare(b.name, 'ko'));
    list.replaceChildren(...sorted.map((p) => h('button', {
      type: 'button',
      class: `btn btn-lg btn-block ${p.uid === last ? '' : 'btn-outline'}`,
      onClick: (e) => busy(e.currentTarget, async () => {
        try {
          try { localStorage.setItem(LAST_PERSON_KEY, p.uid); } catch { /* 무시 */ }
          await loginAsPerson(p);
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      }),
    }, p.name)));
  }).catch((err) => list.replaceChildren(alertBox('error', null, h('p', null, errorMessage(err)))));

  return h('div', { class: 'auth-wrap' },
    authCard(kind === 'admin' ? t('관리자 선택') : t('내 이름 선택'),
      h('p', { class: 'muted' }, kind === 'admin' ? t('관리자 코드가 확인됐습니다. 본인 이름을 고르세요.') : t('가족 코드가 확인됐습니다. 본인 이름을 고르세요.')),
      list),
    h('button', { class: 'btn btn-unstyled', type: 'button', onClick: () => logout() }, t('← 다른 코드로 들어가기')));
}

// ---------- 백업 코드 화면 ----------

export function backupView() {
  const codeForm = h('form', { class: 'stack' },
    field(t('새 관리자 코드'), codeInput('code', { generate: true, minlength: 8 }), t('8자 이상. 기존 관리자 코드는 바로 쓸 수 없게 됩니다.')),
    field(t('새 관리자 코드 확인'), codeInput('code2', { minlength: 8 })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'rekey' }),
      h('span', null, t('관리자 코드가 새어 나갔어요: 관리자 휴대폰을 모두 로그아웃시키기'))),
    h('button', { class: 'btn btn-block', type: 'submit' }, t('관리자 코드 바꾸기')));
  codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(codeForm);
    const problem = accessCodeProblem(d.code, 'admin') || (d.code !== d.code2 ? t('두 코드가 서로 다릅니다.') : null);
    if (problem) { toast(problem, 'error'); return; }
    busy(codeForm.querySelector('button[type=submit]'), async () => {
      try {
        await changeAccessCode('admin', d.code);
        if (codeForm.elements.rekey.checked) await rekeyAccess('admin');
        codeForm.reset();
        toast(t('관리자 코드를 바꿨습니다. 새 코드로 들어가세요.'));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  const adminForm = h('form', { class: 'stack' },
    field(t('이름'), h('input', { name: 'name', required: true, maxlength: 40 })),
    field(t('전화번호'), h('input', { name: 'phone', type: 'tel', maxlength: 30, inputmode: 'tel' })),
    h('button', { class: 'btn btn-outline btn-block', type: 'submit' }, t('관리자 추가')));
  adminForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(adminForm);
    busy(adminForm.querySelector('button[type=submit]'), async () => {
      try {
        await backupAddAdmin(d);
        adminForm.reset();
        toast(t('{name}님을 관리자로 추가했습니다. 관리자 코드로 들어가 이름을 고르면 됩니다.', { name: d.name }));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'auth-wrap' },
    authCard(t('백업 코드'),
      alertBox('warning', null, h('p', null, t('관리자 코드를 잊었거나 관리자가 없을 때만 쓰는 화면입니다. 여기서 한 일은 관리 기록에 남습니다.'))),
      h('h2', { class: 'panel-subhead' }, t('관리자 코드 다시 정하기')),
      codeForm,
      h('h2', { class: 'panel-subhead' }, t('관리자 추가')),
      h('p', { class: 'small muted' }, t('새 관리자는 관리자 코드로 들어와 이름을 고릅니다.')),
      adminForm),
    h('button', { class: 'btn btn-unstyled', type: 'button', onClick: () => logout() }, t('← 나가기')));
}

// ---------- 처음 설정 ----------

export function setupView() {
  const form = h('form', { class: 'stack' },
    h('h2', { class: 'panel-subhead' }, t('첫 관리자')),
    field(t('이름'), h('input', { name: 'name', required: true, maxlength: 40, autocomplete: 'name' })),
    field(t('전화번호'), h('input', { name: 'phone', type: 'tel', maxlength: 30, autocomplete: 'tel', inputmode: 'tel' })),
    h('h2', { class: 'panel-subhead' }, t('접속 코드 3가지')),
    field(codeLabel('family'), codeInput('family', { generate: true }), t('일반 가족이 들어올 때 씁니다. 6자 이상.')),
    field(codeLabel('admin'), codeInput('admin', { generate: true, minlength: 8 }), t('관리자가 들어올 때 씁니다. 8자 이상, 가족 코드와 달라야 합니다.')),
    field(codeLabel('backup'), codeInput('backup', { generate: true, minlength: 8 }), t('관리자 코드를 잊었을 때 씁니다. 8자 이상. 종이에 적어 안전한 곳에 보관하세요.')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'noted', required: true }),
      h('span', null, t('세 코드를 따로 적어 두었습니다. (코드는 어디에도 저장되지 않아 다시 볼 수 없습니다)'))),
    h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, t('설정 완료')));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(form);
    const problem = accessCodesProblem(d);
    if (problem) { toast(problem, 'error'); return; }
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        await setupAccess(d);
        toast(t('설정을 마쳤습니다. 첫 관리자로 들어왔습니다.'));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'auth-wrap' },
    authCard(t('처음 설정'),
      alertBox('warning', null, h('p', null, t('이 화면은 처음 한 번만 쓸 수 있습니다. 설정을 마치면 예전에 저장된 관리자와 가족 계정은 더 이상 들어올 수 없습니다.'))),
      h('div', { style: { marginTop: '1rem' } }, form)));
}

/** 로그인은 됐지만 지금 가족으로 등록되지 않은 계정 (삭제·차단됐거나 예전 방식 계정) */
export function notRegisteredView() {
  return h('div', { class: 'auth-wrap' },
    authCard(t('들어갈 수 없는 계정입니다'),
      h('p', null, t('이 계정은 삭제·차단됐거나 예전 방식으로 만든 계정입니다.')),
      h('p', { class: 'muted' }, t('로그아웃한 뒤 접속 코드로 다시 들어오세요. 등록되면 이 화면이 자동으로 바뀝니다.'))),
    h('button', { class: 'btn btn-outline', onClick: () => logout() }, t('로그아웃')));
}
