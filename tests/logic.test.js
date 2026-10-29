import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  meetingSchedule, scheduleWarnings, formatOffset, formatRemaining, memberStatus,
  ageFromBirth, cleanPhone, smsHref, parseSteps, stepsToText, parseChecklist,
  checklistProgress, checklistKey, directionLinks,
  emergencyLevel, alarmKey, levelActor, emergencyLogTitle, isFreshAlarmTest, buildTimeline,
} from '../web/js/logic.js';
import { DEFAULT_PROTOCOLS } from '../web/js/data/protocols.js';
import { DEFAULT_PROTOCOLS_EN } from '../web/js/data/protocols.en.js';
import { expiryState, suppliesStatus, shelterLinks } from '../web/js/logic.js';

const T0 = new Date('2026-10-27T09:00:00+09:00');
const at = (h) => new Date(T0.getTime() + h * 3600_000);

const points = [
  { rank: 2, name: '학교', offsetHours: 6, waitMinutes: 60 },
  { rank: 1, name: '집', offsetHours: 0, waitMinutes: 120 },
  { rank: 3, name: '시청', offsetHours: 24, waitMinutes: 60 },
];

test('비상이 아니면 시간이 계산되지 않는다', () => {
  const r = meetingSchedule(points, { active: false }, T0);
  assert.equal(r.currentRank, null);
  assert.deepEqual(r.points.map((p) => p.rank), [1, 2, 3]);
  assert.ok(r.points.every((p) => p.state === 'unscheduled' && p.at === null));
});

test('선언 직후에는 1순위가 현재 목표다', () => {
  const r = meetingSchedule(points, { active: true, declaredAt: T0 }, at(0.5));
  assert.equal(r.currentRank, 1);
  assert.equal(r.points[0].at.getTime(), T0.getTime());
  assert.equal(r.points[0].deadline.getTime(), at(2).getTime());
  assert.deepEqual(r.points.map((p) => p.state), ['current', 'upcoming', 'upcoming']);
});

test('1순위 대기 시간이 지나면 2순위로 넘어간다', () => {
  const r = meetingSchedule(points, { active: true, declaredAt: T0 }, at(3));
  assert.equal(r.currentRank, 2);
  assert.deepEqual(r.points.map((p) => p.state), ['past', 'current', 'upcoming']);
});

test('대기 종료 시각 정각까지는 현재 순위로 본다', () => {
  const r = meetingSchedule(points, { active: true, declaredAt: T0 }, at(2));
  assert.equal(r.currentRank, 1);
});

test('모든 순위가 지나면 현재 목표가 없다', () => {
  const r = meetingSchedule(points, { active: true, declaredAt: T0 }, at(48));
  assert.equal(r.currentRank, null);
  assert.ok(r.points.every((p) => p.state === 'past'));
});

test('관리자가 직접 넣은 시각이 우선한다', () => {
  const override = at(30);
  const list = points.map((p) => (p.rank === 2 ? { ...p, overrideAt: { toDate: () => override } } : p));
  const r = meetingSchedule(list, { active: true, declaredAt: T0 }, at(10));
  assert.equal(r.points[1].at.getTime(), override.getTime());
  assert.equal(r.currentRank, 2);
});

test('순위 시간이 거꾸로면 경고한다', () => {
  assert.deepEqual(scheduleWarnings(points), []);
  const bad = [{ rank: 1, offsetHours: 6, waitMinutes: 60 }, { rank: 2, offsetHours: 3, waitMinutes: 0 }];
  assert.equal(scheduleWarnings(bad).length, 1);
});

test('시간 표시', () => {
  assert.equal(formatOffset(0), '비상 발생 직후');
  assert.equal(formatOffset(6), '발생 후 6시간');
  assert.equal(formatOffset(30), '발생 후 1일 6시간');
  assert.equal(formatOffset(48), '발생 후 2일');
  assert.equal(formatRemaining(-1), '지남');
  assert.equal(formatRemaining(5 * 60_000), '5분');
  assert.equal(formatRemaining(133 * 60_000), '2시간 13분');
});

