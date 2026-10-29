// 홈: 현재 상황, "나 무사해요" 생존신고, 바로가기, 가족 현황, 준비 상태, 현재 위치, 긴급 전화
import { h, toast, busy, card, panel, alertBox, isIOS, ask } from '../dom.js';
import { errorMessage } from '../firebase.js';
import { checkIn, notifyHelp, batteryLevel } from '../store.js';
import { getBestPosition, lastKnownPosition } from '../geo.js';
import {
  checkinLabel, formatAgo, formatDateTime, formatRemaining, memberStatus, safetySmsBody, helpSmsBody, smsHref,
  emergencyLabel, emergencyLevel, levelActor, realStartedAt, meetingSchedule, checklistProgress, checklistKey,
  suppliesStatus, toDate, shelterLinks,
} from '../logic.js';
import { t } from '../i18n.js';
import { familyStatusList, statusSummary } from './family.js';
import { locationPanel } from './location.js';
import { quickDeclarePanel } from './emergency.js';

/** 위치를 읽고 신고를 저장한다. 위치를 못 읽어도 신고는 저장한다. */
async function report(state, type, note, knownPos) {
  let pos = knownPos || null;
  let locError = null;
  if (!pos) {
    try {
      pos = await getBestPosition();
    } catch (err) {
      locError = err.message;
    }
  }
  const result = await checkIn(state.me, type, pos, note, state.emergency, await batteryLevel());
  const what = checkinLabel(type);
  if (result === 'queued') toast(t('{what} 저장됨 — 오프라인이라 연결되면 자동으로 전송됩니다.', { what }), 'warn');
  else toast(pos ? t('{what} 전송 완료', { what }) : t('{what} 전송 완료 (위치 없이)', { what }));
  if (locError) toast(t('위치를 못 읽어 위치 없이 저장했습니다: {error}', { error: locError }), 'warn');
  return pos;
}

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
    return alertBox('info', t('현재 비상 상황이 아닙니다'),
      h('p', null, t('평상시에는 집합장소와 대처법을 미리 확인하고, 대비 체크리스트를 채워 두세요.')),
      h('div', { class: 'alert-actions' },
        h('a', { class: 'btn btn-sm', href: '#/protocols' }, t('대비 체크리스트')),
        h('a', { class: 'btn btn-sm btn-outline', href: '#/guide' }, t('사용 안내'))));
  }
  if (emergencyLevel(e) === 'alert') {
    return alertBox('warning', t('2급 비상 발령: {type}', { type: emergencyLabel(e.type) }),
      h('p', null, `${t('{name} · {time} 발령', { name: e.declaredByName || t('가족'), time: formatDateTime(e.declaredAt) })}${e.message ? ` — ${e.message}` : ''}`),
      me.key === 'unknown' ? h('p', null, h('strong', null, t('아직 생존신고를 하지 않았습니다. 아래 버튼을 먼저 누르세요.'))) : null,
      h('p', null, t('준위험 상황입니다. 비상 배낭·물·현금을 확인하고, 집합장소와 가는 길을 미리 봐 두세요. 1급 비상이 되면 경보음이 울립니다.')),
      h('div', { class: 'alert-actions' },
        h('a', { class: 'btn btn-sm', href: '#/meet' }, t('집합장소 확인')),
        h('a', { class: 'btn btn-sm btn-outline', href: `#/protocols/${encodeURIComponent(e.type)}` }, t('대처법 보기'))));
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
      ` · ${target.at > Date.now() ? t('도착까지') : t('대기 종료까지')} `, h('strong', { 'data-until': String(until) }, formatRemaining(until - Date.now()))) : null,
    h('div', { class: 'alert-actions' },
      h('a', { class: 'btn btn-sm', href: '#/meet', style: { background: '#fff', color: '#9c3d10' } }, t('집합장소 보기')),
      h('a', { class: 'btn btn-sm', href: `#/protocols/${encodeURIComponent(e.type)}`, style: { background: 'transparent', boxShadow: 'inset 0 0 0 2px #fff' } }, t('대처법 보기'))));
}

