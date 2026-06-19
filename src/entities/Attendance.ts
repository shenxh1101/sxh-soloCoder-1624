import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Activity } from './Activity';
import { User } from './User';

@Entity()
export class Attendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Activity, activity => activity.attendances, { eager: true })
  @JoinColumn()
  activity: Activity;

  @Column()
  activityId: string;

  @ManyToOne(() => User, { eager: true })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'datetime', nullable: true })
  signInTime: Date | null;

  @Column({ type: 'datetime', nullable: true })
  signOutTime: Date | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  durationHours: number;

  @Column({ default: false })
  isPresent: boolean;

  @Column({ type: 'text', nullable: true })
  signInMethod: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
