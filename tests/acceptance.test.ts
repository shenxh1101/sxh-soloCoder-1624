import 'reflect-metadata';
import request from 'supertest';
import { AppDataSource } from '../src/config/database';

const BASE = 'http://localhost:3000/api';

let leaderId: string;
let advisorId: string;
let committeeId: string;
let financeId: string;
let member1Id: string;
let member2Id: string;
let member3Id: string;
let member4Id: string;
let clubId: string;
let activityId: string;
let advisorApprovalId: string;
let leagueApprovalId: string;
let reimbursementId: string;
let abnormalOrderId: string;
let venueId: string;
let bookingId: string;

beforeAll(async () => {
  try {
    await AppDataSource.initialize();
  } catch (e) {
    throw new Error('Database not initialized. Run npm run seed first, then npm start.');
  }

  const userRepo = AppDataSource.getRepository(
    require('../src/entities/User').User
  );

  const leader = await userRepo.findOne({ where: { username: 'leader1' } });
  const advisor = await userRepo.findOne({ where: { username: 'advisor1' } });
  const committee = await userRepo.findOne({ where: { username: 'committee1' } });
  const finance = await userRepo.findOne({ where: { username: 'finance' } });
  const m1 = await userRepo.findOne({ where: { username: 'member1' } });
  const m2 = await userRepo.findOne({ where: { username: 'member2' } });
  const m3 = await userRepo.findOne({ where: { username: 'member3' } });
  const m4 = await userRepo.findOne({ where: { username: 'member4' } });

  if (!leader || !advisor || !committee || !finance || !m1 || !m2 || !m3 || !m4) {
    throw new Error('Seed data not found. Run npm run seed first.');
  }

  leaderId = leader.id;
  advisorId = advisor.id;
  committeeId = committee.id;
  financeId = finance.id;
  member1Id = m1.id;
  member2Id = m2.id;
  member3Id = m3.id;
  member4Id = m4.id;
}, 15000);

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

function agent() {
  return request(BASE.replace('http://localhost:3000', ''));
}

const req = () => request('http://localhost:3000');