test('비상 중에는 선언 이후 신고만 무사로 인정한다', () => {
  const emergency = { active: true, declaredAt: T0 };
  const before = { last: { type: 'safe', clientAt: at(-1) } };
  const after = { last: { type: 'safe', clientAt: at(1) } };
  const help = { last: { type: 'help', clientAt: at(1) } };
  const checkpoint = { last: { type: 'checkpoint', clientAt: at(1) } };
  assert.equal(memberStatus({}, emergency).key, 'unknown');
  assert.equal(memberStatus(before, emergency).key, 'unknown');
  assert.equal(memberStatus(after, emergency).key, 'safe');
  assert.equal(memberStatus(help, emergency).key, 'help');
  assert.equal(memberStatus(checkpoint, emergency).key, 'safe');
  assert.equal(memberStatus(after, { active: false }).key, 'idle');
});

test('나이 계산', () => {
  const now = new Date('2026-10-27T12:00:00');
  assert.equal(ageFromBirth('1990-10-27', now), 36);
  assert.equal(ageFromBirth('1990-10-28', now), 35);
  assert.equal(ageFromBirth('bad', now), null);
});

test('전화번호와 문자 링크', () => {
  assert.equal(cleanPhone('010-1234-5678'), '01012345678');
  assert.equal(cleanPhone('+82 10 1234 5678'), '+821012345678');
  assert.equal(cleanPhone('javascript:alert(1)'), '1');
  assert.equal(smsHref(['010-1', '010-2'], '안녕 & 잘', false), 'sms:0101,0102?body=%EC%95%88%EB%85%95%20%26%20%EC%9E%98');
  assert.ok(smsHref(['010-1'], 'x', true).startsWith('sms:/open?addresses=0101&body='));
});

test('길찾기 링크는 좌표가 있을 때만', () => {
  assert.deepEqual(directionLinks({ lat: null, lng: null }), []);
  const links = directionLinks({ lat: 37.5, lng: 127 }, '우리,집');
  assert.equal(links[0].href, 'https://map.kakao.com/link/to/%EC%9A%B0%EB%A6%AC%20%EC%A7%91,37.5,127');
});

test('프로토콜 단계 텍스트 왕복', () => {
  const steps = [{ phase: '즉시', items: ['a', 'b'] }, { phase: '나중', items: ['c'] }];
  assert.deepEqual(parseSteps(stepsToText(steps)), steps);
  assert.deepEqual(parseSteps('그냥 한 줄'), [{ phase: '대처법', items: ['그냥 한 줄'] }]);
});

test('체크리스트 편집 시 같은 문구는 id를 유지한다', () => {
  const prev = [{ id: 'g1', text: '물' }, { id: 'g2', text: '라디오' }];
  const next = parseChecklist('- 라디오\n- 손전등\n물', prev);
  assert.deepEqual(next.map((i) => i.id), ['g2', 'i1', 'g1']);
});

test('체크리스트 진행률', () => {
  const protos = [{ id: 'a', checklist: [{ id: '1' }, { id: '2' }] }];
  const r = checklistProgress(protos, { [checklistKey('a', '1')]: true });
  assert.deepEqual(r, { total: 2, checked: 1, percent: 50 });
});

test('기본 프로토콜은 id와 체크리스트 id가 겹치지 않는다', () => {
  const ids = new Set();
  for (const p of DEFAULT_PROTOCOLS) {
    assert.ok(!ids.has(p.id), p.id);
    ids.add(p.id);
    const itemIds = new Set(p.checklist.map((i) => i.id));
    assert.equal(itemIds.size, p.checklist.length, p.id);
    assert.ok(p.steps.length <= 10 && p.checklist.length <= 80);
  }
});

