import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  meetingSchedule, scheduleWarnings, formatOffset, formatRemaining, memberStatus,
  ageFromBirth, cleanPhone, smsHref, parseSteps, stepsToText, parseChecklist,
  checklistProgress, checklistKey, directionLinks,
} from '../web/js/logic.js';
import { DEFAULT_PROTOCOLS } from '../web/js/data/protocols.js';

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

test('아이디 로그인 주소 변환', async () => {
  const { loginEmail, loginIdFromEmail, isValidLoginId, normalizeLoginId, secretCodeProblem } = await import('../web/js/logic.js');
  assert.equal(loginEmail(' Dad ', 'p1'), 'dad@p1.firebaseapp.com');
  assert.equal(loginEmail('old@mail.com', 'p1'), 'old@mail.com');
  assert.equal(loginIdFromEmail('dad@p1.firebaseapp.com', 'p1'), 'dad');
  assert.equal(loginIdFromEmail('old@mail.com', 'p1'), 'old@mail.com');
  assert.equal(normalizeLoginId('  MoM_1 '), 'mom_1');
  assert.ok(isValidLoginId('mom'));
  assert.ok(isValidLoginId('kim.minho-2'));
  assert.ok(!isValidLoginId('ab'));
  assert.ok(!isValidLoginId('_mom'));
  assert.ok(!isValidLoginId('엄마'));
  assert.ok(!isValidLoginId('a'.repeat(21)));
  assert.equal(secretCodeProblem('12345'), '비밀코드는 6자 이상이어야 합니다.');
  assert.match(secretCodeProblem('111111'), /쉬운/);
  assert.match(secretCodeProblem('123456'), /쉬운/);
  assert.equal(secretCodeProblem('482913'), null);
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
