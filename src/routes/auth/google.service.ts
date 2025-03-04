import { Injectable } from '@nestjs/common';
import { auth, OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { GoogleAuthStateType } from 'src/routes/auth/auth.model';
import { AuthRepository } from 'src/routes/auth/auth.repo';
import { AuthService } from 'src/routes/auth/auth.service';
import { RolesService } from 'src/routes/auth/roles.service';
import envConfig from 'src/shared/config';
import { HashingService } from 'src/shared/services/hashing.service';
import { TokenService } from 'src/shared/services/token.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class GoogleService {
  private oauth2Client: OAuth2Client;

  constructor(
    private readonly authRepo: AuthRepository,
    private readonly authService: AuthService,
    private readonly hashingService: HashingService,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      envConfig.GOOGLE_CLIENT_ID,
      envConfig.GOOGLE_CLIENT_SECRET,
      envConfig.GOOGLE_REDIRECT_URI,
    );
  }

  getAuthorizationUrl({
    userAgent,
    ip,
  }: GoogleAuthStateType) {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    // Chuyển đổi thông tin user agent và ip thành base64
    const stateString = Buffer.from(
      JSON.stringify({ userAgent, ip }),
    ).toString('base64');

    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      include_granted_scopes: true,
      state: stateString,
    });

    return url;
  }

  async googleCallback({
    code,
    state,
  }: {
    code: string;
    state: string;
  }) {
    try {
      let userAgent = 'Unknown';
      let ip = 'Unknown';
      // 1. Lấy state từ url
      try {
        if (state) {
          const stateString = Buffer.from(
            state,
            'base64',
          ).toString('utf-8');
          const clientInfo = JSON.parse(stateString);

          userAgent = clientInfo.userAgent;
          ip = clientInfo.ip;
        }
      } catch (error) {
        console.error('Error parsing state', error);
      }

      // 2. Dùng code để lấy token
      const { tokens } =
        await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);

      // 3. Lấy thông tin user
      const oauth2 = google.oauth2({
        auth: this.oauth2Client,
        version: 'v2',
      });
      const { data } = await oauth2.userinfo.get();

      if (!data.email) {
        throw new Error('Không thể lấy thông tin email');
      }

      let user =
        await this.authRepo.findUniqueUserIncludeRole({
          email: data.email,
        });

      // 4. Nếu user chưa tồn tại thì tạo mới
      if (!user) {
        const clientRoleId = await this.hashingService.hash(
          data.email,
        );
        const randomPassword = uuidv4();
        const hashedPassword =
          await this.hashingService.hash(randomPassword);

        user = await this.authRepo.createUserIncludeRole({
          email: data.email,
          name: data.name ?? '',
          password: hashedPassword,
          roleId: clientRoleId,
          phoneNumber: '',
          avatar: data.picture ?? '',
        });

        const device = await this.authRepo.createDevice({
          userId: user.id,
          userAgent,
          ip,
        });

        const authTokens =
          await this.authService.generateTokens({
            userId: user.id,
            roleId: user.roleId,
            deviceId: device.id,
            roleName: user.role.name,
          });

        return authTokens;
      }
    } catch (error) {
      console.log('Error', error);
      throw new Error('Lỗi đăng nhập Google');
    }
  }
}
