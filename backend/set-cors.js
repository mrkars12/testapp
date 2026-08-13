// set-cors.js — شغّله مرة واحدة بس من جذر مشروع الـ backend:
//   node set-cors.js
// بيستخدم نفس المكتبة والمفاتيح الموجودة في .env بتاعك، من غير احتياج لـ aws CLI.

require('dotenv').config();
const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require('@aws-sdk/client-s3');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const corsConfig = {
    Bucket: process.env.R2_BUCKET_NAME,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: ['http://localhost:3000'],
          AllowedMethods: ['PUT', 'GET', 'HEAD'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3000,
        },
      ],
    },
  };

  console.log('⏳ بطبق الـ CORS على الـ bucket:', process.env.R2_BUCKET_NAME);
  await client.send(new PutBucketCorsCommand(corsConfig));
  console.log('✅ تم التطبيق.');

  console.log('⏳ بتأكد من القيمة المسجلة فعليًا...');
  const result = await client.send(new GetBucketCorsCommand({ Bucket: process.env.R2_BUCKET_NAME }));
  console.log('📋 الـ CORS الحالية على الـ bucket:');
  console.log(JSON.stringify(result.CORSRules, null, 2));
}

main().catch((err) => {
  console.error('❌ حصل خطأ:', err);
  process.exit(1);
});