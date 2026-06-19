import { Router, Request, Response } from 'express';
import { userService } from '../services/UserService';
import { successResponse, errorResponse, validationErrorResponse } from '../utils/response';
import { UserRole } from '../types';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, name, studentId, phone, email, role } = req.body;

    const errors: string[] = [];
    if (!username) errors.push('请提供用户名');
    if (!password) errors.push('请提供密码');
    if (!name) errors.push('请提供姓名');
    if (!role) errors.push('请提供角色');

    if (errors.length > 0) {
      return validationErrorResponse(res, errors);
    }

    const user = await userService.createUser({
      username,
      password,
      name,
      studentId,
      phone,
      email,
      role
    });

    return successResponse(res, user, '注册成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '注册失败');
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return validationErrorResponse(res, ['请提供用户名和密码']);
    }

    const user = await userService.login(username, password);

    if (!user) {
      return errorResponse(res, '用户名或密码错误', 401);
    }

    return successResponse(res, user, '登录成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '登录失败');
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const { role, page, pageSize } = req.query;

    const result = await userService.getUsers(
      role as UserRole,
      page ? parseInt(page as string) : 1,
      pageSize ? parseInt(pageSize as string) : 20
    );

    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取用户列表失败');
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await userService.getUserById(id);

    if (!user) {
      return errorResponse(res, '用户不存在', 404);
    }

    return successResponse(res, user);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取用户信息失败');
  }
});

router.get('/:id/clubs', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const clubs = await userService.getUserClubs(id);

    return successResponse(res, clubs);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取用户社团列表失败');
  }
});

router.get('/:id/clubs/detail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await userService.getUserWithClubs(id);

    if (!result) {
      return errorResponse(res, '用户不存在', 404);
    }

    return successResponse(res, result);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取用户社团详情失败');
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, phone, email, password } = req.body;

    const user = await userService.updateUser(id, { name, phone, email, password });

    if (!user) {
      return errorResponse(res, '用户不存在', 404);
    }

    return successResponse(res, user, '用户信息更新成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '更新用户信息失败');
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await userService.deleteUser(id);

    if (!result) {
      return errorResponse(res, '用户不存在', 404);
    }

    return successResponse(res, null, '用户删除成功');
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '删除用户失败');
  }
});

router.get('/leaders', async (req: Request, res: Response) => {
  try {
    const leaders = await userService.getLeaders();
    return successResponse(res, leaders);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取社长列表失败');
  }
});

router.get('/committee', async (req: Request, res: Response) => {
  try {
    const members = await userService.getCommitteeMembers();
    return successResponse(res, members);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取团委成员列表失败');
  }
});

router.get('/finance', async (req: Request, res: Response) => {
  try {
    const staff = await userService.getFinanceStaff();
    return successResponse(res, staff);
  } catch (error) {
    return errorResponse(res, error instanceof Error ? error.message : '获取财务人员列表失败');
  }
});

export default router;
