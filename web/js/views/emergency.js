// 비상 경보 화면(2급 → 1급), 빠른 선언, 전체 화면 경보, 테스트 알람
import { h, field, select, formData, toast, busy, panel, pageHeader, empty, alertBox, table } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { t } from '../i18n.js';
import {
  declareEmergency, escalateEmergency, endEmergency, watchEmergencyLog,
  sendAlarmTest, watchLatestAlarmTest, watchAlarmAcks, ackAlarmTest, hasAckedAlarmTest,
} from '../store.js';
import {
  EMERGENCY_TYPES, EMERGENCY_LEVELS, emergencyLabel, emergencyLevel, levelTitle, levelActor, alarmKey,
  realStartedAt, emergencyLogTitle, isFreshAlarmTest, formatDateTime, formatRemaining, toDate,
} from '../logic.js';
import { startSiren, stopSiren } from '../siren.js';

// ---------- 확인 기록 (사람마다 따로: 한 휴대폰을 가족이 같이 쓸 수도 있다) ----------

const ackStorageKey = (uid) => `family.ackedEmergency.${uid}`;
const testAckStorageKey = (uid) => `family.ackedTest.${uid}`;

function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 무시 */ }
}

// ---------- 전체 화면 경보 ----------

const SOUND_LABEL = { alert: t('2급 (알림만, 경보음 없음)'), real: t('1급 (경보음 + 알림)') };

/** 1급만 경보음을 낸다. 2급은 화면 알림만 띄운다. */
const sirenFor = (level) => level === 'real';

/**
 * 전체 화면 경보를 띄우고, sound가 있으면 소리를 낸다. 한 번에 하나만 뜬다.
 * kind: emergency | test | preview (어떤 경보인지), variant: alert | real | test (색)
 */
// 테스트·시험 경보의 자동 멈춤 타이머. 다른 경보가 뜨면 반드시 취소한다 (실제 경보음이 꺼지지 않게).
let autoStopTimer = null;

function closeOverlay(el) {
  clearTimeout(autoStopTimer);
  autoStopTimer = null;
  stopSiren();
  el?.remove();
}

function showOverlay({ kind, key, variant, sound, label, icon, title, lines = [], message, confirmText, onConfirm, autoStopMs }) {
  closeOverlay(document.getElementById('alarm'));
  const playing = sound ? startSiren() : true;
  if (sound && autoStopMs) autoStopTimer = setTimeout(stopSiren, autoStopMs);
  const overlay = h('div', {
    id: 'alarm', class: `alarm alarm-${variant}`, role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'alarm-title',
    'data-kind': kind, 'data-key': key,
  },
  h('div', { class: 'alarm-box' },
    h('div', { class: 'alarm-label' }, label),
    h('div', { class: 'alarm-icon', 'aria-hidden': 'true' }, icon),
    h('h2', { id: 'alarm-title' }, title),
    lines.map((l) => h('p', null, l)),
    message ? h('p', { class: 'alarm-message' }, message) : null,
    playing ? null : h('button', { class: 'btn btn-lg alarm-sound-btn', onClick: () => startSiren() }, t('🔊 경보음 켜기')),
    h('button', {
      class: 'btn btn-safe btn-lg btn-block',
      onClick: () => {
        closeOverlay(overlay);
        onConfirm?.();
      },
    }, confirmText)));
  document.body.append(overlay);
}

