import { findUserById, toSafeUser } from '../services/userService.js';

export async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to access this resource'
      }
    });
  }

  try {
    const user = await findUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      res.clearCookie('connect.sid');
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'The authenticated user session is no longer valid'
        }
      });
    }

    req.user = toSafeUser(user);
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(500).json({
      error: {
        code: 'AUTH_VERIFICATION_ERROR',
        message: 'Failed to verify session credentials'
      }
    });
  }
}
