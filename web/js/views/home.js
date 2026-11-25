// 홈: 현재 상황 → "나 무사해요" → 긴급 전화 → (비상 중) 지금 할 일 → (관리자) 빠른 선언 → 바로가기 → 가족·준비·재난문자·위치
import { h, toast, busy, panel, foldPanel, alertBox, isIOS, choose } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { checkIn, notifyHelp, setHelpPending, batteryLevel } from '../store.js';
import { getBestPosition, lastKnownPosition } from '../geo.js';
import {
  checkinLabel, formatAgo, formatDateTime, formatRemaining, memberStatus, safetySmsBody, helpSmsBody, smsHref,
  emergencyLabel, emergencyLevel, levelActor, realStartedAt, meetingSchedule, checklistProgress, checklistKey,
  suppliesStatus, toDate, shelterLinks, quickNote,
} from '../logic.js';
import { t } from '../i18n.js';
import { familyStatusList, statusSummary } from './family.js';
import { locationPanel } from './location.js';
import { quickDeclarePanel } from './emergency.js';

// 위치를 기다리는 동안 새 신고를 하면 앞 신고의 위치는 덧붙이지 않는다 (새 신고를 덮어쓰지 않게).
let reportSeq = 0;

/**
 * 신고를 먼저 저장하고, 위치는 잡히는 대로 덧붙인다 (GPS를 기다리다 앱을 닫아도 신고가 남게).
 * @returns {Promise<{located: Promise<object|null>}>} located: 위치를 덧붙이기까지 끝나면 그 위치 (못 잡으면 null)
 */
async function report(state, type, note, knownPos) {
  const seq = ++reportSeq;
  const what = checkinLabel(type);
  // 위치는 저장을 기다리지 않고 함께 찾기 시작한다.
  const finding = knownPos ? null : getBestPosition().then((pos) => ({ pos }), (err) => ({ error: err.message }));
  const battery = await batteryLevel();
  // 알림을 보내기 전에 앱을 닫아도 다음에 열 때 이어서 보낸다.
  if (type === 'help') setHelpPending(state.me.id);
  else if (type === 'safe') setHelpPending(null);
  const result = await checkIn(state.me, type, knownPos || null, note, state.emergency, battery);
  if (result === 'queued') toast(t('{what} 저장됨 — 오프라인이라 연결되면 자동으로 전송됩니다.', { what }), 'warn');
  else toast(knownPos ? t('{what} 전송 완료', { what }) : t('{what} 전송 완료. 위치를 찾아 덧붙이는 중…', { what }));
  if (!finding) return { located: Promise.resolve(knownPos) };

  const located = finding.then(async ({ pos, error }) => {
    // 그 사이 이 휴대폰이나 다른 기기에서 다른 신고를 했으면 덮어쓰지 않는다.
    if (seq !== reportSeq || state.me?.last?.type !== type) return pos || null;
    if (error) {
      toast(t('위치를 못 읽어 위치 없이 저장했습니다: {error}', { error }), 'warn');
      return null;
    }
    try {
      await checkIn(state.me, 'checkpoint', pos, note, state.emergency, battery, { lastType: type });
    } catch (err) {
      // 신고 자체는 이미 저장됐다.
      toast(errorMessage(err), 'warn');
    }
    return pos;
  });
  return { located };
}

// 도움 요청 알림은 위치를 이만큼만 기다렸다가 보낸다. 늦게 잡힌 위치는 신고에 덧붙는다.
const HELP_LOCATION_WAIT_MS = 8000;

/**
 * 도움 요청을 저장한 뒤: 관련 가족의 휴대폰에 알림을 보내고(알림 서버), 이어서 문자 앱을 연다.
 * 문자는 휴대폰 통신망으로 가므로 상대가 인터넷이 안 될 때도 닿는다. 보내기는 본인이 한 번 누른다.
 * 알림 서버에 닿지 않으면(오프라인) 이 휴대폰에 보이는 가족 번호로 문자만 연다.
 */
