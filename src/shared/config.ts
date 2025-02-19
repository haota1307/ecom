import * as fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { z } from 'zod';

config({
  path: '.env',
});

if (!fs.existsSync(path.resolve('.env'))) {
  console.log('Không tìm thấy file .env');
  process.exit(1);
}

const configSchema = z.object({
  DATABASE_URL: z.string(),
  ACCESS_TOKEN_SECRET: z.string(),
  PORT: z.string(),
  ACCESS_TOKEN_EXPIRES_IN: z.string(),
  REFRESH_TOKEN_SECRET: z.string(),
  REFRESH_TOKEN_EXPIRES_IN: z.string(),
  SECRET_API_KEY: z.string(),
  ADMIN_NAME: z.string(),
  ADMIN_PASSWORD: z.string(),
  ADMIN_EMAIL: z.string(),
  ADMIN_PHONE_NUMBER: z.string(),
});

const configServer = configSchema.safeParse(process.env);

if (!configServer.success) {
  console.error('Các giá trị khai báo trong file .env không hợp lệ');
  console.error(configServer.error.format());
  process.exit(1);
}

const envConfig = configServer.data;

export default envConfig;