/** 새 경보(2급 비상 발령, 1급 비상)를 처음 보면 전체 화면 경보를 띄운다. 확인하면 다시 울리지 않는다. */
export function maybeAlarm(state) {
  const e = state.emergency;
  const key = alarmKey(e);
  const existing = document.getElementById('alarm');
  if (!key) {
    // 해제되면 떠 있던 비상 경보를 닫는다 (테스트·시험 화면은 그대로 둔다).
    if (existing?.dataset.kind === 'emergency') closeOverlay(existing);
    return;
  }
  const uid = state.me?.id;
  const acked = uid ? readLocal(ackStorageKey(uid)) : null;
  // 예전 버전은 시각(밀리초)만 저장했다. 이미 확인한 경보가 업데이트 직후 다시 울리지 않게 같이 본다.
  const legacyKey = String(realStartedAt(e)?.getTime() ?? toDate(e.declaredAt)?.getTime());
  if (!uid || acked === key || (acked === legacyKey && emergencyLevel(e) === 'real')) return;
  if (existing?.dataset.key === key) return;
  // 이 단계를 연 본인에게는 울리지 않는다.
  if (levelActor(e).id === uid) {
    writeLocal(ackStorageKey(uid), key);
    return;
  }

  const level = emergencyLevel(e);
  const actor = levelActor(e);
  const at = level === 'real' ? realStartedAt(e) : toDate(e.declaredAt);
  showOverlay({
    kind: 'emergency',
    key,
    variant: level,
    sound: sirenFor(level),
    label: level === 'alert' ? t('NOTICE · 2급 비상') : t('EMERGENCY · 1급 비상'),
    icon: level === 'alert' ? '⚠️' : '🚨',
    title: `${t(levelTitle(level))}: ${t(emergencyLabel(e.type))}`,
    lines: [
      `${actor.name || t('가족')} · ${formatDateTime(at)}`,
      level === 'alert'
        ? t('준위험 상황입니다. 생존신고를 하고, 비상 배낭과 집합장소를 확인하세요.')
        : t('지금 비상 상황입니다. 생존신고를 하고 집합장소로 이동하세요.'),
    ],
    message: e.message,
    confirmText: t('확인 — 생존신고 하러 가기'),
    onConfirm: () => {
      writeLocal(ackStorageKey(uid), key);
      location.hash = '/';
    },
  });
}