async function sendHelp(state, note, pos) {
  const r = await notifyHelp();
  const people = r.recipients?.length ? r.recipients : state.members.filter((m) => m.id !== state.me.id);
  if (r.error) toast(t('가족 휴대폰 알림을 보내지 못했습니다: {error}. 문자로 알리세요.', { error: r.error }), 'warn');
  else if (r.recipients?.length) toast(t('도움 요청 알림을 {n}명에게 보냈습니다.', { n: r.recipients.length }));
  const phones = people.map((m) => m.phone).filter(Boolean);
  if (!phones.length) {
    toast(t('문자를 보낼 전화번호가 등록된 가족이 없습니다.'), 'warn');
    return;
  }
  location.href = smsHref(phones, helpSmsBody(state.me.name, note, pos), isIOS);
}

function situation(state) {
  const e = state.emergency;
  const me = memberStatus(state.me, e);
  if (!e?.active) {
    return h('p', { class: 'calm-line' }, t('현재 비상 상황이 아닙니다'));
  }
  if (emergencyLevel(e) === 'alert') {
    return alertBox('warning', t('2급 비상 발령: {type}', { type: emergencyLabel(e.type) }),
      h('p', null, `${t('{name} · {time} 발령', { name: e.declaredByName || t('가족'), time: formatDateTime(e.declaredAt) })}${e.message ? ` — ${e.message}` : ''}`),
      me.key === 'unknown' ? h('p', null, h('strong', null, t('아직 생존신고를 하지 않았습니다. 아래 버튼을 먼저 누르세요.'))) : null);
  }
  const { currentRank, points } = meetingSchedule(state.meetingPoints, e);
  const target = points.find((p) => p.rank === currentRank);
  const until = target ? (target.at > Date.now() ? target.at.getTime() : target.deadline.getTime()) : null;
  const actor = levelActor(e);
  const who = { name: actor.name || t('가족'), time: formatDateTime(realStartedAt(e)) };
  return alertBox('emergency', t('1급 비상: {type}', { type: emergencyLabel(e.type) }),
    h('p', null, `${e.escalatedBy ? t('{name} · {time} 1급 격상', who) : t('{name} · {time} 선언', who)}${e.message ? ` — ${e.message}` : ''}`),
    me.key === 'unknown' ? h('p', null, h('strong', null, t('아직 생존신고를 하지 않았습니다. 아래 버튼을 먼저 누르세요.'))) : null,
    target ? h('p', null, t('지금 갈 곳: '), h('strong', null, `${t('{rank}순위', { rank: target.rank })} ${target.name}`),
      ` · ${target.at > Date.now() ? t('도착까지') : t('대기 종료까지')} `, h('strong', { 'data-until': String(until) }, formatRemaining(until - Date.now()))) : null);
}

/** 비상 중: 지금 할 일을 순서대로. 신고를 마치면 첫 줄이 체크된다. */
function todoPanel(state) {
  const e = state.emergency;
  if (!e?.active) return null;
  const alert = emergencyLevel(e) === 'alert';
  const reported = memberStatus(state.me, e).key !== 'unknown';
  const step = (n, done, title, desc, href) => h('li', { class: done ? 'done' : null },
    h(href ? 'a' : 'div', { class: 'menu-row', href },
      h('span', { class: 'todo-num', 'aria-hidden': 'true' }, done ? '✓' : String(n)),
      h('span', { class: 'menu-text' }, h('strong', null, title), h('span', null, desc)),
      href ? h('span', { class: 'menu-arrow', 'aria-hidden': 'true' }, '›') : null));
  return panel(t('지금 할 일'), null, h('ol', { class: 'menu-list todo' },
    step(1, reported, t('생존신고'), reported ? t('신고했습니다. 상황이 바뀌면 다시 누르세요.') : t('위의 "나 무사해요"를 누르세요.')),
    step(2, false, alert ? t('집합장소 확인') : t('집합장소로 이동'),
      alert ? t('가는 길을 미리 봐 두세요. 시간은 1급 비상부터 시작합니다.') : t('지금 갈 곳과 남은 시간을 봅니다.'), '#/meet'),
    step(3, false, t('대처법 보기'), t('{type} 때 해야 할 행동', { type: t(emergencyLabel(e.type)) }), `#/protocols/${encodeURIComponent(e.type)}`),
    alert ? step(4, false, t('비상 물품'), t('비상 배낭·물·현금을 확인하세요. 1급 비상이 되면 경보음이 울립니다.'), '#/supplies') : null));
}

