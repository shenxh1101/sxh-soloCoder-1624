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

  test('3.2 提交审批后生成指导老师+团委两级审批', async () => {
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

    expect(advisorApp).toBeDefined();
    expect(leagueApp).toBeDefined();
    expect(advisorApp.status).toBe('pending');
    expect(leagueApp.status).toBe('pending');

    advisorApprovalId = advisorApp.id;
    leagueApprovalId = leagueApp.id;
  });

  test('3.3 团委在指导老师审批前不能直接通过', async () => {
    const res = await req()
      .post(`/api/activities/approvals/${leagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true,
        comment: '团委提前审批'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('指导老师尚未审批');
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

  test('5.2 团委不能跳过指导老师直接审批', async () => {
    const res = await req()
      .post(`/api/activities/approvals/${timeoutLeagueApprovalId}/process`)
      .send({
        approverId: committeeId,
        approved: true
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('指导老师尚未审批');
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
