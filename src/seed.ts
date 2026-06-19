import 'reflect-metadata';
import { AppDataSource } from './config/database';
import { userService } from './services/UserService';
import { clubService } from './services/ClubService';
import { UserRole, ClubCategory, VenueStatus } from './types';
import { v4 as uuidv4 } from 'uuid';
import { Venue, Club } from './entities';

async function seed() {
  try {
    await AppDataSource.initialize();
    console.log('数据库连接成功，开始初始化数据...');

    console.log('1. 创建管理员账户...');
    const admin = await userService.createUser({
      username: 'admin',
      password: 'admin123',
      name: '系统管理员',
      role: UserRole.ADMIN,
      phone: '13800000000',
      email: 'admin@campus.edu'
    });
    console.log(`   管理员创建成功: ${admin.username} / admin123`);

    console.log('2. 创建团委成员...');
    const committee1 = await userService.createUser({
      username: 'committee1',
      password: '123456',
      name: '团委李老师',
      role: UserRole.COMMITTEE,
      phone: '13800000001',
      email: 'committee1@campus.edu'
    });
    const committee2 = await userService.createUser({
      username: 'committee2',
      password: '123456',
      name: '团委王老师',
      role: UserRole.COMMITTEE,
      phone: '13800000002',
      email: 'committee2@campus.edu'
    });
    console.log(`   团委成员创建成功: ${committee1.name}, ${committee2.name}`);

    console.log('3. 创建财务人员...');
    const finance = await userService.createUser({
      username: 'finance',
      password: '123456',
      name: '财务张老师',
      role: UserRole.FINANCE,
      phone: '13800000003',
      email: 'finance@campus.edu'
    });
    console.log(`   财务人员创建成功: ${finance.name}`);

    console.log('4. 创建指导老师...');
    const advisor1 = await userService.createUser({
      username: 'advisor1',
      password: '123456',
      name: '陈教授',
      role: UserRole.ADVISOR,
      phone: '13800000004',
      email: 'advisor1@campus.edu'
    });
    const advisor2 = await userService.createUser({
      username: 'advisor2',
      password: '123456',
      name: '刘教授',
      role: UserRole.ADVISOR,
      phone: '13800000005',
      email: 'advisor2@campus.edu'
    });
    console.log(`   指导老师创建成功: ${advisor1.name}, ${advisor2.name}`);

    console.log('5. 创建社长和普通用户...');
    const leader1 = await userService.createUser({
      username: 'leader1',
      password: '123456',
      name: '张三',
      studentId: '2021001',
      role: UserRole.LEADER,
      phone: '13900000001'
    });
    const leader2 = await userService.createUser({
      username: 'leader2',
      password: '123456',
      name: '李四',
      studentId: '2021002',
      role: UserRole.LEADER,
      phone: '13900000002'
    });
    const leader3 = await userService.createUser({
      username: 'leader3',
      password: '123456',
      name: '王五',
      studentId: '2021003',
      role: UserRole.LEADER,
      phone: '13900000003'
    });

    const member1 = await userService.createUser({
      username: 'member1',
      password: '123456',
      name: '赵六',
      studentId: '2022001',
      role: UserRole.MEMBER,
      phone: '13900000004'
    });
    const member2 = await userService.createUser({
      username: 'member2',
      password: '123456',
      name: '孙七',
      studentId: '2022002',
      role: UserRole.MEMBER,
      phone: '13900000005'
    });
    const member3 = await userService.createUser({
      username: 'member3',
      password: '123456',
      name: '周八',
      studentId: '2022003',
      role: UserRole.MEMBER,
      phone: '13900000006'
    });
    const member4 = await userService.createUser({
      username: 'member4',
      password: '123456',
      name: '吴九',
      studentId: '2022004',
      role: UserRole.MEMBER,
      phone: '13900000007'
    });
    const member5 = await userService.createUser({
      username: 'member5',
      password: '123456',
      name: '郑十',
      studentId: '2022005',
      role: UserRole.MEMBER,
      phone: '13900000008'
    });
    console.log(`   用户创建成功: 3位社长, 5位成员`);

    console.log('6. 创建场地...');
    const venueRepository = AppDataSource.getRepository(Venue);
    const venues = [
      { name: '大学生活动中心A101', capacity: 100, location: '东区1号楼', facilities: ['投影仪', '音响', '空调'], status: VenueStatus.AVAILABLE },
      { name: '大学生活动中心A201', capacity: 50, location: '东区1号楼', facilities: ['投影仪', '音响'], status: VenueStatus.AVAILABLE },
      { name: '大学生活动中心B101', capacity: 200, location: '东区2号楼', facilities: ['投影仪', '音响', '空调', '舞台'], status: VenueStatus.AVAILABLE },
      { name: '学术报告厅', capacity: 300, location: '图书馆1楼', facilities: ['投影仪', '音响', '空调', '录像设备'], status: VenueStatus.AVAILABLE },
      { name: '操场1号场地', capacity: 500, location: '西区体育场', facilities: ['灯光'], status: VenueStatus.AVAILABLE },
      { name: '操场2号场地', capacity: 300, location: '西区体育场', facilities: ['灯光'], status: VenueStatus.AVAILABLE },
      { name: '舞蹈排练室', capacity: 30, location: '艺术楼301', facilities: ['镜子', '把杆', '音响'], status: VenueStatus.AVAILABLE },
      { name: '音乐排练室', capacity: 20, location: '艺术楼302', facilities: ['钢琴', '音响'], status: VenueStatus.MAINTENANCE },
    ];

    for (const v of venues) {
      const venue = venueRepository.create({
        id: uuidv4(),
        ...v,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await venueRepository.save(venue);
    }
    console.log(`   场地创建成功: ${venues.length} 个场地`);

    console.log('7. 创建社团（已审批状态）...');
    const clubsData = [
      {
        name: '计算机协会',
        description: '致力于推广计算机技术，举办编程比赛、技术讲座等活动',
        category: ClubCategory.ACADEMIC,
        leaderId: leader1.id,
        advisorId: advisor1.id,
        memberIds: [leader1.id, member1.id, member2.id, member3.id, member4.id, member5.id]
      },
      {
        name: '舞蹈协会',
        description: '推广舞蹈艺术，提供舞蹈培训和表演机会',
        category: ClubCategory.ARTS,
        leaderId: leader2.id,
        advisorId: advisor2.id,
        memberIds: [leader2.id, member1.id, member2.id, member3.id, member4.id]
      },
      {
        name: '篮球协会',
        description: '组织篮球比赛和训练，提高学生篮球水平',
        category: ClubCategory.SPORTS,
        leaderId: leader3.id,
        advisorId: advisor1.id,
        memberIds: [leader3.id, member1.id, member2.id, member3.id, member5.id]
      }
    ];

    for (const c of clubsData) {
      const result = await clubService.createClubApplication(c);
      
      if (result.validation.valid && result.club) {
        await clubService.approveClub(result.club.id, admin.id, '资料齐全，符合条件');
        console.log(`   社团创建并审批通过: ${c.name}`);
      } else {
        console.log(`   社团创建失败: ${c.name}, 错误: ${result.validation.errors.join(', ')}`);
      }
    }

    console.log('\n数据初始化完成！');
    console.log('================================');
    console.log('测试账户:');
    console.log('  管理员: admin / admin123');
    console.log('  团委: committee1 / 123456');
    console.log('  财务: finance / 123456');
    console.log('  指导老师: advisor1 / 123456');
    console.log('  社长: leader1 / 123456');
    console.log('  成员: member1 / 123456');
    console.log('================================');

    await AppDataSource.destroy();
    process.exit(0);

  } catch (error) {
    console.error('数据初始化失败:', error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

seed();