/** 하단 메뉴에 없는, 급할 때 바로 찾을 화면만. 나머지는 더보기에 있다. */
function tiles() {
  const list = [
    ['#/protocols', '📘', t('상황별 대처법')],
    ['#/sos', '🆘', t('구조 신호')],
    ['#/contacts', '☎️', t('비상 연락처')],
    ['#/supplies', '📦', t('비상 물품')],
    ['#/emergency', '🚨', t('비상 경보')],
    ['#/guide', '📖', t('사용 안내')],
  ];
  return h('div', { class: 'tiles tiles-compact' }, list.map(([href, icon, title]) => h('a', { class: 'tile', href },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon),
    h('strong', null, title))));
}

/** 우리 지역에 온 최근 재난문자(알림 서버가 남김)와 가까운 대피소 찾기 */
function alertsPanel(state) {
  const recent = state.disasterRecent;
  const items = (recent?.items || []).slice(0, 5);
  const pos = lastKnownPosition();
  const STEP_TAG = { 위급재난: 'status-help', 긴급재난: 'status-unknown' };
  // 알림 서버가 확인할 때마다 checkedAt 을 남긴다. 문서 자체가 없으면 서버가 아직 한 번도 확인하지 않은 것.
  const region = (recent?.regions || []).join(', ') || t('우리 지역');
  const checked = recent?.checkedAt ? toDate(recent.checkedAt) : null;
  return panel(t('📨 우리 지역 재난문자'), null,
    items.length
      ? h('ul', { class: 'list list-compact' }, items.map((m) => h('li', { class: 'list-item small' },
        h('div', null, h('span', { class: `tag ${STEP_TAG[m.step] || 'tag-light'}` }, m.step || ''), ' ',
          h('span', { class: 'muted' }, `${formatDateTime(toDate(m.at))}${m.kind ? ` · ${m.kind}` : ''}`)),
        h('div', null, m.text))))
      : h('p', { class: 'muted small' }, recent ? t('최근 {region}에 온 재난문자가 없습니다.', { region }) : t('알림 서버가 재난문자를 확인하면 여기에 보입니다.')),
    checked ? h('p', { class: 'muted small', style: { margin: '0.25rem 0 0' } },
      t('{region} 기준 · 마지막 확인 {time}', { region, time: formatDateTime(checked) })) : null,
    h('div', { class: 'row', style: { marginTop: '0.75rem' } },
      shelterLinks(pos).map(([label, href]) => h('a', { class: 'btn btn-sm btn-outline', href, target: '_blank', rel: 'noopener' }, label))),
    h('p', { class: 'small muted', style: { margin: '0.5rem 0 0' } }, t('민방위 대피소는 지하철역·건물 지하가 대부분입니다. 평소에 집·직장 근처 한 곳씩 가 보세요.')));
}

