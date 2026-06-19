import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../entities/User';
import { Club } from '../entities/Club';
import { ClubMember } from '../entities/ClubMember';
import { Venue } from '../entities/Venue';
import { Activity } from '../entities/Activity';
import { VenueBooking } from '../entities/VenueBooking';
import { ActivityApproval } from '../entities/ActivityApproval';
import { Attendance } from '../entities/Attendance';
import { ClubPoints } from '../entities/ClubPoints';
import { ActivityWarning } from '../entities/ActivityWarning';
import { Reimbursement } from '../entities/Reimbursement';
import { ReimbursementItem } from '../entities/ReimbursementItem';
import { AbnormalOrder } from '../entities/AbnormalOrder';
import { Notification } from '../entities/Notification';
import { DailyReport } from '../entities/DailyReport';

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: './data/campus_club.db',
  synchronize: true,
  logging: true,
  entities: [
    User,
    Club,
    ClubMember,
    Venue,
    Activity,
    VenueBooking,
    ActivityApproval,
    Attendance,
    ClubPoints,
    ActivityWarning,
    Reimbursement,
    ReimbursementItem,
    AbnormalOrder,
    Notification,
    DailyReport
  ],
  migrations: [],
  subscribers: [],
});

export const connectDatabase = async () => {
  try {
    await AppDataSource.initialize();
    console.log('数据库连接成功');
  } catch (error) {
    console.error('数据库连接失败:', error);
    throw error;
  }
};
