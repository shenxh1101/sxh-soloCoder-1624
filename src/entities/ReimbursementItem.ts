import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Reimbursement } from './Reimbursement';

@Entity()
export class ReimbursementItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Reimbursement, reimbursement => reimbursement.items)
  @JoinColumn()
  reimbursement: Reimbursement;

  @Column()
  reimbursementId: string;

  @Column()
  itemName: string;

  @Column()
  category: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @Column({ type: 'text', nullable: true })
  invoiceNo: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