function readiness(state) {
  const r = checklistProgress(state.protocols, state.checklist);
  const sup = suppliesStatus(state.supplies);
  let next = null;
  for (const p of state.protocols) {
    const item = (p.checklist || []).find((i) => !state.checklist[checklistKey(p.id, i.id)]);
    if (item) { next = { p, item }; break; }
  }
  return h('div', null,
    h('div', { class: 'readiness' },
      h('div', { class: 'readiness-score' }, `${r.percent}`, h('small', null, '%')),
      h('div', { style: { flex: 1 } },
        h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: `${r.percent}%` } })),
        h('div', { class: 'small muted' }, t('체크리스트 {checked}/{total}개 완료', { checked: r.checked, total: r.total })))),
    next ? h('p', { class: 'small', style: { marginTop: '0.75rem' } }, t('다음 할 일: '),
      h('a', { href: `#/protocols/${encodeURIComponent(next.p.id)}` }, `${next.p.title} — ${next.item.text}`)) : h('p', { class: 'small' }, t('모든 준비를 마쳤습니다. 6개월마다 다시 확인하세요.')),
    sup.expired.length || sup.soon.length
      ? h('p', { class: 'small', style: { marginTop: '0.5rem' } }, '📦 ',
        h('a', { href: '#/supplies' }, sup.expired.length
          ? t('유통기한 지난 물품 {n}개', { n: sup.expired.length }) + (sup.soon.length ? t(', 30일 안 {m}개', { m: sup.soon.length }) : '')
          : t('30일 안에 기한이 오는 물품 {m}개', { m: sup.soon.length })))
      : null);
}

