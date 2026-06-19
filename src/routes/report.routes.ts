import { Router, Request, Response } from 'express';
import { reportService } from '../services/ReportService';
import { successResponse, errorResponse, validationErrorResponse } from '../utils/response';

const router = Router();

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;

    const reportDate = date ? new Date(date) : undefined;

    const report = await reportService.generateDailyReport(reportDate);

    return successResponse(res, report, '运营日报生成成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '运营日报生成失败');
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, page, pageSize } = req.query;

    const result = await reportService.getReports(
      startDate as string,
      endDate as string,
      page ? parseInt(page as string) : 1,
      pageSize ? parseInt(pageSize as string) : 20
    );

    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取报表列表失败');
  }
});

router.get('/date/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;

    const report = await reportService.getReportByDate(date);

    if (!report) {
      return errorResponse(res, '报表不存在');
    }

    return successResponse(res, report);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取报表失败');
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const report = await reportService.getReportById(id);

    if (!report) {
      return errorResponse(res, '报表不存在');
    }

    return successResponse(res, report);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取报表失败');
  }
});

router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const buffer = await reportService.exportToExcel(id);
    const report = await reportService.getReportById(id);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=campus_club_report_${report?.reportDate || id}.xlsx`);

    return res.send(buffer);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '导出Excel失败');
  }
});

router.get('/export/batch', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, category } = req.query;

    const buffer = await reportService.exportReportsToExcel(
      startDate as string,
      endDate as string,
      category as string
    );

    const dateStr = startDate && endDate ? `${startDate}_${endDate}` : 'all';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=campus_club_reports_${dateStr}.xlsx`);

    return res.send(buffer);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '批量导出Excel失败');
  }
});

export default router;
