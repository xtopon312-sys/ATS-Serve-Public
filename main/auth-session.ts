import jwt, { JwtPayload } from 'jsonwebtoken';
import { getJWTSecret } from './routes/auth';
import { getUserAuthStatus, isTokenRevoked, isTokenStale } from './middleware/security';

export function authenticateSession(token: unknown, options: { fresh?: boolean } = {}): (JwtPayload & { userId: string; role: string }) | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    if (isTokenRevoked(token)) return null;
    const decoded = jwt.verify(token, getJWTSecret());
    if (typeof decoded === 'string' || typeof decoded.userId !== 'string') return null;
    const status = getUserAuthStatus(decoded.userId, options);
    if (!status?.isActive || isTokenStale(decoded.iat, status.tokensValidAfter)) return null;
    return { ...decoded, userId: decoded.userId, role: status.role };
  } catch {
    return null;
  }
}