export function homeView({ state, live, onChange }) {
  let lastPos = null;
  const note = h('input', { placeholder: t('메모 (선택) 예: 회사 지하 대피소에 있음'), maxlength: 300, 'aria-label': t('신고 메모') });

  // 메모는 필요할 때만 펼친다 (첫 화면에는 누를 버튼만). 접어도 함께 보낼 메모가 무엇인지 보인다.
  const noteTitle = h('span');
  const noteBox = h('details', { class: 'note-fold' }, h('summary', null, noteTitle), note);
  const drawNote = () => {
    const text = note.value.trim();
    noteTitle.textContent = text ? t('함께 보낼 메모: {text}', { text }) : t('메모 덧붙이기 (선택)');
  };
  // 지금 있는 곳을 글 없이 고른다 (다시 누르면 취소)
  let place = '';
  const places = [t('이동 중'), t('집'), t('대피소')].map((label) => h('button', {
    type: 'button', class: 'btn btn-sm btn-outline', 'aria-pressed': 'false',
    onClick: () => { place = place === label ? '' : label; drawPlaces(); },
  }, label));
  const drawPlaces = () => { for (const b of places) b.setAttribute('aria-pressed', String(b.textContent === place)); };
  const placeRow = h('div', { class: 'place-row', role: 'group', 'aria-label': t('지금 있는 곳 (선택)') },
    h('span', { class: 'small muted' }, t('지금 있는 곳 (선택)')), places);
  const clearNote = () => {
    place = '';
    drawPlaces();
    note.value = '';
    noteBox.open = false;
    drawNote();
  };
  note.addEventListener('input', drawNote);
  drawNote();

  const run = (type, button, after = null, status = '') => busy(button, async () => {
    const original = [...button.childNodes];
    const text = quickNote(status, place, note.value);
    button.textContent = t('보내는 중…');
    try {
      const { located } = await report(state, type, text, null);
      located.then((pos) => { lastPos = pos || lastPos; });
      clearNote();
      if (after) await after(text, await Promise.race([located, new Promise((resolve) => setTimeout(() => resolve(null), HELP_LOCATION_WAIT_MS))]));
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      button.replaceChildren(...original);
    }
  });

  const safeBtn = h('button', { class: 'btn btn-safe btn-hero', onClick: (e) => run('safe', e.currentTarget) },
    t('나 무사해요'), h('small', null, t('누르면 GPS 위치와 시간이 가족에게 전달됩니다')));
  const helpBtn = h('button', {
    class: 'btn btn-secondary btn-lg',
    onClick: async (e) => {
      const target = e.currentTarget;
      // 메모를 적었으면 바로 보낸다.
      let status = '';
      if (!note.value.trim()) {
        status = await choose(t('어떤 상황인가요? 누르면 바로 가족에게 위치와 함께 알리고, 이어서 문자 앱이 열립니다.'), [
          ...[t('다침'), t('갇힘'), t('아픔'), t('위험')].map((label) => ({ value: label, label, cls: 'btn-secondary' })),
          { value: '', label: t('고르지 않고 보내기'), cls: 'btn-outline choose-wide' },
        ]);
        if (status === null) return;
      }
      run('help', target, (text, pos) => sendHelp(state, text, pos), status);
    },
  }, t('🆘 도움 요청'));

  const smsBtn = h('button', {
    class: 'btn btn-outline btn-lg',
    onClick: (e) => busy(e.currentTarget, async () => {
      let pos = lastPos;
      if (!pos) {
        try { pos = await getBestPosition(); } catch { pos = lastKnownPosition(); }
      }
      const phones = state.members.filter((m) => m.id !== state.me.id && m.phone).map((m) => m.phone);
      if (!phones.length) {
        toast(t('전화번호가 등록된 가족이 없습니다.'), 'error');
        return;
      }
      location.href = smsHref(phones, safetySmsBody(state.me.name, pos), isIOS);
    }),
  }, t('✉️ 문자로 알리기'));

  return h('div', { class: 'page' },
    h('div', { class: 'home-hello' },
      h('h1', null, t('{name}님', { name: state.me.name })),
      live(() => situation(state))),

    h('section', { class: 'card', 'aria-label': t('생존 신고') },
      safeBtn,
      h('div', { class: 'report-actions' }, helpBtn, smsBtn),
      placeRow,
      noteBox,
      live(() => {
        const last = state.me.last;
        return h('p', { class: 'small muted center', style: { margin: '0.75rem 0 0' } },
          last ? t('마지막 신고: {type} · {ago} ({time})', {
            type: checkinLabel(last.type),
            ago: formatAgo(last.clientAt || last.at),
            time: formatDateTime(last.clientAt || last.at),
          }) : t('아직 신고 기록이 없습니다.'));
      })),

    live(() => todoPanel(state)),

    h('div', { class: 'hotlines', role: 'group', 'aria-label': t('긴급 전화') },
      h('a', { class: 'hotline hotline-red', href: 'tel:119' }, h('strong', null, '119'), h('span', null, t('화재·구조·구급'))),
      h('a', { class: 'hotline', href: 'tel:112' }, h('strong', null, '112'), h('span', null, t('경찰'))),
      h('a', { class: 'hotline', href: 'tel:1339' }, h('strong', null, '1339'), h('span', null, t('질병관리청')))),

    // 관리자는 홈에서 바로 비상을 선언할 수 있다 (1급은 바로, 2급은 펼쳐서).
    live(() => (state.emergency?.active ? null : quickDeclarePanel(state, { foldAlert: true }))),

    h('h2', { class: 'section-title' }, t('바로가기')),
    tiles(),

    h('div', { class: 'grid grid-2' },
      panel(state.isAdmin ? t('가족 현황') : t('지정된 가족 현황'), { href: '#/family', label: t('전체 보기') },
        live(() => statusSummary(state)),
        live(() => familyStatusList(state, { compact: true }))),
      panel(t('나의 대비 상태'), { href: '#/protocols', label: t('체크리스트') },
        live(() => readiness(state)))),

    live(() => alertsPanel(state)),

    foldPanel(t('현재 위치'), { key: 'home-location', hint: t('내 좌표와 집합장소까지의 거리·방향') },
      locationPanel(state, {
        onChange,
        onPosition: (p) => { lastPos = p; },
        onCheckpoint: async (p) => {
          await report(state, 'checkpoint', quickNote(place, note.value), p);
          clearNote();
        },
      })),

    live(() => (state.emergency?.active || state.isAdmin ? null
      : alertBox('warning', null,
        h('p', null, t('위험한데 아직 경보가 없다면 직접 2급이나 1급 비상을 발령할 수 있습니다 (1회).'), ' ',
          h('a', { href: '#/emergency' }, t('비상 경보 화면으로')))))));
}