function tiles(state) {
  const list = [
    ['#/meet', '📍', t('집합장소'), t('1~10순위 장소와 시간, 거리·방향')],
    ['#/protocols', '📘', t('상황별 대처법'), t('응급처치·물·대피 등 23가지')],
    ['#/contacts', '☎️', t('비상 연락처'), t('119·112와 가족 지정 연락처')],
    ['#/family', '👪', t('가족 현황'), state.isAdmin ? t('가족 전체 상태와 위치') : t('지정된 가족의 상태')],
    ['#/sos', '🆘', t('구조 신호'), t('손전등·SOS 불빛·호루라기 소리')],
    ['#/supplies', '📦', t('비상 물품'), t('물·식량·약 유통기한 관리')],
    ['#/records', '🗂', t('내 신고 기록'), t('내가 남긴 위치와 시간')],
    ['#/print', '🖨', t('인쇄용 비상카드'), t('지갑·배낭에 넣을 종이 카드')],
  ];
  const admin = state.isAdmin ? [
    ['#/admin', '🛠', t('관리자 설정'), t('비상 선언·해제, 소리 테스트, 가족 등록'), 'tile-admin'],
    ['#/emergency', '🚨', t('비상 경보'), state.emergency?.active ? t('1급 격상·해제·테스트') : t('1급·2급 발령, 테스트 알람'), 'tile-admin tile-danger'],
  ] : [['#/emergency', '🚨', t('비상 경보'), state.me.declareCredits >= 1 ? t('선언권 1회 남음 · 경보음 시험') : t('선언권 없음 · 경보음 시험'), 'tile-danger']];
  return h('div', { class: 'tiles' }, [...list, ...admin].map(([href, icon, title, desc, cls = '']) => h('a', { class: `tile ${cls}`, href },
    h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon),
    h('strong', null, title),
    h('span', null, desc))));
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

  const run = (type, button, after = null) => busy(button, async () => {
    const original = [...button.childNodes];
    const text = note.value.trim();
    button.textContent = t('위치 확인 중…');
    try {
      const pos = await report(state, type, text, null);
      lastPos = pos || lastPos;
      note.value = '';
      if (after) await after(text, pos);
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
      if (!note.value.trim() && !(await ask(t('도움 요청을 보낼까요? 관련 가족의 휴대폰에 내 위치와 함께 알림이 가고, 이어서 문자 앱이 열립니다. 메모에 상황을 적으면 더 빨리 도울 수 있습니다.')))) return;
      run('help', target, (text, pos) => sendHelp(state, text, pos));
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
    h('div', null,
      h('p', { class: 'muted', style: { margin: 0, fontWeight: 600 } }, t('안녕하세요,')),
      h('h1', null, t('{name}님', { name: state.me.name }))),
    live(() => situation(state)),
    // 관리자는 홈에서 바로 비상을 선언할 수 있다.
    live(() => (state.emergency?.active ? null : quickDeclarePanel(state))),

    panel(t('생존 신고'), null,
      safeBtn,
      h('div', { style: { margin: '0.75rem 0' } }, note),
      h('div', { class: 'row' }, helpBtn, smsBtn),
      live(() => {
        const last = state.me.last;
        return h('p', { class: 'small muted center', style: { margin: '0.75rem 0 0' } },
          last ? t('마지막 신고: {type} · {ago} ({time})', {
            type: checkinLabel(last.type),
            ago: formatAgo(last.clientAt || last.at),
            time: formatDateTime(last.clientAt || last.at),
          }) : t('아직 신고 기록이 없습니다.'));
      })),

    h('h2', { class: 'section-title' }, t('바로가기')),
    live(() => tiles(state)),

    h('div', { class: 'grid grid-2' },
      panel(state.isAdmin ? t('가족 현황') : t('지정된 가족 현황'), { href: '#/family', label: t('전체 보기') },
        live(() => statusSummary(state)),
        live(() => familyStatusList(state, { compact: true }))),
      panel(t('나의 대비 상태'), { href: '#/protocols', label: t('체크리스트') },
        live(() => readiness(state)))),

    live(() => alertsPanel(state)),

    panel(t('현재 위치'), null,
      locationPanel(state, {
        onChange,
        onPosition: (p) => { lastPos = p; },
        onCheckpoint: async (p) => {
          await report(state, 'checkpoint', note.value.trim(), p);
          note.value = '';
        },
      })),

    card(
      h('h2', null, t('긴급 전화')),
      h('div', { class: 'hotlines' },
        h('a', { class: 'hotline hotline-red', href: 'tel:119' }, h('strong', null, '119'), h('span', null, t('화재·구조·구급'))),
        h('a', { class: 'hotline', href: 'tel:112' }, h('strong', null, '112'), h('span', null, t('경찰'))),
        h('a', { class: 'hotline', href: 'tel:1339' }, h('strong', null, '1339'), h('span', null, t('질병관리청')))),
      h('p', { class: 'small', style: { margin: '0.75rem 0 0' } }, h('a', { href: '#/contacts' }, t('전체 비상 연락처 보기 →')))),

    live(() => (state.emergency?.active || state.isAdmin ? null
      : alertBox('warning', null,
        h('p', null, t('위험한데 아직 경보가 없다면 직접 2급이나 1급 비상을 발령할 수 있습니다 (1회).'), ' ',
          h('a', { href: '#/emergency' }, t('비상 경보 화면으로')))))));
}
