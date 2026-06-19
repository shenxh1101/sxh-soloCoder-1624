import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { WarningLevel } from '../types';
import { Club } from './Club';

@Entity()
export class ActivityWarning {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Club, club => club.warnings, { eager: true })
  @JoinColumn()
  club: Club;

  @Column()
  clubId: string;

  @Column({
    type: 'simple-enum',
    enum: WarningLevel,
    default: WarningLevel.WARNING
  })
  level: WarningLevel;

  @Column()
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  suggestions: string | null;

  @Column({ type: 'simple-array', nullable: true })
  monthlyActivityCounts: number[];

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  activityRate: number;

  @Column({ default: false })
  acknowledged: boolean;

  @Column({ type: 'datetime', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  acknowledgedBy: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
