import {
  ConflictException,
  HttpException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { addMilliseconds } from 'date-fns';
import {
  LoginBodyType,
  RefreshTokenBodyType,
  RegisterBodyType,
  SendOTPBodyType,
} from 'src/routes/auth/auth.model';
import { AuthRepository } from 'src/routes/auth/auth.repo';
import { RolesService } from 'src/routes/auth/roles.service';
import envConfig from 'src/shared/config';
import {
  generateOTP,
  isNotFoundPrismaError,
  isUniqueConstraintPrismaError,
} from 'src/shared/helpers';
import { SharedUserRepository } from 'src/shared/repositories/shared-user.repo';
import { HashingService } from 'src/shared/services/hashing.service';
import { PrismaService } from 'src/shared/services/prisma.service';
import { TokenService } from 'src/shared/services/token.service';
import ms from 'ms';
import { TypeOfVerificationCode } from 'src/shared/constants/auth.constant';
import { EmailService } from 'src/shared/services/email.service';
import { AccessTokenPayloadCreate } from 'src/shared/types/jwt.type';
import { RefreshToken } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly hashingService: HashingService,
    private readonly prismaService: PrismaService,
    private readonly tokenService: TokenService,
    private readonly rolesService: RolesService,
    private readonly authRepository: AuthRepository,
    private readonly sharedUserRepository: SharedUserRepository,
    private readonly emailService: EmailService,
  ) {}

  async register(body: RegisterBodyType) {
    try {
      const vevificationCode =
        await this.authRepository.findUniqueVerificationCode(
          {
            email: body.email,
            code: body.code,
            type: TypeOfVerificationCode.REGISTER,
          },
        );

      if (!vevificationCode) {
        throw new UnprocessableEntityException([
          {
            message: 'Mã OTP không hợp lệ',
            path: 'code',
          },
        ]);
      }

      if (vevificationCode.expiresAt < new Date()) {
        throw new UnprocessableEntityException([
          {
            message: 'Mã OTP đã hết hạn',
            path: 'code',
          },
        ]);
      }

      const clientRoleId =
        await this.rolesService.getClientRoleId();
      const hashedPassword = await this.hashingService.hash(
        body.password,
      );

      return await this.authRepository.createUser({
        email: body.email,
        name: body.name,
        phoneNumber: body.phoneNumber,
        password: hashedPassword,
        roleId: clientRoleId,
      });
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw new ConflictException('Email đã tồn tại');
      }

      throw error;
    }
  }

  async sendOTP(body: SendOTPBodyType) {
    // 1. Kiểm tra email đã tồn tại trong database chưa
    const user = await this.sharedUserRepository.findUnique(
      {
        email: body.email,
      },
    );

    if (user) {
      throw new UnprocessableEntityException([
        {
          message: 'Email đã tồn tại',
          path: 'email',
        },
      ]);
    }

    // 2. Tạo mã OTP
    const code = generateOTP();
    const verificationCode =
      this.authRepository.createVerificationCode({
        email: body.email,
        code,
        type: body.type,
        expiresAt: addMilliseconds(
          new Date(),
          ms(envConfig.OTP_EXPIRES_IN),
        ),
      });

    // 3. Gửi mã OTP
    const { error } = await this.emailService.sendOTP({
      email: body.email,
      code,
    });
    if (error) {
      throw new UnprocessableEntityException([
        {
          message: 'Gửi mã OTP thất bại',
          path: 'code',
        },
      ]);
    }
    return verificationCode;
  }

  async login(
    body: LoginBodyType & { userAgent: string; ip: string },
  ) {
    const user =
      await this.authRepository.findUniqueUserIncludeRole({
        email: body.email,
      });

    if (!user) {
      throw new UnprocessableEntityException([
        {
          message: 'Email không tồn tại',
          path: 'email',
        },
      ]);
    }

    const isPasswordMatch =
      await this.hashingService.compare(
        body.password,
        user.password,
      );

    if (!isPasswordMatch) {
      throw new UnprocessableEntityException([
        {
          field: 'password',
          error: 'Mật khẩu không đúng',
        },
      ]);
    }

    const device = await this.authRepository.createDevice({
      userId: user.id,
      userAgent: body.userAgent,
      ip: body.ip,
    });

    const tokens = await this.generateTokens({
      userId: user.id,
      roleId: user.roleId,
      deviceId: device.id,
      roleName: user.role.name,
    });
    return tokens;
  }

  async generateTokens({
    userId,
    deviceId,
    roleId,
    roleName,
  }: AccessTokenPayloadCreate) {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken({
        userId,
        deviceId,
        roleId,
        roleName,
      }),
      this.tokenService.signRefreshToken({
        userId,
      }),
    ]);

    const decodedRefreshToken =
      await this.tokenService.verifyRefreshToken(
        refreshToken,
      );

    await this.authRepository.createRefreshToken({
      token: refreshToken,
      userId,
      expiresAt: new Date(decodedRefreshToken.exp * 1000),
      deviceId,
    });

    return { accessToken, refreshToken };
  }

  async refreshToken({
    refreshToken,
    ip,
    userAgent,
  }: RefreshTokenBodyType & {
    userAgent: string;
    ip: string;
  }) {
    try {
      // 1. Kiểm tra refreshToken có hợp lệ không
      const { userId } =
        await this.tokenService.verifyRefreshToken(
          refreshToken,
        );

      // 2. Kiểm tra refreshToken có tồn tại trong database không
      const refreshTokenInDb =
        await this.authRepository.findUniqueRefeshTokenIncludeUserRole(
          {
            token: refreshToken,
          },
        );

      if (!refreshTokenInDb) {
        throw new UnauthorizedException(
          'Refresh token đã được sử dụng hoặc không tồn tại',
        );
      }

      const {
        deviceId,
        user: { roleId, name: roleName },
      } = refreshTokenInDb;

      // 3. Cập nhật thông tin device
      const $updateDevice =
        this.authRepository.updateDevice(deviceId, {
          userAgent,
          ip,
        });

      // 4. Xóa refreshToken cũ
      const $deleteRefreshToken =
        this.authRepository.deleteRefreshToken({
          token: refreshToken,
        });

      // 5. Tạo mới accessToken và refreshToken
      const $token = this.generateTokens({
        userId,
        roleId,
        roleName,
        deviceId,
      });

      const [, , token] = await Promise.all([
        $updateDevice,
        $deleteRefreshToken,
        $token,
      ]);

      return token;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException();
    }
  }

  async logout(refreshToken: string) {
    try {
      // 1. Kiểm tra refreshToken có hợp lệ không
      await this.tokenService.verifyRefreshToken(
        refreshToken,
      );

      // 2. Xóa refreshToken trong database
      await this.prismaService.refreshToken.delete({
        where: {
          token: refreshToken,
        },
      });

      return { message: 'Logout successfully' };
    } catch (error) {
      // Trường hợp đã refresh token rồi, hãy thông báo cho user biết
      // refresh token của họ đã bị đánh cắp
      if (isNotFoundPrismaError(error)) {
        throw new UnauthorizedException(
          'Refresh token has been revoked',
        );
      }

      throw new UnauthorizedException();
    }
  }
}
