// generalRateLimiter.ts

import rateLimit from 'express-rate-limit';
import { Request } from 'express';

/**
 * Strict rate limiter for sensitive routes.
 * Limits to 5 requests per 15 minutes from a single IP.
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  keyGenerator: (req: Request) => req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many attempts, please try again later.',
  },
});

/**
 * General rate limiter for most routes.
 * Higher limits for authenticated users.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  keyGenerator: (req: Request) => req.ip || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many requests, please try again later.',
  },
});
