import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Club } from './Club';
import { User } from './User';

@Entity()
export class ClubMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Club, club => club.members)
  @JoinColumn()
  club: Club;

  @Column()
  clubId: string;

  @ManyToOne(() => User, user => user.clubMemberships, { eager: true })
  @JoinColumn()
  user: User;

  @Column()
  userId: string;

  @Column({ default: 'member' })
  position: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'datetime', nullable: true })
  joinedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  leftAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