/** 관리자가 보낸 가족 전체 테스트 알람. 보낸 지 30분 안에 처음 보면 울리고, 확인을 누르면 관리자에게 기록이 간다. */
export async function maybeTestAlarm(state, test) {
  const uid = state.me?.id;
  if (!uid || !test || !isFreshAlarmTest(test) || test.by === uid) return;
  if (readLocal(testAckStorageKey(uid)) === test.id) return;
  // 실제 경보가 떠 있으면 테스트는 띄우지 않는다.
  if (document.getElementById('alarm')) return;
  if (await hasAckedAlarmTest(uid, test.id)) {
    writeLocal(testAckStorageKey(uid), test.id);
    return;
  }
  if (document.getElementById('alarm')) return;
  showOverlay({
    kind: 'test',
    key: test.id,
    variant: 'test',
    sound: sirenFor(test.sound || 'real'),
    label: t('TEST · 테스트 알람'),
    icon: '🔔',
    title: t('테스트 알람입니다'),
    lines: [
      `${test.byName || t('관리자')} · ${formatDateTime(test.at)}`,
      t('실제 상황이 아닙니다. 알림이 잘 오는지 확인하는 훈련입니다. ({sound})', { sound: SOUND_LABEL[test.sound] || SOUND_LABEL.real }),
    ],
    message: test.message,
    confirmText: t('확인 — 잘 받았어요'),
    autoStopMs: 60_000,
    onConfirm: async () => {
      writeLocal(testAckStorageKey(uid), test.id);
      try {
        await ackAlarmTest(state.me, test.id);
        toast(t('확인을 보냈습니다. 관리자 화면에 표시됩니다.'));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    },
  });
}

/** 이 휴대폰에서만 1급 경보음을 시험한다. 아무에게도 알리지 않는다. (2급은 경보음이 없다) */
export function previewAlarm() {
  showOverlay({
    kind: 'preview',
    key: 'preview-real',
    variant: 'test',
    sound: true,
    label: t('TEST · 이 휴대폰 경보음 시험'),
    icon: '🔊',
    title: SOUND_LABEL.real,
    lines: [t('이 휴대폰에서만 울립니다. 가족에게는 아무 알림도 가지 않습니다.'), t('소리가 작으면 휴대폰 음량을 올리고, 무음·방해금지 모드를 확인하세요.')],
    confirmText: t('닫기'),
    autoStopMs: 15_000,
  });
}

// ---------- 비상 경보 화면 ----------

export function emergencyView({ state, onChange, navigate }) {
  // 입력 중인 메시지가 지워지지 않도록 경보 단계가 바뀔 때만 다시 그린다.
  const guideBox = h('div');
  const quickBox = h('div');
  const main = h('div');
  let shownKey;
  const drawMain = () => {
    const level = emergencyLevel(state.emergency) || 'none';
    // 선언권이 다시 채워지거나 쓰이면 버튼 상태가 달라지므로 같이 본다.
    const key = `${level}:${state.me?.declareCredits}`;
    if (key === shownKey) return;
    shownKey = key;
    guideBox.replaceChildren(levelGuide(level));
    quickBox.replaceChildren(level === 'none' ? quickDeclarePanel(state) || '' : '');
    if (level === 'none') main.replaceChildren(declareCard(state, navigate));
    else if (level === 'alert') main.replaceChildren(alertActiveCard(state));
    else main.replaceChildren(realActiveCard(state));
  };
  onChange(drawMain);
  drawMain();

  const logBox = h('div');
  let logs = [];
  const drawLogs = () => {
    logBox.replaceChildren(logs.length
      ? table([t('일시'), t('구분'), t('누가'), t('메시지')], logs.map((l) => [
        h('span', { class: 'num' }, formatDateTime(l.at)),
        h('span', { class: `tag ${logTagClass(l)}` }, emergencyLogTitle(l)),
        l.byName,
        l.message || '-',
      ]))
      : empty(t('기록이 없습니다.')));
  };
  drawLogs();
  const unsubs = [watchEmergencyLog((list) => { logs = list; drawLogs(); }, () => {})];

  const testBox = testPanel(state, unsubs);
  window.addEventListener('hashchange', () => unsubs.forEach((u) => u()), { once: true });

  return h('div', { class: 'page' },
    pageHeader(t('비상 경보'), { lead: t('비상은 2단계입니다. 준위험 상황은 "2급"(알림만), 지진·전쟁·대형재난 같은 큰 재난은 "1급"(경보음 + 알림). 1급 비상부터 집합장소 시간이 계산됩니다.') }),
    guideBox,
    quickBox,
    main,
    testBox,
    panel(t('발령·해제 기록'), state.isAdmin ? { href: '#/admin/logs', label: t('전체 기록') } : null, logBox));
}

function logTagClass(l) {
  if (l.action === 'end') return 'status-safe';
  if (l.action === 'declare' && l.level === 'alert') return 'level-tag-alert';
  return 'kind-emergency';
}

function levelGuide(current) {
  const item = (level, steps) => h('div', { class: `level-card level-card-${level}${current === level ? ' is-current' : ''}` },
    h('div', { class: 'level-card-head' },
      h('span', { class: 'level-badge' }, t(EMERGENCY_LEVELS[level].label)),
      h('strong', null, level === 'alert' ? t('준위험 상황') : t('대형 재난 (지진·전쟁 등)')),
      current === level ? h('span', { class: 'level-now' }, t('현재 단계')) : null),
    h('ul', null, steps.map((s) => h('li', null, s))));
  return h('div', { class: 'level-guide', 'aria-label': t('경보 단계') },
    item('alert', [t('알림만 감 (경보음 없음)'), t('가족 모두 생존신고, 연락 유지'), t('비상 배낭·물·현금·연료 확인'), t('집합 시간은 아직 시작하지 않음')]),
    h('div', { class: 'level-arrow', 'aria-hidden': 'true' }, '→'),
    item('real', [t('경보음 + 알림'), t('즉시 생존신고'), t('이때부터 집합장소 시간 계산'), t('1순위 집합장소로 이동')]));
}

function sinceText(at) {
  const d = toDate(at);
  return d ? ` ${t('({time} 지남)', { time: formatRemaining(Date.now() - d.getTime()) })}` : '';
}

function endPanel(state) {
  if (!state.isAdmin) return alertBox('info', null, h('p', null, t('경보 해제는 관리자만 할 수 있습니다.')));
  return panel(t('경보 해제'), null,
    h('p', null, t('상황이 끝났으면 해제하세요. 가족 모두에게 해제 알림이 가고, 집합장소 시간이 평상시 표시로 돌아갑니다.')),
    h('button', {
      class: 'btn btn-lg',
      onClick: (ev) => {
        if (!confirm(t('경보를 해제할까요? 가족 모두에게 해제 알림이 갑니다.'))) return;
        busy(ev.currentTarget, async () => {
          try {
            const r = await endEmergency(state.me);
            toast(r?.error ? t('해제됐습니다. 알림 발송 실패: {error}', { error: r.error }) : t('경보를 해제했습니다.'));
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        });
      },
    }, t('✅ 경보 해제')));
}

function alertActiveCard(state) {
  const e = state.emergency;
  const me = state.me;
  const canEscalate = state.isAdmin || me.declareCredits >= 1;
  const form = h('form', { class: 'stack' },
    field(t('가족에게 보낼 메시지 (선택)'), h('textarea', { name: 'message', rows: 3, maxlength: 500, placeholder: t('예: 1급 비상입니다. 지금 바로 1순위 집합장소로 이동하세요.') }),
      t('비워 두면 2급 때 메시지를 그대로 씁니다.')),
    h('button', { class: 'btn btn-secondary btn-lg btn-block', type: 'submit', disabled: !canEscalate }, t('🚨 1급으로 격상')));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { message } = formData(form);
    const warn = state.isAdmin
      ? t('1급으로 격상할까요? 가족 모두에게 경보음과 알림이 가고, 지금부터 집합 시간이 계산됩니다.')
      : t('1급으로 격상할까요? 가족 모두에게 경보음과 알림이 가고, 내 선언권 1회를 씁니다.');
    if (!confirm(warn)) return;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const r = await escalateEmergency(me, e, message);
        toast(r?.error ? t('전환됐습니다. 다만 알림 발송에 실패했습니다: {error}', { error: r.error }) : t('1급으로 격상했습니다. 알림 {n}건 발송.', { n: r?.sent ?? 0 }), r?.error ? 'error' : 'info');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'stack' },
    alertBox('warning', t('2급 비상 발령 중: {type}', { type: t(emergencyLabel(e.type)) }),
      h('p', null, `${t('{name} · {time} 발령', { name: e.declaredByName, time: formatDateTime(e.declaredAt) })}${sinceText(e.declaredAt)}`),
      e.message ? h('p', null, e.message) : null,
      h('p', null, t('집합 시간은 아직 시작하지 않았습니다. 1급으로 격상되면 그때부터 계산됩니다.'))),
    panel(t('1급으로 격상'), null,
      canEscalate ? null : alertBox('error', t('선언권이 없습니다'), h('p', null, t('관리자에게 연락하세요.'))),
      !state.isAdmin && canEscalate ? alertBox('warning', t('내 선언권: {n}회 남음', { n: me.declareCredits }), h('p', null, t('전환하면 선언권 1회를 씁니다.'))) : null,
      form),
    endPanel(state));
}

