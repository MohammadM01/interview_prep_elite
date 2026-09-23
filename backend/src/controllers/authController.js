import { registerSchema, loginSchema } from '../utils/validators.js';
import {
  createUser,
  findUserByEmail,
  verifyUserPassword,
  toSafeUser
} from '../services/userService.js';

export async function register(req, res) {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues?.[0] || parseResult.error.errors?.[0];
      const firstError = issue?.message || 'Invalid registration input';
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError
        }
      });
    }

    const { email, password } = parseResult.data;
    const safeUser = await createUser({ email, password });

    req.session.userId = safeUser.id;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({
          error: {
            code: 'SESSION_ERROR',
            message: 'Failed to establish user session'
          }
        });
      }

      return res.status(201).json({
        user: safeUser
      });
    });
  } catch (error) {
    if (error.code === 'EMAIL_ALREADY_EXISTS') {
      return res.status(409).json({
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: error.message
        }
      });
    }

    console.error('Registration error:', error);
    return res.status(500).json({
      error: {
        code: 'REGISTRATION_FAILED',
        message: 'Unable to complete user registration'
      }
    });
  }
}

export async function login(req, res) {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues?.[0] || parseResult.error.errors?.[0];
      const firstError = issue?.message || 'Invalid login input';
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError
        }
      });
    }

    const { email, password } = parseResult.data;
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    const isMatch = await verifyUserPassword(user.password_hash, password);
    if (!isMatch) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    const safeUser = toSafeUser(user);
    req.session.userId = safeUser.id;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({
          error: {
            code: 'SESSION_ERROR',
            message: 'Failed to establish user session'
          }
        });
      }

      return res.status(200).json({
        user: safeUser
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      error: {
        code: 'LOGIN_FAILED',
        message: 'Unable to process login request'
      }
    });
  }
}

export function logout(req, res) {
  if (!req.session) {
    return res.status(200).json({ message: 'Logged out successfully' });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Logout session destruction error:', err);
      return res.status(500).json({
        error: {
          code: 'LOGOUT_FAILED',
          message: 'Failed to terminate session'
        }
      });
    }

    res.clearCookie('ipe.sid', { path: '/' });
    return res.status(200).json({
      message: 'Logged out successfully'
    });
  });
}

export function getCurrentUser(req, res) {
  return res.status(200).json({
    user: req.user
  });
}
