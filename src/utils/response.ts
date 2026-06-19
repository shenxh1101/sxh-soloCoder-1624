import { Response } from 'express';
import { ApiResponse, PaginatedResponse } from '../types';

export const successResponse = <T>(res: Response, data?: T, message = '操作成功'): Response<ApiResponse<T>> => {
  return res.status(200).json({
    success: true,
    data,
    message
  });
};

export const createdResponse = <T>(res: Response, data?: T, message = '创建成功'): Response<ApiResponse<T>> => {
  return res.status(201).json({
    success: true,
    data,
    message
  });
};

export const errorResponse = (res: Response, message: string, status = 400, errors?: string[]): Response<ApiResponse> => {
  return res.status(status).json({
    success: false,
    message,
    errors
  });
};

export const paginatedResponse = <T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  message = '查询成功'
): Response<ApiResponse<PaginatedResponse<T>>> => {
  return res.status(200).json({
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    },
    message
  });
};

export const validationErrorResponse = (res: Response, errors: string[]): Response<ApiResponse> => {
  return errorResponse(res, '参数验证失败', 400, errors);
};
