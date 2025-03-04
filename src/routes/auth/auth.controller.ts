import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  GetAuthorizationUrlDTo,
  LoginResDTO,
  LogoutBodyDTO,
  RefreshTokenBodyDTO,
  RefreshTokenResDTO,
  RegisterBodyDTO,
  RegisterResDTO,
  SendOTPBodyDTO,
} from 'src/routes/auth/auth.dto';
import { LoginBodyType } from 'src/routes/auth/auth.model';
import { AuthService } from 'src/routes/auth/auth.service';
import { GoogleService } from 'src/routes/auth/google.service';
import envConfig from 'src/shared/config';
import { IsPublic } from 'src/shared/decorators/auth.decorator';
import { UserAgent } from 'src/shared/decorators/user-agent.decorator';
import { MessageResDTO } from 'src/shared/dtos/response.dto';
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleService: GoogleService,
  ) {}

  @Post('register')
  @IsPublic()
  @ZodSerializerDto(RegisterResDTO)
  register(@Body() body: RegisterBodyDTO) {
    return this.authService.register(body);
  }

  @Post('otp')
  @IsPublic()
  @ZodSerializerDto(MessageResDTO)
  sendOTP(@Body() body: SendOTPBodyDTO) {
    return this.authService.sendOTP(body);
  }

  @Post('login')
  @IsPublic()
  @ZodSerializerDto(LoginResDTO)
  login(
    @Body() body: LoginBodyType,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
  ) {
    return this.authService.login({
      ...body,
      userAgent,
      ip,
    });
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(RefreshTokenResDTO)
  async refreshToken(
    @Body() body: RefreshTokenBodyDTO,
    @UserAgent() userAgent: string,
    @Ip() ip: string,
  ) {
    return this.authService.refreshToken({
      refreshToken: body.refreshToken,
      userAgent,
      ip,
    });
  }

  @Post('logout')
  @ZodSerializerDto(MessageResDTO)
  logout(@Body() body: LogoutBodyDTO) {
    return this.authService.logout(body.refreshToken);
  }

  @Get('google-link')
  @IsPublic()
  @ZodSerializerDto(GetAuthorizationUrlDTo)
  getAuthorizationUrl(
    @UserAgent() userAgent: string,
    @Ip() ip: string,
  ) {
    return this.googleService.getAuthorizationUrl({
      ip,
      userAgent,
    });
  }

  @Get('google/callback')
  @IsPublic()
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const data = await this.googleService.googleCallback({
        code,
        state,
      });

      return res.redirect(
        `${envConfig.GOOGLE_CLIENT_REDIRECT_URI}?accessToken=${data?.accessToken}&refreshToken=${data?.refreshToken}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Đã có lỗi xảy ra khi đăng nhập bằng google, vui lòng thử lại bằng cách khác';

      return res.redirect(
        `${envConfig.GOOGLE_CLIENT_REDIRECT_URI}?error=${message}`,
      );
    }
  }
}
