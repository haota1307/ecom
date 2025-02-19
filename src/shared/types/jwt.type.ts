import { Role } from '@prisma/client';

export interface TokenPayload {
  userId: number;
  role: Role;
  exp: number;
  iat: number;
}