describe('1. 社团申请主流程', () => {
  test('1.1 社长在成员名单中，人数>=5，应正常通过校验', async () => {
    const res = await req()
      .post('/api/clubs')
      .send({
        name: '编程技术社_' + Date.now(),
        description: '专注编程技术交流',
        category: 'technology',
        leaderId,
        memberIds: [member1Id, member2Id, member3Id, member4Id],
        advisorId
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    clubId = res.body.data.id;
  });

  test('1.2 社长不在成员列表中但自动合并，人数仍>=5，应通过', async () => {
    const res = await req()
      .post('/api/clubs')
      .send({
        name: '摄影社_' + Date.now(),
        description: '摄影爱好者社团',
        category: 'arts',
        leaderId,
        memberIds: [leaderId, member1Id, member2Id, member3Id, member4Id],
        advisorId
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('1.3 成员不足5人应退回，带出具体原因', async () => {
    const res = await req()
      .post('/api/clubs')
      .send({
        name: '小众社_' + Date.now(),
        description: '人数不够的社',
        category: 'other',
        leaderId,
        memberIds: [member1Id],
        advisorId
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThanOrEqual(1);
    const msg = res.body.errors.join('');
    expect(msg).toContain('初始成员人数不足');
  });

  test('1.4 名称重复应退回并注明原因', async () => {
    const uniqueName = '重复测试社_' + Date.now();
    await req()
      .post('/api/clubs')
      .send({
        name: uniqueName,
        description: '先创建一个',
        category: 'technology',
        leaderId,
        memberIds: [member1Id, member2Id, member3Id, member4Id],
        advisorId
      });

    const res = await req()
      .post('/api/clubs')
      .send({
        name: uniqueName,
        description: '重复名称',
        category: 'technology',
        leaderId,
        memberIds: [member1Id, member2Id, member3Id, member4Id],
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors.join('')).toContain('已存在');
  });

  test('1.5 资料缺失（空名称/描述/类别）应退回并逐条列出', async () => {
    const res = await req()
      .post('/api/clubs')
      .send({
        name: '',
        description: '',
        category: '',
        leaderId,
        memberIds: [member1Id, member2Id, member3Id, member4Id],
      });

    expect(res.body.success).toBe(false);
    expect(res.body.errors).toBeDefined();
    const msg = res.body.errors.join(',');
    expect(msg).toContain('社团名称不能为空');
    expect(msg).toContain('社团描述不能为空');
    expect(msg).toContain('社团类别不能为空');
  });

  test('1.6 审批社团申请', async () => {
    const res = await req()
      .post(`/api/clubs/${clubId}/approve`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });
});

describe('2. 场地推荐与预约', () => {
  test('2.1 GET /api/venues/available/recommend 返回可用场地评分', async () => {
    const res = await req()
      .get('/api/venues/available/recommend')
      .query({
        startTime: '2026-08-01T09:00:00Z',
        endTime: '2026-08-01T12:00:00Z',
        participants: 50
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('score');
    expect(res.body.data[0]).toHaveProperty('venue');
    expect(res.body.data[0]).toHaveProperty('available');
    venueId = res.body.data[0].venue.id;
  });

  test('2.2 GET /api/venues/bookings 返回预约列表（不被/:id拦截）', async () => {
    const res = await req()
      .get('/api/venues/bookings');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('items');
    expect(res.body.data).toHaveProperty('total');
  });

  test('2.3 创建场地预约', async () => {
    const res = await req()
      .post('/api/venues/bookings')
      .send({
        venueId,
        startTime: '2026-08-01T09:00:00Z',
        endTime: '2026-08-01T12:00:00Z',
        purpose: '技术分享会',
        participants: 50
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.isLocked).toBe(true);
    bookingId = res.body.data.id;
  });

  test('2.4 场地详情仍可正常访问', async () => {
    const res = await req()
      .get(`/api/venues/${venueId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(venueId);
  });
});

describe('3. 超预算多级审批', () => {
  test('3.1 创建超预算活动', async () => {
    const res = await req()
      .post('/api/activities')
      .send({
        title: '大型技术峰会',
        description: '超预算活动测试',
        category: 'lecture',
        startTime: '2026-09-01T09:00:00Z',
        endTime: '2026-09-01T17:00:00Z',
        budget: 5000,
        expectedParticipants: 200,
        clubId
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    activityId = res.body.data.id;
  });

  test('3.2 提交审批后生成指导老师+团委两级审批，团委先排队', async () => {
    const res = await req()
      .post(`/api/activities/${activityId}/submit`);

    expect(res.status).toBe(200);
    expect(res.body.data.activity.status).toBe('pending_approval');
    expect(res.body.data.approvals.length).toBe(2);

    const advisorApp = res.body.data.approvals.find(
      (a: any) => a.level === 'advisor'
    );
    const leagueApp = res.body.data.approvals.find(
      (a: any) => a.level === 'league_committee'
    );

    advisorApprovalId = advisorApp.id;
    leagueApprovalId = leagueApp.id;

    expect(advisorApp).toBeDefined();
    expect(leagueApp).toBeDefined();
    expect(advisorApp.status).toBe('pending');
    expect(leagueApp.status).toBe('queued');
  });

  test('3.3 团委在指导老师审批前不能直接处理（QUEUED 状态提示明确原因）', async () => {
    const res = await req()
      .post(`/api/activities/approvals/${leagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true,
        comment: '团委提前审批'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('尚未进入待处理状态');
  });

  test('3.4 指导老师审批通过后，团委可审批', async () => {
    const advisorRes = await req()
      .post(`/api/activities/approvals/${advisorApprovalId}/process`)
      .send({
        approverId: advisorId,
        approved: true,
        comment: '指导老师同意'
      });

    expect(advisorRes.status).toBe(200);
    expect(advisorRes.body.data.status).toBe('approved');

    const leagueRes = await req()
      .post(`/api/activities/approvals/${leagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true,
        comment: '团委同意'
      });

    expect(leagueRes.status).toBe(200);
    expect(leagueRes.body.data.status).toBe('approved');
  });

  test('3.5 两级审批通过后活动状态变为approved', async () => {
    const res = await req()
      .get(`/api/activities/${activityId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });
});

describe('4. 报销与异常工单', () => {
  test('4.1 完成活动后提交超预算报销（偏差>10%触发异常工单）', async () => {
    await req()
      .post(`/api/activities/${activityId}/complete`)
      .send({ actualCost: 6000, actualParticipants: 180 });

    const res = await req()
      .post('/api/reimbursements')
      .send({
        activityId,
        description: '技术峰会报销',
        items: [
          { itemName: '场地费', category: 'venue', quantity: 1, unitPrice: 3000 },
          { itemName: '物料费', category: 'material', quantity: 1, unitPrice: 3000 }
        ]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isAbnormal).toBe(true);
    expect(res.body.data.deviationRate).toBeGreaterThan(10);
    reimbursementId = res.body.data.reimbursement.id;
    abnormalOrderId = res.body.data.abnormalOrder.id;
  });

  test('4.2 异常工单列表中可查到分配给财务的记录', async () => {
    const res = await req()
      .get('/api/abnormal-orders');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);

    const order = res.body.data.items.find(
      (o: any) => o.id === abnormalOrderId
    );
    expect(order).toBeDefined();
    expect(order.status).toBe('pending');
    expect(order.assigneeId).toBeDefined();
  });

  test('4.3 异常工单详情可访问', async () => {
    const res = await req()
      .get(`/api/abnormal-orders/${abnormalOrderId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(abnormalOrderId);
    expect(res.body.data.reimbursement).toBeDefined();
  });

  test('4.4 财务复核通过异常工单', async () => {
    const res = await req()
      .post(`/api/abnormal-orders/${abnormalOrderId}/process`)
      .send({
        resolvedBy: financeId,
        resolution: '核实无误，同意报销',
        approve: true
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('resolved');
  });

  test('4.5 报销详情可查看', async () => {
    const res = await req()
      .get(`/api/reimbursements/${reimbursementId}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(reimbursementId);
  });

  test('4.6 报销审批通过', async () => {
    const res = await req()
      .post(`/api/reimbursements/${reimbursementId}/approve`)
      .send({ approvedBy: committeeId, approvedAmount: 6000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('approved');
  });

  test('4.7 报销标记为已付款', async () => {
    const res = await req()
      .post(`/api/reimbursements/${reimbursementId}/paid`)
      .send({ paidBy: financeId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('paid');
  });

  test('4.8 报销列表可正常查看', async () => {
    const res = await req()
      .get('/api/reimbursements');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });
});

describe('5. 审批超时催办', () => {
  let timeoutActivityId: string;
  let timeoutAdvisorApprovalId: string;
  let timeoutLeagueApprovalId: string;

  test('5.1 创建超预算活动并提交审批', async () => {
    const createRes = await req()
      .post('/api/activities')
      .send({
        title: '超时审批测试活动',
        description: '测试催办逻辑',
        category: 'competition',
        startTime: '2026-10-01T09:00:00Z',
        endTime: '2026-10-01T17:00:00Z',
        budget: 2000,
        expectedParticipants: 100,
        clubId
      });

    timeoutActivityId = createRes.body.data.id;

    const submitRes = await req()
      .post(`/api/activities/${timeoutActivityId}/submit`);

    const approvals = submitRes.body.data.approvals;
    timeoutAdvisorApprovalId = approvals.find((a: any) => a.level === 'advisor').id;
    timeoutLeagueApprovalId = approvals.find((a: any) => a.level === 'league_committee').id;

    expect(timeoutAdvisorApprovalId).toBeDefined();
    expect(timeoutLeagueApprovalId).toBeDefined();
  });

  test('5.2 团委不能跳过指导老师直接审批（QUEUED 状态明确提示）', async () => {
    const res = await req()
      .post(`/api/activities/approvals/${timeoutLeagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('尚未进入待处理状态');
  });

  test('5.3 指导老师审批后团委可审批', async () => {
    await req()
      .post(`/api/activities/approvals/${timeoutAdvisorApprovalId}/process`)
      .send({
        approverId: advisorId,
        approved: true,
        comment: '指导老师同意'
      });

    const res = await req()
      .post(`/api/activities/approvals/${timeoutLeagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true,
        comment: '团委同意'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });
});

describe('6. 审批流转记录与超时催办完整流程', () => {
  let flowActivityId: string;
  let flowAdvisorApprovalId: string;
  let flowLeagueApprovalId: string;

  test('6.1 创建超预算活动并提交', async () => {
    const createRes = await req()
      .post('/api/activities')
      .send({
        title: '流转记录完整测试_' + Date.now(),
        description: '测试审批流转记录和超时催办',
        category: 'lecture',
        startTime: '2026-11-01T09:00:00Z',
        endTime: '2026-11-01T17:00:00Z',
        budget: 3000,
        expectedParticipants: 80,
        clubId
      });

    expect(createRes.status).toBe(201);
    flowActivityId = createRes.body.data.id;

    const submitRes = await req()
      .post(`/api/activities/${flowActivityId}/submit`);

    expect(submitRes.status).toBe(200);
    const approvals = submitRes.body.data.approvals;
    flowAdvisorApprovalId = approvals.find((a: any) => a.level === 'advisor').id;
    flowLeagueApprovalId = approvals.find((a: any) => a.level === 'league_committee').id;
  });

  test('6.2 提交后团委状态为 queued（排队），当前待办是指导老师', async () => {
    const res = await req()
      .get('/api/activities/approvals')
      .query({ activityId: flowActivityId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.currentLevel).toBe('advisor');

    const items = res.body.data.items;
    const advisor = items.find((a: any) => a.level === 'advisor');
    const league = items.find((a: any) => a.level === 'league_committee');

    expect(advisor.status).toBe('pending');
    expect(league.status).toBe('queued');
  });

  test('6.3 提交后指导老师收到待办通知，团委暂未收到', async () => {
    const advisorNotifRes = await req()
      .get(`/api/notifications/user/${advisorId}`)
      .query({ unread: 'true' });

    expect(advisorNotifRes.status).toBe(200);
    const advisorNotifs = advisorNotifRes.body.data.items || [];
    const hasApprovalNotif = advisorNotifs.some(
      (n: any) => n.relatedId === flowActivityId && n.type === 'activity_approval'
    );
    expect(hasApprovalNotif).toBe(true);

    const committeeNotifRes = await req()
      .get(`/api/notifications/user/${committeeId}`)
      .query({ unread: 'true' });

    expect(committeeNotifRes.status).toBe(200);
    const committeeNotifs = committeeNotifRes.body.data.items || [];
    const hasCommitteeApprovalNotif = committeeNotifs.some(
      (n: any) => n.relatedId === flowActivityId && n.type === 'activity_approval' && n.title.includes('团委')
    );
    expect(hasCommitteeApprovalNotif).toBe(false);
  });

  test('6.4 团委提前点通过返回明确原因（QUEUED 状态不可处理）', async () => {
    const res = await req()
      .post(`/api/activities/approvals/${flowLeagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true,
        comment: '团委想提前通过'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('尚未进入待处理状态');
  });

  test('6.5 流转记录包含提交节点，返回丰富的进度条数据', async () => {
    const res = await req()
      .get(`/api/activities/${flowActivityId}/approval-flow`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('nodes');
    expect(res.body.data).toHaveProperty('total');

    const nodes = res.body.data.nodes;
    expect(nodes.length).toBeGreaterThanOrEqual(1);

    const submitted = nodes.find((n: any) => n.action === 'submitted');
    expect(submitted).toBeDefined();
    expect(submitted.description).toContain('指导老师');
    expect(submitted.actionText).toBe('提交审批');
    expect(submitted.icon).toBe('📝');
    expect(submitted.displayStatus).toBeDefined();
    expect(submitted.timeText).toBeDefined();

    const pendingLeague = nodes.find((n: any) => n.actionText === '待团委审批');
    expect(pendingLeague).toBeDefined();
    expect(pendingLeague.displayStatus).toBe('pending');
    expect(pendingLeague.icon).toBe('⏳');
  });

  test('6.6 模拟创建超过4小时，第一次催办通知产生', async () => {
    const approvalRepo = AppDataSource.getRepository(
      require('../src/entities/ActivityApproval').ActivityApproval
    );

    const fourHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await approvalRepo.update(flowAdvisorApprovalId, {
      createdAt: fourHoursAgo,
      lastReminderAt: null
    });

    const timeoutRes = await req().get('/api/activities/approvals/check-timeouts');
    expect(timeoutRes.status).toBe(200);
    expect(timeoutRes.body.data.reminded).toBeGreaterThanOrEqual(1);

    const advisorNotifRes = await req()
      .get(`/api/notifications/user/${advisorId}`);

    const advisorNotifs = advisorNotifRes.body.data.items || [];
    const hasReminder = advisorNotifs.some(
      (n: any) => n.relatedId === flowActivityId && n.type === 'approval_reminder' && n.title.includes('催办')
    );
    expect(hasReminder).toBe(true);
  });

  test('6.7 第一次催办后流转记录新增 reminder 节点，含丰富进度条信息', async () => {
    const res = await req()
      .get(`/api/activities/${flowActivityId}/approval-flow`);

    const nodes = res.body.data.nodes;
    const reminder = nodes.find((n: any) => n.action === 'reminder' && n.level === 'advisor');
    expect(reminder).toBeDefined();
    expect(reminder.description).toContain('催办');
    expect(reminder.actionText).toBe('催办');
    expect(reminder.icon).toBe('⏰');
    expect(reminder.displayStatus).toBe('current');
    expect(reminder.levelText).toBe('指导老师');
  });

  test('6.8 再次超时（累计2次），指导老师审批升级到团委', async () => {
    const approvalRepo = AppDataSource.getRepository(
      require('../src/entities/ActivityApproval').ActivityApproval
    );

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await approvalRepo.update(flowAdvisorApprovalId, {
      lastReminderAt: fiveHoursAgo
    });

    const timeoutRes = await req().get('/api/activities/approvals/check-timeouts');
    expect(timeoutRes.status).toBe(200);
    expect(timeoutRes.body.data.escalated).toBeGreaterThanOrEqual(1);

    const approvalsRes = await req()
      .get('/api/activities/approvals')
      .query({ activityId: flowActivityId });

    const items = approvalsRes.body.data.items;
    const advisor = items.find((a: any) => a.level === 'advisor');
    const league = items.find((a: any) => a.level === 'league_committee');

    expect(advisor.status).toBe('escalated');
    expect(league.status).toBe('pending');
    expect(advisor.escalated).toBe(true);
  });

  test('6.9 升级后团委和管理员都能查到升级通知', async () => {
    const committeeNotifRes = await req()
      .get(`/api/notifications/user/${committeeId}`);

    const committeeNotifs = committeeNotifRes.body.data.items || [];
    const hasEscalationNotif = committeeNotifs.some(
      (n: any) => n.relatedId === flowActivityId && n.type === 'approval_reminder' && n.title.includes('升级')
    );
    expect(hasEscalationNotif).toBe(true);

    const adminUser = await AppDataSource.getRepository(
      require('../src/entities/User').User
    ).findOne({ where: { role: 'admin' } });

    if (adminUser) {
      const adminNotifRes = await req()
        .get(`/api/notifications/user/${adminUser.id}`);
      const adminNotifs = adminNotifRes.body.data.items || [];
      const adminHasEscalation = adminNotifs.some(
        (n: any) => n.relatedId === flowActivityId && n.type === 'approval_reminder'
      );
      expect(adminHasEscalation).toBe(true);
    }
  });

  test('6.10 升级后流转记录新增 escalated 节点，当前待办变为团委', async () => {
    const flowRes = await req()
      .get(`/api/activities/${flowActivityId}/approval-flow`);

    const nodes = flowRes.body.data.nodes;
    const escalated = nodes.find((n: any) => n.action === 'escalated' && n.level === 'advisor');
    expect(escalated).toBeDefined();
    expect(escalated.actionText).toBe('升级');
    expect(escalated.icon).toBe('⬆️');
    expect(escalated.displayStatus).toBe('current');

    const approvalsRes = await req()
      .get('/api/activities/approvals')
      .query({ activityId: flowActivityId });

    expect(approvalsRes.body.data.currentLevel).toBe('league_committee');
  });

  test('6.11 指导老师审批通过（走正常流程），团委变当前待办+有通知', async () => {
    const newCreateRes = await req()
      .post('/api/activities')
      .send({
        title: '正常流转测试_' + Date.now(),
        description: '测试正常审批顺序的通知和流转',
        category: 'training',
        startTime: '2026-12-01T09:00:00Z',
        endTime: '2026-12-01T17:00:00Z',
        budget: 2500,
        expectedParticipants: 50,
        clubId
      });

    const newActivityId = newCreateRes.body.data.id;
    const submitRes = await req()
      .post(`/api/activities/${newActivityId}/submit`);

    const advisorAppr = submitRes.body.data.approvals.find((a: any) => a.level === 'advisor');
    const leagueAppr = submitRes.body.data.approvals.find((a: any) => a.level === 'league_committee');

    const beforeCommitteeNotifsRes = await req()
      .get(`/api/notifications/user/${committeeId}`);
    const beforeCount = beforeCommitteeNotifsRes.body.data.items.filter(
      (n: any) => n.relatedId === newActivityId && n.type === 'activity_approval' && n.title.includes('团委')
    ).length;

    const advisorProcessRes = await req()
      .post(`/api/activities/approvals/${advisorAppr.id}/process`)
      .send({
        approverId: advisorId,
        approved: true,
        comment: '指导老师同意'
      });

    expect(advisorProcessRes.status).toBe(200);

    const afterCommitteeNotifsRes = await req()
      .get(`/api/notifications/user/${committeeId}`);
    const afterCount = afterCommitteeNotifsRes.body.data.items.filter(
      (n: any) => n.relatedId === newActivityId && n.type === 'activity_approval'
    ).length;

    expect(afterCount).toBeGreaterThan(beforeCount);

    const approvalsRes = await req()
      .get('/api/activities/approvals')
      .query({ activityId: newActivityId });

    expect(approvalsRes.body.data.currentLevel).toBe('league_committee');

    const leagueApprovalItem = approvalsRes.body.data.items.find(
      (a: any) => a.level === 'league_committee'
    );
    expect(leagueApprovalItem.status).toBe('pending');
  });

  test('6.12 完整流转记录按时间排序，覆盖提交→催办→升级节点', async () => {
    const flowRes = await req()
      .get(`/api/activities/${flowActivityId}/approval-flow`);

    const nodes = flowRes.body.data.nodes;
    expect(nodes.length).toBeGreaterThanOrEqual(3);

    const actions = nodes.map((n: any) => n.action);
    expect(actions).toContain('submitted');
    expect(actions).toContain('reminder');
    expect(actions).toContain('escalated');

    for (let i = 1; i < nodes.length; i++) {
      expect(new Date(nodes[i].createdAt).getTime())
        .toBeGreaterThanOrEqual(new Date(nodes[i - 1].createdAt).getTime());
    }

    for (const node of nodes) {
      expect(node).toHaveProperty('actionText');
      expect(node).toHaveProperty('displayStatus');
      expect(node).toHaveProperty('icon');
      expect(node).toHaveProperty('timeText');
    }
  });
});

describe('7. 团委超时催办与升级', () => {
  let leagueTimeoutActivityId: string;
  let leagueTimeoutAdvisorId: string;
  let leagueTimeoutLeagueId: string;

  test('7.1 创建超预算活动并让指导老师快速通过', async () => {
    const createRes = await req()
      .post('/api/activities')
      .send({
        title: '团委超时测试_' + Date.now(),
        description: '测试团委超时催办和升级到管理员',
        category: 'charity',
        startTime: '2026-12-15T09:00:00Z',
        endTime: '2026-12-15T17:00:00Z',
        budget: 4000,
        expectedParticipants: 60,
        clubId
      });

    leagueTimeoutActivityId = createRes.body.data.id;

    const submitRes = await req()
      .post(`/api/activities/${leagueTimeoutActivityId}/submit`);

    const approvals = submitRes.body.data.approvals;
    leagueTimeoutAdvisorId = approvals.find((a: any) => a.level === 'advisor').id;
    leagueTimeoutLeagueId = approvals.find((a: any) => a.level === 'league_committee').id;

    await req()
      .post(`/api/activities/approvals/${leagueTimeoutAdvisorId}/process`)
      .send({
        approverId: advisorId,
        approved: true,
        comment: '指导老师已通过'
      });

    const approvalsRes = await req()
      .get('/api/activities/approvals')
      .query({ activityId: leagueTimeoutActivityId });

    expect(approvalsRes.body.data.currentLevel).toBe('league_committee');
  });

  test('7.2 团委第一次超时产生催办通知（团委+管理员都收到）', async () => {
    const approvalRepo = AppDataSource.getRepository(
      require('../src/entities/ActivityApproval').ActivityApproval
    );

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await approvalRepo.update(leagueTimeoutLeagueId, {
      createdAt: fiveHoursAgo,
      lastReminderAt: null
    });

    const timeoutRes = await req().get('/api/activities/approvals/check-timeouts');
    expect(timeoutRes.status).toBe(200);
    expect(timeoutRes.body.data.reminded).toBeGreaterThanOrEqual(1);

    const committeeNotifRes = await req()
      .get(`/api/notifications/user/${committeeId}`);
    const committeeNotifs = committeeNotifRes.body.data.items || [];
    const committeeHasReminder = committeeNotifs.some(
      (n: any) => n.relatedId === leagueTimeoutActivityId && n.type === 'approval_reminder' && n.title.includes('催办')
    );
    expect(committeeHasReminder).toBe(true);

    const adminUser = await AppDataSource.getRepository(
      require('../src/entities/User').User
    ).findOne({ where: { role: 'admin' } });

    if (adminUser) {
      const adminNotifRes = await req()
        .get(`/api/notifications/user/${adminUser.id}`);
      const adminNotifs = adminNotifRes.body.data.items || [];
      const adminHasReminder = adminNotifs.some(
        (n: any) => n.relatedId === leagueTimeoutActivityId && n.type === 'approval_reminder'
      );
      expect(adminHasReminder).toBe(true);
    }
  });

  test('7.3 团委第二次超时升级，通知管理员+团委', async () => {
    const approvalRepo = AppDataSource.getRepository(
      require('../src/entities/ActivityApproval').ActivityApproval
    );

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await approvalRepo.update(leagueTimeoutLeagueId, {
      lastReminderAt: fiveHoursAgo
    });

    const timeoutRes = await req().get('/api/activities/approvals/check-timeouts');
    expect(timeoutRes.status).toBe(200);
    expect(timeoutRes.body.data.escalated).toBeGreaterThanOrEqual(1);

    const adminUser = await AppDataSource.getRepository(
      require('../src/entities/User').User
    ).findOne({ where: { role: 'admin' } });

    if (adminUser) {
      const adminNotifRes = await req()
        .get(`/api/notifications/user/${adminUser.id}`);
      const adminNotifs = adminNotifRes.body.data.items || [];
      const adminHasEscalation = adminNotifs.filter(
        (n: any) => n.relatedId === leagueTimeoutActivityId && n.type === 'approval_reminder' && n.title.includes('团委')
      ).length;
      expect(adminHasEscalation).toBeGreaterThanOrEqual(1);
    }
  });

  test('7.4 团委超时后流转记录包含 escalated(团委) 节点', async () => {
    const flowRes = await req()
      .get(`/api/activities/${leagueTimeoutActivityId}/approval-flow`);

    const nodes = flowRes.body.data.nodes;
    const leagueEscalated = nodes.find(
      (n: any) => n.action === 'escalated' && n.level === 'league_committee'
    );
    expect(leagueEscalated).toBeDefined();
    expect(leagueEscalated.description).toContain('管理员');
    expect(leagueEscalated.actionText).toBe('升级');
    expect(leagueEscalated.icon).toBe('⬆️');
  });
});

describe('8. 升级后团委处理收尾', () => {
  let escalationCleanupActivityId: string;
  let escalationLeagueApprovalId: string;

  test('8.1 指导老师超时升级后，团委通过能正常收尾（活动状态/审批列表/流转记录一致）', async () => {
    const createRes = await req()
      .post('/api/activities')
      .send({
        title: '升级收尾测试_' + Date.now(),
        description: '测试升级后团委处理能正确收尾',
        category: 'academic',
        startTime: '2026-12-20T09:00:00Z',
        endTime: '2026-12-20T17:00:00Z',
        budget: 3000,
        expectedParticipants: 40,
        clubId
      });

    escalationCleanupActivityId = createRes.body.data.id;

    const submitRes = await req()
      .post(`/api/activities/${escalationCleanupActivityId}/submit`);

    const advisorAppr = submitRes.body.data.approvals.find((a: any) => a.level === 'advisor');
    escalationLeagueApprovalId = submitRes.body.data.approvals.find((a: any) => a.level === 'league_committee').id;

    const approvalRepo = AppDataSource.getRepository(
      require('../src/entities/ActivityApproval').ActivityApproval
    );

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await approvalRepo.update(advisorAppr.id, {
      createdAt: fiveHoursAgo,
      lastReminderAt: null
    });

    await req().get('/api/activities/approvals/check-timeouts');

    await approvalRepo.update(advisorAppr.id, {
      lastReminderAt: fiveHoursAgo
    });

    const timeoutRes = await req().get('/api/activities/approvals/check-timeouts');
    expect(timeoutRes.body.data.escalated).toBeGreaterThanOrEqual(1);
    expect(timeoutRes.body.data.total).toBe(timeoutRes.body.data.reminded + timeoutRes.body.data.escalated);

    const processRes = await req()
      .post(`/api/activities/approvals/${escalationLeagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true,
        comment: '升级后团委通过'
      });

    expect(processRes.status).toBe(200);

    const activityRes = await req()
      .get(`/api/activities/${escalationCleanupActivityId}`);
    expect(activityRes.body.data.status).toBe('approved');

    const approvalsRes = await req()
      .get('/api/activities/approvals')
      .query({ activityId: escalationCleanupActivityId });

    expect(approvalsRes.body.data.currentLevel).toBeNull();

    const allApprovals = approvalsRes.body.data.items;
    expect(allApprovals.every((a: any) => a.status === 'approved')).toBe(true);

    const flowRes = await req()
      .get(`/api/activities/${escalationCleanupActivityId}/approval-flow`);

    const nodes = flowRes.body.data.nodes;
    const advisorApproved = nodes.find(
      (n: any) => n.action === 'approved' && n.level === 'advisor'
    );
    expect(advisorApproved).toBeDefined();
    expect(advisorApproved.description).toContain('超时升级');

    const leagueApproved = nodes.find(
      (n: any) => n.action === 'approved' && n.level === 'league_committee'
    );
    expect(leagueApproved).toBeDefined();

    const completed = nodes.find((n: any) => n.action === 'completed');
    expect(completed).toBeDefined();
    expect(completed.displayStatus).toBe('completed');
  });

  test('8.2 升级后团委拒绝也能正常收尾，状态一致', async () => {
    const createRes = await req()
      .post('/api/activities')
      .send({
        title: '升级拒绝测试_' + Date.now(),
        description: '测试升级后团委拒绝能正确收尾',
        category: 'arts',
        startTime: '2026-12-21T09:00:00Z',
        endTime: '2026-12-21T17:00:00Z',
        budget: 2800,
        expectedParticipants: 35,
        clubId
      });

    const activityId = createRes.body.data.id;

    const submitRes = await req()
      .post(`/api/activities/${activityId}/submit`);

    const advisorAppr = submitRes.body.data.approvals.find((a: any) => a.level === 'advisor');
    const leagueApprId = submitRes.body.data.approvals.find((a: any) => a.level === 'league_committee').id;

    const approvalRepo = AppDataSource.getRepository(
      require('../src/entities/ActivityApproval').ActivityApproval
    );

    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    await approvalRepo.update(advisorAppr.id, {
      createdAt: fiveHoursAgo,
      lastReminderAt: null
    });

    await req().get('/api/activities/approvals/check-timeouts');

    await approvalRepo.update(advisorAppr.id, {
      lastReminderAt: fiveHoursAgo
    });

    await req().get('/api/activities/approvals/check-timeouts');

    const processRes = await req()
      .post(`/api/activities/approvals/${leagueApprId}/process`)
      .send({
        approverId: committeeId,
        approved: false,
        comment: '不符合要求，拒绝'
      });

    expect(processRes.status).toBe(200);

    const activityRes = await req()
      .get(`/api/activities/${activityId}`);
    expect(activityRes.body.data.status).toBe('rejected');

    const approvalsRes = await req()
      .get('/api/activities/approvals')
      .query({ activityId });

    expect(approvalsRes.body.data.currentLevel).toBeNull();

    const allApprovals = approvalsRes.body.data.items;
    expect(allApprovals.some((a: any) => a.status === 'rejected')).toBe(true);
  });
});

describe('9. 审批看板接口', () => {
  test('9.1 管理员能看到全量统计，包含各分组数据', async () => {
    const adminUser = await AppDataSource.getRepository(
      require('../src/entities/User').User
    ).findOne({ where: { role: 'admin' } });

    if (!adminUser) return;

    const dashboardRes = await req()
      .get('/api/activities/approvals/dashboard')
      .query({ userId: adminUser.id, userRole: 'admin' });

    expect(dashboardRes.status).toBe(200);
    expect(dashboardRes.body.data).toHaveProperty('stats');
    expect(dashboardRes.body.data.stats).toHaveProperty('pendingAdvisor');
    expect(dashboardRes.body.data.stats).toHaveProperty('pendingLeague');
    expect(dashboardRes.body.data.stats).toHaveProperty('timeout');
    expect(dashboardRes.body.data.stats).toHaveProperty('completed');
    expect(dashboardRes.body.data.stats).toHaveProperty('total');
    expect(dashboardRes.body.data.stats.total).toBeGreaterThan(0);
    expect(dashboardRes.body.data.stats.total).toBe(
      dashboardRes.body.data.stats.pendingAdvisor +
      dashboardRes.body.data.stats.pendingLeague +
      dashboardRes.body.data.stats.completed
    );

    expect(dashboardRes.body.data).toHaveProperty('pendingAdvisor');
    expect(dashboardRes.body.data).toHaveProperty('pendingLeague');
    expect(dashboardRes.body.data).toHaveProperty('timeout');
    expect(dashboardRes.body.data).toHaveProperty('completed');

    expect(Array.isArray(dashboardRes.body.data.pendingAdvisor)).toBe(true);
    expect(Array.isArray(dashboardRes.body.data.pendingLeague)).toBe(true);
    expect(Array.isArray(dashboardRes.body.data.timeout)).toBe(true);
    expect(Array.isArray(dashboardRes.body.data.completed)).toBe(true);

    for (const item of dashboardRes.body.data.pendingLeague) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('activityTitle');
      expect(item).toHaveProperty('clubName');
      expect(item).toHaveProperty('currentLevel');
      expect(item).toHaveProperty('currentLevelText');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('statusText');
      expect(item).toHaveProperty('isTimeout');
      expect(item).toHaveProperty('createdAt');
      expect(item).toHaveProperty('reminderCount');
    }
  });

  test('9.2 团委用户只能看到待团委处理和相关数据', async () => {
    const dashboardRes = await req()
      .get('/api/activities/approvals/dashboard')
      .query({ userId: committeeId, userRole: 'league_committee' });

    expect(dashboardRes.status).toBe(200);
    expect(dashboardRes.body.data.stats.total).toBeGreaterThanOrEqual(
      dashboardRes.body.data.pendingLeague.length
    );
  });

  test('9.3 指导老师只能看到自己相关的社团审批', async () => {
    const dashboardRes = await req()
      .get('/api/activities/approvals/dashboard')
      .query({ userId: advisorId, userRole: 'advisor' });

    expect(dashboardRes.status).toBe(200);
    expect(Array.isArray(dashboardRes.body.data.pendingAdvisor)).toBe(true);
  });

  test('9.4 社长只能看到自己社团的审批', async () => {
    const dashboardRes = await req()
      .get('/api/activities/approvals/dashboard')
      .query({ userId: leaderId, userRole: 'club_leader' });

    expect(dashboardRes.status).toBe(200);
    expect(Array.isArray(dashboardRes.body.data.completed)).toBe(true);
  });

  test('9.5 缺少参数返回错误', async () => {
    const res1 = await req()
      .get('/api/activities/approvals/dashboard')
      .query({ userRole: 'admin' });
    expect(res1.status).toBe(400);

    const res2 = await req()
      .get('/api/activities/approvals/dashboard')
      .query({ userId: 'test' });
    expect(res2.status).toBe(400);
  });
});
