import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  LoginBodyDTO,
  RegisterBodyDTO,
  RegisterResDTO,
  SendOTPBodyDTO,
} from 'src/routes/auth/auth.dto';
import { LoginBodyType } from 'src/routes/auth/auth.model';
import { AuthService } from 'src/routes/auth/auth.service';
import { IP } from 'src/shared/decorators/id.decorator';
import { UserAgent } from 'src/shared/decorators/user-agent.decorator';
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ZodSerializerDto(RegisterResDTO)
  async register(@Body() body: RegisterBodyDTO) {
    return await this.authService.register(body);
  }

  @Post('otp')
  async sendOTP(@Body() body: SendOTPBodyDTO) {
    return await this.authService.sendOTP(body);
  }

  @Post('login')
  async login(
    @Body() body: LoginBodyType,
    @UserAgent() userAgent: string,
    @IP() ip: string,
  ) {
    return this.authService.login({ ...body, userAgent, ip });
  }

  // @Post('refresh-token')
  // @HttpCode(HttpStatus.OK)
  // async refreshToken(@Body() body: any) {
  //   return this.authService.refreshToken(body.refreshToken);
  // }

  @Post('logout')
  async logout(@Body() body: any) {
    return this.authService.logout(body.refreshToken);
  }
}