test('접속 코드 검사', async () => {
  const { accessCodeProblem, accessCodesProblem, randomDigits } = await import('../web/js/logic.js');
  assert.equal(accessCodeProblem('12345', 'family'), '가족 코드는 6자 이상이어야 합니다.');
  assert.equal(accessCodeProblem('482913', 'family'), null);
  assert.match(accessCodeProblem('482913', 'admin'), /관리자 코드는 8자/);
  assert.match(accessCodeProblem('11111111', 'backup'), /쉬운/);
  assert.match(accessCodeProblem('12345678', 'admin'), /쉬운/);
  assert.equal(accessCodesProblem({ family: '482913', admin: '58201937', backup: 'river-stone-42' }), null);
  assert.match(accessCodesProblem({ family: '58201937', admin: '58201937', backup: 'river-stone-42' }), /서로 달라/);
  const r = randomDigits();
  assert.match(r, /^\d{8}$/);
  assert.equal(accessCodeProblem(r, 'admin'), null);
});

test('오프라인 거리·방향 계산', async () => {
  const { distanceMeters, bearingDegrees, compassLabel, formatDistance, routeHint, formatDms } = await import('../web/js/logic.js');
  const seoulCityHall = { lat: 37.5663, lng: 126.9779 };
  const gangnamStation = { lat: 37.4979, lng: 127.0276 };
  const d = distanceMeters(seoulCityHall, gangnamStation);
  assert.ok(d > 8500 && d < 9000, `거리 ${d}`);
  const b = bearingDegrees(seoulCityHall, gangnamStation);
  assert.ok(b > 140 && b < 160, `방위 ${b}`);
  assert.equal(compassLabel(b).label, '남동쪽');
  assert.equal(compassLabel(0).label, '북쪽');
  assert.equal(compassLabel(359).label, '북쪽');
  assert.equal(formatDistance(234), '230m');
  assert.equal(formatDistance(2345), '2.3km');
  assert.equal(formatDistance(23456), '23km');
  assert.equal(routeHint({ lat: null, lng: null }, gangnamStation), null);
  assert.match(routeHint(seoulCityHall, gangnamStation).text, /km · 남동쪽/);
  assert.equal(formatDms(37.5, -0.25), "N 37° 30.000', W 0° 15.000'");
});