function realActiveCard(state) {
  const e = state.emergency;
  const actor = levelActor(e);
  const at = realStartedAt(e);
  return h('div', { class: 'stack' },
    alertBox('emergency', t('1급 비상: {type}', { type: t(emergencyLabel(e.type)) }),
      h('p', null, `${actor.name || t('가족')} · ${formatDateTime(at)} ${e.escalatedBy ? t('1급 격상') : t('선언')}${sinceText(at)}`),
      e.escalatedBy ? h('p', null, t('2급 비상 발령: {name} · {time}', { name: e.declaredByName, time: formatDateTime(e.declaredAt) })) : null,
      e.message ? h('p', null, e.message) : null),
    endPanel(state));
}

// ---------- 빠른 비상 선언 (관리자) ----------
// 상황 버튼을 누르고 확인하면 바로 발령된다. 1급은 경보음 + 알림, 2급은 알림만.

const QUICK_DECLARE = [
  { level: 'real', title: '1급 비상 — 경보음 + 알림', items: [['earthquake', '🏚️'], ['war', '💥'], ['disaster', '🌪️'], ['cbrn', '☢️']] },
  { level: 'alert', title: '2급 비상 — 알림만 (준위험)', items: [['flood', '🌀'], ['fire', '🔥'], ['heat', '🌡️'], ['cold', '❄️'], ['blackout', '🔌'], ['pandemic', '🦠'], ['other', '⚠️']] },
];

export function quickDeclarePanel(state) {
  if (!state.isAdmin) return null;
  const button = (level, type, icon) => {
    const name = t(emergencyLabel(type));
    return h('button', {
      type: 'button',
      class: `quick-btn quick-${level}`,
      onClick: (ev) => {
        const warn = level === 'real'
          ? t('1급 비상({type})을 선언할까요? 가족 모두에게 경보음과 알림이 갑니다.', { type: name })
          : t('2급 비상({type})을 발령할까요? 가족 모두에게 알림이 갑니다 (경보음 없음).', { type: name });
        if (!confirm(warn)) return;
        busy(ev.currentTarget, async () => {
          try {
            const r = await declareEmergency(state.me, { level, type, message: '' });
            if (r?.error) toast(t('발령됐습니다. 다만 알림 발송에 실패했습니다: {error}', { error: r.error }), 'error');
            else toast(t('{level}을 알렸습니다. 알림 {n}건 발송.', { level: t(levelTitle(level)), n: r?.sent ?? 0 }));
            location.hash = '/emergency';
          } catch (err) {
            toast(errorMessage(err), 'error');
          }
        });
      },
    }, h('span', { class: 'quick-icon', 'aria-hidden': 'true' }, icon), h('span', null, name));
  };
  return panel(t('⚡ 빠른 비상 선언'), null,
    h('p', { class: 'muted small' }, t('상황을 누르고 확인하면 바로 가족 모두에게 갑니다.')),
    QUICK_DECLARE.map((g) => [
      h('h3', { class: `panel-subhead quick-head-${g.level}` }, t(g.title)),
      h('div', { class: 'quick-grid' }, g.items.map(([type, icon]) => button(g.level, type, icon))),
    ]));
}

function declareCard(state, navigate) {
  const me = state.me;
  const canDeclare = state.isAdmin || me.declareCredits >= 1;
  const levelOption = (value, title, desc, checked) => h('label', { class: `choice choice-${value}` },
    h('input', { type: 'radio', name: 'level', value, checked }),
    h('span', { class: 'choice-text' }, h('strong', null, title), h('span', null, desc)));
  const submit = h('button', { class: 'btn btn-warning-solid btn-lg btn-block', type: 'submit', disabled: !canDeclare }, t('⚠️ 2급 비상 발령'));
  const form = h('form', { class: 'stack' },
    h('fieldset', { class: 'choice-group' },
      h('legend', null, t('단계')),
      levelOption('alert', t('2급'), t('준위험 상황. 알림만 가고 경보음은 울리지 않음. 집합 시간은 아직 시작 안 함.'), true),
      levelOption('real', t('1급'), t('지진·전쟁·대형재난. 경보음과 알림이 함께 감. 집합장소 시간이 지금부터 계산됨.'), false)),
    field(t('상황'), select('type', EMERGENCY_TYPES.map((ty) => ({ value: ty.id, label: t(ty.label) })), 'war')),
    field(t('가족에게 보낼 메시지'), h('textarea', { name: 'message', rows: 3, maxlength: 500, placeholder: t('예: 상황을 지켜보는 중입니다. 비상 배낭을 확인하고 연락을 유지하세요.') }),
      t('알림과 경보 화면에 그대로 표시됩니다.')),
    submit);

  // 고른 단계에 따라 버튼 모양을 바꾼다.
  form.addEventListener('change', () => {
    const real = formData(form).level === 'real';
    submit.className = `btn ${real ? 'btn-secondary' : 'btn-warning-solid'} btn-lg btn-block`;
    submit.textContent = real ? t('🚨 1급 비상 선언') : t('⚠️ 2급 비상 발령');
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const data = formData(form);
    const real = data.level === 'real';
    let warn;
    if (state.isAdmin) {
      warn = real
        ? t('1급 비상을 선언할까요? 가족 모두에게 경보음과 알림이 갑니다.')
        : t('2급 비상을 발령할까요? 가족 모두에게 알림이 갑니다 (경보음 없음).');
    } else {
      warn = real
        ? t('1급 비상을 선언할까요? 가족 모두에게 경보음과 알림이 가고, 내 선언권 1회를 씁니다.')
        : t('2급 비상을 발령할까요? 가족 모두에게 알림이 가고(경보음 없음), 내 선언권 1회를 씁니다.');
    }
    if (!confirm(warn)) return;
    busy(submit, async () => {
      try {
        const r = await declareEmergency(me, data);
        if (r?.error) toast(t('발령됐습니다. 다만 알림 발송에 실패했습니다: {error}', { error: r.error }), 'error');
        else toast(t('{level}을 알렸습니다. 알림 {n}건 발송.', { level: t(levelTitle(data.level)), n: r?.sent ?? 0 }));
        navigate('/');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  return h('div', { class: 'stack' },
    state.isAdmin
      ? alertBox('warning', t('관리자 발령'), h('p', null, t('관리자는 횟수 제한 없이 발령할 수 있습니다. 바로 선언하려면 위 "빠른 비상 선언"을, 메시지를 함께 보내려면 아래 양식을 쓰세요. 알림이 잘 가는지 확인하려면 "테스트 알람"을 쓰세요.')))
      : alertBox(me.declareCredits >= 1 ? 'warning' : 'error', me.declareCredits >= 1 ? t('내 선언권: {n}회 남음', { n: me.declareCredits }) : t('선언권을 모두 썼습니다'),
        h('p', null, me.declareCredits >= 1 ? t('정말 위험할 때만 쓰세요. 2급 비상 발령이나 1급 격상에 1회씩 씁니다. 관리자가 다시 채워 줄 수 있습니다.') : t('관리자에게 연락하세요.'))),
    panel(t('경보 발령'), null, form));
}

// ---------- 테스트 알람 ----------

function testPanel(state, unsubs) {
  const local = h('div', { class: 'stack' },
    h('p', null, t('이 휴대폰에서만 1급 경보음을 들어 봅니다. 가족에게는 아무 알림도 가지 않습니다.')),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-outline', onClick: () => previewAlarm() }, t('🔊 1급 경보음 듣기'))),
    h('p', { class: 'muted small' }, t('2급 비상은 경보음 없이 알림만 갑니다.')));
  if (!state.isAdmin) return panel(t('🔔 경보 테스트'), null, local);

  const form = h('form', { class: 'stack' },
    field(t('소리'), select('sound', [{ value: 'real', label: SOUND_LABEL.real }, { value: 'alert', label: SOUND_LABEL.alert }], 'real')),
    field(t('메시지'), h('input', { name: 'message', maxlength: 200, value: t('테스트 알람입니다. 확인을 눌러 주세요.') })),
    h('button', { class: 'btn btn-lg btn-block', type: 'submit' }, t('🔔 가족 전체 테스트 알람 보내기')));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const data = formData(form);
    if (!confirm(t('가족 모두의 휴대폰에서 "테스트" 경보가 울립니다. 보낼까요?'))) return;
    busy(form.querySelector('button[type=submit]'), async () => {
      try {
        const r = await sendAlarmTest(state.me, data);
        toast(r.error
          ? t('테스트 알람을 보냈습니다. 사이트를 열어 둔 휴대폰에서 울립니다. (푸시 알림: {error})', { error: r.error })
          : t('테스트 알람을 보냈습니다. 푸시 알림 {n}건 발송.', { n: r.sent ?? 0 }));
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    });
  });

  const resultBox = h('div', null, h('p', { class: 'muted' }, t('불러오는 중…')));
  let ackUnsub = null;
  let shownTestId = null;
  const showResult = (test, acks) => {
    const ackById = new Map(acks.map((a) => [a.id, a]));
    const family = state.members.filter((m) => m.active);
    const done = family.filter((m) => ackById.has(m.id) || m.id === test.by).length;
    resultBox.replaceChildren(
      h('p', null, h('strong', null, t('마지막 테스트: {time}', { time: formatDateTime(test.at) })), ` · ${test.byName} · ${SOUND_LABEL[test.sound] || SOUND_LABEL.real}`),
      h('p', { class: 'muted small' }, t('확인 {done}/{total}명. 확인하지 않은 가족은 알림이 꺼져 있거나 사이트를 열지 않았을 수 있습니다.', { done, total: family.length })),
      table([t('가족'), t('확인')], family.map((m) => {
        const a = ackById.get(m.id);
        if (m.id === test.by) return [m.name, h('span', { class: 'tag' }, t('보낸 사람'))];
        return [m.name, a
          ? h('span', { class: 'tag status-safe' }, t('확인 {time}', { time: formatDateTime(a.at) }))
          : h('span', { class: 'tag status-unknown' }, t('아직 확인 안 함'))];
      })));
  };
  unsubs.push(watchLatestAlarmTest((test) => {
    if (!test) {
      resultBox.replaceChildren(empty(t('아직 보낸 테스트 알람이 없습니다.')));
      return;
    }
    if (test.id === shownTestId) return;
    shownTestId = test.id;
    ackUnsub?.();
    showResult(test, []);
    ackUnsub = watchAlarmAcks(test.id, (acks) => showResult(test, acks), () => {});
  }, () => resultBox.replaceChildren(empty(t('테스트 기록을 불러오지 못했습니다.')))));
  unsubs.push(() => ackUnsub?.());

  return panel(t('🔔 경보 테스트'), null,
    h('h3', { class: 'panel-subhead' }, t('이 휴대폰에서 듣기')),
    local,
    h('h3', { class: 'panel-subhead' }, t('가족 전체 테스트 알람')),
    h('p', null, t('가족 모두의 휴대폰에서 "테스트" 표시와 함께 경보가 울립니다. 각자 확인을 누르면 아래 표에 표시됩니다. 실제 경보 상태는 바뀌지 않습니다.')),
    form,
    resultBox);
}