test('CSV는 BOM을 붙이고 수식 실행을 막는다', async () => {
  const { toCsv } = await import('../web/js/logic.js');
  const csv = toCsv(['이름', '메모'], [['엄마', '=HYPERLINK("x")'], ['아빠', '쉼표, 있음']]);
  assert.ok(csv.startsWith('﻿이름,메모'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"쉼표, 있음"'));
});

test('기록을 시간 역순 하나의 목록으로 합치고 거른다', async () => {
  const { buildTimeline, filterTimeline } = await import('../web/js/logic.js');
  const t = (h) => new Date(`2026-10-27T${String(h).padStart(2, '0')}:00:00`);
  const items = buildTimeline({
    emergencyLog: [{ id: '1', action: 'declare', type: 'earthquake', by: 'a', byName: '아빠', at: t(9) }],
    checkins: [{ id: '2', type: 'help', uid: 'm', name: '엄마', note: '다리 다침', clientAt: t(10) }],
    meetingLogs: [{ id: '3', rank: 1, uid: 'k', name: '아이', message: '도착', clientAt: t(11) }],
    auditLog: [{ id: '4', action: 'notify.emergency', by: 'a', byName: '아빠', detail: '3건 발송', at: t(9) }],
  });
  assert.equal(items.length, 4);
  assert.equal(items[0].kind, 'meet');
  assert.equal(items[1].kind, 'help');
  assert.ok(['emergency', 'notify'].includes(items[2].kind));
  assert.equal(filterTimeline(items, { kind: 'help' }).length, 1);
  assert.equal(filterTimeline(items, { who: 'a' }).length, 2);
  assert.equal(filterTimeline(items, { q: '다리' }).length, 1);
  assert.equal(filterTimeline(items, { days: 1 }, new Date('2026-10-30T00:00:00')).length, 0);
});

test('경계 중에는 집합 시간이 시작되지 않고, 실제로 바뀐 시각부터 계산된다', () => {
  const alert = { active: true, level: 'alert', declaredAt: T0, declaredBy: 'a' };
  assert.equal(emergencyLevel(alert), 'alert');
  assert.equal(meetingSchedule(points, alert, at(1)).currentRank, null);
  // 경계 발령 2시간 뒤 실제 전환 → 1순위 도착은 전환 시각, 대기 120분
  const real = { ...alert, level: 'real', realAt: at(2), escalatedBy: 'b', escalatedByName: '엄마' };
  const r = meetingSchedule(points, real, at(3.5));
  assert.equal(r.currentRank, 1);
  assert.equal(r.points[0].at.getTime(), at(2).getTime());
  assert.deepEqual(levelActor(real), { id: 'b', name: '엄마' });
  // level이 없는 예전 문서는 실제로 본다
  assert.equal(emergencyLevel({ active: true, declaredAt: T0 }), 'real');
  assert.equal(emergencyLevel({ active: false, level: 'alert' }), null);
});

test('경계 → 실제로 바뀌면 경보 키가 달라져 다시 울린다', () => {
  const alert = { active: true, level: 'alert', declaredAt: T0 };
  const real = { ...alert, level: 'real', realAt: at(1) };
  assert.notEqual(alarmKey(alert), alarmKey(real));
  assert.equal(alarmKey({ active: false }), null);
  assert.equal(alarmKey({ active: true, level: 'alert' }), null);
});

test('비상 기록 제목', () => {
  assert.match(emergencyLogTitle({ action: 'declare', level: 'alert', type: 'war' }), /^2급 비상 발령: 전쟁/);
  assert.match(emergencyLogTitle({ action: 'declare', type: 'war' }), /^1급 비상 선언/);
  assert.match(emergencyLogTitle({ action: 'escalate', type: 'earthquake' }), /^1급 격상: 지진/);
  assert.equal(emergencyLogTitle({ action: 'end' }), '비상 해제');
  const tl = buildTimeline({ alarmTests: [{ id: 't', at: T0, byName: '아빠', sound: 'alert', message: '훈련' }] });
  assert.equal(tl[0].kind, 'test');
  assert.match(tl[0].title, /2급/);
});

test('테스트 알람은 보낸 뒤 30분 안에만 울린다', () => {
  assert.equal(isFreshAlarmTest({ at: T0 }, at(0.25)), true);
  assert.equal(isFreshAlarmTest({ at: T0 }, at(1)), false);
  assert.equal(isFreshAlarmTest({}, T0), false);
});

test('영어 기본 프로토콜은 한국어와 항목 수가 같다', () => {
  assert.equal(DEFAULT_PROTOCOLS_EN.length, DEFAULT_PROTOCOLS.length);
  DEFAULT_PROTOCOLS.forEach((p, i) => {
    const e = DEFAULT_PROTOCOLS_EN[i];
    assert.equal(e.id, p.id);
    assert.equal(e.keyPoints.length, p.keyPoints.length, p.id);
    assert.equal(e.steps.length, p.steps.length, p.id);
    p.steps.forEach((st, j) => assert.equal(e.steps[j].items.length, st.items.length, `${p.id} step ${j}`));
    assert.deepEqual(e.checklist.map((c) => c.id), p.checklist.map((c) => c.id), p.id);
    assert.ok(p.keyPoints.length <= 6 && p.summary.length <= 300 && p.title.length <= 60, p.id);
  });
});

test('비상 물품: 기한 지남·30일 안·괜찮음을 가른다', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const day = 86400e3;
  const items = [
    { name: '물', expiresAt: new Date(now - day) },
    { name: '건빵', expiresAt: new Date(now + 10 * day) },
    { name: '약', expiresAt: new Date(now + 31 * day) },
    { name: '건전지', expiresAt: null },
  ];
  assert.deepEqual(items.map((i) => expiryState(i, now)), ['expired', 'soon', 'ok', 'none']);
  const s = suppliesStatus(items, now);
  assert.deepEqual([s.expired.map((i) => i.name), s.soon.map((i) => i.name)], [['물'], ['건빵']]);
  assert.match(shelterLinks({ lat: 37.5665, lng: 126.978 })[0][1], /@37\.56650,126\.97800/);
  assert.equal(shelterLinks(null).length, 3);
});
