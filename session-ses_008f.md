# READ-ONLY tenant-isolation audit plan

**Session ID:** ses_008f31f86ffeTOsMcqp75x0Z1j
**Created:** 8/12/2026, 5:37:24 PM
**Updated:** 8/12/2026, 5:39:00 PM

---

## User

I want a READ-ONLY tenant-isolation audit.

Do NOT modify, create, delete, rename, or format ANY files.
Do NOT execute commands that modify the repository.
Do NOT apply any fixes.

Read the entire current tenant-isolation implementation and the relevant Prisma/services code.

Use the existing P0 inventory and P1-A remediation findings as context, but VERIFY EVERYTHING against the current workspace.

Your job is ONLY to produce the implementation plan.

I need you to tell me exactly:

1. Every tenant-isolation problem that still exists.
2. Every file and exact line that needs modification.
3. The exact code change that should be made at each location.
4. Which changes are:
   - normal tenant-scoped fixes
   - crossStoreQuery(platform_sweep)
   - crossStoreQuery(provider_lookup)
   - crossStoreQuery(health_check)
   - crossModeQuery(merchant_dual_mode_view)
5. Every transaction that must change from:
   this.prisma.$transaction(...)
   to:
   this.prisma.guarded().$transaction(...)
6. Any raw SQL that bypasses the guard and whether it is legitimate or needs remediation.
7. Any tenant-scoped Prisma model missing from the registry.
8. All tests that must be added or updated.
9. The safest implementation order.
10. A final checklist for P1 completion.

IMPORTANT:
- Do NOT implement anything.
- Do NOT edit files.
- Do NOT run formatters that modify files.
- Do NOT commit.
- Do NOT proceed to P2.
- Do NOT enable fail-closed enforcement.
- Do NOT enable throwOnViolation in production.
- Do NOT enable RLS.
- Do NOT invent a new CrossStoreReason.
- Do NOT automatically inject store_id.
- Do NOT change the tenant architecture.

At the end, provide a concise "IMPLEMENTATION DIFF PLAN" section showing the exact intended changes file-by-file.

I will review your plan before allowing any code changes. 

---

## Assistant (Build · Muse Spark 1.2 Contributor · 3.8s)

_Thinking:_



Read-only tenant-isolation audit — verifying the implementation against the workspace and building your plan.

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp"
}
```

**Output:**
```
<path>/workspaces/testapp</path>
<type>directory</type>
<entries>
.git/
backend/
frontend/
opencode.json

(4 entries)
</entries>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.5s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend"
}
```

**Output:**
```
<path>/workspaces/testapp/backend</path>
<type>directory</type>
<entries>
.env
.gitignore
.prettierrc
.zed/
AI_RULES.md
APPLY.md
aws/
awscliv2.zip
backup_pre_phase1a.dump
backup.sql
cloudflared.deb
cookies.txt
dist.zip
docs/
eslint.config.mjs
failures.txt
nest-cli.json
node_modules/
package-lock.json
package.json
prisma/
README.md
set-cors.js
src.zip
src/
test/
tsconfig.build.json
tsconfig.json

(28 entries)
</entries>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 2.4s)

**Tool: glob**

**Input:**
```json
{
  "pattern": "**/tenant*",
  "path": "/workspaces/testapp/backend"
}
```

**Output:**
```
/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts
/workspaces/testapp/backend/src/common/tenant/tenant-context.service.ts
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts
/workspaces/testapp/backend/src/common/tenant/tenant.module.ts
/workspaces/testapp/backend/src/common/tenant/tenant-scoped-models.ts
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.ts
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "docs/**/*.md",
  "path": "/workspaces/testapp/backend"
}
```

**Output:**
```
/workspaces/testapp/backend/docs/PAYMENTS-ARCHITECTURE.md
/workspaces/testapp/backend/docs/MONEY.md
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src</path>
<type>directory</type>
<entries>
app.controller.spec.ts
app.controller.ts
app.module.ts
app.service.ts
auth/
common/
config/
devices/
ledger/
main.ts
notifications/
prisma/
realtime/
stores.zip
stores/
uploads/
wallet/

(17 entries)
</entries>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.7s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/prisma/schema.prisma"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/prisma/schema.prisma</path>
<type>file</type>
<content>
1: // ═══════════════════════════════════════════════════════════════════
2: // PHASE-1B.2-SCHEMA-V1  (checkout, payment intents, ledger)
3: //
4: // لو السطر ده مش موجود في أول prisma/schema.prisma عندك، يبقى الملف
5: // المطبَّق مش الملف ده.
6: //
7: // اتحقق منه بـ:
8: //     head -2 prisma/schema.prisma
9: //     grep -c "^model Payment" prisma/schema.prisma      → لازم 1
10: //
11: // الموديلات المؤقتة لجداول الدفع غير الموجودة في قاعدة البيانات اتشالت
12: // من هنا ومحفوظة في prisma/phase1b-placeholders.prisma.bak
13: // ═══════════════════════════════════════════════════════════════════
14: 
15: generator client {
16:   provider = "prisma-client-js"
17: }
18: 
19: datasource db {
20:   provider = "postgresql"
21:   url      = env("DATABASE_URL")
22: }
23: 
24: model cache {
25:   key        String @id @db.VarChar(255)
26:   value      String
27:   expiration Int
28: 
29:   @@index([expiration], map: "cache_expiration_index")
30: }
31: 
32: model cache_locks {
33:   key        String @id @db.VarChar(255)
34:   owner      String @db.VarChar(255)
35:   expiration Int
36: 
37:   @@index([expiration], map: "cache_locks_expiration_index")
38: }
39: 
40: model device_verification_tokens {
41:   id          BigInt    @id @default(autoincrement())
42:   user_id     BigInt
43:   fingerprint String    @db.VarChar(255)
44:   token       String    @unique(map: "device_verification_tokens_token_unique") @db.VarChar(255)
45:   ip_address  String    @db.VarChar(255)
46:   user_agent  String
47:   expires_at  DateTime  @db.Timestamp(0)
48:   used_at     DateTime? @db.Timestamp(0)
49:   created_at  DateTime? @db.Timestamp(0)
50:   updated_at  DateTime? @db.Timestamp(0)
51:   users       users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "device_verification_tokens_user_id_foreign")
52: }
53: 
54: model device_verifications {
55:   id           BigInt    @id @default(autoincrement())
56:   user_id      BigInt
57:   fingerprint  String    @db.VarChar(255)
58:   ip_address   String?   @db.VarChar(255)
59:   user_agent   String?   @db.VarChar(255)
60:   device_name  String?   @db.VarChar(255)
61:   platform     String?   @db.VarChar(255)
62:   browser      String?   @db.VarChar(255)
63:   is_verified  Boolean   @default(false)
64:   verified_at  DateTime? @db.Timestamp(0)
65:   last_used_at DateTime? @db.Timestamp(0)
66:   created_at   DateTime? @db.Timestamp(0)
67:   updated_at   DateTime? @db.Timestamp(0)
68:   code         String
69:   users        users     @relation(fields: [user_id], references: [id])
70: 
71:   @@unique([user_id, fingerprint], map: "device_verifications_user_id_fingerprint_unique")
72:   @@index([fingerprint], map: "device_verifications_fingerprint_index")
73: }
74: 
75: model devices {
76:   id                      BigInt    @id @default(autoincrement())
77:   user_id                 BigInt
78:   fingerprint             String?   @db.VarChar(255)
79:   browser                 String?   @db.VarChar(255)
80:   ip_address              String?   @db.VarChar(255)
81:   verification_token      String?   @db.VarChar(255)
82:   verified_at             DateTime? @db.Timestamp(0)
83:   created_at              DateTime? @db.Timestamp(0)
84:   updated_at              DateTime? @db.Timestamp(0)
85:   last_active_at          DateTime? @db.Timestamp(0)
86:   os                      String?   @db.VarChar(255)
87:   trust_token             String?   @db.VarChar(64)
88:   session_id              String?   @db.VarChar(255)
89:   logged_out_at           DateTime? @db.Timestamp(0)
90:   platform                String?   @db.VarChar(255)
91:   hardware_signature      String?
92:   device_name             String?   @db.VarChar(255)
93:   verification_expires_at DateTime? @db.Timestamp(0)
94:   users                   users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "devices_user_id_foreign")
95: 
96:   @@index([fingerprint], map: "devices_fingerprint_index")
97:   @@index([session_id], map: "devices_session_id_index")
98: }
99: 
100: model email_verifications {
101:   id         BigInt    @id @default(autoincrement())
102:   email      String    @db.VarChar(255)
103:   token      String    @db.VarChar(255)
104:   created_at DateTime? @db.Timestamp(0)
105: 
106:   @@index([email], map: "email_verifications_email_index")
107: }
108: 
109: model failed_jobs {
110:   id         BigInt   @id @default(autoincrement())
111:   uuid       String   @unique(map: "failed_jobs_uuid_unique") @db.VarChar(255)
112:   connection String
113:   queue      String
114:   payload    String
115:   exception  String
116:   failed_at  DateTime @default(now()) @db.Timestamp(0)
117: }
118: 
119: model job_batches {
120:   id             String  @id @db.VarChar(255)
121:   name           String  @db.VarChar(255)
122:   total_jobs     Int
123:   pending_jobs   Int
124:   failed_jobs    Int
125:   failed_job_ids String
126:   options        String?
127:   cancelled_at   Int?
128:   created_at     Int
129:   finished_at    Int?
130: }
131: 
132: model jobs {
133:   id           BigInt @id @default(autoincrement())
134:   queue        String @db.VarChar(255)
135:   payload      String
136:   attempts     Int    @db.SmallInt
137:   reserved_at  Int?
138:   available_at Int
139:   created_at   Int
140: 
141:   @@index([queue], map: "jobs_queue_index")
142: }
143: 
144: model migrations {
145:   id        Int    @id @default(autoincrement())
146:   migration String @db.VarChar(255)
147:   batch     Int
148: }
149: 
150: model notifications {
151:   id         BigInt    @id @default(autoincrement())
152:   user_id    BigInt
153:   type       String    @default("system") @db.VarChar(255)
154:   title      String    @db.VarChar(255)
155:   message    String
156:   data       Json?     @db.Json
157:   read_at    DateTime? @db.Timestamp(0)
158:   created_at DateTime? @db.Timestamp(0)
159:   updated_at DateTime? @db.Timestamp(0)
160:   users      users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "notifications_user_id_foreign")
161: 
162:   @@index([type], map: "notifications_type_index")
163:   @@index([user_id, read_at], map: "notifications_user_id_read_at_index")
164: }
165: 
166: model password_reset_tokens {
167:   email      String    @id @db.VarChar(255)
168:   token      String    @db.VarChar(255)
169:   created_at DateTime? @db.Timestamp(0)
170: }
171: 
172: model personal_access_tokens {
173:   id             BigInt    @id @default(autoincrement())
174:   tokenable_type String    @db.VarChar(255)
175:   tokenable_id   BigInt
176:   name           String
177:   token          String    @unique(map: "personal_access_tokens_token_unique") @db.VarChar(64)
178:   abilities      String?
179:   last_used_at   DateTime? @db.Timestamp(0)
180:   expires_at     DateTime? @db.Timestamp(0)
181:   created_at     DateTime? @db.Timestamp(0)
182:   updated_at     DateTime? @db.Timestamp(0)
183: 
184:   @@index([expires_at], map: "personal_access_tokens_expires_at_index")
185:   @@index([tokenable_type, tokenable_id], map: "personal_access_tokens_tokenable_type_tokenable_id_index")
186: }
187: 
188: model push_subscriptions {
189:   id         BigInt    @id @default(autoincrement())
190:   user_id    BigInt
191:   endpoint   String
192:   public_key String
193:   auth_token String
194:   created_at DateTime? @db.Timestamp(0)
195:   updated_at DateTime? @db.Timestamp(0)
196:   users      users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "push_subscriptions_user_id_foreign")
197: }
198: 
199: model security_logs {
200:   id         BigInt    @id @default(autoincrement())
201:   user_id    BigInt?
202:   event      String    @db.VarChar(255)
203:   ip_address String    @db.Inet
204:   user_agent String?
205:   created_at DateTime? @db.Timestamp(0)
206:   updated_at DateTime? @db.Timestamp(0)
207: }
208: 
209: model sessions {
210:   id            String  @id @db.VarChar(255)
211:   user_id       BigInt?
212:   ip_address    String? @db.VarChar(45)
213:   user_agent    String?
214:   payload       String
215:   last_activity Int
216: 
217:   @@index([last_activity], map: "sessions_last_activity_index")
218:   @@index([user_id], map: "sessions_user_id_index")
219: }
220: 
221: model trusted_devices {
222:   id                 BigInt    @id @default(autoincrement())
223:   user_id            BigInt
224:   device_fingerprint String    @db.VarChar(255)
225:   ip_address         String?   @db.VarChar(255)
226:   user_agent         String?
227:   device_name        String?   @db.VarChar(255)
228:   last_login_at      DateTime  @default(now()) @db.Timestamp(0)
229:   created_at         DateTime? @db.Timestamp(0)
230:   updated_at         DateTime? @db.Timestamp(0)
231:   users              users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "trusted_devices_user_id_foreign")
232: 
233:   @@unique([user_id, device_fingerprint], map: "trusted_devices_user_id_device_fingerprint_unique")
234:   @@index([user_id, last_login_at], map: "trusted_devices_user_id_last_login_at_index")
235: }
236: 
237: model user_devices {
238:   id               BigInt    @id @default(autoincrement())
239:   user_id          BigInt
240:   device_token     String    @unique(map: "user_devices_device_token_unique") @db.Uuid
241:   fingerprint      String    @db.VarChar(255)
242:   name             String?   @db.VarChar(255)
243:   platform         String?   @db.VarChar(255)
244:   browser          String?   @db.VarChar(255)
245:   type             String?   @db.VarChar(255)
246:   browser_version  String?   @db.VarChar(255)
247:   ip_address       String    @db.VarChar(255)
248:   location         Json?     @db.Json
249:   is_trusted       Boolean   @default(false)
250:   verified_at      DateTime? @db.Timestamp(0)
251:   last_login_at    DateTime? @db.Timestamp(0)
252:   last_activity_at DateTime? @db.Timestamp(0)
253:   logged_out_at    DateTime? @db.Timestamp(0)
254:   created_at       DateTime? @db.Timestamp(0)
255:   updated_at       DateTime? @db.Timestamp(0)
256:   deleted_at       DateTime? @db.Timestamp(0)
257:   session_id       String?   @db.VarChar(255)
258:   users            users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "user_devices_user_id_foreign")
259: 
260:   @@unique([user_id, device_token], map: "user_devices_user_id_device_token_unique")
261:   @@index([fingerprint])
262:   @@index([fingerprint], map: "user_devices_fingerprint_index")
263:   @@index([user_id])
264:   @@index([user_id], map: "user_devices_user_id_index")
265: }
266: 
267: /// This table contains check constraints and requires additional setup for migrations. Visit https://pris.ly/d/check-constraints for more info.
268: model users {
269:   id                            BigInt                       @id @default(autoincrement())
270:   fullname                      String?                      @db.VarChar(255)
271:   username                      String                       @unique(map: "users_username_unique") @db.VarChar(255)
272:   email                         String                       @unique(map: "users_email_unique") @db.VarChar(255)
273:   email_verified_at             DateTime?                    @db.Timestamp(0)
274:   password                      String                       @db.VarChar(255)
275:   country                       String?                      @db.VarChar(255)
276:   country_code                  String?                      @db.VarChar(10)
277:   mobile_code                   String?                      @db.VarChar(10)
278:   avatar                        String?                      @db.VarChar(255)
279:   business_name                 String?                      @db.VarChar(255)
280:   completed_trade               Int                          @default(0)
281:   rating                        Float                        @default(0) @db.Real
282:   is_verified                   Boolean                      @default(false)
283:   remember_token                String?                      @db.VarChar(100)
284:   created_at                    DateTime?                    @db.Timestamp(0)
285:   updated_at                    DateTime?                    @db.Timestamp(0)
286:   entity_type                   String?                      @db.Char(255)
287:   email_verification_token      String?                      @db.VarChar(64)
288:   email_verification_expires_at DateTime?                    @db.Timestamp(0)
289:   accounttype                   String                       @default("individual") @db.VarChar(255)
290:   email_otp                     String?                      @db.VarChar(255)
291:   email_otp_expires_at          DateTime?                    @db.Timestamp(0)
292:   email_otp_attempts            Int                          @default(0) @db.SmallInt
293:   email_otp_last_sent_at        DateTime?                    @db.Timestamp(0)
294:   account_locked_until          DateTime?                    @db.Timestamp(0)
295:   email_otp_blocked_until       DateTime?                    @db.Timestamptz(0)
296:   email_otp_resend_attempts     Int                          @default(0)
297:   two_factor_secret             String?
298:   two_factor_enabled            Boolean                      @default(false)
299:   two_factor_confirmed_at       DateTime?                    @db.Timestamp(0)
300:   session_id                    String?                      @db.VarChar(255)
301:   login_attempts                Int                          @default(0) @db.SmallInt
302:   login_locked_until            DateTime?                    @db.Timestamp(0)
303:   last_login_attempt_at         DateTime?                    @db.Timestamp(0)
304:   timezone                      String                       @default("UTC") @db.VarChar(255)
305:   last_activity_at              DateTime?                    @db.Timestamp(0)
306:   password_reset_expires_at     DateTime?                    @db.Timestamp(0)
307:   password_reset_code           String?                      @db.VarChar(255)
308:   device_verification_tokens    device_verification_tokens[]
309:   device_verifications          device_verifications[]
310:   devices                       devices[]
311:   notifications                 notifications[]
312:   oauth_providers               oauth_providers[]
313:   push_subscriptions            push_subscriptions[]
314:   store                         store[]
315:   trusted_devices               trusted_devices[]
316:   user_devices                  user_devices[]
317:   wallets                       wallets?
318: 
319:   @@index([accounttype], map: "idx_users_accounttype")
320:   @@index([email], map: "idx_users_email")
321:   @@index([email, email_verified_at], map: "idx_users_email_verified")
322:   @@index([username], map: "idx_users_username")
323:   @@index([session_id], map: "users_session_id_index")
324: }
325: 
326: model login_blocks {
327:   id            BigInt    @id @default(autoincrement())
328:   fingerprint   String    @unique
329:   attempts      Int       @default(0)
330:   blocked_until DateTime?
331:   created_at    DateTime  @default(now())
332:   updated_at    DateTime  @updatedAt
333:   ip_address    String?
334: }
335: 
336: model wallets {
337:   id         BigInt    @id @default(autoincrement())
338:   user_id    BigInt    @unique
339:   balance    Float     @default(0)
340:   currency   String    @default("USDDC") @db.VarChar(5)
341:   created_at DateTime? @db.Timestamp(0)
342:   updated_at DateTime? @db.Timestamp(0)
343:   users      users     @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "1")
344: }
345: 
346: model oauth_providers {
347:   id            BigInt    @id @default(autoincrement())
348:   user_id       BigInt
349:   provider      String    @db.VarChar(50)
350:   provider_id   String    @db.VarChar(255)
351:   access_token  String?
352:   refresh_token String?
353:   expires_at    DateTime? @db.Timestamp(0)
354:   profile_data  Json?     @db.Json
355:   created_at    DateTime? @db.Timestamp(0)
356:   updated_at    DateTime? @db.Timestamp(0)
357:   users         users     @relation(fields: [user_id], references: [id], onDelete: Cascade)
358: 
359:   @@unique([provider, provider_id])
360:   @@index([user_id])
361: }
362: 
363: // schema.prisma
364: 
365: model store {
366:   name                String
367:   slug                String                 @unique
368:   customDomain        String?                @unique
369:   logo                String?
370:   currency            String                 @default("USD")
371:   ownerId             BigInt
372:   createdAt           DateTime               @default(now())
373:   updatedAt           DateTime
374:   status              BigInt                 @default(1)
375:   id                  BigInt                 @id @default(autoincrement())
376:   description         String?
377:   menus               StoreMenu[]
378:   pages               StorePage[]
379:   theme               StoreTheme?
380:   sections            ThemeSection[]
381:   products            Product[]
382:   productTypes        ProductType[]
383:   tags                Tag[]
384:   collections         Collection[]
385:   orders              Order[]
386:   /// وضع الدفع النشط. عمود واحد، فالتنافي مضمون بالبناء: مستحيل
387:   /// المتجر يكون في وضعين.
388:   payment_mode        StorePaymentMode @default(MERCHANT_GATEWAY)
389: 
390:   paymentAccounts     PaymentAccount[]
391:   checkouts           Checkout[]
392: 
393:   users users @relation(fields: [ownerId], references: [id])
394: }
395: 
396: model StoreTheme {
397:   id         BigInt   @id @default(autoincrement())
398:   store_id   BigInt   @unique
399:   menu_id    BigInt?
400:   store      store    @relation(fields: [store_id], references: [id])
401:   colors     Json     @default("{}")
402:   typography Json     @default("{}")
403:   header     Json     @default("{}")
404:   footer     Json     @default("{}")
405:   settings   Json?
406:   content    Json?
407:   created_at DateTime @default(now()) @db.Timestamp(6)
408:   updated_at DateTime @default(now()) @db.Timestamp(6)
409: }
410: 
411: model ThemeSection {
412:   id         BigInt   @id @default(autoincrement())
413:   store_id   BigInt
414:   store      store    @relation(fields: [store_id], references: [id], onDelete: Cascade)
415:   type       String
416:   name       String
417:   settings   Json     @default("{}")
418:   blocks     Json     @default("[]")
419:   sort_order Int      @default(0)
420:   is_active  Boolean  @default(true)
421:   page_type  String   @default("home")
422:   created_at DateTime @default(now())
423:   updated_at DateTime @updatedAt
424: 
425:   @@index([store_id, page_type, sort_order])
426: }
427: 
428: model StorePage {
429:   title      String
430:   slug       String
431:   type       PageType @default(STANDARD)
432:   content    String?
433:   image_url  String?
434:   is_active  Boolean  @default(true)
435:   sort_order Int      @default(0)
436:   created_at DateTime @default(now())
437:   updated_at DateTime @updatedAt
438:   id         BigInt   @id @default(autoincrement())
439:   store_id   BigInt
440:   store      store    @relation(fields: [store_id], references: [id])
441: 
442:   @@unique([store_id, slug])
443: }
444: 
445: model StoreMenu {
446:   name     String
447:   id       BigInt     @id @default(autoincrement())
448:   store_id BigInt
449:   handle   String     @unique
450:   items    MenuItem[]
451:   store    store      @relation(fields: [store_id], references: [id])
452: }
453: 
454: model MenuItem {
455:   title       String
456:   url         String
457:   sort_order  Int          @default(0)
458:   id          BigInt       @id @default(autoincrement())
459:   menu_id     BigInt
460:   parent_id   BigInt?
461:   resource_id BigInt?
462:   type        MenuItemType
463:   menu        StoreMenu    @relation(fields: [menu_id], references: [id])
464:   parent      MenuItem?    @relation("MenuTree", fields: [parent_id], references: [id])
465:   children    MenuItem[]   @relation("MenuTree")
466: }
467: 
468: enum PageType {
469:   STANDARD
470:   PRODUCT_WITH_HERO
471:   PRODUCT_WITHOUT_HERO
472: }
473: 
474: enum MenuItemType {
475:   HOME
476:   SEARCH
477:   COLLECTION
478:   PRODUCT
479:   PAGE
480:   BLOG
481:   POLICY
482:   ORDERS
483:   PROFILE
484:   CUSTOM
485: }
486: 
487: model StoreThemePublished {
488:   id       BigInt @id @default(autoincrement())
489:   store_id BigInt @unique
490: 
491:   theme    Json
492:   sections Json
493:   menus    Json
494: 
495:   created_at DateTime @default(now())
496:   updated_at DateTime @updatedAt
497: }
498: 
499: enum ProductStatus {
500:   DRAFT
501:   ACTIVE
502:   ARCHIVED
503:   UNLISTED
504: }
505: 
506: model Product {
507:   id BigInt @id @default(autoincrement())
508: 
509:   store_id BigInt
510: 
511:   title  String
512:   handle String
513: 
514:   description String?
515: 
516:   status ProductStatus @default(DRAFT)
517: 
518:   product_type_id BigInt?
519: 
520:   category String?
521: 
522:   charge_tax Boolean @default(true)
523: 
524:   seo_title String?
525:   seo_desc  String?
526: 
527:   created_at DateTime  @default(now())
528:   updated_at DateTime  @updatedAt
529:   deleted_at DateTime?
530: 
531:   store store @relation(fields: [store_id], references: [id], onDelete: Cascade)
532: 
533:   productType ProductType? @relation(fields: [product_type_id], references: [id])
534: 
535:   images      ProductImage[]
536:   variants    ProductVariant[]
537:   options     ProductOption[]
538:   tags        ProductTag[]
539:   collections ProductCollection[]
540: 
541:   @@unique([store_id, handle])
542:   @@index([store_id])
543:   @@index([status])
544:   @@index([product_type_id])
545:   @@index([deleted_at])
546: }
547: 
548: model ProductType {
549:   id       BigInt @id @default(autoincrement())
550:   store_id BigInt
551:   name     String
552: 
553:   created_at DateTime @default(now())
554:   updated_at DateTime @updatedAt
555: 
556:   store    store     @relation(fields: [store_id], references: [id], onDelete: Cascade)
557:   products Product[]
558: 
559:   @@unique([store_id, name])
560:   @@index([store_id])
561: }
562: 
563: model Tag {
564:   id       BigInt @id @default(autoincrement())
565:   store_id BigInt
566:   name     String
567: 
568:   created_at DateTime @default(now())
569:   updated_at DateTime @updatedAt
570: 
571:   store    store        @relation(fields: [store_id], references: [id], onDelete: Cascade)
572:   products ProductTag[]
573: 
574:   @@unique([store_id, name])
575:   @@index([store_id])
576: }
577: 
578: model ProductTag {
579:   product_id BigInt
580:   tag_id     BigInt
581: 
582:   product Product @relation(fields: [product_id], references: [id], onDelete: Cascade)
583:   tag     Tag     @relation(fields: [tag_id], references: [id], onDelete: Cascade)
584: 
585:   @@id([product_id, tag_id])
586:   @@index([tag_id])
587: }
588: 
589: model ProductImage {
590:   id BigInt @id @default(autoincrement())
591: 
592:   product_id BigInt
593: 
594:   url String
595:   key String? // ← جديد: مسار R2 للحذف
596:   alt String?
597: 
598:   position Int @default(0)
599: 
600:   created_at DateTime @default(now())
601: 
602:   product Product @relation(fields: [product_id], references: [id], onDelete: Cascade)
603: 
604:   @@index([product_id])
605: }
606: 
607: model ProductOption {
608:   id BigInt @id @default(autoincrement())
609: 
610:   product_id BigInt
611: 
612:   name String
613: 
614:   position Int @default(0)
615: 
616:   product Product @relation(fields: [product_id], references: [id], onDelete: Cascade)
617: 
618:   colors Json?
619: 
620:   display_type String?
621: 
622:   values ProductOptionValue[]
623: 
624:   @@index([product_id])
625: }
626: 
627: model ProductOptionValue {
628:   id BigInt @id @default(autoincrement())
629: 
630:   option_id BigInt
631: 
632:   value String
633: 
634:   option ProductOption @relation(fields: [option_id], references: [id], onDelete: Cascade)
635: 
636:   @@index([option_id])
637: }
638: 
639: model ProductVariant {
640:   id BigInt @id @default(autoincrement())
641: 
642:   product_id BigInt
643: 
644:   title String
645: 
646:   price            Decimal? @db.Decimal(10, 2)
647:   compare_at_price Decimal? @db.Decimal(10, 2)
648:   cost_per_item    Decimal? @db.Decimal(10, 2)
649: 
650:   sku     String?
651:   barcode String?
652: 
653:   inventory_qty Int @default(0)
654: 
655:   track_inventory  Boolean @default(true)
656:   continue_selling Boolean @default(false)
657: 
658:   option1 String?
659:   option2 String?
660:   option3 String?
661: 
662:   image_url String?
663:   image_key String?
664: 
665:   image_id BigInt?
666: 
667:   position Int @default(0)
668: 
669:   created_at DateTime @default(now())
670:   updated_at DateTime @updatedAt
671: 
672:   product Product @relation(fields: [product_id], references: [id], onDelete: Cascade)
673: 
674:   @@index([product_id])
675:   @@index([sku])
676: }
677: 
678: model Upload {
679:   id            BigInt   @id @default(autoincrement())
680:   key           String   @unique
681:   url           String
682:   mime_type     String
683:   size          Int
684:   store_id      BigInt
685:   status        String   @default("pending") // pending | attached
686:   attached_type String? // "product" | "variant"
687:   attached_id   BigInt?
688:   created_at    DateTime @default(now())
689: 
690:   @@index([status, created_at])
691:   @@index([store_id])
692: }
693: 
694: model Collection {
695:   id          Int     @id @default(autoincrement())
696:   name        String
697:   handle      String
698:   description String?
699:   image_url   String?
700:   image_key   String?
701: 
702:   seo_title       String?
703:   seo_description String?
704: 
705:   storeId BigInt
706: 
707:   store store @relation(fields: [storeId], references: [id], onDelete: Cascade)
708: 
709:   products ProductCollection[]
710: 
711:   createdAt DateTime @default(now())
712:   updatedAt DateTime @updatedAt
713: 
714:   @@unique([storeId, handle])
715: }
716: 
717: model ProductCollection {
718:   productId    BigInt
719:   collectionId Int
720:   position     Int    @default(0)
721: 
722:   product    Product    @relation(fields: [productId], references: [id], onDelete: Cascade)
723:   collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
724: 
725:   @@id([productId, collectionId])
726: }
727: 
728: enum OrderStatus {
729:   PENDING
730:   /// اتعمل من checkout ملتزم بس لسه مادفعش (تحويل بنكي / فوري)
731:   AWAITING_PAYMENT // لسه جديد، محتاج التاجر يراجعه
732:   CONFIRMED // التاجر أكد الطلب
733:   PROCESSING // بيتجهز
734:   SHIPPED // اتشحن
735:   DELIVERED // وصل
736:   CANCELLED // اتلغى
737: }
738: 
739: // جاهزة لبوابات الدفع اللي هتضيفها بعدين — دلوقتي كل الطلبات هتتعمل
740: // بحالة UNPAID لحد ما تضيف منطق الدفع الفعلي.
741: enum PaymentStatus {
742:   /// استرداد جزئي — المتبقي لسه محصّل
743:   PARTIALLY_REFUNDED
744:   UNPAID
745:   PAID
746:   REFUNDED
747:   FAILED
748: }
749: 
750: model Order {
751:   id BigInt @id @default(autoincrement())
752: 
753:   // العلاقات
754:   store_id BigInt
755:   store    store  @relation(fields: [store_id], references: [id], onDelete: Restrict, onUpdate: Cascade)
756: 
757:   // رقم الطلب الظاهر للعميل
758:   order_number String
759: 
760:   // حالة الطلب
761:   status OrderStatus @default(PENDING)
762: 
763:   /// عملة الطلب وقت إنشائه.
764:   /// ⚠️ متخزّنة على الطلب نفسه مش متقروءة من المتجر: لو التاجر غيّر
765:   /// عملة متجره، الطلبات القديمة لازم تفضل بعملتها الأصلية.
766:   currency String @default("USD") @db.VarChar(3)
767: 
768:   // ملخص سريع لحالة الدفع. المصدر التفصيلي هييجي في المرحلة 1b.
769:   payment_status PaymentStatus @default(UNPAID)
770: 
771:   // آخر وسيلة دفع استخدمها العميل.
772:   //
773:   // ⚠️ العمود ده في قاعدة البيانات TEXT مش enum. كان متكتب هنا كـ
774:   // PaymentProviderKey? بالغلط، وده كان بيخلي Prisma يقترح حذف العمود
775:   // وإعادة إنشائه — لأن Postgres مابيحوّلش text لـ enum في مكانه.
776:   //
777:   // اتصلّح هنا عشان الوصف يطابق الواقع. التحويل لـ enum بيحصل في
778:   // المرحلة 1b بهجرة صريحة فيها USING clause.
779:   payment_method String?
780: 
781:   /// وقت اكتمال الدفع فعلاً
782:   paid_at DateTime? @db.Timestamptz(6)
783: 
784:   /// الـ checkout اللي الطلب اتولد منه. null للطلبات القديمة.
785:   checkout_id BigInt? @unique
786: 
787:   // بيانات العميل
788:   customer_name  String
789:   customer_phone String
790:   customer_email String?
791: 
792:   // العنوان
793:   address_line String
794:   city         String
795:   notes        String?
796: 
797:   // الأسعار
798:   subtotal Decimal @db.Decimal(10, 2)
799:   total    Decimal @db.Decimal(10, 2)
800: 
801:   // المنتجات
802:   items OrderItem[]
803: 
804:   // التواريخ
805:   created_at DateTime @default(now())
806:   updated_at DateTime @updatedAt
807: 
808:   @@unique([store_id, order_number])
809:   @@index([store_id])
810:   @@index([store_id, status])
811: }
812: 
813: model OrderItem {
814:   id       BigInt @id @default(autoincrement())
815:   order_id BigInt
816:   order    Order  @relation(fields: [order_id], references: [id], onDelete: Cascade)
817: 
818:   // مش هنعمل relation إجباري على Product/ProductVariant عشان لو المنتج
819:   // اتحذف بعدين، تفاصيل الطلب القديم تفضل زي ما هي
820:   product_id BigInt?
821:   variant_id BigInt?
822: 
823:   title         String
824:   variant_title String?
825:   price         Decimal @db.Decimal(10, 2)
826:   qty           Int
827:   image_url     String?
828: }
829: 
830: enum PaymentProviderKey {
831:   cod
832:   bank_transfer
833:   paymob
834:   kashier
835:   stripe
836:   fawry
837:   paypal
838:   paytabs
839:   moyasar
840:   paylink
841:   tap
842:   tabby
843:   taager
844:   my_fatoorah
845:   fawaterk
846:   xpay
847:   ziina
848:   tamara
849:   easykash
850:   upay
851:   fabmisr
852: }
853: 
854: /// وسيلة الدفع زي ما العميل بيشوفها.
855: ///
856: /// مختلفة عن PaymentProviderKey: البوابة الواحدة بتقدّم أكتر من وسيلة،
857: /// والوسيلة الواحدة بتتقدّم من أكتر من بوابة.
858: enum PaymentMethodKey {
859:   card
860:   mada
861:   knet
862:   benefit
863:   apple_pay
864:   google_pay
865:   wallet
866:   kiosk
867:   bank_transfer
868:   cod
869:   bnpl
870: }
871: 
872: /// وضع الدفع للمتجر. واحد بس نشط في أي وقت.
873: ///
874: /// MERCHANT_GATEWAY: التاجر بيوصّل حساب بوابته الخاص (Stripe, Paymob,
875: ///   Moyasar…). البوابات دي مزوّدين تحت الوضع ده، مش أوضاع منفصلة.
876: ///
877: /// MERCHANT_MOR: النموذج المُدار. **مش متنفّذ في المرحلة دي** — القيمة
878: ///   موجودة عشان الدفعات القديمة تفضل معروفة الوضع بعد أي تحويل، ومفيش
879: ///   أي منطق دفع أو قيود دفتر مبنية عليها لسه.
880: enum StorePaymentMode {
881:   MERCHANT_GATEWAY
882:   MERCHANT_MOR
883: }
884: 
885: enum RefundStatus {
886:   pending
887:   succeeded
888:   failed
889:   cancelled
890: }
891: 
892: /// مين بدأ الاسترداد
893: enum RefundInitiator {
894:   merchant
895:   customer
896:   provider
897:   system
898: }
899: 
900: enum OwnershipModel {
901:   /// التاجر بيدخل مفاتيح البوابة بنفسه
902:   merchant_credentials
903:   /// حساب متصل تديره المنصة — المرحلة 6
904:   platform_managed
905: }
906: 
907: enum PaymentAccountStatus {
908:   /// اتعمل بس لسه مافيش بيانات اعتماد
909:   draft
910:   /// بيانات الاعتماد موجودة والتحقق منها لسه ماتمش
911:   verifying
912:   active
913:   disabled
914:   /// آخر تحقق فشل — التفاصيل في last_error
915:   errored
916: }
917: 
918: /// نوع الالتزام اللي وسيلة الدفع بتنتجه لما العميل يأكّد الطلب
919: enum CommitmentKind {
920:   /// تفويض أو تحصيل نجح فعلاً (Stripe / Paymob / Moyasar / Tap)
921:   funds_secured
922:   /// وعد غير ممول والتاجر بيقبله (الدفع عند الاستلام / تحويل بنكي)
923:   promise_accepted
924:   /// صدر رقم مرجعي والعميل هيدفع بعدين (فوري / كشك)
925:   awaiting_offline_settlement
926: }
927: 
928: enum CaptureMode {
929:   automatic
930:   manual
931: }
932: 
933: /// وسائل الدفع اللي العميل بيشوفها عند الدفع.
934: ///
935: /// صف لكل (حساب × وسيلة × إعداد البوابة). ده اللي بيحل مشكلة البوابات
936: /// اللي بتقدّم أكتر من تكامل تحت نفس الحساب — زي Paymob اللي بيديك
937: /// integration_id مختلف للكارت والمحفظة والكشك، والتاجر عايز يعرضهم
938: /// كأزرار منفصلة في صفحة الدفع.
939: model PaymentMethodOffering {
940:   id BigInt @id @default(autoincrement())
941: 
942:   account_id BigInt
943:   account    PaymentAccount @relation(fields: [account_id], references: [id], onDelete: Cascade)
944: 
945:   /// نفس مالك الحساب — متكرر عشان الاستعلامات تتقيّد من غير join
946:   store_id BigInt
947:   mode     Mode
948: 
949:   method PaymentMethodKey
950: 
951:   /// معرّف التكامل عند البوابة (مثال: integration_id في Paymob).
952:   /// نص فاضي معناه إن البوابة مالهاش تكاملات متعددة.
953:   gateway_method_config String @default("") @db.VarChar(255)
954: 
955:   enabled  Boolean @default(false)
956:   position Int     @default(0)
957: 
958:   /// الاسم اللي بيظهر للعميل. null معناه استخدم الاسم الافتراضي للوسيلة.
959:   display_name_ar String? @db.VarChar(120)
960:   display_name_en String? @db.VarChar(120)
961: 
962:   /// قيود اختيارية: أقل/أكبر مبلغ، عملات مسموحة، مدن مسموحة.
963:   /// المبالغ بالوحدات الصغرى زي أي مبلغ في المشروع.
964:   constraints Json?
965: 
966:   /// نوع الالتزام اللي الوسيلة دي بتنتجه — ده اللي بيخلي الدفع عند
967:   /// الاستلام وفوري و Stripe يمرّوا بنفس المسار في المرحلة 1b.2.
968:   commitment_kind CommitmentKind @default(funds_secured)
969: 
970:   capture_mode CaptureMode @default(automatic)
971: 
972:   created_at DateTime @default(now()) @db.Timestamptz(6)
973:   updated_at DateTime @updatedAt @db.Timestamptz(6)
974: 
975:   @@unique([account_id, method, gateway_method_config])
976:   @@index([store_id, mode])
977:   @@index([account_id])
978:   @@index([store_id, mode, enabled, position])
979:   @@map("payment_method_offerings")
980: }
981: 
982: /// اتصال متجر ببوابة دفع.
983: ///
984: /// المتجر ممكن يكون عنده أكتر من حساب لنفس البوابة (عملات مختلفة،
985: /// كيانات مختلفة، أو ترحيل من حساب لحساب)، وعشان كده الاسم المعروض
986: /// جزء من مفتاح التفرّد.
987: ///
988: /// ⚠️ المفتاح الأساسي لازم يفضل BigInt مربوط بـ sequence: بيانات
989: /// الاعتماد مشفّرة بـ AAD مربوط بـ id الصف، والـ id لازم يبقى معروف
990: /// قبل التشفير (شوف IdReservationService).
991: model PaymentAccount {
992:   id BigInt @id @default(autoincrement())
993: 
994:   store_id BigInt
995:   store    store  @relation(fields: [store_id], references: [id], onDelete: Cascade)
996: 
997:   /// عزل كامل بين بيانات الاختبار والبيانات الحقيقية
998:   mode Mode
999: 
1000:   gateway PaymentProviderKey
1001: 
1002:   /// اسم من اختيار التاجر يفرّق بين حسابات نفس البوابة
1003:   display_name String @db.VarChar(120)
1004: 
1005:   /// merchant_credentials = التاجر بيدخل مفاتيحه بنفسه (الوضع الحالي)
1006:   /// platform_managed     = حساب متصل تديره المنصة (المرحلة 6)
1007:   ownership_model OwnershipModel @default(merchant_credentials)
1008: 
1009:   /// معرّف الحساب المتصل عند البوابة — null في وضع مفاتيح التاجر
1010:   connected_account_ref String? @db.VarChar(255)
1011: 
1012:   /// ═══ بيانات الاعتماد ═══
1013:   ///
1014:   /// مشفّرة بمفتاح مشتق للمتجر (StoreKeyService)، والـ AAD مربوط بـ:
1015:   ///     (store_id, mode, 'payment_account', id, 'credentials')
1016:   ///
1017:   /// ⚠️ **مابترجعش أبداً في أي رد API.** الواجهة بتاخد تلميح مقنّع
1018:   /// (credentials_hint) و is_configured بس.
1019:   credentials_envelope String?
1020:   credential_kek_version Int?
1021:   credential_dek_version Int?
1022: 
1023:   /// HMAC بمفتاح المتجر — للكشف عن التغيير ولعرض تلميح مقنّع،
1024:   /// مش hash عادي للسر عشان مايبقاش قابل للتخمين
1025:   credentials_fingerprint String? @db.VarChar(64)
1026: 
1027:   /// آخر 4 حروف من كل حقل، للعرض بس. مفيش أسرار كاملة هنا.
1028:   credentials_hint Json?
1029: 
1030:   /// العملة اللي البوابة بتسوّي بيها على الحساب ده
1031:   settlement_currency String? @db.VarChar(3)
1032: 
1033:   status PaymentAccountStatus @default(draft)
1034: 
1035:   /// نتيجة آخر تحقق من بيانات الاعتماد — بيتملّى في المرحلة 1b.2
1036:   /// لما أول أدابتر يقدر يكلّم البوابة فعلاً
1037:   last_verified_at DateTime? @db.Timestamptz(6)
1038:   last_error       String?
1039: 
1040:   offerings PaymentMethodOffering[]
1041: 
1042:   created_at DateTime @default(now()) @db.Timestamptz(6)
1043:   updated_at DateTime @updatedAt @db.Timestamptz(6)
1044: 
1045:   @@unique([store_id, mode, gateway, display_name])
1046:   @@index([store_id, mode])
1047:   @@index([store_id, mode, status])
1048:   @@map("payment_accounts")
1049: }
1050: 
1051: 
1052: // ═══════════════════════════════════════════════════════════════════
1053: // Phase 1a — Foundations
1054: //
1055: // إضافات فقط. مفيش أي جدول موجود في قاعدة البيانات بيتغيّر.
1056: //
1057: // الموديلات المؤقتة اللي كانت مكتوبة هنا لجداول دفع **مش موجودة**
1058: // في قاعدة البيانات اتشالت من الملف ده، لأن وجودها كان بيخلي هجرة
1059: // المرحلة 1a تحاول تنشئ جداول مش من نطاقها. اتحفظت كاملة في:
1060: //
1061: //     prisma/phase1b-placeholders.prisma.bak
1062: //
1063: // وهترجع بشكلها النهائي في المرحلة 1b.
1064: //
1065: // PaymentProviderKey اتساب زي ما هو — الـ enum موجود في قاعدة البيانات
1066: // وبيستخدمه PaymentAccount.
1067: //
1068: // ملاحظة على التقسيم (partitioning): الجداول دي مش مقسّمة في 1a لأنها
1069: // هتفضل فاضية في الإنتاج (مفيش producer). التقسيم بيتعمل في 1b مع أول
1070: // producer، وقتها التحويل drop-and-recreate على جدول فاضي.
1071: // ═══════════════════════════════════════════════════════════════════
1072: 
1073: /// وضع التشغيل — العزل الكامل بين بيانات الاختبار والبيانات الحقيقية.
1074: /// في المرحلة 1a بيتبعت كمعامل صريح؛ الحل التلقائي بييجي في 1b.
1075: enum Mode {
1076:   test
1077:   live
1078: }
1079: 
1080: enum OutboxStatus {
1081:   pending
1082:   claimed
1083:   published
1084:   failed
1085:   dead
1086: }
1087: 
1088: enum IdempotencyStatus {
1089:   in_flight
1090:   completed
1091:   failed
1092: }
1093: 
1094: /// سجل الطلبات المتكرّرة (Idempotency).
1095: ///
1096: /// مفيش FK على store عن قصد: السجل لازم يفضل موجود حتى لو المتجر
1097: /// اتحذف، عشان التدقيق. store_id هنا قيمة نطاق مش اعتماد مرجعي.
1098: model PaymentIdempotencyRecord {
1099:   id BigInt @id @default(autoincrement())
1100: 
1101:   store_id BigInt
1102:   mode     Mode
1103: 
1104:   /// اسم العملية المنطقي، مثال: "payments.create_intent"
1105:   scope String @db.VarChar(100)
1106: 
1107:   /// المفتاح اللي بعته العميل في هيدر Idempotency-Key
1108:   idempotency_key String @db.VarChar(255)
1109: 
1110:   /// hash للـ method + path + body بعد التطبيع — عشان نكشف
1111:   /// نفس المفتاح مع body مختلف
1112:   request_fingerprint String @db.VarChar(64)
1113: 
1114:   status IdempotencyStatus @default(in_flight)
1115: 
1116:   response_status_code Int?
1117:   /// الرد المخزّن للإعادة. بيمرّ على redaction قبل التخزين.
1118:   response_body        Json?
1119: 
1120:   /// حجز للطلب الجاري — الطلب المكرر المتزامن بيستنى أو يترفض
1121:   locked_until DateTime? @db.Timestamptz(6)
1122: 
1123:   created_at   DateTime  @default(now()) @db.Timestamptz(6)
1124:   completed_at DateTime? @db.Timestamptz(6)
1125:   expires_at   DateTime  @db.Timestamptz(6)
1126: 
1127:   @@unique([store_id, mode, scope, idempotency_key])
1128:   @@index([expires_at])
1129:   @@index([store_id, mode])
1130:   @@map("payment_idempotency_records")
1131: }
1132: 
1133: /// صندوق الصادر (Transactional Outbox).
1134: ///
1135: /// الرسالة بتتكتب جوه نفس الـ transaction بتاعة تغيير الحالة، فمفيش
1136: /// احتمال إن الحالة تتحفظ والحدث يضيع أو العكس.
1137: ///
1138: /// مفيش FK على store: الحذف المتتالي ماينفعش يمسح أحداث لسه ماتسلّمتش.
1139: model OutboxMessage {
1140:   id BigInt @id @default(autoincrement())
1141: 
1142:   store_id BigInt
1143:   mode     Mode
1144: 
1145:   /// نوع الكيان المصدر، مثال: "checkout"
1146:   aggregate_type String @db.VarChar(64)
1147:   aggregate_id   String @db.VarChar(64)
1148: 
1149:   /// نوع الحدث، مثال: "checkout.committed"
1150:   event_type    String @db.VarChar(100)
1151:   /// إصدار عقد الحدث — موجود من الرسالة رقم 1، مش من رقم 100000
1152:   event_version Int    @default(1)
1153: 
1154:   payload Json
1155: 
1156:   status OutboxStatus @default(pending)
1157: 
1158:   /// حجز للتوزيع — بيخلي أكتر من instance تشتغل بأمان من غير Redis
1159:   claimed_by        String?   @db.VarChar(100)
1160:   claim_expires_at  DateTime? @db.Timestamptz(6)
1161: 
1162:   attempts        Int       @default(0)
1163:   next_attempt_at DateTime  @default(now()) @db.Timestamptz(6)
1164:   last_error      String?
1165: 
1166:   /// وقت حدوث الحدث في العمل (مقابل وقت تسجيله في النظام)
1167:   occurred_at  DateTime  @db.Timestamptz(6)
1168:   created_at   DateTime  @default(now()) @db.Timestamptz(6)
1169:   published_at DateTime? @db.Timestamptz(6)
1170: 
1171:   consumptions ConsumedEvent[]
1172: 
1173:   @@index([status, next_attempt_at])
1174:   @@index([aggregate_type, aggregate_id])
1175:   @@index([store_id, mode])
1176:   @@index([created_at])
1177:   @@map("outbox_messages")
1178: }
1179: 
1180: /// سجل استهلاك الأحداث لكل مستهلك.
1181: ///
1182: /// القيد الفريد ده **هو** ضمانة الـ at-least-once، مش فحص في الكود.
1183: model ConsumedEvent {
1184:   id BigInt @id @default(autoincrement())
1185: 
1186:   consumer_name String @db.VarChar(100)
1187:   message_id    BigInt
1188: 
1189:   store_id BigInt
1190:   mode     Mode
1191: 
1192:   consumed_at DateTime @default(now()) @db.Timestamptz(6)
1193:   /// نتيجة مختصرة للتشخيص، مثال: "ok" أو "skipped:duplicate"
1194:   result      String?  @db.VarChar(255)
1195: 
1196:   message OutboxMessage @relation(fields: [message_id], references: [id], onDelete: Cascade)
1197: 
1198:   @@unique([consumer_name, message_id])
1199:   @@index([message_id])
1200:   @@index([store_id, mode])
1201:   @@map("consumed_events")
1202: }
1203: 
1204: // ═══════════════════════════════════════════════════════════════════
1205: // المرحلة 1b.2 — Checkout والنوايا والدفتر
1206: //
1207: // المبادئ اللي الجداول دي مبنية عليها:
1208: //   • المبالغ أعداد صحيحة بالوحدات الصغرى (amount_minor) + عملة.
1209: //   • الطلب بيتولد من **التزام** الـ checkout، مش قبله.
1210: //   • الحالة بتتحرس بجدول انتقالات في الكود، مابتتكتبش فوقها.
1211: //   • كل حركة مالية قيد غير قابل للتعديل في الدفتر؛ الأرصدة تُشتق.
1212: //   • مفيش FK على store لأي سجل مالي: حذف المتجر ماينفعش يمسح
1213: //     سجلات مالية. الـ FK موجود بس على الكيانات المؤقتة (Checkout).
1214: // ═══════════════════════════════════════════════════════════════════
1215: 
1216: enum CheckoutStatus {
1217:   open
1218:   pending_payment
1219:   committed
1220:   expired
1221:   abandoned
1222:   failed
1223: }
1224: 
1225: enum QuoteComponentKind {
1226:   line_subtotal
1227:   shipping
1228:   tax
1229:   discount
1230:   payment_fee
1231:   adjustment
1232: }
1233: 
1234: enum ReservationState {
1235:   held
1236:   converted
1237:   released
1238:   expired
1239: }
1240: 
1241: enum PaymentIntentContextKind {
1242:   checkout
1243:   order_balance
1244:   subscription_cycle
1245:   invoice
1246:   manual
1247: }
1248: 
1249: enum PaymentIntentUsage {
1250:   one_time
1251:   setup
1252:   recurring
1253: }
1254: 
1255: enum PaymentIntentStatus {
1256:   created
1257:   requires_payment_method
1258:   requires_action
1259:   processing
1260:   authorized
1261:   partially_captured
1262:   captured
1263:   partially_refunded
1264:   refunded
1265:   failed
1266:   cancelled
1267:   expired
1268: }
1269: 
1270: enum PaymentAttemptStatus {
1271:   initialized
1272:   requires_action
1273:   processing
1274:   authorized
1275:   succeeded
1276:   failed
1277:   expired
1278:   cancelled
1279: }
1280: 
1281: /// الخطوة اللي العميل لازم يعملها عشان الدفع يكمل.
1282: /// reference_code و bank_instructions هما اللي بيخلّوا فوري والتحويل
1283: /// البنكي يمرّوا بنفس المسار بتاع البوابات الأونلاين.
1284: enum NextActionKind {
1285:   none
1286:   redirect
1287:   iframe
1288:   client_sdk
1289:   reference_code
1290:   bank_instructions
1291:   poll
1292: }
1293: 
1294: enum CaptureStatus {
1295:   pending
1296:   succeeded
1297:   failed
1298: }
1299: 
1300: enum AllocationKind {
1301:   revenue
1302:   platform_fee
1303:   vendor_share
1304: }
1305: 
1306: enum BeneficiaryKind {
1307:   store
1308:   vendor
1309:   platform
1310: }
1311: 
1312: enum LedgerAccountType {
1313:   psp_receivable
1314:   offline_receivable
1315:   cash_collected
1316:   settled_out
1317:   sales_revenue
1318:   refunds_contra
1319:   psp_fee_expense
1320:   platform_fee_expense
1321:   platform_fee_payable
1322:   disputes_held
1323:   chargeback_loss
1324:   fx_conversion
1325:   suspense
1326: }
1327: 
1328: enum PostingDirection {
1329:   debit
1330:   credit
1331: }
1332: 
1333: enum PaymentEventSource {
1334:   api
1335:   webhook
1336:   reconciliation
1337:   return_url
1338:   merchant
1339:   system
1340: }
1341: 
1342: /// سلة مجمّدة + عنوان + سعر، قبل ما تتحوّل لطلب.
1343: ///
1344: /// الـ checkout بياخد token معتّم مش رقم تسلسلي: أرقام الطلبات
1345: /// بتتحجز عند الالتزام بس، فالسلة المهجورة مابتستهلكش رقم.
1346: model Checkout {
1347:   id BigInt @id @default(autoincrement())
1348: 
1349:   store_id BigInt
1350:   store    store  @relation(fields: [store_id], references: [id], onDelete: Cascade)
1351:   mode     Mode
1352: 
1353:   /// المعرّف العلني اللي بيظهر في رابط صفحة الدفع
1354:   token String @unique @db.VarChar(64)
1355: 
1356:   status CheckoutStatus @default(open)
1357: 
1358:   customer_name  String? @db.VarChar(160)
1359:   customer_email String? @db.VarChar(160)
1360:   customer_phone String? @db.VarChar(40)
1361: 
1362:   shipping_address Json?
1363: 
1364:   /// عملة العرض، مجمّدة وقت الإنشاء
1365:   currency String @db.VarChar(3)
1366: 
1367:   /// مجموع كل مكوّنات السعر، بالوحدات الصغرى
1368:   quote_total_minor BigInt @default(0)
1369: 
1370:   /// ختم على السلة والسعر — بيمنع تعديل السلة أثناء الدفع
1371:   quote_hash String? @db.VarChar(64)
1372: 
1373:   /// وسيلة الدفع اللي العميل اختارها
1374:   selected_offering_id BigInt?
1375: 
1376:   expires_at   DateTime  @db.Timestamptz(6)
1377:   committed_at DateTime? @db.Timestamptz(6)
1378: 
1379:   /// الطلب اللي اتولد من الالتزام
1380:   order_id BigInt? @unique
1381: 
1382:   client_ip  String? @db.VarChar(64)
1383:   user_agent String? @db.VarChar(400)
1384: 
1385:   items        CheckoutLineItem[]
1386:   components   QuoteComponent[]
1387:   reservations InventoryReservation[]
1388: 
1389:   created_at DateTime @default(now()) @db.Timestamptz(6)
1390:   updated_at DateTime @updatedAt @db.Timestamptz(6)
1391: 
1392:   @@index([store_id, mode, status])
1393:   @@index([expires_at])
1394:   @@index([store_id, mode, created_at])
1395:   @@map("checkouts")
1396: }
1397: 
1398: /// لقطة من المنتج وقت الإضافة للسلة.
1399: /// المراجع nullable عن قصد: الطلب لازم يفضل مقروء حتى لو المنتج اتحذف.
1400: model CheckoutLineItem {
1401:   id BigInt @id @default(autoincrement())
1402: 
1403:   checkout_id BigInt
1404:   checkout    Checkout @relation(fields: [checkout_id], references: [id], onDelete: Cascade)
1405: 
1406:   product_id BigInt?
1407:   variant_id BigInt?
1408: 
1409:   title         String  @db.VarChar(255)
1410:   variant_title String? @db.VarChar(255)
1411:   image_url     String? @db.VarChar(600)
1412: 
1413:   unit_price_minor BigInt
1414:   quantity         Int
1415: 
1416:   created_at DateTime @default(now()) @db.Timestamptz(6)
1417: 
1418:   @@index([checkout_id])
1419:   @@map("checkout_line_items")
1420: }
1421: 
1422: /// مكوّن من مكوّنات السعر.
1423: ///
1424: /// الشحن والضرايب والخصومات بتتحسب في وحدات منفصلة وبتضيف صفوف هنا،
1425: /// فـ Checkout مش محتاج يعرف حاجة عنهم.
1426: /// ثابت: quote_total_minor = مجموع amount_minor لكل المكوّنات.
1427: model QuoteComponent {
1428:   id BigInt @id @default(autoincrement())
1429: 
1430:   checkout_id BigInt
1431:   checkout    Checkout @relation(fields: [checkout_id], references: [id], onDelete: Cascade)
1432: 
1433:   kind  QuoteComponentKind
1434:   label String             @db.VarChar(160)
1435: 
1436:   /// ممكن يكون سالب (خصم)
1437:   amount_minor BigInt
1438: 
1439:   /// الوحدة اللي حسبت المكوّن ده
1440:   source_ref String? @db.VarChar(120)
1441: 
1442:   position Int @default(0)
1443: 
1444:   @@index([checkout_id])
1445:   @@map("quote_components")
1446: }
1447: 
1448: /// حجز مخزون مؤقت أثناء الدفع.
1449: ///
1450: /// بيتحوّل لسطر طلب عند الالتزام، وبيترجع عند الانتهاء أو الفشل.
1451: model InventoryReservation {
1452:   id BigInt @id @default(autoincrement())
1453: 
1454:   checkout_id BigInt
1455:   checkout    Checkout @relation(fields: [checkout_id], references: [id], onDelete: Cascade)
1456: 
1457:   store_id   BigInt
1458:   mode       Mode
1459:   variant_id BigInt
1460:   quantity   Int
1461: 
1462:   state ReservationState @default(held)
1463: 
1464:   expires_at DateTime  @db.Timestamptz(6)
1465:   settled_at DateTime? @db.Timestamptz(6)
1466: 
1467:   created_at DateTime @default(now()) @db.Timestamptz(6)
1468: 
1469:   @@unique([checkout_id, variant_id])
1470:   @@index([state, expires_at])
1471:   @@index([store_id, mode, variant_id])
1472:   @@map("inventory_reservations")
1473: }
1474: 
1475: /// جذر عملية الدفع.
1476: ///
1477: /// بيفضل موجود عبر المحاولات الفاشلة: العميل اللي بطاقته اترفضت وجرّب
1478: /// تانية بيبقى عنده نية واحدة ومحاولتين، مش عمليتين منفصلتين.
1479: ///
1480: /// context_kind بيفك الارتباط بالـ checkout عشان الاشتراكات والفواتير
1481: /// في المراحل الجاية تقدر تعمل نوايا من غير سلة.
1482: model PaymentIntent {
1483:   id BigInt @id @default(autoincrement())
1484: 
1485:   store_id BigInt
1486:   mode     Mode
1487: 
1488:   context_kind PaymentIntentContextKind @default(checkout)
1489:   context_id   String                   @db.VarChar(64)
1490: 
1491:   amount_minor BigInt
1492:   currency     String @db.VarChar(3)
1493: 
1494:   capture_method CaptureMode        @default(automatic)
1495:   usage          PaymentIntentUsage @default(one_time)
1496: 
1497:   /// وضع الدفع وقت إنشاء النية.
1498:   ///
1499:   /// ⚠️ لقطة مقصودة. الاسترداد لازم يتربط بالمسار اللي عالج الدفعة
1500:   /// أصلاً، مش بالوضع النشط على المتجر وقت طلب الاسترداد. من غير
1501:   /// العمود ده، تحويل المتجر لوضع تاني بيخلي الاستردادات القديمة
1502:   /// تتحسب غلط بأثر رجعي.
1503:   payment_mode StorePaymentMode @default(MERCHANT_GATEWAY)
1504: 
1505:   status PaymentIntentStatus @default(created)
1506: 
1507:   /// نسخ مخزّنة من حقيقة الدفتر — بيتأكد منها فاحص الثوابت
1508:   authorized_total_minor BigInt @default(0)
1509:   captured_total_minor   BigInt @default(0)
1510:   refunded_total_minor   BigInt @default(0)
1511: 
1512:   /// تحكّم تفاؤلي في التزامن
1513:   version Int @default(0)
1514: 
1515:   /// مفتاح العميل — فريد لكل متجر ووضع
1516:   idempotency_key String? @db.VarChar(255)
1517: 
1518:   account_id  BigInt?
1519:   offering_id BigInt?
1520: 
1521:   expires_at  DateTime? @db.Timestamptz(6)
1522:   terminal_at DateTime? @db.Timestamptz(6)
1523: 
1524:   metadata Json?
1525: 
1526:   attempts PaymentAttempt[]
1527:   captures Capture[]
1528:   refunds  Refund[]
1529:   events   PaymentEvent[]
1530: 
1531:   created_at DateTime @default(now()) @db.Timestamptz(6)
1532:   updated_at DateTime @updatedAt @db.Timestamptz(6)
1533: 
1534:   @@unique([store_id, mode, idempotency_key])
1535:   @@index([store_id, mode, status])
1536:   @@index([context_kind, context_id])
1537:   @@index([status, expires_at])
1538:   @@index([store_id, mode, created_at])
1539:   @@map("payment_intents")
1540: }
1541: 
1542: /// محاولة واحدة على حساب بوابة واحد.
1543: ///
1544: /// بتحمل حقائق التفويض بنفسها — مفيش كيان Authorization منفصل، لأن
1545: /// مفيش بوابة بتدي أكتر من تفويض للمحاولة الواحدة.
1546: model PaymentAttempt {
1547:   id BigInt @id @default(autoincrement())
1548: 
1549:   intent_id BigInt
1550:   intent    PaymentIntent @relation(fields: [intent_id], references: [id], onDelete: Cascade)
1551: 
1552:   store_id BigInt
1553:   mode     Mode
1554: 
1555:   /// ترتيب المحاولة داخل النية
1556:   sequence Int
1557: 
1558:   account_id  BigInt?
1559:   offering_id BigInt?
1560: 
1561:   status PaymentAttemptStatus @default(initialized)
1562: 
1563:   authorized_amount_minor   BigInt?
1564:   authorization_expires_at  DateTime? @db.Timestamptz(6)
1565: 
1566:   /// معرّفات البوابة — التفرّد على مستوى الحساب مش البوابة، عشان
1567:   /// متجرين بنفس حساب البوابة مايتعارضوش
1568:   gateway_reference  String? @db.VarChar(255)

(Output capped at 50 KB. Showing lines 1-1568. Use offset=1569 to continue.)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-scoped-models.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-scoped-models.ts</path>
<type>file</type>
<content>
1: /**
2:  * سجل الموديلات المشمولة بحارس العزل.
3:  *
4:  * التسجيل صريح عن قصد: الحارس مابيفحصش أي موديل مش مكتوب هنا، فمفيش
5:  * أي تأثير على أي كود موجود في المشروع.
6:  *
7:  * كل موديل فيه store_id لازم يتسجّل هنا. الموديل الغايب مش بيتفحص
8:  * أصلاً — الحارس بيعدّي عليه من غير ما يقول حاجة، وده أسوأ من غياب
9:  * الحارس لأنه بيدّي إحساس زائف بالأمان.
10:  *
11:  * ⚠️ لما تضيف جدول فيه store_id، ضيفه هنا. في اختبار بيقارن السجل ده
12:  * بالـ schema وبيفشل لو في موديل ناقص.
13:  */
14: export interface TenantScopedModel {
15:   /** اسم الموديل زي ما هو في Prisma (مش اسم الجدول) */
16:   readonly model: string
17:   readonly storeField: string
18:   /** null لو الموديل مالوش وضع test/live */
19:   readonly modeField: string | null
20:   /**
21:    * اسم العلاقة اللي بتوصّل للمتجر، لو موجودة.
22:    *
23:    * Prisma بيقبل الشكلين:
24:    *   where: { store_id: 5n }        ← scalar
25:    *   where: { store: { id: 5n } }   ← relation
26:    *
27:    * الاتنين نطاق صحيح تماماً. الحارس كان بيعرف الأول بس، فكان بيبلّغ
28:    * عن استعلام سليم — وحارس بيصرخ على كود صح بيتعلّم الناس يتجاهلوه.
29:    *
30:    * الافتراضي 'store'.
31:    */
32:   readonly storeRelation?: string
33: }
34: 
35: export const TENANT_SCOPED_MODELS: readonly TenantScopedModel[] = [
36:   // ── البنية التحتية (المرحلة 1a) ────────────────────────────────
37:   { model: 'PaymentIdempotencyRecord', storeField: 'store_id', modeField: 'mode' },
38:   { model: 'OutboxMessage', storeField: 'store_id', modeField: 'mode' },
39:   { model: 'ConsumedEvent', storeField: 'store_id', modeField: 'mode' },
40: 
41:   // ── إعدادات الدفع (المرحلة 1b.1) ───────────────────────────────
42:   { model: 'PaymentAccount', storeField: 'store_id', modeField: 'mode' },
43:   { model: 'PaymentMethodOffering', storeField: 'store_id', modeField: 'mode' },
44: 
45:   // ── الـ checkout (المرحلة 1b.2) ────────────────────────────────
46:   { model: 'Checkout', storeField: 'store_id', modeField: 'mode' },
47:   { model: 'InventoryReservation', storeField: 'store_id', modeField: 'mode' },
48: 
49:   // ── الدفع (المرحلة 1b.2) ───────────────────────────────────────
50:   { model: 'PaymentIntent', storeField: 'store_id', modeField: 'mode' },
51:   { model: 'PaymentAttempt', storeField: 'store_id', modeField: 'mode' },
52:   { model: 'Capture', storeField: 'store_id', modeField: 'mode' },
53:   { model: 'CaptureAllocation', storeField: 'store_id', modeField: 'mode' },
54:   { model: 'PaymentEvent', storeField: 'store_id', modeField: 'mode' },
55: 
56:   // ── الاسترداد ──────────────────────────────────────────────────
57:   { model: 'Refund', storeField: 'store_id', modeField: 'mode' },
58:   { model: 'RefundAllocation', storeField: 'store_id', modeField: 'mode' },
59: 
60:   // ── الدفتر ─────────────────────────────────────────────────────
61:   { model: 'Beneficiary', storeField: 'store_id', modeField: 'mode' },
62:   { model: 'LedgerAccount', storeField: 'store_id', modeField: 'mode' },
63:   { model: 'JournalEntry', storeField: 'store_id', modeField: 'mode' },
64: 
65:   // ── بيانات المتجر الأصلية ──────────────────────────────────────
66:   //
67:   // الجداول دي أقدم من فكرة الـ mode، فمالهاش عمود mode. كلها بيانات
68:   // مملوكة لمتجر واحد: استعلام من غير store_id عليها بيرجّع كتالوج أو
69:   // طلبات تاجر تاني.
70:   //
71:   // ⚠️ التسجيل هنا **مابيغيّرش أي سلوك حالي**. الحارس بيشتغل بس على
72:   // الاستعلامات اللي بتعدّي على guarded()، ومفيش خدمة من دول بتستخدمها
73:   // لسه. التسجيل بيخلي السجل صادق، ولما الخدمات دي تتحوّل بعدين يبقى
74:   // الحارس شايفها من أول يوم.
75:   { model: 'Product', storeField: 'store_id', modeField: null },
76:   { model: 'ProductType', storeField: 'store_id', modeField: null },
77:   { model: 'Tag', storeField: 'store_id', modeField: null },
78:   { model: 'Order', storeField: 'store_id', modeField: null },
79:   { model: 'Upload', storeField: 'store_id', modeField: null },
80:   { model: 'StoreTheme', storeField: 'store_id', modeField: null },
81:   { model: 'StoreThemePublished', storeField: 'store_id', modeField: null },
82:   { model: 'ThemeSection', storeField: 'store_id', modeField: null },
83:   { model: 'StorePage', storeField: 'store_id', modeField: null },
84:   { model: 'StoreMenu', storeField: 'store_id', modeField: null },
85: ]
86: 
87: /**
88:  * موديلات فيها store_id لكن **مش** مشمولة بالحارس، وليه.
89:  *
90:  * موجودة كتوثيق صريح: الفرق بين "اتنسي" و"اتقرر" لازم يكون مكتوب.
91:  */
92: export const DELIBERATELY_UNSCOPED: readonly { model: string; reason: string }[] = [
93:   {
94:     model: 'CheckoutLineItem',
95:     reason: 'مالوش store_id — مربوط بالـ checkout اللي بيملكه',
96:   },
97:   {
98:     model: 'QuoteComponent',
99:     reason: 'مالوش store_id — مربوط بالـ checkout اللي بيملكه',
100:   },
101:   {
102:     model: 'LedgerPosting',
103:     reason: 'مالوش store_id — مربوط بالقيد اللي بيملكه',
104:   },
105: ]
106: 
107: const BY_MODEL: ReadonlyMap<string, TenantScopedModel> = new Map(
108:   TENANT_SCOPED_MODELS.map((entry) => [entry.model, entry]),
109: )
110: 
111: export function getTenantScopedModel(model: string | undefined): TenantScopedModel | undefined {
112:   if (!model) return undefined
113:   return BY_MODEL.get(model)
114: }
115: 
116: /** عمليات القراءة — بتتفحص الـ where */
117: export const READ_OPERATIONS = new Set([
118:   'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
119:   'findMany', 'count', 'aggregate', 'groupBy',
120: ])
121: 
122: /** عمليات التعديل والحذف — بتتفحص الـ where كمان */
123: export const WRITE_WITH_WHERE_OPERATIONS = new Set([
124:   'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
125: ])
126: 
127: /** عمليات الإنشاء — بتتفحص الـ data */
128: export const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn'])

(End of file - total 128 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts</path>
<type>file</type>
<content>
1: import { Logger } from '@nestjs/common'
2: import { Prisma } from '@prisma/client/extension'
3: import { inspectScope } from './tenant-scope.inspector'
4: import { currentCrossStoreReason, isCrossStoreQuery } from './cross-store-query'
5: import { currentCrossModeReason, isCrossModeQuery } from './cross-mode-query'
6: import type { TenantContextService } from './tenant-context.service'
7: 
8: /**
9:  * ══════════════════════════════════════════════════════════════════
10:  * حارس عزل المستأجرين — تبليغ فقط
11:  * ══════════════════════════════════════════════════════════════════
12:  *
13:  * بيفحص الاستعلامات على الموديلات المسجّلة في tenant-scoped-models،
14:  * وبيسجّل تحذير لو الاستعلام مش مقيّد بـ store_id و mode.
15:  *
16:  * ثلاث ضمانات صريحة:
17:  *   ❌ مابيعدّلش args — الاستعلام بيتنفّذ زي ما المطوّر كتبه بالظبط.
18:  *   ❌ مابيضيفش شروط ولا بيعيد كتابة أي حاجة.
19:  *   ❌ مابيمنعش ولا بيرمي — الفشل في الفحص مايوقفش الطلب.
20:  *
21:  * ✅ بيسجّل تحذير بس.
22:  *
23:  * السبب: إعادة الكتابة التلقائية بتخلي نتيجة الاستعلام تختلف عن اللي
24:  * مكتوب في الكود، وده أسوأ من غياب الحارس أصلاً — المطوّر بيثق في
25:  * كود مش بيعمل اللي مكتوب فيه.
26:  *
27:  * ⚠️ الفحص نفسه ملفوف في try/catch: أي خطأ جواه (شكل args غير متوقع
28:  * مثلاً) لازم مايأثرش على الاستعلام. حارس تبليغ ماينفعش يكسر إنتاج.
29:  *
30:  * المرحلة 3 هتحوّل ده لمنع فعلي مع RLS على مستوى Postgres.
31:  */
32: 
33: export interface TenantGuardOptions {
34:   /** لو false الـ extension بيعدّي على طول من غير أي فحص */
35:   readonly enabled: boolean
36:   readonly tenantContext: TenantContextService
37:   readonly logger?: Logger
38:   /**
39:    * يرمي بدل ما يسجّل.
40:    *
41:    * ⚠️ للاختبارات بس. في الإنتاج تبليغ فقط، عشان استعلام ناقص نطاق
42:    * يبقى تحذير مش صفحة خطأ للتاجر. في الاختبار العكس هو الصح: مطلوب
43:    * يفشل عشان مايوصلش للإنتاج أصلاً.
44:    */
45:   readonly throwOnViolation?: boolean
46: }
47: 
48: /** بيتترمي لما throwOnViolation شغّال. */
49: export class TenantScopeViolationError extends Error {
50:   constructor(message: string) {
51:     super(message)
52:     this.name = 'TenantScopeViolationError'
53:     Object.setPrototypeOf(this, TenantScopeViolationError.prototype)
54:   }
55: }
56: 
57: /**
58:  * The extension definition, before Prisma wraps it.
59:  *
60:  * Exported separately because Prisma.defineExtension returns an opaque
61:  * wrapper, which leaves the handler unreachable from a unit test. The
62:  * suppression logic below is exactly the kind of thing that has to be
63:  * proven rather than assumed, so it needs a seam.
64:  */
65: export function buildTenantGuardDefinition(options: TenantGuardOptions) {
66:   const logger = options.logger ?? new Logger('TenantGuard')
67: 
68:   return {
69:     name: 'tenant-guard',
70:     query: {
71:       $allOperations({ model, operation, args, query }: any) {
72:         if (!options.enabled) {
73:           return query(args)
74:         }
75: 
76:         // استعلام معلَن إنه عابر للمتاجر — بيعدّي من غير فحص، والسبب
77:         // متسجّل في الكود عند نقطة الاستدعاء.
78:         if (isCrossStoreQuery()) {
79:           logger.debug(
80:             `[tenant-scope] عبور متاجر مسموح: ${model ?? 'unknown'}.${operation}` +
81:               ` — ${currentCrossStoreReason()}`,
82:           )
83:           return query(args)
84:         }
85: 
86:         try {
87:           const rawViolations = inspectScope({
88:             model,
89:             operation,
90:             args,
91:             contextStoreId: options.tenantContext.getStoreId(),
92:           })
93: 
94:           // crossModeQuery suppresses ONLY the mode-scope finding. Store
95:           // scope — missing_store_scope, store_scope_mismatch — is never
96:           // filtered here, by construction: this is a post-filter on the
97:           // mode kind alone, not a second bypass path. A query that is
98:           // both cross-store and mode-agnostic must still declare
99:           // crossStoreQuery to pass; crossModeQuery cannot substitute
100:           // for it.
101:           const violations = isCrossModeQuery()
102:             ? rawViolations.filter((v) => v.kind !== 'missing_mode_scope')
103:             : rawViolations
104: 
105:           if (isCrossModeQuery() && violations.length < rawViolations.length) {
106:             logger.debug(
107:               `[tenant-scope] وضع عابر مسموح: ${model ?? 'unknown'}.${operation}` +
108:                 ` — ${currentCrossModeReason()}`,
109:             )
110:           }
111: 
112:           if (violations.length > 0) {
113:             const requestId = options.tenantContext.getRequestId()
114: 
115:             if (options.throwOnViolation) {
116:               throw new TenantScopeViolationError(
117:                 `[tenant-scope] ` +
118:                   violations
119:                     .map(
120:                       (violation) =>
121:                         `${violation.model}.${violation.operation} — ` +
122:                         `${violation.kind}: ${violation.detail}`,
123:                     )
124:                     .join('; ') +
125:                   (requestId ? ` (request ${requestId})` : ''),
126:               )
127:             }
128: 
129:             for (const violation of violations) {
130:               logger.warn(
131:                 `[tenant-scope] ${violation.model}.${violation.operation} — ` +
132:                   `${violation.kind}: ${violation.detail}` +
133:                   (requestId ? ` (request ${requestId})` : ''),
134:               )
135:             }
136:           }
137:         } catch (error) {
138:           // المخالفة المتعمّدة بتعدّي — دي مش فشل في الفحص.
139:           if (error instanceof TenantScopeViolationError) throw error
140: 
141:           // الفحص فشل — بنسجّل ونكمّل. الاستعلام أهم من الحارس.
142:           logger.error(
143:             `[tenant-scope] فشل الفحص لـ ${model ?? 'unknown'}.${operation}: ` +
144:               `${(error as Error).message}`,
145:           )
146:         }
147: 
148:         // args متمرّرة زي ما هي بالظبط، من غير أي تعديل
149:         return query(args)
150:       },
151:     },
152:   }
153: }
154: 
155: export function createTenantGuardExtension(options: TenantGuardOptions) {
156:   return Prisma.defineExtension(buildTenantGuardDefinition(options) as never)
157: }

(End of file - total 157 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-context.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-context.service.ts</path>
<type>file</type>
<content>
1: import { Injectable } from '@nestjs/common'
2: import { AsyncLocalStorage } from 'async_hooks'
3: import type { Mode } from '../money/money.types'
4: 
5: /**
6:  * سياق المستأجر للطلب الحالي.
7:  *
8:  * ⚠️ متاح جزئياً في المرحلة 1a. الميدلوير بيملأ اللي يقدر عليه من
9:  * الطلب، لكن حل المتجر النشط بيحصل في الـ Guards بعد الميدلوير، فمعظم
10:  * الطلبات هيبقى فيها storeId = null.
11:  *
12:  * ده مقبول لأن الاستخدام الوحيد في 1a هو التبليغ. الحل الكامل بييجي
13:  * في المرحلة 1b مع ActiveStoreGuard.
14:  */
15: export interface TenantContext {
16:   storeId: string | null
17:   mode: Mode
18:   actor: string | null
19:   requestId: string | null
20: }
21: 
22: @Injectable()
23: export class TenantContextService {
24:   private readonly storage = new AsyncLocalStorage<TenantContext>()
25: 
26:   /** يشغّل دالة جوه سياق مستأجر */
27:   run<T>(context: TenantContext, callback: () => T): T {
28:     return this.storage.run(context, callback)
29:   }
30: 
31:   /** السياق الحالي، أو undefined لو إحنا برّه أي طلب (مهمة مجدولة مثلاً) */
32:   get(): TenantContext | undefined {
33:     return this.storage.getStore()
34:   }
35: 
36:   getStoreId(): string | null {
37:     return this.storage.getStore()?.storeId ?? null
38:   }
39: 
40:   /** الوضع الحالي، والافتراضي live لو مفيش سياق */
41:   getMode(): Mode {
42:     return this.storage.getStore()?.mode ?? 'live'
43:   }
44: 
45:   getRequestId(): string | null {
46:     return this.storage.getStore()?.requestId ?? null
47:   }
48: 
49:   /**
50:    * يحدّث معرّف المتجر بعد ما الـ Guard يحلّه.
51:    *
52:    * الميدلوير بيشتغل قبل الـ Guards، فالمتجر مش معروف وقت فتح السياق.
53:    * التعديل هنا بيغيّر نفس الكائن اللي جوه AsyncLocalStorage، وده آمن
54:    * لأنه محصور في الطلب الحالي.
55:    */
56:   setStoreId(storeId: string | null): void {
57:     const context = this.storage.getStore()
58:     if (context) context.storeId = storeId
59:   }
60: 
61:   setMode(mode: Mode): void {
62:     const context = this.storage.getStore()
63:     if (context) context.mode = mode
64:   }
65: }

(End of file - total 65 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.ts</path>
<type>file</type>
<content>
1: import {
2:   CREATE_OPERATIONS,
3:   READ_OPERATIONS,
4:   WRITE_WITH_WHERE_OPERATIONS,
5:   getTenantScopedModel,
6: } from './tenant-scoped-models'
7: 
8: /**
9:  * ══════════════════════════════════════════════════════════════════
10:  * فحص نطاق المستأجر — منطق خالص
11:  * ══════════════════════════════════════════════════════════════════
12:  *
13:  * منفصل عن الـ extension عن قصد: كده المنطق بيتغطّى باختبارات وحدة
14:  * من غير قاعدة بيانات ومن غير عميل Prisma مولّد.
15:  *
16:  * ⚠️ الفحص **بيبلّغ بس**. مابيعدّلش الاستعلام، ومابيضيفش شروط، ومابيمنعش
17:  * أي عملية — عشان مايبقاش في سلوك خفي بيغيّر نتايج الاستعلامات من ورا
18:  * المطوّر.
19:  */
20: 
21: export type ScopeViolationKind =
22:   /** استعلام على موديل مشمول من غير store_id في الـ where */
23:   | 'missing_store_scope'
24:   | 'missing_mode_scope'
25:   | 'missing_store_value'
26:   | 'missing_mode_value'
27:   /** الاستعلام بيستهدف متجر غير المتجر اللي في سياق الطلب */
28:   | 'store_scope_mismatch'
29: 
30: export interface ScopeViolation {
31:   readonly kind: ScopeViolationKind
32:   readonly model: string
33:   readonly operation: string
34:   readonly detail: string
35: }
36: 
37: export interface InspectionInput {
38:   readonly model: string | undefined
39:   readonly operation: string
40:   readonly args: unknown
41:   /** معرّف المتجر من سياق الطلب، لو موجود */
42:   readonly contextStoreId?: string | null
43: }
44: 
45: function isRecord(value: unknown): value is Record<string, unknown> {
46:   return typeof value === 'object' && value !== null && !Array.isArray(value)
47: }
48: 
49: /**
50:  * هل الحقل مقيّد في الـ where؟
51:  *
52:  * بيدوّر جوه AND كمان، لأن الشكل ده شائع:
53:  *   where: { AND: [{ store_id: 1n }, { status: 'pending' }] }
54:  *
55:  * OR مابيتحسبش عن قصد: شرط جوه OR ممكن يتحقق من غير ما الحقل يتقيّد،
56:  * فوجوده هناك مش ضمانة عزل.
57:  */
58: function fieldConstrained(
59:   where: unknown,
60:   field: string,
61:   relation?: string,
62: ): boolean {
63:   if (!isRecord(where)) return false
64:   if (Object.prototype.hasOwnProperty.call(where, field)) return true
65: 
66:   // الشكل العلائقي: where: { store: { id: 5n } }
67:   //
68:   // نطاق صحيح زي الـ scalar بالظبط. بنقبله لما العلاقة بتقيّد المفتاح
69:   // الأساسي أو المفتاح الأجنبي — مش مجرد وجود العلاقة، عشان
70:   // { store: { name: 'x' } } مايعدّيش كأنه نطاق.
71:   if (relation && isRecord(where[relation])) {
72:     const nested = where[relation] as Record<string, unknown>
73:     if (
74:       Object.prototype.hasOwnProperty.call(nested, 'id') ||
75:       Object.prototype.hasOwnProperty.call(nested, field)
76:     ) {
77:       return true
78:     }
79:   }
80: 
81:   const and = where.AND
82:   if (Array.isArray(and)) {
83:     return and.some((clause) => fieldConstrained(clause, field, relation))
84:   }
85:   if (isRecord(and)) return fieldConstrained(and, field, relation)
86: 
87:   return false
88: }
89: 
90: /** يستخرج قيمة الحقل لو كانت قيمة مباشرة أو بشكل { equals } */
91: /** بيطلّع قيمة المتجر من الشكل العلائقي: { store: { id: 5n } } */
92: function extractRelationScalar(
93:   where: unknown,
94:   relation: string,
95:   field: string,
96: ): unknown {
97:   if (!isRecord(where)) return undefined
98: 
99:   const nested = where[relation]
100:   if (isRecord(nested)) {
101:     const value = nested.id ?? nested[field]
102:     if (value !== undefined) {
103:       if (isRecord(value) && 'equals' in value) return value.equals
104:       return value
105:     }
106:   }
107: 
108:   const and = where.AND
109:   if (Array.isArray(and)) {
110:     for (const clause of and) {
111:       const found = extractRelationScalar(clause, relation, field)
112:       if (found !== undefined) return found
113:     }
114:   }
115: 
116:   return undefined
117: }
118: 
119: function extractScalar(where: unknown, field: string): unknown {
120:   if (!isRecord(where)) return undefined
121:   const direct = where[field]
122:   if (direct !== undefined) {
123:     if (isRecord(direct) && 'equals' in direct) return direct.equals
124:     return direct
125:   }
126:   const and = where.AND
127:   if (Array.isArray(and)) {
128:     for (const clause of and) {
129:       const found = extractScalar(clause, field)
130:       if (found !== undefined) return found
131:     }
132:   }
133:   return undefined
134: }
135: 
136: /** بيرجّع صفوف الـ data سواء كانت صف واحد أو مجموعة */
137: function payloadsOf(args: unknown): unknown[] {
138:   if (!isRecord(args)) return []
139:   const data = args.data
140:   if (Array.isArray(data)) return data
141:   if (isRecord(data)) return [data]
142:   return []
143: }
144: 
145: export function inspectScope(input: InspectionInput): ScopeViolation[] {
146:   const scoped = getTenantScopedModel(input.model)
147:   if (!scoped) return [] // موديل مش مسجّل → مفيش أي فحص
148: 
149:   const model = scoped.model
150:   const { operation, args, contextStoreId } = input
151:   const violations: ScopeViolation[] = []
152: 
153:   const check = (kind: ScopeViolationKind, detail: string) =>
154:     violations.push({ kind, model, operation, detail })
155: 
156:   if (CREATE_OPERATIONS.has(operation)) {
157:     for (const payload of payloadsOf(args)) {
158:       if (!isRecord(payload)) continue
159:       if (payload[scoped.storeField] === undefined) {
160:         check('missing_store_value', `data.${scoped.storeField} غير موجود`)
161:       }
162:       if (scoped.modeField && payload[scoped.modeField] === undefined) {
163:         check('missing_mode_value', `data.${scoped.modeField} غير موجود`)
164:       }
165:     }
166:     return violations
167:   }
168: 
169:   if (READ_OPERATIONS.has(operation) || WRITE_WITH_WHERE_OPERATIONS.has(operation)) {
170:     const where = isRecord(args) ? args.where : undefined
171: 
172:     if (
173:       !fieldConstrained(where, scoped.storeField, scoped.storeRelation ?? 'store')
174:     ) {
175:       check('missing_store_scope', `where.${scoped.storeField} غير موجود`)
176:     } else if (contextStoreId != null) {
177:       const value =
178:         extractScalar(where, scoped.storeField) ??
179:         extractRelationScalar(where, scoped.storeRelation ?? 'store', scoped.storeField)
180:       if (value !== undefined && String(value) !== String(contextStoreId)) {
181:         check(
182:           'store_scope_mismatch',
183:           `where.${scoped.storeField}=${String(value)} بينما سياق الطلب ${contextStoreId}`,
184:         )
185:       }
186:     }
187: 
188:     if (scoped.modeField && !fieldConstrained(where, scoped.modeField)) {
189:       check('missing_mode_scope', `where.${scoped.modeField} غير موجود`)
190:     }
191: 
192:     if (operation === 'upsert') {
193:       for (const key of ['create', 'update'] as const) {
194:         const payload = isRecord(args) ? args[key] : undefined
195:         if (!isRecord(payload)) continue
196:         if (key === 'create' && payload[scoped.storeField] === undefined) {
197:           check('missing_store_value', `${key}.${scoped.storeField} غير موجود`)
198:         }
199:       }
200:     }
201:   }
202: 
203:   return violations
204: }

(End of file - total 204 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts</path>
<type>file</type>
<content>
1: import { Injectable, NestMiddleware } from '@nestjs/common'
2: import { randomUUID } from 'crypto'
3: import type { NextFunction, Request, Response } from 'express'
4: import { TenantContextService } from './tenant-context.service'
5: 
6: /**
7:  * بيفتح سياق المستأجر لكل طلب.
8:  *
9:  * ⚠️ الميدلوير ده **مابيرفضش أي طلب ومابيوقفش أي حاجة**. بيفتح السياق
10:  * وبيكمّل. أي منطق تفويض بيفضل في الـ Guards الموجودة زي ما هو.
11:  *
12:  * الوضع الافتراضي live: المرحلة 1a مافيهاش حل للوضع، وأي كتابة على
13:  * جداول 1a بتاخد الوضع كمعامل صريح من المستدعي. الافتراضي هنا للتبليغ بس.
14:  */
15: @Injectable()
16: export class TenantContextMiddleware implements NestMiddleware {
17:   constructor(private readonly tenantContext: TenantContextService) {}
18: 
19:   use(request: Request, response: Response, next: NextFunction): void {
20:     const requestId =
21:       (request.headers['x-request-id'] as string | undefined) ?? randomUUID()
22: 
23:     response.setHeader('x-request-id', requestId)
24: 
25:     this.tenantContext.run(
26:       {
27:         storeId: null, // بيتملّى في الـ Guard في المرحلة 1b
28:         mode: 'live',
29:         actor: null,
30:         requestId,
31:       },
32:       () => next(),
33:     )
34:   }
35: }

(End of file - total 35 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant.module.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant.module.ts</path>
<type>file</type>
<content>
1: import { Global, Module } from '@nestjs/common'
2: import { TenantContextService } from './tenant-context.service'
3: import { TenantContextMiddleware } from './tenant-context.middleware'
4: 
5: /**
6:  * سياق المستأجر.
7:  *
8:  * @Global عشان PrismaService (في موديول عام) محتاج يحقن
9:  * TenantContextService من غير ما يحصل اعتماد دائري بين الموديولين.
10:  *
11:  * الميدلوير بيتسجّل في main.ts، والـ extension بيتركّب في PrismaService.
12:  */
13: @Global()
14: @Module({
15:   providers: [TenantContextService, TenantContextMiddleware],
16:   exports: [TenantContextService, TenantContextMiddleware],
17: })
18: export class TenantModule {}

(End of file - total 18 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 2.2s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/prisma"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/prisma</path>
<type>directory</type>
<entries>
prisma.module.ts
prisma.service.spec.ts
prisma.service.ts

(3 entries)
</entries>
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "**/*.ts",
  "path": "/workspaces/testapp/backend/src/common/tenant"
}
```

**Output:**
```
/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts
/workspaces/testapp/backend/src/common/tenant/registry-completeness.spec.ts
/workspaces/testapp/backend/src/common/tenant/tenant-context.service.ts
/workspaces/testapp/backend/src/common/tenant/cross-store-query.spec.ts
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts
/workspaces/testapp/backend/src/common/tenant/tenant.module.ts
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts
/workspaces/testapp/backend/src/common/tenant/cross-mode-query.spec.ts
/workspaces/testapp/backend/src/common/tenant/tenant-scoped-models.ts
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts
/workspaces/testapp/backend/src/common/tenant/cross-mode-query.ts
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.ts
/workspaces/testapp/backend/src/common/tenant/cross-store-query.ts
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/package.json"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/package.json</path>
<type>file</type>
<content>
1: {
2:   "name": "backend-nestjs",
3:   "version": "0.0.1",
4:   "description": "",
5:   "author": "",
6:   "private": true,
7:   "license": "UNLICENSED",
8:   "scripts": {
9:     "build": "nest build",
10:     "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
11:     "start": "nest start",
12:     "start:dev": "nest start --watch",
13:     "start:debug": "nest start --debug --watch",
14:     "start:prod": "node dist/main",
15:     "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
16:     "test": "jest",
17:     "test:watch": "jest --watch",
18:     "test:cov": "jest --coverage",
19:     "test:debug": "node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/.bin/jest --runInBand",
20:     "test:integration": "jest --config ./test/jest-integration.json --runInBand",
21:     "test:e2e": "jest --config ./test/jest-e2e.json"
22:   },
23:   "dependencies": {
24:     "@aws-sdk/client-s3": "^3.1083.0",
25:     "@aws-sdk/s3-request-presigner": "^3.1083.0",
26:     "@nestjs/common": "^11.0.1",
27:     "@nestjs/config": "^4.0.2",
28:     "@nestjs/core": "^11.0.1",
29:     "@nestjs/event-emitter": "^3.1.0",
30:     "@nestjs/jwt": "^11.0.2",
31:     "@nestjs/passport": "^11.0.5",
32:     "@nestjs/platform-express": "^11.0.1",
33:     "@nestjs/platform-socket.io": "^11.1.21",
34:     "@nestjs/schedule": "^6.1.3",
35:     "@nestjs/throttler": "^6.5.0",
36:     "@nestjs/websockets": "^11.1.21",
37:     "@otplib/preset-default": "^12.0.1",
38:     "@prisma/client": "^6.19.3",
39:     "axios": "^1.16.1",
40:     "bcrypt": "^6.0.0",
41:     "class-transformer": "^0.5.1",
42:     "class-validator": "^0.15.1",
43:     "cookie-parser": "^1.4.7",
44:     "express-useragent": "^2.1.0",
45:     "jsonwebtoken": "^9.0.3",
46:     "ms": "^2.1.3",
47:     "multer": "^2.2.0",
48:     "passport": "^0.7.0",
49:     "passport-facebook": "^3.0.0",
50:     "passport-github2": "^0.1.12",
51:     "passport-google-oauth20": "^2.0.0",
52:     "passport-jwt": "^4.0.1",
53:     "passport-microsoft": "^2.1.0",
54:     "qrcode": "^1.5.4",
55:     "reflect-metadata": "^0.2.2",
56:     "rxjs": "^7.8.1",
57:     "socket.io": "^4.8.3",
58:     "stripe": "^22.3.2",
59:     "ua-parser-js": "^2.0.9"
60:   },
61:   "devDependencies": {
62:     "@eslint/eslintrc": "^3.2.0",
63:     "@eslint/js": "^9.18.0",
64:     "@nestjs/cli": "^11.0.0",
65:     "@nestjs/schematics": "^11.0.0",
66:     "@nestjs/testing": "^11.0.1",
67:     "@testcontainers/postgresql": "^10.28.0",
68:     "@types/bcrypt": "^6.0.0",
69:     "@types/cookie-parser": "^1.4.10",
70:     "@types/express": "^5.0.0",
71:     "@types/express-useragent": "^1.0.5",
72:     "@types/jest": "^30.0.0",
73:     "@types/ms": "^2.1.0",
74:     "@types/multer": "^2.2.0",
75:     "@types/node": "^24.0.0",
76:     "@types/passport-facebook": "^3.0.4",
77:     "@types/passport-github2": "^1.2.9",
78:     "@types/passport-google-oauth20": "^2.0.17",
79:     "@types/passport-jwt": "^4.0.1",
80:     "@types/qrcode": "^1.5.6",
81:     "@types/supertest": "^7.0.0",
82:     "@types/ua-parser-js": "^0.7.39",
83:     "eslint": "^9.18.0",
84:     "eslint-config-prettier": "^10.0.1",
85:     "eslint-plugin-prettier": "^5.2.2",
86:     "fast-check": "^3.23.1",
87:     "globals": "^17.0.0",
88:     "jest": "^30.0.0",
89:     "prettier": "^3.4.2",
90:     "prisma": "^6.19.3",
91:     "source-map-support": "^0.5.21",
92:     "supertest": "^7.0.0",
93:     "ts-jest": "^29.2.5",
94:     "ts-loader": "^9.5.2",
95:     "ts-node": "^10.9.2",
96:     "tsconfig-paths": "^4.2.0",
97:     "typescript": "^5.7.3",
98:     "typescript-eslint": "^8.20.0"
99:   },
100:   "jest": {
101:     "moduleFileExtensions": [
102:       "js",
103:       "json",
104:       "ts"
105:     ],
106:     "rootDir": "src",
107:     "testRegex": ".*\\.spec\\.ts$",
108:     "testPathIgnorePatterns": [
109:       "/node_modules/",
110:       "\\.integration\\.spec\\.ts$"
111:     ],
112:     "transform": {
113:       "^.+\\.(t|j)s$": "ts-jest"
114:     },
115:     "collectCoverageFrom": [
116:       "**/*.(t|j)s"
117:     ],
118:     "coverageDirectory": "../coverage",
119:     "testEnvironment": "node"
120:   }
121: }

(End of file - total 121 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.7s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/prisma/prisma.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/prisma/prisma.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
2: import { PrismaClient } from '@prisma/client';
3: import { EventEmitter2 } from '@nestjs/event-emitter';
4: import { ConfigService } from '@nestjs/config';
5: import { TenantContextService } from '../common/tenant/tenant-context.service';
6: import { createTenantGuardExtension } from '../common/tenant/tenant-guard.extension';
7: import type { TenantConfig } from '../common/config/configuration';
8: 
9: @Injectable()
10: export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
11:   /**
12:    * كاش للعميل الموسّع بحارس العزل.
13:    *
14:    * unknown مش النوع المستنتج: $extends بيرجّع نوع معقّد، وتخزينه في
15:    * حقل معرّف بالنوع المستنتج بيعمل دورة استنتاج في TypeScript.
16:    * التحويل بيحصل في guarded() نفسها، فالمستدعي بياخد النوع الصح.
17:    */
18:   private guardedCache: unknown = null
19: 
20:   constructor(
21:     private eventEmitter: EventEmitter2,
22:     private readonly config: ConfigService,
23:     private readonly tenantContext: TenantContextService,
24:   ) {
25:     super()
26:   }
27: 
28:   async onModuleInit() {
29:     await this.$connect()
30:     console.log('✅ Database connected successfully!')
31:   }
32: 
33:   async onModuleDestroy() {
34:     await this.$disconnect()
35:   }
36: 
37:   /**
38:    * عميل Prisma مع حارس عزل المستأجرين.
39:    *
40:    * الحارس **تبليغ فقط**: بيسجّل تحذير لو استعلام على موديل مسجّل في
41:    * tenant-scoped-models مش مقيّد بـ store_id و mode. مابيعدّلش الاستعلام،
42:    * ومابيضيفش شروط، ومابيمنعش أي عملية.
43:    *
44:    * ⚠️ ده مسار **اختياري بالكامل**. كل الخدمات الموجودة في المشروع
45:    * بتستخدم `this` مباشرةً زي ما هي بالظبط، ومفيش أي تغيير في سلوكها
46:    * ولا في أنواعها. خدمات المرحلة 1b هي اللي هتستخدم guarded() صراحةً.
47:    *
48:    * السبب في إنه اختياري: $extends بيرجّع عميل بنوع مختلف، فلو استبدلنا
49:    * العميل الأساسي كان التغيير هيمتد لكل خدمة في المشروع.
50:    */
51:   guarded() {
52:     if (!this.guardedCache) {
53:       this.guardedCache = this.buildGuardedClient()
54:     }
55:     return this.guardedCache as ReturnType<PrismaService['buildGuardedClient']>
56:   }
57: 
58:   private buildGuardedClient() {
59:     const tenant = this.config.get<TenantConfig>('tenant')
60: 
61:     return this.$extends(
62:       createTenantGuardExtension({
63:         enabled: tenant?.guardEnabled ?? false,
64:         tenantContext: this.tenantContext,
65:       }),
66:     )
67:   }
68: 
69:   /**
70:    * ✅ استدعى الدالة دى قبل أى delete على devices
71:    */
72:   async deleteDevice(deviceId: bigint) {
73:     const device = await this.devices.findFirst({
74:       where: { id: deviceId },
75:       select: { id: true, user_id: true }
76:     })
77: 
78:     const result = await this.devices.delete({
79:       where: { id: deviceId }
80:     })
81: 
82:     if (device) {
83:       this.eventEmitter.emit('device.deleted', {
84:         deviceId: device.id.toString(),
85:         userId: device.user_id.toString()
86:       })
87:     }
88: 
89:     return result
90:   }
91: 
92:   async deleteManyDevices(where: any) {
93:     const devices = await this.devices.findMany({
94:       where,
95:       select: { id: true, user_id: true }
96:     })
97: 
98:     const result = await this.devices.deleteMany({ where })
99: 
100:     for (const device of devices) {
101:       this.eventEmitter.emit('device.deleted', {
102:         deviceId: device.id.toString(),
103:         userId: device.user_id.toString()
104:       })
105:     }
106: 
107:     return result
108:   }
109: }

(End of file - total 109 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/cross-store-query.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/cross-store-query.ts</path>
<type>file</type>
<content>
1: import { AsyncLocalStorage } from 'async_hooks'
2: import { Logger } from '@nestjs/common'
3: 
4: /**
5:  * ==================================================================
6:  * Queries that are deliberately not scoped to one store
7:  * ==================================================================
8:  *
9:  * A few reads genuinely cannot carry a store_id, and contorting them to
10:  * satisfy the guard would change what they mean:
11:  *
12:  *   The fact applier finds an attempt by (account_id, gateway_reference)
13:  *   because that is what a webhook gives it. There is no store in the
14:  *   payload — the store is *derived* from the account the attempt
15:  *   belongs to. Requiring store_id first would mean guessing it.
16:  *
17:  *   Reconciliation and the health checks sweep every store by design.
18:  *   That is the whole point of a platform-wide sweep.
19:  *
20:  * Rather than let those read as ordinary unscoped queries — which is
21:  * indistinguishable from a mistake — they are wrapped here. The wrapper
22:  * suppresses the guard for exactly the enclosed call, records why, and
23:  * makes the exception greppable.
24:  *
25:  * ⚠️ This is an escape hatch for platform-level reads. It is never the
26:  * fix for "the guard complained about my query". If a query has a store
27:  * in scope, it belongs in the where clause.
28:  */
29: 
30: const logger = new Logger('CrossStoreQuery')
31: 
32: /** Reasons a query may legitimately span stores. Closed set on purpose. */
33: export type CrossStoreReason =
34:   /** Resolves the owning store from a provider identifier. */
35:   | 'provider_lookup'
36:   /** Platform-wide background sweep. */
37:   | 'platform_sweep'
38:   /** Operational health check across all tenants. */
39:   | 'health_check'
40: 
41: interface Scope {
42:   readonly reason: CrossStoreReason
43:   readonly description: string
44: }
45: 
46: /**
47:  * Execution-context-local, not module-level.
48:  *
49:  * ⚠️ This was module-level state, and that was wrong. Two requests
50:  * running concurrently — two PaymentFactApplier instances handling two
51:  * webhooks, say — share a module. One opening a scope made the other
52:  * believe it was nested, so an unrelated request threw
53:  * "Nested crossStoreQuery". Worse in the other direction: one request's
54:  * open scope silently suppressed the tenant guard for every query any
55:  * other request made while it was open.
56:  *
57:  * AsyncLocalStorage keeps the scope on the async execution context, so
58:  * it propagates through awaits within one logical operation and is
59:  * invisible to every other.
60:  */
61: const storage = new AsyncLocalStorage<Scope>()
62: 
63: /** Whether the current execution context is inside an approved block. */
64: export function isCrossStoreQuery(): boolean {
65:   return storage.getStore() !== undefined
66: }
67: 
68: export function currentCrossStoreReason(): string | null {
69:   const scope = storage.getStore()
70:   if (!scope) return null
71:   return `${scope.reason}: ${scope.description}`
72: }
73: 
74: /**
75:  * Runs a read that legitimately spans stores.
76:  *
77:  * The scope covers exactly this call and whatever it awaits. It is
78:  * cleared when the context exits, including on throw — AsyncLocalStorage
79:  * unwinds with the stack, so there is no leak path a `finally` would
80:  * need to cover.
81:  *
82:  * @param reason  why this is allowed, from the closed set
83:  * @param description what the query is actually doing, for the audit log
84:  */
85: export async function crossStoreQuery<T>(
86:   reason: CrossStoreReason,
87:   description: string,
88:   run: () => Promise<T>,
89: ): Promise<T> {
90:   const existing = storage.getStore()
91: 
92:   if (existing) {
93:     // Still a hard error, but now it only fires for a genuine nest
94:     // inside one operation, not for two operations running at once.
95:     throw new Error(
96:       `Nested crossStoreQuery: "${description}" inside "${existing.description}".`,
97:     )
98:   }
99: 
100:   // ⚠️ The callback is awaited *inside* the context, not merely invoked.
101:   //
102:   // Prisma promises are lazy: findFirst() builds a promise and executes
103:   // nothing. Returning storage.run(scope, run) hands back an unexecuted
104:   // promise and lets the context exit, so the query — and therefore the
105:   // guard's handler — ran with no scope at all. The bypass never fired
106:   // and every approved cross-store read was still reported as a
107:   // violation.
108:   //
109:   // Awaiting here keeps the context alive across the continuation that
110:   // actually executes the query.
111:   return storage.run({ reason, description }, async () => await run())
112: }
113: 
114: /** Logs the exceptions once at boot so they are visible, not buried. */
115: export function logCrossStoreExceptions(entries: readonly string[]): void {
116:   if (entries.length === 0) return
117:   logger.log(`Cross-store reads in use: ${entries.join(', ')}`)
118: }

(End of file - total 118 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/cross-mode-query.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/cross-mode-query.ts</path>
<type>file</type>
<content>
1: import { AsyncLocalStorage } from 'async_hooks'
2: import { Logger } from '@nestjs/common'
3: 
4: /**
5:  * ==================================================================
6:  * Queries that deliberately span both test and live for one store
7:  * ==================================================================
8:  *
9:  * A sibling to cross-store-query.ts, not a variant of it. The two solve
10:  * different problems and must not be conflated:
11:  *
12:  *   crossStoreQuery suppresses the ENTIRE tenant check — store and mode
13:  *   together — for queries that genuinely cannot name a store yet, or
14:  *   that sweep every store on purpose.
15:  *
16:  *   crossModeQuery suppresses ONLY the mode check. Store scope stays
17:  *   fully enforced. This is for a query that knows exactly which store
18:  *   it is reading, and is deliberately reading across both modes within
19:  *   that one store — a merchant settings screen that must show live and
20:  *   test configuration side by side, for instance.
21:  *
22:  * Reusing crossStoreQuery for the mode-only case would be strictly too
23:  * permissive: it would also suppress a missing_store_scope finding at
24:  * that call site, silently, if one ever appeared. This mechanism cannot
25:  * do that by construction — the store check is never touched here.
26:  *
27:  * ⚠️ This is an escape hatch for one specific, named product need. It is
28:  * never the fix for "the guard complained about my query." A query
29:  * missing store scope belongs in the where clause, not in either of
30:  * these wrappers.
31:  */
32: 
33: const logger = new Logger('CrossModeQuery')
34: 
35: /** Closed set, deliberately narrow. */
36: export type CrossModeReason =
37:   /** A merchant-facing view that must show both live and test
38:    *  configuration for the same store at once, by product requirement. */
39:   | 'merchant_dual_mode_view'
40: 
41: interface Scope {
42:   readonly reason: CrossModeReason
43:   readonly description: string
44: }
45: 
46: /**
47:  * Execution-context-local, mirroring cross-store-query.ts exactly.
48:  *
49:  * A prior version of the sibling mechanism used module-level state and
50:  * that was wrong: two concurrent operations shared one flag, so one
51:  * opening a scope made an unrelated operation believe it was nested, and
52:  * — worse — one operation's open scope silently suppressed checks for
53:  * every other operation running at the same time. AsyncLocalStorage
54:  * keeps the scope on the async execution context, invisible to
55:  * everything else.
56:  */
57: const storage = new AsyncLocalStorage<Scope>()
58: 
59: /** Whether the current execution context is inside an approved block. */
60: export function isCrossModeQuery(): boolean {
61:   return storage.getStore() !== undefined
62: }
63: 
64: export function currentCrossModeReason(): string | null {
65:   const scope = storage.getStore()
66:   if (!scope) return null
67:   return `${scope.reason}: ${scope.description}`
68: }
69: 
70: /**
71:  * Runs a read that deliberately spans modes for one store.
72:  *
73:  * Nesting is refused, same as crossStoreQuery — a nested block makes the
74:  * exit condition ambiguous, and every real case here is a single query.
75:  * Nesting crossModeQuery inside crossStoreQuery (or the reverse) is also
76:  * refused: the two mechanisms have different suppression semantics, and
77:  * silently picking one when both are open would hide which rule
78:  * actually applied.
79:  *
80:  * The callback is awaited *inside* the context, not merely invoked —
81:  * Prisma promises are lazy, so returning storage.run(scope, run)
82:  * unawaited would let the context exit before the query executes. That
83:  * exact bug was found and fixed once already in crossStoreQuery; this
84:  * mechanism does not repeat it.
85:  *
86:  * @param reason  why this is allowed, from the closed set
87:  * @param description what the query is actually doing, for the audit log
88:  */
89: export async function crossModeQuery<T>(
90:   reason: CrossModeReason,
91:   description: string,
92:   run: () => Promise<T>,
93: ): Promise<T> {
94:   const existing = storage.getStore()
95: 
96:   if (existing) {
97:     throw new Error(
98:       `Nested crossModeQuery: "${description}" inside "${existing.description}".`,
99:     )
100:   }
101: 
102:   return storage.run({ reason, description }, async () => await run())
103: }

(End of file - total 103 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts</path>
<type>file</type>
<content>
1: import { inspectScope } from './tenant-scope.inspector'
2: 
3: const M = 'OutboxMessage'
4: 
5: describe('inspectScope', () => {
6:   it('ignores unregistered models', () => {
7:     // Deliberately a model with no store_id at all. Product used to sit
8:     // here, which stopped being true the moment the registry was
9:     // completed — a reminder that "unregistered" is not a fixed set.
10:     expect(
11:       inspectScope({ model: 'LedgerPosting', operation: 'findMany', args: {} }),
12:     ).toEqual([])
13:     expect(inspectScope({ model: undefined, operation: '$queryRaw', args: {} })).toEqual([])
14:   })
15: 
16:   it('flags reads without store scope', () => {
17:     const v = inspectScope({ model: M, operation: 'findMany', args: { where: { status: 'pending' } } })
18:     expect(v.map(x => x.kind).sort()).toEqual(['missing_mode_scope', 'missing_store_scope'])
19:   })
20: 
21:   it('accepts a fully scoped read', () => {
22:     expect(inspectScope({ model: M, operation: 'findMany', args: { where: { store_id: 1n, mode: 'live' } } })).toEqual([])
23:   })
24: 
25:   it('accepts scope nested inside AND', () => {
26:     expect(inspectScope({ model: M, operation: 'findMany',
27:       args: { where: { AND: [{ store_id: 1n }, { mode: 'live' }] } } })).toEqual([])
28:   })
29: 
30:   it('accepts equals-form filters', () => {
31:     expect(inspectScope({ model: M, operation: 'findFirst',
32:       args: { where: { store_id: { equals: 1n }, mode: { equals: 'live' } } } })).toEqual([])
33:   })
34: 
35:   it('flags creates missing tenant fields', () => {
36:     const v = inspectScope({ model: M, operation: 'create', args: { data: { event_type: 'x' } } })
37:     expect(v.map(x => x.kind).sort()).toEqual(['missing_mode_value', 'missing_store_value'])
38:   })
39: 
40:   it('accepts a fully populated create', () => {
41:     expect(inspectScope({ model: M, operation: 'create',
42:       args: { data: { store_id: 1n, mode: 'live' } } })).toEqual([])
43:   })
44: 
45:   it('inspects every row of createMany', () => {
46:     const v = inspectScope({ model: M, operation: 'createMany',
47:       args: { data: [{ store_id: 1n, mode: 'live' }, { store_id: 2n }] } })
48:     expect(v).toHaveLength(1)
49:     expect(v[0].kind).toBe('missing_mode_value')
50:   })
51: 
52:   it('flags a mismatch against the request context', () => {
53:     const v = inspectScope({ model: M, operation: 'findMany',
54:       args: { where: { store_id: 9n, mode: 'live' } }, contextStoreId: '1' })
55:     expect(v).toHaveLength(1)
56:     expect(v[0].kind).toBe('store_scope_mismatch')
57:   })
58: 
59:   it('does not flag a matching context', () => {
60:     expect(inspectScope({ model: M, operation: 'findMany',
61:       args: { where: { store_id: 1n, mode: 'live' } }, contextStoreId: '1' })).toEqual([])
62:   })
63: 
64:   it('flags deletes and updates without scope', () => {
65:     for (const op of ['updateMany', 'deleteMany', 'update', 'delete']) {
66:       expect(inspectScope({ model: M, operation: op, args: { where: { id: 1n } } }).length).toBeGreaterThan(0)
67:     }
68:   })
69: 
70:   it('checks the create branch of upsert', () => {
71:     const v = inspectScope({ model: M, operation: 'upsert',
72:       args: { where: { store_id: 1n, mode: 'live' }, create: { event_type: 'x' }, update: {} } })
73:     expect(v.map(x => x.kind)).toEqual(['missing_store_value'])
74:   })
75: 
76:   it('tolerates missing or malformed args', () => {
77:     expect(() => inspectScope({ model: M, operation: 'findMany', args: undefined })).not.toThrow()
78:     expect(() => inspectScope({ model: M, operation: 'create', args: { data: null } })).not.toThrow()
79:   })
80: })
81: 
82: describe('relation-nested store scope', () => {
83:   // Prisma accepts both forms and they mean the same thing. The guard
84:   // only understood the scalar, so it reported correct code as a
85:   // violation — and a guard that cries wolf gets ignored.
86:   it('accepts the relation form', () => {
87:     expect(
88:       inspectScope({
89:         model: 'Product',
90:         operation: 'findMany',
91:         args: { where: { store: { id: 5n } } },
92:       }),
93:     ).toEqual([])
94:   })
95: 
96:   it('still accepts the scalar form', () => {
97:     expect(
98:       inspectScope({
99:         model: 'Product',
100:         operation: 'findMany',
101:         args: { where: { store_id: 5n } },
102:       }),
103:     ).toEqual([])
104:   })
105: 
106:   it('accepts the relation form nested inside AND', () => {
107:     expect(
108:       inspectScope({
109:         model: 'Product',
110:         operation: 'findMany',
111:         args: { where: { AND: [{ store: { id: 5n } }, { status: 'ACTIVE' }] } },
112:       }),
113:     ).toEqual([])
114:   })
115: 
116:   it('does not accept a relation filter that is not a scope', () => {
117:     // { store: { name: 'x' } } narrows by an attribute of the store, not
118:     // by which store. Accepting it would let any query mentioning the
119:     // relation past the guard.
120:     const violations = inspectScope({
121:       model: 'Product',
122:       operation: 'findMany',
123:       args: { where: { store: { name: 'Acme' } } },
124:     })
125: 
126:     expect(violations.map((v) => v.kind)).toContain('missing_store_scope')
127:   })
128: 
129:   it('compares the relation form against the request context', () => {
130:     expect(
131:       inspectScope({
132:         model: 'Product',
133:         operation: 'findMany',
134:         args: { where: { store: { id: 999n } } },
135:         contextStoreId: '5',
136:       }).map((v) => v.kind),
137:     ).toContain('store_scope_mismatch')
138:   })
139: 
140:   it('accepts a matching relation form against the context', () => {
141:     expect(
142:       inspectScope({
143:         model: 'Product',
144:         operation: 'findMany',
145:         args: { where: { store: { id: 5n } } },
146:         contextStoreId: '5',
147:       }),
148:     ).toEqual([])
149:   })
150: 
151:   it('leaves unregistered models alone regardless of form', () => {
152:     // ProductVariant has no store_id at all; it is scoped through its
153:     // product. Nothing to check.
154:     expect(
155:       inspectScope({
156:         model: 'ProductVariant',
157:         operation: 'findMany',
158:         args: { where: { product: { store_id: 5n } } },
159:       }),
160:     ).toEqual([])
161:   })
162: })

(End of file - total 162 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts</path>
<type>file</type>
<content>
1: import { readFileSync, readdirSync, statSync } from 'fs'
2: import { join } from 'path'
3: import { TenantContextService } from './tenant-context.service'
4: import { inspectScope } from './tenant-scope.inspector'
5: 
6: /**
7:  * ==================================================================
8:  * Demonstration: the tenant isolation net is not attached
9:  * ==================================================================
10:  *
11:  * These tests describe the behaviour tenant isolation is supposed to
12:  * have. They are written before the fix, and they fail today.
13:  *
14:  * Nothing here is a hypothetical. Every payment query in the codebase —
15:  * 83 of them — is scoped correctly by hand. The gap is that nothing
16:  * checks. A single forgotten `store_id` in a future change ships
17:  * silently, and in a multi-tenant payment system that is one merchant
18:  * reading another merchant's payments.
19:  */
20: 
21: describe('the guard has something to compare against', () => {
22:   it('exposes the active store to the tenant context during a request', () => {
23:     const context = new TenantContextService()
24: 
25:     // What ActiveStoreGuard should do after resolving the store. It sets
26:     // request.activeStore and request.activeStoreId, and stops there —
27:     // setStoreId() has no caller anywhere in the codebase.
28:     context.run(
29:       { storeId: null, mode: 'live', requestId: 'req-1', actor: null },
30:       () => {
31:         context.setStoreId('42')
32:         expect(context.getStoreId()).toBe('42')
33:       },
34:     )
35:   })
36: 
37:   it('reports no active store when the guard has not run', () => {
38:     const context = new TenantContextService()
39:     expect(context.getStoreId()).toBeNull()
40:   })
41: })
42: 
43: describe('a query missing store_id is a violation', () => {
44:   // The inspector already works. It is simply never consulted, because
45:   // no service calls prisma.guarded() and the context is never filled.
46:   it('flags an unscoped read on a tenant-scoped model', () => {
47:     const violations = inspectScope({
48:       model: 'PaymentIntent',
49:       operation: 'findMany',
50:       args: { where: { status: 'captured' } },
51:       contextStoreId: '42',
52:     })
53: 
54:     expect(violations.length).toBeGreaterThan(0)
55:   })
56: 
57:   it('accepts a correctly scoped read', () => {
58:     const violations = inspectScope({
59:       model: 'PaymentIntent',
60:       operation: 'findMany',
61:       args: { where: { store_id: 42n, mode: 'live', status: 'captured' } },
62:       contextStoreId: '42',
63:     })
64: 
65:     expect(violations).toEqual([])
66:   })
67: 
68:   it('flags a read scoped to a different store than the request', () => {
69:     // The shape of an actual leak: the query is scoped, but to somebody
70:     // else's store.
71:     const violations = inspectScope({
72:       model: 'PaymentIntent',
73:       operation: 'findMany',
74:       args: { where: { store_id: 999n, mode: 'live' } },
75:       contextStoreId: '42',
76:     })
77: 
78:     expect(violations.length).toBeGreaterThan(0)
79:   })
80: })
81: 
82: describe('the net is attached to production code', () => {
83:   it('has at least one service reading through the guarded client', () => {
84:     // guarded() is built, cached and typed. If nothing calls it, the
85:     // extension never runs and the inspector above is dead code in
86:     // production.
87:     const callers: string[] = []
88: 
89:     const walk = (dir: string): void => {
90:       for (const entry of readdirSync(dir)) {
91:         const full = join(dir, entry)
92:         if (statSync(full).isDirectory()) {
93:           walk(full)
94:         } else if (full.endsWith('.ts') && !full.includes('.spec.')) {
95:           if (/\.guarded\(/.test(readFileSync(full, 'utf8'))) callers.push(full)
96:         }
97:       }
98:     }
99: 
100:     walk(join(__dirname, '..', '..'))
101: 
102:     expect(callers).not.toEqual([])
103:   })
104: })

(End of file - total 104 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/registry-completeness.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/registry-completeness.spec.ts</path>
<type>file</type>
<content>
1: import { readFileSync } from 'fs'
2: import { join } from 'path'
3: import {
4:   DELIBERATELY_UNSCOPED,
5:   TENANT_SCOPED_MODELS,
6: } from './tenant-scoped-models'
7: 
8: /**
9:  * Guards the registry against the failure that let it fall behind.
10:  *
11:  * The registry sat at three models for two phases while a dozen tables
12:  * carrying store_id were added around it. An unregistered model is not
13:  * checked at all, so the guard reported clean on exactly the tables that
14:  * matter most. Nobody noticed because nothing compared the two lists.
15:  */
16: describe('every store-scoped model is registered', () => {
17:   const schemaPath = join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma')
18: 
19:   /** Prisma models declaring a store_id field. */
20:   function modelsWithStoreId(): string[] {
21:     let schema: string
22:     try {
23:       schema = readFileSync(schemaPath, 'utf8')
24:     } catch {
25:       return []
26:     }
27: 
28:     const found: string[] = []
29:     const blocks = schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)
30: 
31:     for (const [, name, body] of blocks) {
32:       if (/^\s*store_id\s+/m.test(body)) found.push(name)
33:     }
34: 
35:     return found
36:   }
37: 
38:   it('leaves no model with store_id unaccounted for', () => {
39:     const declared = modelsWithStoreId()
40: 
41:     if (declared.length === 0) {
42:       // Schema not reachable from here; the registry cannot be compared.
43:       return
44:     }
45: 
46:     const registered = new Set(TENANT_SCOPED_MODELS.map((m) => m.model))
47:     const excused = new Set(DELIBERATELY_UNSCOPED.map((m) => m.model))
48: 
49:     const missing = declared.filter(
50:       (model) => !registered.has(model) && !excused.has(model),
51:     )
52: 
53:     expect(missing).toEqual([])
54:   })
55: 
56:   it('registers no model twice', () => {
57:     const names = TENANT_SCOPED_MODELS.map((m) => m.model)
58:     expect(new Set(names).size).toBe(names.length)
59:   })
60: 
61:   it('gives every exclusion a reason', () => {
62:     for (const entry of DELIBERATELY_UNSCOPED) {
63:       expect(entry.reason.length).toBeGreaterThan(10)
64:     }
65:   })
66: })

(End of file - total 66 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.3s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/cross-store-query.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/cross-store-query.spec.ts</path>
<type>file</type>
<content>
1: import {
2:   crossStoreQuery,
3:   currentCrossStoreReason,
4:   isCrossStoreQuery,
5: } from './cross-store-query'
6: 
7: describe('the cross-store escape hatch', () => {
8:   it('is closed by default', () => {
9:     expect(isCrossStoreQuery()).toBe(false)
10:     expect(currentCrossStoreReason()).toBeNull()
11:   })
12: 
13:   it('opens only for the enclosed call', async () => {
14:     let insideValue = false
15: 
16:     await crossStoreQuery('provider_lookup', 'resolve attempt', async () => {
17:       insideValue = isCrossStoreQuery()
18:     })
19: 
20:     expect(insideValue).toBe(true)
21:     expect(isCrossStoreQuery()).toBe(false)
22:   })
23: 
24:   it('records why, for the audit log', async () => {
25:     let reason: string | null = null
26: 
27:     await crossStoreQuery('platform_sweep', 'nightly reconcile', async () => {
28:       reason = currentCrossStoreReason()
29:     })
30: 
31:     expect(reason).toBe('platform_sweep: nightly reconcile')
32:   })
33: 
34:   it('closes even when the query throws', async () => {
35:     // A leaked-open scope would silently disable the guard for every
36:     // later query on this worker — far worse than the original problem.
37:     await expect(
38:       crossStoreQuery('provider_lookup', 'boom', async () => {
39:         throw new Error('query failed')
40:       }),
41:     ).rejects.toThrow('query failed')
42: 
43:     expect(isCrossStoreQuery()).toBe(false)
44:   })
45: 
46:   it('refuses to nest', async () => {
47:     await expect(
48:       crossStoreQuery('provider_lookup', 'outer', () =>
49:         crossStoreQuery('platform_sweep', 'inner', async () => undefined),
50:       ),
51:     ).rejects.toThrow(/Nested crossStoreQuery/)
52: 
53:     expect(isCrossStoreQuery()).toBe(false)
54:   })
55: 
56:   it('returns the enclosed value', async () => {
57:     const result = await crossStoreQuery('health_check', 'count', async () => 7)
58:     expect(result).toBe(7)
59:   })
60: })
61: 
62: describe('concurrent operations do not see each other', () => {
63:   /** Yields to the event loop so the two calls genuinely interleave. */
64:   const tick = () => new Promise((resolve) => setImmediate(resolve))
65: 
66:   it('lets two independent scopes run at the same time', async () => {
67:     // The bug this replaced: module-level state meant one operation
68:     // opening a scope made an unrelated concurrent operation believe it
69:     // was nested, and it threw.
70:     const results = await Promise.all([
71:       crossStoreQuery('provider_lookup', 'first', async () => {
72:         await tick()
73:         return currentCrossStoreReason()
74:       }),
75:       crossStoreQuery('platform_sweep', 'second', async () => {
76:         await tick()
77:         return currentCrossStoreReason()
78:       }),
79:     ])
80: 
81:     expect(results).toEqual([
82:       'provider_lookup: first',
83:       'platform_sweep: second',
84:     ])
85:   })
86: 
87:   it('does not leak one scope into an unrelated concurrent call', async () => {
88:     // The dangerous direction: an open scope suppressing the tenant
89:     // guard for queries belonging to somebody else's request.
90:     let observedOutside: boolean | null = null
91: 
92:     await Promise.all([
93:       crossStoreQuery('provider_lookup', 'inside', async () => {
94:         await tick()
95:         await tick()
96:       }),
97:       (async () => {
98:         await tick()
99:         observedOutside = isCrossStoreQuery()
100:       })(),
101:     ])
102: 
103:     expect(observedOutside).toBe(false)
104:   })
105: 
106:   it('still refuses a genuine nest within one operation', async () => {
107:     await expect(
108:       crossStoreQuery('provider_lookup', 'outer', async () => {
109:         await tick()
110:         return crossStoreQuery('platform_sweep', 'inner', async () => undefined)
111:       }),
112:     ).rejects.toThrow(/Nested crossStoreQuery/)
113:   })
114: 
115:   it('clears the scope after a concurrent batch', async () => {
116:     await Promise.all([
117:       crossStoreQuery('provider_lookup', 'a', async () => tick()),
118:       crossStoreQuery('health_check', 'b', async () => tick()),
119:     ])
120: 
121:     expect(isCrossStoreQuery()).toBe(false)
122:   })
123: })

(End of file - total 123 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/cross-mode-query.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/cross-mode-query.spec.ts</path>
<type>file</type>
<content>
1: import {
2:   crossModeQuery,
3:   currentCrossModeReason,
4:   isCrossModeQuery,
5: } from './cross-mode-query'
6: 
7: describe('the cross-mode escape hatch', () => {
8:   it('is closed by default', () => {
9:     expect(isCrossModeQuery()).toBe(false)
10:     expect(currentCrossModeReason()).toBeNull()
11:   })
12: 
13:   it('opens only for the enclosed call', async () => {
14:     let insideValue = false
15: 
16:     await crossModeQuery('merchant_dual_mode_view', 'settings screen', async () => {
17:       insideValue = isCrossModeQuery()
18:     })
19: 
20:     expect(insideValue).toBe(true)
21:     expect(isCrossModeQuery()).toBe(false)
22:   })
23: 
24:   it('records why, for the audit log', async () => {
25:     let reason: string | null = null
26: 
27:     await crossModeQuery('merchant_dual_mode_view', 'list all accounts', async () => {
28:       reason = currentCrossModeReason()
29:     })
30: 
31:     expect(reason).toBe('merchant_dual_mode_view: list all accounts')
32:   })
33: 
34:   it('closes even when the query throws', async () => {
35:     await expect(
36:       crossModeQuery('merchant_dual_mode_view', 'boom', async () => {
37:         throw new Error('query failed')
38:       }),
39:     ).rejects.toThrow('query failed')
40: 
41:     expect(isCrossModeQuery()).toBe(false)
42:   })
43: 
44:   it('refuses to nest', async () => {
45:     await expect(
46:       crossModeQuery('merchant_dual_mode_view', 'outer', () =>
47:         crossModeQuery('merchant_dual_mode_view', 'inner', async () => undefined),
48:       ),
49:     ).rejects.toThrow(/Nested crossModeQuery/)
50: 
51:     expect(isCrossModeQuery()).toBe(false)
52:   })
53: 
54:   it('returns the enclosed value', async () => {
55:     const result = await crossModeQuery(
56:       'merchant_dual_mode_view',
57:       'count',
58:       async () => 7,
59:     )
60:     expect(result).toBe(7)
61:   })
62: 
63:   it('keeps the scope open until a lazily-executed query runs', async () => {
64:     // Mirrors the applier's real usage shape: a Prisma promise is lazy,
65:     // so the scope must still be open when the deferred .then() runs.
66:     let insideScope: boolean | null = null
67: 
68:     function lazyQuery(onExecute: () => void) {
69:       return {
70:         then(resolve: (value: unknown) => void) {
71:           onExecute()
72:           resolve(null)
73:         },
74:       }
75:     }
76: 
77:     await crossModeQuery('merchant_dual_mode_view', 'lazy', () =>
78:       lazyQuery(() => {
79:         insideScope = isCrossModeQuery()
80:       }) as unknown as Promise<unknown>,
81:     )
82: 
83:     expect(insideScope).toBe(true)
84:   })
85: })
86: 
87: describe('cross-mode and cross-store contexts do not bleed into each other', () => {
88:   const tick = () => new Promise((resolve) => setImmediate(resolve))
89: 
90:   it('lets two independent operations run concurrently without interference', async () => {
91:     const results = await Promise.all([
92:       crossModeQuery('merchant_dual_mode_view', 'first', async () => {
93:         await tick()
94:         return currentCrossModeReason()
95:       }),
96:       (async () => {
97:         await tick()
98:         // Runs outside any scope; must never observe the concurrent one.
99:         return isCrossModeQuery()
100:       })(),
101:     ])
102: 
103:     expect(results).toEqual(['merchant_dual_mode_view: first', false])
104:   })
105: 
106:   it('does not leak into an unrelated concurrent call', async () => {
107:     let observedOutside: boolean | null = null
108: 
109:     await Promise.all([
110:       crossModeQuery('merchant_dual_mode_view', 'inside', async () => {
111:         await tick()
112:         await tick()
113:       }),
114:       (async () => {
115:         await tick()
116:         observedOutside = isCrossModeQuery()
117:       })(),
118:     ])
119: 
120:     expect(observedOutside).toBe(false)
121:   })
122: 
123:   it('clears the scope after a concurrent batch', async () => {
124:     await Promise.all([
125:       crossModeQuery('merchant_dual_mode_view', 'a', async () => tick()),
126:       crossModeQuery('merchant_dual_mode_view', 'b', async () => tick()),
127:     ])
128: 
129:     expect(isCrossModeQuery()).toBe(false)
130:   })
131: })

(End of file - total 131 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts</path>
<type>file</type>
<content>
1: import { Logger } from '@nestjs/common'
2: import { buildTenantGuardDefinition } from './tenant-guard.extension'
3: import { TenantContextService } from './tenant-context.service'
4: import { crossModeQuery } from './cross-mode-query'
5: import { crossStoreQuery } from './cross-store-query'
6: 
7: /**
8:  * Exercises the real $allOperations dispatch, the same way
9:  * guard-crossstore-suppression.spec.ts does for crossStoreQuery. A test
10:  * against the pure inspector alone would not prove the wiring in the
11:  * extension actually filters the right violation kind — that filtering
12:  * lives in tenant-guard.extension.ts, not in tenant-scope.inspector.ts,
13:  * and only running through buildTenantGuardDefinition touches it.
14:  */
15: 
16: function makeLogger() {
17:   const warnings: string[] = []
18:   const debugs: string[] = []
19:   const logger = {
20:     warn: (m: string) => warnings.push(m),
21:     debug: (m: string) => debugs.push(m),
22:     error: (m: string) => warnings.push(m),
23:     log: () => undefined,
24:   } as unknown as Logger
25:   return { logger, warnings, debugs }
26: }
27: 
28: async function runThroughGuard(
29:   extension: any,
30:   args: { model: string; operation: string; args: unknown },
31: ): Promise<void> {
32:   const handler = extension.query.$allOperations
33:   await handler({
34:     model: args.model,
35:     operation: args.operation,
36:     args: args.args,
37:     query: async () => [],
38:   })
39: }
40: 
41: /** PaymentAccount is registered with a modeField; store_id present, mode absent. */
42: const dualModeShapedRead = {
43:   model: 'PaymentAccount',
44:   operation: 'findMany',
45:   args: { where: { store_id: 1n } },
46: }
47: 
48: describe('crossModeQuery — case A: suppresses only the mode finding', () => {
49:   it('emits no warning for a store-scoped, mode-agnostic read', async () => {
50:     const { logger, warnings, debugs } = makeLogger()
51:     const extension = buildTenantGuardDefinition({
52:       enabled: true,
53:       tenantContext: new TenantContextService(),
54:       logger,
55:     })
56: 
57:     await crossModeQuery('merchant_dual_mode_view', 'settings screen', () =>
58:       runThroughGuard(extension, dualModeShapedRead),
59:     )
60: 
61:     expect(warnings).toEqual([])
62:     expect(debugs.join(' ')).toContain('merchant_dual_mode_view')
63:   })
64: })
65: 
66: describe('crossModeQuery — case B: store violations are NOT suppressed', () => {
67:   it('still warns on missing_store_scope inside crossModeQuery', async () => {
68:     const { logger, warnings } = makeLogger()
69:     const extension = buildTenantGuardDefinition({
70:       enabled: true,
71:       tenantContext: new TenantContextService(),
72:       logger,
73:     })
74: 
75:     // No store_id at all — this must survive the mode-only filter.
76:     await crossModeQuery('merchant_dual_mode_view', 'no store at all', () =>
77:       runThroughGuard(extension, {
78:         model: 'PaymentAccount',
79:         operation: 'findMany',
80:         args: { where: {} },
81:       }),
82:     )
83: 
84:     expect(warnings.join(' ')).toContain('missing_store_scope')
85:   })
86: 
87:   it('still warns on store_scope_mismatch inside crossModeQuery', async () => {
88:     const { logger, warnings } = makeLogger()
89:     const context = new TenantContextService()
90: 
91:     const extension = buildTenantGuardDefinition({
92:       enabled: true,
93:       tenantContext: context,
94:       logger,
95:     })
96: 
97:     await context.run(
98:       { storeId: null, mode: 'live', requestId: 'req-1', actor: null },
99:       async () => {
100:         context.setStoreId('42')
101: 
102:         await crossModeQuery('merchant_dual_mode_view', 'wrong store', () =>
103:           runThroughGuard(extension, {
104:             model: 'PaymentAccount',
105:             operation: 'findMany',
106:             // store_id present, but does not match the request context.
107:             args: { where: { store_id: 999n } },
108:           }),
109:         )
110:       },
111:     )
112: 
113:     expect(warnings.join(' ')).toContain('store_scope_mismatch')
114:   })
115: 
116:   it('does not accidentally behave like crossStoreQuery', async () => {
117:     // The decisive check: crossModeQuery must never grant the full
118:     // bypass crossStoreQuery provides. Same unscoped query, run under
119:     // each mechanism — only crossStoreQuery should come back clean.
120:     const unscoped = {
121:       model: 'PaymentAccount',
122:       operation: 'findMany',
123:       args: { where: {} },
124:     }
125: 
126:     const underCrossMode = makeLogger()
127:     const extensionA = buildTenantGuardDefinition({
128:       enabled: true,
129:       tenantContext: new TenantContextService(),
130:       logger: underCrossMode.logger,
131:     })
132:     await crossModeQuery('merchant_dual_mode_view', 'x', () =>
133:       runThroughGuard(extensionA, unscoped),
134:     )
135: 
136:     const underCrossStore = makeLogger()
137:     const extensionB = buildTenantGuardDefinition({
138:       enabled: true,
139:       tenantContext: new TenantContextService(),
140:       logger: underCrossStore.logger,
141:     })
142:     await crossStoreQuery('provider_lookup', 'x', () =>
143:       runThroughGuard(extensionB, unscoped),
144:     )
145: 
146:     expect(underCrossMode.warnings.join(' ')).toContain('missing_store_scope')
147:     expect(underCrossStore.warnings).toEqual([])
148:   })
149: })
150: 
151: describe('crossModeQuery — case C: unwrapped queries are unaffected', () => {
152:   it('warns on missing_mode_scope outside any wrapper', async () => {
153:     const { logger, warnings } = makeLogger()
154:     const extension = buildTenantGuardDefinition({
155:       enabled: true,
156:       tenantContext: new TenantContextService(),
157:       logger,
158:     })
159: 
160:     await runThroughGuard(extension, dualModeShapedRead)
161: 
162:     expect(warnings.join(' ')).toContain('missing_mode_scope')
163:   })
164: 
165:   it('resumes warning once the crossModeQuery scope closes', async () => {
166:     const { logger, warnings } = makeLogger()
167:     const extension = buildTenantGuardDefinition({
168:       enabled: true,
169:       tenantContext: new TenantContextService(),
170:       logger,
171:     })
172: 
173:     await crossModeQuery('merchant_dual_mode_view', 'inside', () =>
174:       runThroughGuard(extension, dualModeShapedRead),
175:     )
176:     expect(warnings).toEqual([])
177: 
178:     await runThroughGuard(extension, dualModeShapedRead)
179:     expect(warnings.join(' ')).toContain('missing_mode_scope')
180:   })
181: })
182: 
183: describe('crossModeQuery — case D: survives an await before the query runs', () => {
184:   it('still filters correctly after a deferred continuation', async () => {
185:     const { logger, warnings } = makeLogger()
186:     const extension = buildTenantGuardDefinition({
187:       enabled: true,
188:       tenantContext: new TenantContextService(),
189:       logger,
190:     })
191: 
192:     await crossModeQuery('merchant_dual_mode_view', 'deferred', async () => {
193:       await new Promise((resolve) => setImmediate(resolve))
194:       await runThroughGuard(extension, dualModeShapedRead)
195:     })
196: 
197:     expect(warnings).toEqual([])
198:   })
199: })

(End of file - total 199 lines)
</content>
```

**Tool: glob**

**Input:**
```json
{
  "pattern": "src/**/*.service.ts",
  "path": "/workspaces/testapp/backend"
}
```

**Output:**
```
/workspaces/testapp/backend/src/auth/oauth.service.ts
/workspaces/testapp/backend/src/auth/auth.service.ts
/workspaces/testapp/backend/src/ledger/ledger.service.ts
/workspaces/testapp/backend/src/app.service.ts
/workspaces/testapp/backend/src/stores/active-store.service.ts
/workspaces/testapp/backend/src/stores/products/product.service.ts
/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts
/workspaces/testapp/backend/src/stores/checkout/checkout-finalizer.service.ts
/workspaces/testapp/backend/src/stores/collections/storefront-collections.service.ts
/workspaces/testapp/backend/src/stores/collections/collections.service.ts
/workspaces/testapp/backend/src/stores/orders/order.service.ts
/workspaces/testapp/backend/src/stores/payments/payment-collection.service.ts
/workspaces/testapp/backend/src/stores/payments/payment-query.service.ts
/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts
/workspaces/testapp/backend/src/stores/payments/refund.service.ts
/workspaces/testapp/backend/src/stores/payments/gateways/provider-registry.service.ts
/workspaces/testapp/backend/src/stores/payments/order-cancellation.service.ts
/workspaces/testapp/backend/src/stores/payments/webhooks/webhook-ingestion.service.ts
/workspaces/testapp/backend/src/uploads/uploads.service.ts
/workspaces/testapp/backend/src/prisma/prisma.service.ts
/workspaces/testapp/backend/src/common/tenant/tenant-context.service.ts
/workspaces/testapp/backend/src/common/crypto/store-key.service.ts
/workspaces/testapp/backend/src/common/crypto/encryption.service.ts
/workspaces/testapp/backend/src/common/ids/id-reservation.service.ts
/workspaces/testapp/backend/src/common/messaging/outbox.service.ts
/workspaces/testapp/backend/src/common/messaging/consumed-event.service.ts
/workspaces/testapp/backend/src/common/messaging/outbox-dispatcher.service.ts
/workspaces/testapp/backend/src/common/idempotency/idempotency.service.ts
/workspaces/testapp/backend/src/stores/store.service.ts
/workspaces/testapp/backend/src/stores/payments/facts/reconciliation.service.ts
/workspaces/testapp/backend/src/stores/payments/facts/checkout-finalizer.service.ts
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 2.1s)

**Tool: grep**

**Input:**
```json
{
  "pattern": "guarded\\(\\)",
  "path": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
Found 61 matches
/workspaces/testapp/backend/src/ledger/ledger.service.ts:
  Line 99:     const account = await this.prisma.guarded().ledgerAccount.findFirst({


/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts:
  Line 70:         this.prisma.guarded().checkout.findMany({


/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts:
  Line 117:     const offerings = await this.prisma.guarded().paymentMethodOffering.findMany({

  Line 124:     const accounts = await this.prisma.guarded().paymentAccount.findMany({

  Line 222:     const offering = await this.prisma.guarded().paymentMethodOffering.findFirst({

  Line 236:     const account = await this.prisma.guarded().paymentAccount.findFirst({

  Line 567:       ? await this.prisma.guarded().order.findFirst({

  Line 576:       : await this.prisma.guarded().order.findFirst({

  Line 625:     const checkout = await this.prisma.guarded().checkout.findFirst({

  Line 631:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 642:       ? await this.prisma.guarded().paymentAttempt.findFirst({

  Line 650:       ? await this.prisma.guarded().order.findFirst({

  Line 700:     const checkout = await this.prisma.guarded().checkout.findFirst({

  Line 707:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 743:       const account = await this.prisma.guarded().paymentAccount.findFirst({

  Line 753:       const attempt = await this.prisma.guarded().paymentAttempt.findFirst({

  Line 994:     const store = await this.prisma.guarded().store.findFirst({ where: { slug } })

  Line 1010:     const variants = await this.prisma.guarded().productVariant.findMany({

  Line 1061:     const existing = await this.prisma.guarded().beneficiary.findFirst({

  Line 1068:     const created = await this.prisma.guarded().beneficiary.create({


/workspaces/testapp/backend/src/stores/payments/payment-collection.service.ts:
  Line 50:     const order = await this.prisma.guarded().order.findFirst({

  Line 80:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 95:     const beneficiary = await this.prisma.guarded().beneficiary.findFirst({


/workspaces/testapp/backend/src/stores/payments/consumers/payment-notification.consumer.spec.ts:
  Line 42:   // The consumer reads through guarded(), matching PrismaService. The


/workspaces/testapp/backend/src/stores/payments/consumers/payment-notification.consumer.ts:
  Line 85:     const store = await this.prisma.guarded().store.findFirst({

  Line 103:     const existing = await this.prisma.guarded().notifications.findFirst({


/workspaces/testapp/backend/src/stores/payments/payment-query.service.ts:
  Line 40:       this.prisma.guarded().order.count({

  Line 43:       this.prisma.guarded().paymentIntent.count({

  Line 50:       this.prisma.guarded().outboxMessage.count({

  Line 77:     const order = await this.prisma.guarded().order.findFirst({

  Line 121:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 142:       this.prisma.guarded().paymentAttempt.findMany({

  Line 146:       this.prisma.guarded().capture.findMany({

  Line 150:       this.prisma.guarded().paymentEvent.findMany({

  Line 154:       this.prisma.guarded().journalEntry.findMany({


/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts:
  Line 86:         this.prisma.guarded().paymentAccount.findMany({

  Line 145:     const existing = await this.prisma.guarded().paymentAccount.findFirst({

  Line 230:     const account = await this.prisma.guarded().paymentAccount.findFirst({

  Line 243:     const updated = await this.prisma.guarded().paymentAccount.update({

  Line 279:     const account = await this.prisma.guarded().paymentAccount.findFirstOrThrow({


/workspaces/testapp/backend/src/stores/payments/refund.service.ts:
  Line 48:     const order = await this.prisma.guarded().order.findFirst({

  Line 67:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 108:     const account = await this.prisma.guarded().paymentAccount.findFirstOrThrow({

  Line 122:     const attempt = await this.prisma.guarded().paymentAttempt.findFirst({

  Line 134:     const capture = await this.prisma.guarded().capture.findFirst({

  Line 190:     const after = await this.prisma.guarded().paymentIntent.findFirstOrThrow({


/workspaces/testapp/backend/src/stores/payments/order-cancellation.service.ts:
  Line 51:     const order = await this.prisma.guarded().order.findFirst({

  Line 76:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 93:     const commitmentEntry = await this.prisma.guarded().journalEntry.findFirst({


/workspaces/testapp/backend/src/stores/payments/facts/reconciliation.service.ts:
  Line 82:         this.prisma.guarded().paymentIntent.findMany({

  Line 116:     const account = await this.prisma.guarded().paymentAccount.findFirst({

  Line 130:     const attempt = await this.prisma.guarded().paymentAttempt.findFirst({


/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts:
  Line 101:         this.prisma.guarded().paymentAttempt.findFirst({

  Line 119:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 630:       await this.prisma.guarded().paymentEvent.create({


/workspaces/testapp/backend/src/prisma/prisma.service.ts:
  Line 16:    * التحويل بيحصل في guarded() نفسها، فالمستدعي بياخد النوع الصح.

  Line 46:    * ولا في أنواعها. خدمات المرحلة 1b هي اللي هتستخدم guarded() صراحةً.

  Line 51:   guarded() {


/workspaces/testapp/backend/src/common/tenant/tenant-scoped-models.ts:
  Line 72:   // الاستعلامات اللي بتعدّي على guarded()، ومفيش خدمة من دول بتستخدمها


/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:
  Line 45:   // no service calls prisma.guarded() and the context is never filled.

  Line 84:     // guarded() is built, cached and typed. If nothing calls it, the

```

**Tool: grep**

**Input:**
```json
{
  "pattern": "prisma\\.(store|product|order|checkout|payment|outbox|consumed|ledger|beneficiary|journal|inventory|refund|capture|upload|collection|storeTheme|themeSection|storePage|storeMenu|wallets|devices)",
  "path": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
Found 100 matches (more matches available)
/workspaces/testapp/backend/src/ledger/ledger.service.integration.spec.ts:
  Line 42:     const store = await prisma.beneficiary.create({

  Line 46:     const platform = await prisma.beneficiary.create({

  Line 83:       expect(await prisma.ledgerPosting.count({ where: { entry_id: result.entryId } })).toBe(2)

  Line 103:       expect(await prisma.journalEntry.count()).toBe(1)

  Line 114:       expect(await prisma.journalEntry.count()).toBe(0)

  Line 115:       expect(await prisma.ledgerPosting.count()).toBe(0)

  Line 125:       expect(await prisma.ledgerAccount.count()).toBe(2)

  Line 136:       expect(await prisma.ledgerAccount.count()).toBe(4)

  Line 147:       expect(await prisma.ledgerAccount.count()).toBe(4)

  Line 165:       expect(await prisma.journalEntry.count()).toBe(0)

  Line 237:       expect(await prisma.ledgerPosting.count({ where: { entry_id: result.entryId } })).toBe(3)

  Line 346:       const originalRow = await prisma.journalEntry.findFirstOrThrow({


/workspaces/testapp/backend/src/stores/active-store.service.ts:
  Line 38:       const store = await this.prisma.store.findFirst({

  Line 57:     const store = await this.prisma.store.findFirst({

  Line 83:     const store = await this.prisma.store.findFirst({


/workspaces/testapp/backend/src/auth/session-auth.guard.ts:
  Line 58:         const device = await this.prisma.devices.findFirst({


/workspaces/testapp/backend/src/auth/jwt.strategy.ts:
  Line 91:       await this.prisma.devices.findFirst({


/workspaces/testapp/backend/src/auth/oauth.service.ts:
  Line 144:     const device = await this.prisma.devices.findFirst({

  Line 158:     await this.prisma.devices.update({

  Line 257:     const device = await this.prisma.devices.findFirst({

  Line 273:     const existing = await this.prisma.devices.findFirst({

  Line 278:       await this.prisma.devices.update({

  Line 289:       await this.prisma.devices.create({

  Line 330:     const existing = await this.prisma.devices.findFirst({

  Line 335:       await this.prisma.devices.update({

  Line 345:       await this.prisma.devices.create({


/workspaces/testapp/backend/src/auth/auth.service.ts:
  Line 612:   const trusted = await this.prisma.devices.findFirst({

  Line 629:     await this.prisma.devices.update({

  Line 674:   const existingDevice = await this.prisma.devices.findFirst({

  Line 682:     await this.prisma.devices.update({

  Line 699:     await this.prisma.devices.create({

  Line 1311:     await this.prisma.devices.findFirst({

  Line 1347:   await this.prisma.devices.update({

  Line 1406:     await this.prisma.devices.findFirst({

  Line 1456:   await this.prisma.devices.update({

  Line 1510:     const device = await this.prisma.devices.findFirst({

  Line 1609:       await this.prisma.devices.findFirst({

  Line 1650:       await this.prisma.devices.update({

  Line 1899:     await this.prisma.devices.updateMany({

  Line 2375: //     await this.prisma.devices.findFirst({

  Line 2385: //     await this.prisma.devices.update({

  Line 2492:   const device = await this.prisma.devices.findFirst({

  Line 2497:     await this.prisma.devices.update({


/workspaces/testapp/backend/src/stores/store.service.ts:
  Line 35:     return this.prisma.store.findMany({

  Line 51:     const store = await this.prisma.store.create({

  Line 65:     await this.prisma.storeTheme.create({

  Line 123:       await this.prisma.store.findFirst({

  Line 135:     return this.prisma.store.update({

  Line 154:     return this.prisma.storePage.findMany({

  Line 169:    * هيكسر الـ build على prisma.storePage.create({ data: { type } }).

  Line 176:       await this.prisma.storePage.findFirst({

  Line 185:     return this.prisma.storePage.create({

  Line 204:     const page = await this.prisma.storePage.findFirst({

  Line 214:     return this.prisma.storePage.update({

  Line 233:     const page = await this.prisma.storePage.findFirst({

  Line 243:     return this.prisma.storePage.delete({

  Line 258:     const owned = await this.prisma.storePage.findMany({

  Line 268:         this.prisma.storePage.update({

  Line 286:     return this.prisma.storeMenu.findMany({

  Line 313:     return this.prisma.storeMenu.create({

  Line 329:     const menu = await this.prisma.storeMenu.findFirst({

  Line 336:     return this.prisma.storeMenu.update({

  Line 350:     const menu = await this.prisma.storeMenu.findFirst({

  Line 360:     return this.prisma.storeMenu.delete({

  Line 374:     const menu = await this.prisma.storeMenu.findFirst({

  Line 492:       await this.prisma.storePage.findMany({

  Line 534:     return this.prisma.storeMenu.findFirst({

  Line 556:       await this.prisma.storeMenu.findFirst({

  Line 570:       await this.prisma.storeMenu.create({

  Line 626:       await this.prisma.storeTheme.findUnique({

  Line 633:       theme = await this.prisma.storeTheme.create({

  Line 684:     const sections = await this.prisma.themeSection.findMany({

  Line 706:   return this.prisma.storeTheme.upsert({

  Line 727:     await this.prisma.storeTheme.findUnique({

  Line 734:     await this.prisma.themeSection.findMany({

  Line 745:     await this.prisma.storeMenu.findMany({

  Line 762:   await this.prisma.storeThemePublished.upsert({

  Line 795:     return this.prisma.storeTheme.update({

  Line 805:     return this.prisma.storeTheme.update({

  Line 815:     return this.prisma.storeTheme.update({

  Line 825:     return this.prisma.storeTheme.update({

  Line 841:       await this.prisma.storeTheme.findUnique({

  Line 848:       await this.prisma.themeSection.findMany({

  Line 858:       await this.prisma.storeMenu.findMany({

  Line 879: //   const store = await this.prisma.store.findUnique({ where: { slug } })

  Line 882: //   return this.prisma.product.findMany({

  Line 894:     return this.prisma.themeSection.findMany({

  Line 907:     const lastSection = await this.prisma.themeSection.findFirst({

  Line 912:     return this.prisma.themeSection.create({

  Line 931:     const section = await this.prisma.themeSection.findFirst({

  Line 936:     return this.prisma.themeSection.update({

  Line 953:     await this.prisma.themeSection.findFirst({

  Line 963:   return this.prisma.themeSection.delete({

  Line 975:     const owned = await this.prisma.themeSection.findMany({

  Line 985:         this.prisma.themeSection.update({

  Line 999:     await this.prisma.store.findUnique({

  Line 1009:     await this.prisma.storeThemePublished.findUnique({

  Line 1032:   const store = await this.prisma.store.findUnique({

  Line 1038:   await this.prisma.storeThemePublished.findUnique({

  Line 1048:   const store = await this.prisma.store.findUnique({


(Results truncated. Consider using a more specific path or pattern.)
```

**Tool: grep**

**Input:**
```json
{
  "pattern": "\\$transaction",
  "path": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
Found 49 matches
/workspaces/testapp/backend/src/ledger/ledger.service.integration.spec.ts:
  Line 68:       const result = await prisma.$transaction((tx) =>

  Line 88:         prisma.$transaction((tx) =>

  Line 108:         prisma.$transaction(async (tx) => {

  Line 120:         await prisma.$transaction((tx) =>

  Line 129:       await prisma.$transaction((tx) =>

  Line 132:       await prisma.$transaction((tx) =>

  Line 140:       await prisma.$transaction((tx) =>

  Line 143:       await prisma.$transaction((tx) =>

  Line 154:         prisma.$transaction((tx) =>

  Line 170:         prisma.$transaction((tx) =>

  Line 184:         prisma.$transaction((tx) =>

  Line 197:         prisma.$transaction((tx) =>

  Line 220:       const result = await prisma.$transaction((tx) =>

  Line 243:       await prisma.$transaction((tx) =>

  Line 271:       await prisma.$transaction((tx) =>

  Line 283:       await prisma.$transaction((tx) =>

  Line 309:       await prisma.$transaction((tx) =>

  Line 327:       const original = await prisma.$transaction((tx) =>

  Line 334:       const reversal = await prisma.$transaction((tx) =>

  Line 353:       const original = await prisma.$transaction((tx) =>

  Line 357:       const first = await prisma.$transaction((tx) =>

  Line 360:       const second = await prisma.$transaction((tx) =>

  Line 370:       await prisma.$transaction((tx) =>


/workspaces/testapp/backend/src/stores/products/product.service.ts:
  Line 239:     const productId = await this.prisma.$transaction(async (tx) => {

  Line 393:     await this.prisma.$transaction(async (tx) => {

  Line 600:     return this.prisma.$transaction(async (tx) => {

  Line 628:     const newProductId = await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts:
  Line 107:     await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts:
  Line 319:     const result = await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/collections/collections.service.ts:
  Line 157:     return this.prisma.$transaction(async (tx) => {

  Line 206:     await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/orders/order.service.ts:
  Line 96:     const order = await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/payments/payment-collection.service.ts:
  Line 106:     const updated = await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/payments/consumers/payment-notification.integration.spec.ts:
  Line 136:     return prisma.$transaction((tx) =>


/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts:
  Line 190:     const account = await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/auth/auth.service.ts:
  Line 115:   return this.prisma.$transaction(


/workspaces/testapp/backend/src/stores/payments/order-cancellation.service.ts:
  Line 104:     const result = await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts:
  Line 180:       await this.prisma.$transaction(

  Line 408:       await this.prisma.$transaction(


/workspaces/testapp/backend/src/common/messaging/outbox.integration.spec.ts:
  Line 50:     await prisma.$transaction(async (tx) => {

  Line 68:       prisma.$transaction(async (tx) => {

  Line 83:     await prisma.$transaction(async (tx) => {

  Line 99:       prisma.$transaction(async (tx) => {

  Line 109:       prisma.$transaction(async (tx) => {

  Line 123:     await prisma.$transaction(async (tx) => {

  Line 136:     await prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/common/messaging/outbox.service.ts:
  Line 18:  *   await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/common/messaging/outbox-dispatcher.integration.spec.ts:
  Line 72:   await prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/common/ids/id-reservation.service.integration.spec.ts:
  Line 84:       prisma.$transaction(async () => {

```

**Tool: grep**

**Input:**
```json
{
  "pattern": "\\$queryRaw|\\$executeRaw|queryRawUnsafe",
  "path": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
Found 15 matches
/workspaces/testapp/backend/src/ledger/ledger.service.ts:
  Line 109:     const rows = await this.prisma.$queryRaw<DirectionTotalRow[]>`

  Line 130:     const rows = await this.prisma.$queryRaw<AccountBalanceRow[]>`

  Line 157:     const rows = await this.prisma.$queryRaw<EntryIdRow[]>`

  Line 192:     // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and

  Line 193:     // Prisma has no deserializer for that type, so $queryRaw fails with

  Line 196:     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`


/workspaces/testapp/backend/src/ledger/ledger.service.integration.spec.ts:
  Line 37:     await prisma.$executeRawUnsafe(


/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts:
  Line 13:     expect(inspectScope({ model: undefined, operation: '$queryRaw', args: {} })).toEqual([])


/workspaces/testapp/backend/src/common/ids/id-reservation.service.ts:
  Line 103:     const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`


/workspaces/testapp/backend/src/common/messaging/outbox-dispatcher.service.ts:
  Line 142:     const rows = await this.prisma.$queryRaw<


/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts:
  Line 1105:     await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`


/workspaces/testapp/backend/src/stores/checkout/checkout-finalizer.service.ts:
  Line 228:     await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`


/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts:
  Line 667:     // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and

  Line 668:     // Prisma has no deserializer for that type, so $queryRaw fails with

  Line 671:     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`

```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.3s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/ledger/ledger.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/ledger/ledger.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger } from '@nestjs/common'
2: import { Prisma } from '@prisma/client'
3: import type { LedgerAccountType, Mode, PostingDirection } from '@prisma/client'
4: import { PrismaService } from '../prisma/prisma.service'
5: import { isUniqueConstraintError } from '../common/idempotency/idempotency.types'
6: import { JournalEntryInput, LedgerError, PostResult, PostingInput } from './ledger.types'
7: 
8: /**
9:  * Row shapes for the raw queries below.
10:  *
11:  * Declared as named types on purpose: an inline generic immediately
12:  * followed by a template literal produces the `>` + backtick sequence,
13:  * which is fragile to copy and hard to read.
14:  */
15: interface DirectionTotalRow {
16:   direction: PostingDirection
17:   total: bigint | null
18: }
19: 
20: interface EntryIdRow {
21:   entry_id: bigint
22: }
23: 
24: interface AccountBalanceRow {
25:   currency: string
26:   account_type: LedgerAccountType
27:   balance: bigint
28: }
29: 
30: /** One ledger account's derived balance. */
31: export interface LedgerBalance {
32:   currency: string
33:   accountType: LedgerAccountType
34:   balanceMinor: bigint
35: }
36: 
37: @Injectable()
38: export class LedgerService {
39:   private readonly logger = new Logger(LedgerService.name)
40:   constructor(private readonly prisma: PrismaService) {}
41: 
42:   async post(tx: Prisma.TransactionClient, input: JournalEntryInput): Promise<PostResult> {
43:     this.validate(input)
44:     const existing = await tx.journalEntry.findFirst({ where: { dedupe_key: input.dedupeKey }, select: { id: true } })
45:     if (existing) return { entryId: existing.id, duplicate: true }
46:     const accountIds = await this.resolveAccounts(tx, input)
47:     try {
48:       const entry = await tx.journalEntry.create({
49:         data: {
50:           store_id: input.storeId, mode: input.mode, currency: input.currency,
51:           entry_type: input.entryType, source_kind: input.sourceKind, source_id: input.sourceId,
52:           dedupe_key: input.dedupeKey, occurred_at: input.occurredAt, memo: input.memo ?? null,
53:         },
54:         select: { id: true },
55:       })
56:       await tx.ledgerPosting.createMany({
57:         data: input.postings.map((posting, index) => ({
58:           entry_id: entry.id, ledger_account_id: accountIds[index],
59:           direction: posting.direction, amount_minor: posting.amountMinor,
60:         })),
61:       })
62:       return { entryId: entry.id, duplicate: false }
63:     } catch (error) {
64:       if (isUniqueConstraintError(error)) {
65:         const raced = await tx.journalEntry.findFirstOrThrow({ where: { dedupe_key: input.dedupeKey }, select: { id: true } })
66:         return { entryId: raced.id, duplicate: true }
67:       }
68:       throw error
69:     }
70:   }
71: 
72:   async reverse(tx: Prisma.TransactionClient, entryId: bigint, dedupeKey: string, memo?: string): Promise<PostResult> {
73:     const original = await tx.journalEntry.findFirstOrThrow({ where: { id: entryId }, include: { postings: true } })
74:     const existing = await tx.journalEntry.findFirst({ where: { dedupe_key: dedupeKey }, select: { id: true } })
75:     if (existing) return { entryId: existing.id, duplicate: true }
76:     const reversal = await tx.journalEntry.create({
77:       data: {
78:         store_id: original.store_id, mode: original.mode, currency: original.currency,
79:         entry_type: `${original.entry_type}.reversal`, source_kind: original.source_kind,
80:         source_id: original.source_id, dedupe_key: dedupeKey, occurred_at: new Date(),
81:         reverses_entry_id: original.id, memo: memo ?? `Reversal of entry ${original.id}`,
82:       },
83:       select: { id: true },
84:     })
85:     await tx.ledgerPosting.createMany({
86:       data: original.postings.map((posting) => ({
87:         entry_id: reversal.id, ledger_account_id: posting.ledger_account_id,
88:         direction: (posting.direction === 'debit' ? 'credit' : 'debit') as PostingDirection,
89:         amount_minor: posting.amount_minor,
90:       })),
91:     })
92:     return { entryId: reversal.id, duplicate: false }
93:   }
94: 
95:   async balance(params: {
96:     storeId: bigint; mode: Mode; currency: string; accountType: LedgerAccountType
97:     beneficiaryId?: bigint | null; paymentAccountId?: bigint | null
98:   }): Promise<bigint> {
99:     const account = await this.prisma.guarded().ledgerAccount.findFirst({
100:       where: {
101:         store_id: params.storeId, mode: params.mode, currency: params.currency,
102:         account_type: params.accountType,
103:         beneficiary_id: params.beneficiaryId ?? null,
104:         payment_account_id: params.paymentAccountId ?? null,
105:       },
106:       select: { id: true },
107:     })
108:     if (!account) return 0n
109:     const rows = await this.prisma.$queryRaw<DirectionTotalRow[]>`
110:       SELECT direction, SUM(amount_minor) AS total
111:       FROM ledger_postings WHERE ledger_account_id = ${account.id} GROUP BY direction
112:     `
113:     let balance = 0n
114:     for (const row of rows) {
115:       const total = row.total === null ? 0n : BigInt(row.total)
116:       balance += row.direction === 'debit' ? total : -total
117:     }
118:     return balance
119:   }
120: 
121:   /**
122:    * All non-zero balances for a store, grouped by currency and account
123:    * type.
124:    *
125:    * Additive read path for the merchant dashboard; posting behaviour is
126:    * unchanged. The ::bigint cast keeps the declared type honest, since
127:    * SUM() over a bigint column returns numeric.
128:    */
129:   async summary(storeId: bigint, mode: Mode): Promise<LedgerBalance[]> {
130:     const rows = await this.prisma.$queryRaw<AccountBalanceRow[]>`
131:       SELECT la.currency,
132:              la.account_type,
133:              SUM(
134:                CASE WHEN lp.direction = 'debit'
135:                     THEN lp.amount_minor
136:                     ELSE -lp.amount_minor
137:                END
138:              )::bigint AS balance
139:       FROM ledger_accounts la
140:       JOIN ledger_postings lp ON lp.ledger_account_id = la.id
141:       WHERE la.store_id = ${storeId}
142:         AND la.mode::text = ${mode}
143:       GROUP BY la.currency, la.account_type
144:       ORDER BY la.currency ASC, la.account_type ASC
145:     `
146: 
147:     return rows
148:       .map((row) => ({
149:         currency: row.currency,
150:         accountType: row.account_type,
151:         balanceMinor: BigInt(row.balance),
152:       }))
153:       .filter((row) => row.balanceMinor !== 0n)
154:   }
155: 
156:   async findUnbalancedEntries(limit = 50): Promise<bigint[]> {
157:     const rows = await this.prisma.$queryRaw<EntryIdRow[]>`
158:       SELECT entry_id FROM ledger_postings GROUP BY entry_id
159:       HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE 0 END)
160:           <> SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE 0 END)
161:       LIMIT ${limit}
162:     `
163:     return rows.map((row) => BigInt(row.entry_id))
164:   }
165: 
166:   private validate(input: JournalEntryInput): void {
167:     if (input.postings.length < 2) {
168:       throw new LedgerError('A journal entry needs at least two postings.')
169:     }
170:     if (!/^[A-Z]{3}$/.test(input.currency)) {
171:       throw new LedgerError(`Invalid currency code: "${input.currency}".`)
172:     }
173:     let debits = 0n, credits = 0n
174:     for (const posting of input.postings) {
175:       if (posting.amountMinor <= 0n) {
176:         throw new LedgerError(
177:           `Posting amount must be positive (direction carries the sign). Received: ${posting.amountMinor}.`,
178:         )
179:       }
180:       if (posting.direction === 'debit') debits += posting.amountMinor
181:       else credits += posting.amountMinor
182:     }
183:     if (debits !== credits) {
184:       throw new LedgerError(
185:         `Unbalanced journal entry: debits ${debits} vs credits ${credits}.`,
186:       )
187:     }
188:   }
189: 
190:   private async resolveAccounts(tx: Prisma.TransactionClient, input: JournalEntryInput): Promise<bigint[]> {
191:     const lockKey = `ledger:${input.storeId}:${input.mode}:${input.currency}`
192:     // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and
193:     // Prisma has no deserializer for that type, so $queryRaw fails with
194:     // "Failed to deserialize column of type 'void'". Nothing reads the
195:     // result here — the statement is executed purely for the lock.
196:     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
197:     const ids: bigint[] = []
198:     for (const posting of input.postings) ids.push(await this.resolveAccount(tx, input, posting))
199:     return ids
200:   }
201: 
202:   private async resolveAccount(
203:     tx: Prisma.TransactionClient, input: JournalEntryInput, posting: PostingInput,
204:   ): Promise<bigint> {
205:     const where = {
206:       store_id: input.storeId, mode: input.mode, currency: input.currency,
207:       account_type: posting.accountType,
208:       beneficiary_id: posting.beneficiaryId ?? null,
209:       payment_account_id: posting.paymentAccountId ?? null,
210:     }
211:     const existing = await tx.ledgerAccount.findFirst({ where, select: { id: true } })
212:     if (existing) return existing.id
213:     const created = await tx.ledgerAccount.create({ data: where, select: { id: true } })
214:     this.logger.log(
215:       `Ledger account created: ${posting.accountType} / ${input.currency} / store ${input.storeId} / ${input.mode}`,
216:     )
217:     return created.id
218:   }
219: }

(End of file - total 219 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/messaging/outbox.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/messaging/outbox.service.ts</path>
<type>file</type>
<content>
1: import { Injectable } from '@nestjs/common'
2: import type { Prisma } from '@prisma/client'
3: import {
4:   CURRENT_EVENT_VERSION,
5:   OutboxEnvelope,
6:   assertPayloadIsSafe,
7: } from './messaging.types'
8: 
9: /**
10:  * كتابة الأحداث في صندوق الصادر.
11:  *
12:  * ⚠️ **بياخد عميل الـ transaction من المستدعي.** ده جوهر الفكرة:
13:  * الحدث بيتكتب جوه نفس الـ transaction بتاعة تغيير الحالة، فمستحيل
14:  * الحالة تتحفظ والحدث يضيع أو العكس.
15:  *
16:  * الاستخدام المتوقع في المرحلة 1b:
17:  *
18:  *   await this.prisma.$transaction(async (tx) => {
19:  *     const order = await tx.order.create({ ... })
20:  *     await this.outbox.emit(tx, {
21:  *       storeId, mode,
22:  *       aggregateType: 'checkout',
23:  *       aggregateId: checkout.id.toString(),
24:  *       eventType: 'checkout.committed',
25:  *       payload: { checkoutId, orderId: order.id.toString() },
26:  *     })
27:  *   })
28:  *
29:  * ❌ ماينفعش يتنادى بـ PrismaService مباشرةً برّه transaction — ساعتها
30:  * الضمانة بتضيع وبتبقى كتابة مزدوجة عادية.
31:  */
32: @Injectable()
33: export class OutboxService {
34:   async emit(
35:     tx: Prisma.TransactionClient,
36:     envelope: OutboxEnvelope,
37:   ): Promise<bigint> {
38:     assertPayloadIsSafe(envelope.payload)
39: 
40:     const created = await tx.outboxMessage.create({
41:       data: {
42:         store_id: envelope.storeId,
43:         mode: envelope.mode,
44:         aggregate_type: envelope.aggregateType,
45:         aggregate_id: envelope.aggregateId,
46:         event_type: envelope.eventType,
47:         event_version: envelope.eventVersion ?? CURRENT_EVENT_VERSION,
48:         payload: envelope.payload as Prisma.InputJsonValue,
49:         occurred_at: envelope.occurredAt ?? new Date(),
50:       },
51:       select: { id: true },
52:     })
53: 
54:     return created.id
55:   }
56: 
57:   /** يكتب أكتر من حدث في نفس الـ transaction */
58:   async emitMany(
59:     tx: Prisma.TransactionClient,
60:     envelopes: readonly OutboxEnvelope[],
61:   ): Promise<void> {
62:     // الفحص كله الأول: صف واحد غير آمن مايخلّيش أي صف يتكتب
63:     for (const envelope of envelopes) {
64:       assertPayloadIsSafe(envelope.payload)
65:     }
66: 
67:     await tx.outboxMessage.createMany({
68:       data: envelopes.map((envelope) => ({
69:         store_id: envelope.storeId,
70:         mode: envelope.mode,
71:         aggregate_type: envelope.aggregateType,
72:         aggregate_id: envelope.aggregateId,
73:         event_type: envelope.eventType,
74:         event_version: envelope.eventVersion ?? CURRENT_EVENT_VERSION,
75:         payload: envelope.payload as Prisma.InputJsonValue,
76:         occurred_at: envelope.occurredAt ?? new Date(),
77:       })),
78:     })
79:   }
80: }

(End of file - total 80 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/messaging/outbox-dispatcher.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/messaging/outbox-dispatcher.service.ts</path>
<type>file</type>
<content>
1: import {
2:   Injectable,
3:   Logger,
4:   OnModuleDestroy,
5:   OnModuleInit,
6: } from '@nestjs/common'
7: import { ConfigService } from '@nestjs/config'
8: import { SchedulerRegistry } from '@nestjs/schedule'
9: import { hostname } from 'os'
10: import { randomUUID } from 'crypto'
11: import { PrismaService } from '../../prisma/prisma.service'
12: import type { MessagingConfig } from '../config/configuration'
13: import { ConsumedEventService } from './consumed-event.service'
14: import { OutboxHandlerRegistry } from './outbox-handler.registry'
15: import { OutboxRecord } from './messaging.types'
16: 
17: /**
18:  * ══════════════════════════════════════════════════════════════════
19:  * موزّع صندوق الصادر
20:  * ══════════════════════════════════════════════════════════════════
21:  *
22:  * موزّع بالاستطلاع مع حجز (leased poller). من غير Redis ولا BullMQ —
23:  * دول متأجّلين للمرحلة 2.
24:  *
25:  * الحجز الآمن بين أكتر من instance بيتعمل بـ:
26:  *
27:  *   FOR UPDATE SKIP LOCKED
28:  *
29:  * ده بيخلي كل عامل ياخد دفعة مختلفة من غير تعارض ومن غير انتظار.
30:  * لو عامل وقع وهو ماسك رسايل، الحجز بينتهي (claim_expires_at) وعامل
31:  * تاني بياخدها.
32:  *
33:  * ⚠️ التسليم at-least-once مش exactly-once: رسالة ممكن تتسلّم مرتين لو
34:  * الحجز انتهى أثناء معالجة بطيئة. المستهلكين **لازم** يكونوا idempotent،
35:  * وده اللي ConsumedEventService بيضمنه بقيد فريد في قاعدة البيانات.
36:  *
37:  * ملاحظة على الجدولة: الفترة بتتسجّل ديناميكياً في SchedulerRegistry
38:  * مش بديكوريتر @Interval، لأن الديكوريتر بيتقيّم وقت تعريف الكلاس وقتها
39:  * ConfigService لسه مش متاح — يعني القيمة كانت هتفضل ثابتة في الكود
40:  * ومتغيّر البيئة يبقى بلا معنى.
41:  *
42:  * المرحلة 1a: سجل المستهلكين فاضي، فالموزّع بيشتغل على جدول فاضي.
43:  */
44: @Injectable()
45: export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
46:   private readonly logger = new Logger(OutboxDispatcherService.name)
47: 
48:   /** معرّف فريد للعامل — بيتكتب في claimed_by */
49:   private readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
50: 
51:   private static readonly INTERVAL_NAME = 'outbox-dispatcher'
52: 
53:   /** بيمنع تداخل الدورات داخل نفس الـ instance */
54:   private running = false
55: 
56:   constructor(
57:     private readonly prisma: PrismaService,
58:     private readonly config: ConfigService,
59:     private readonly registry: OutboxHandlerRegistry,
60:     private readonly consumed: ConsumedEventService,
61:     private readonly scheduler: SchedulerRegistry,
62:   ) {}
63: 
64:   onModuleInit(): void {
65:     if (!this.settings.dispatcherEnabled) {
66:       this.logger.warn(
67:         'موزّع صندوق الصادر متوقّف (OUTBOX_DISPATCHER_ENABLED=false). ' +
68:           'الأحداث هتتكتب ومحدش هيعالجها.',
69:       )
70:       return
71:     }
72: 
73:     const intervalMs = this.settings.pollIntervalMs
74: 
75:     const handle = setInterval(() => {
76:       void this.poll()
77:     }, intervalMs)
78: 
79:     this.scheduler.addInterval(OutboxDispatcherService.INTERVAL_NAME, handle)
80: 
81:     this.logger.log(
82:       `موزّع صندوق الصادر شغّال — عامل ${this.workerId}، ` +
83:         `كل ${intervalMs}ms، دفعة ${this.settings.batchSize}.`,
84:     )
85:   }
86: 
87:   onModuleDestroy(): void {
88:     // من غير ده، إعادة التشغيل السريعة بتسيب مؤقتات شغالة
89:     if (
90:       this.scheduler.doesExist('interval', OutboxDispatcherService.INTERVAL_NAME)
91:     ) {
92:       this.scheduler.deleteInterval(OutboxDispatcherService.INTERVAL_NAME)
93:     }
94:   }
95: 
96:   private get settings(): MessagingConfig {
97:     return this.config.getOrThrow<MessagingConfig>('messaging')
98:   }
99: 
100:   /** دورة الاستطلاع — بتتسجّل في onModuleInit */
101:   async poll(): Promise<void> {
102:     // التداخل بين instances متعالج بالحجز في قاعدة البيانات؛
103:     // ده بيمنع التداخل جوه الـ instance الواحدة بس.
104:     if (this.running) return
105: 
106:     this.running = true
107:     try {
108:       await this.dispatchBatch()
109:     } catch (error) {
110:       this.logger.error(
111:         `دورة توزيع فشلت: ${(error as Error).message}`,
112:         (error as Error).stack,
113:       )
114:     } finally {
115:       this.running = false
116:     }
117:   }
118: 
119:   /** يحجز دفعة ويعالجها. بيرجّع عدد الرسايل اللي اتعالجت. */
120:   async dispatchBatch(): Promise<number> {
121:     const claimed = await this.claimBatch()
122:     if (claimed.length === 0) return 0
123: 
124:     for (const message of claimed) {
125:       await this.dispatchOne(message)
126:     }
127: 
128:     return claimed.length
129:   }
130: 
131:   /**
132:    * يحجز دفعة رسايل ذرّياً.
133:    *
134:    * بياخد:
135:    *   • الرسايل المعلّقة اللي حان وقتها
136:    *   • الرسايل المحجوزة اللي حجزها انتهى (عامل وقع)
137:    */
138:   private async claimBatch(): Promise<OutboxRecord[]> {
139:     const { leaseSeconds, batchSize } = this.settings
140:     const leaseExpiry = new Date(Date.now() + leaseSeconds * 1000)
141: 
142:     const rows = await this.prisma.$queryRaw<
143:       {
144:         id: bigint
145:         store_id: bigint
146:         mode: 'test' | 'live'
147:         aggregate_type: string
148:         aggregate_id: string
149:         event_type: string
150:         event_version: number
151:         payload: Record<string, unknown>
152:         attempts: number
153:         occurred_at: Date
154:       }[]
155:     >`
156:       UPDATE outbox_messages AS target
157:       SET status = 'claimed',
158:           claimed_by = ${this.workerId},
159:           claim_expires_at = ${leaseExpiry}
160:       FROM (
161:         SELECT id
162:         FROM outbox_messages
163:         WHERE (status = 'pending' AND next_attempt_at <= now())
164:            OR (status = 'claimed' AND claim_expires_at < now())
165:         ORDER BY id ASC
166:         LIMIT ${batchSize}
167:         FOR UPDATE SKIP LOCKED
168:       ) AS candidate
169:       WHERE target.id = candidate.id
170:       RETURNING target.id, target.store_id, target.mode, target.aggregate_type,
171:                 target.aggregate_id, target.event_type, target.event_version,
172:                 target.payload, target.attempts, target.occurred_at
173:     `
174: 
175:     return rows.map((row) => ({
176:       id: typeof row.id === 'bigint' ? row.id : BigInt(row.id as never),
177:       storeId:
178:         typeof row.store_id === 'bigint'
179:           ? row.store_id
180:           : BigInt(row.store_id as never),
181:       mode: row.mode,
182:       aggregateType: row.aggregate_type,
183:       aggregateId: row.aggregate_id,
184:       eventType: row.event_type,
185:       eventVersion: row.event_version,
186:       payload: row.payload ?? {},
187:       attempts: row.attempts,
188:       occurredAt: row.occurred_at,
189:     }))
190:   }
191: 
192:   private async dispatchOne(message: OutboxRecord): Promise<void> {
193:     const handlers = this.registry.handlersFor(message.eventType)
194: 
195:     // مفيش مستهلك مسجّل — الحالة الطبيعية في المرحلة 1a.
196:     // بنعلّمها منشورة عشان مانفضلش نحاول عليها للأبد.
197:     if (handlers.length === 0) {
198:       await this.markPublished(message.id, 'no_handlers')
199:       return
200:     }
201: 
202:     // Tracks the claim held while a handler runs, so it can be released
203:     // if that handler throws.
204:     let claimedBy: string | null = null
205: 
206:     try {
207:       for (const handler of handlers) {
208:         const first = await this.consumed.tryConsume(
209:           handler.consumerName,
210:           message,
211:         )
212: 
213:         if (!first) {
214:           this.logger.debug(
215:             `تخطّي: ${handler.consumerName} استهلك الرسالة ${message.id} قبل كده.`,
216:           )
217:           continue
218:         }
219: 
220:         claimedBy = handler.consumerName
221:         await handler.handle(message)
222:         claimedBy = null
223:       }
224: 
225:       await this.markPublished(message.id, 'ok')
226:     } catch (error) {
227:       // The claim is taken before the handler runs so concurrent workers
228:       // cannot both process it. If the handler then fails, the claim must
229:       // go, or every retry skips it and the message is marked published
230:       // without ever having been handled.
231:       if (claimedBy) {
232:         await this.consumed
233:           .release(claimedBy, message.id)
234:           .catch((releaseError) =>
235:             this.logger.error(
236:               `فشل تحرير حجز ${claimedBy} للرسالة ${message.id}: ` +
237:                 `${(releaseError as Error).message}`,
238:             ),
239:           )
240:       }
241: 
242:       await this.markFailed(message, error as Error)
243:     }
244:   }
245: 
246:   private async markPublished(id: bigint, reason: string): Promise<void> {
247:     await this.prisma.outboxMessage.updateMany({
248:       where: { id },
249:       data: {
250:         status: 'published',
251:         published_at: new Date(),
252:         claimed_by: null,
253:         claim_expires_at: null,
254:         last_error: reason === 'ok' ? null : reason,
255:       },
256:     })
257:   }
258: 
259:   private async markFailed(message: OutboxRecord, error: Error): Promise<void> {
260:     const { maxAttempts, backoffBaseSeconds } = this.settings
261: 
262:     const attempts = message.attempts + 1
263:     const isDead = attempts >= maxAttempts
264: 
265:     // تراجع أسي: 5s, 10s, 20s, 40s ...
266:     const delaySeconds = backoffBaseSeconds * 2 ** (attempts - 1)
267:     const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000)
268: 
269:     await this.prisma.outboxMessage.updateMany({
270:       where: { id: message.id },
271:       data: {
272:         status: isDead ? 'dead' : 'pending',
273:         attempts,
274:         next_attempt_at: nextAttemptAt,
275:         last_error: error.message.slice(0, 2000),
276:         claimed_by: null,
277:         claim_expires_at: null,
278:       },
279:     })
280: 
281:     if (isDead) {
282:       // ⚠️ في المرحلة 1b الرسالة الميتة معناها عملية دفع نجحت وطلب
283:       // ماتعملش. لازم تنبيه حقيقي، مش سطر لوج بس.
284:       this.logger.error(
285:         `[outbox-dead-letter] الرسالة ${message.id} (${message.eventType}) ` +
286:           `فشلت ${attempts} مرة ووصلت للحد الأقصى. متجر ${message.storeId} ` +
287:           `وضع ${message.mode}. آخر خطأ: ${error.message}`,
288:       )
289:     } else {
290:       this.logger.warn(
291:         `الرسالة ${message.id} (${message.eventType}) فشلت — محاولة ${attempts}/` +
292:           `${maxAttempts}، إعادة بعد ${delaySeconds}s: ${error.message}`,
293:       )
294:     }
295:   }
296: 
297:   /** عدد الرسايل الميتة — للمراقبة والتنبيه */
298:   async deadLetterCount(): Promise<number> {
299:     return this.prisma.outboxMessage.count({ where: { status: 'dead' } })
300:   }
301: 
302:   /**
303:    * الرسايل المعلّقة أكتر من المدة المحددة.
304:    *
305:    * صندوق واقف معناه إن أحداث بتتكتب وماحدش بيعالجها. لازم تنبيه.
306:    */
307:   async stalePendingCount(olderThanSeconds = 300): Promise<number> {
308:     return this.prisma.outboxMessage.count({
309:       where: {
310:         status: 'pending',
311:         created_at: { lt: new Date(Date.now() - olderThanSeconds * 1000) },
312:       },
313:     })
314:   }
315: }

(End of file - total 315 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/ids/id-reservation.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/ids/id-reservation.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger } from '@nestjs/common'
2: import { PrismaService } from '../../prisma/prisma.service'
3: 
4: /**
5:  * ══════════════════════════════════════════════════════════════════
6:  * حجز المعرّفات قبل الإدراج
7:  * ══════════════════════════════════════════════════════════════════
8:  *
9:  * ليه موجودة أصلاً:
10:  *
11:  * صيغة الـ AAD المجمّدة (common/crypto) بتربط كل نص مشفّر بـ
12:  * (المتجر، الوضع، نوع الصف، **معرّف الصف**، اسم الحقل). يعني المعرّف
13:  * لازم يكون معروف **قبل** التشفير، مش بعد الإدراج.
14:  *
15:  * البديل — إدراج الصف الأول وبعدين تشفير وتحديث — معناه إن الصف
16:  * بيتولد ثانية بقيمة غير مشفّرة أو فاضية، وإن كل كتابة بتبقى عمليتين.
17:  * ده اللي رفضناه.
18:  *
19:  * الآلية:
20:  *
21:  *   nextval(pg_get_serial_sequence('table','id'))
22:  *
23:  * خصائص مهمة:
24:  *   • ذرّية — استدعاءين متوازيين مستحيل يرجّعوا نفس الرقم.
25:  *   • **مش تفاعلية مع الـ transaction** — الـ sequence بتتقدّم حتى لو
26:  *     الـ transaction اترجعت. وده المطلوب بالظبط: معرّف اتربط بيه نص
27:  *     مشفّر ماينفعش يترجع للاستخدام تاني.
28:  *   • بتسيب فجوات في الأرقام. الفجوات دي طبيعية ومتوقعة ومش مشكلة.
29:  *
30:  * ⚠️ أي جدول هيخزّن نص مشفّر مربوط بـ AAD لازم يكون مفتاحه BigInt
31:  * مربوط بـ sequence. ممنوع UUID أو معرّف بيتولد في التطبيق.
32:  */
33: 
34: /** الجداول المسموح الحجز منها — قائمة صريحة بدل اسم جدول حر */
35: export interface ReservableTable {
36:   /** اسم الجدول في قاعدة البيانات (اللي في @@map) */
37:   readonly table: string
38:   /** عمود المفتاح الأساسي */
39:   readonly column: string
40: }
41: 
42: /** مفتاح جدول حسابات الدفع — أول مستهلك للخدمة (المرحلة 1b.1) */
43: export const PAYMENT_ACCOUNTS_TABLE = 'payment_accounts'
44: 
45: export const PAYMENT_INTENTS_TABLE = 'payment_intents'
46: 
47: export const RESERVABLE_TABLES: Record<string, ReservableTable> = {
48:   [PAYMENT_ACCOUNTS_TABLE]: { table: 'payment_accounts', column: 'id' },
49:   [PAYMENT_INTENTS_TABLE]: { table: 'payment_intents', column: 'id' },
50: }
51: 
52: export class IdReservationError extends Error {
53:   constructor(message: string) {
54:     super(message)
55:     this.name = 'IdReservationError'
56:     Object.setPrototypeOf(this, IdReservationError.prototype)
57:   }
58: }
59: 
60: /** أقصى عدد معرّفات في الحجز الواحد — حاجز أمان ضد استدعاء بالغلط */
61: const MAX_BATCH = 1000
62: 
63: @Injectable()
64: export class IdReservationService {
65:   private readonly logger = new Logger(IdReservationService.name)
66: 
67:   constructor(private readonly prisma: PrismaService) {}
68: 
69:   /**
70:    * يحجز معرّف واحد.
71:    *
72:    * بيتنفّذ خارج أي transaction عن قصد — حتى لو المستدعي جوه واحدة،
73:    * nextval مالهاش علاقة بالـ transaction، والمعرّف المحجوز مش هيترجع.
74:    */
75:   async reserve(key: string): Promise<bigint> {
76:     const [id] = await this.reserveMany(key, 1)
77:     return id
78:   }
79: 
80:   /**
81:    * يحجز مجموعة معرّفات.
82:    *
83:    * مفيدة للإدراج بالجملة: بنجيب كل المعرّفات مرة واحدة، بنشفّر، وبعدين
84:    * createMany في عملية واحدة.
85:    */
86:   async reserveMany(key: string, count: number): Promise<bigint[]> {
87:     const target = this.resolve(key)
88: 
89:     if (!Number.isSafeInteger(count) || count < 1) {
90:       throw new IdReservationError(
91:         `عدد المعرّفات لازم يكون عدد صحيح موجب (استلمنا: ${count}).`,
92:       )
93:     }
94: 
95:     if (count > MAX_BATCH) {
96:       throw new IdReservationError(
97:         `الحد الأقصى للحجز الواحد ${MAX_BATCH} معرّف (طُلب: ${count}).`,
98:       )
99:     }
100: 
101:     // القيم متمرّرة كباراميترات مش مدمجة في النص، فمفيش أي احتمال حقن.
102:     // pg_get_serial_sequence بتاخد أسماء نصية، فالباراميترات شغالة معاها.
103:     const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
104:       SELECT nextval(pg_get_serial_sequence(${target.table}, ${target.column})) AS id
105:       FROM generate_series(1, ${count})
106:     `
107: 
108:     if (rows.length !== count) {
109:       throw new IdReservationError(
110:         `توقعنا ${count} معرّف من ${target.table} واستلمنا ${rows.length}.`,
111:       )
112:     }
113: 
114:     return rows.map((row) => {
115:       const value = row.id
116:       if (typeof value !== 'bigint') {
117:         // بعض إعدادات الدرايفر بترجّع string لأنواع bigint
118:         return BigInt(value as unknown as string)
119:       }
120:       return value
121:     })
122:   }
123: 
124:   /** يتأكد إن الجدول مسجّل في القائمة المسموحة */
125:   private resolve(key: string): ReservableTable {
126:     const target = RESERVABLE_TABLES[key]
127: 
128:     if (!target) {
129:       const available = Object.keys(RESERVABLE_TABLES)
130:       throw new IdReservationError(
131:         `الجدول "${key}" مش مسجّل في RESERVABLE_TABLES. ` +
132:           `المتاح: [${available.join(', ')}].`,
133:       )
134:     }
135: 
136:     return target
137:   }
138: }

(End of file - total 138 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.3s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger, NotFoundException } from '@nestjs/common'
2: import { Prisma } from '@prisma/client'
3: import type {
4:   Mode,
5:   PaymentEventSource,
6:   StorePaymentMode,
7: } from '@prisma/client'
8: import { PrismaService } from '../../../prisma/prisma.service'
9: import { LedgerService } from '../../../ledger/ledger.service'
10: import { captureSucceeded, refundIssued } from '../../../ledger/posting-rules'
11: import { OutboxService } from '../../../common/messaging/outbox.service'
12: import { isUniqueConstraintError } from '../../../common/idempotency/idempotency.types'
13: import type { ObservedFact } from '../gateways/provider.types'
14: import { decideFact, type FactDecision } from './fact-decision'
15: import { crossStoreQuery } from '../../../common/tenant/cross-store-query'
16: import { allocate, money } from '../../../common/money/money.util'
17: import { CheckoutFinalizerService } from './checkout-finalizer.service'
18: 
19: /**
20:  * ==================================================================
21:  * Applying observed facts
22:  * ==================================================================
23:  *
24:  * One consumer, three producers. Webhooks, reconciliation sweeps and a
25:  * customer returning from a gateway all produce ObservedFacts and all
26:  * arrive here. Because the dedupe key is derived from the fact's content
27:  * rather than from how it travelled, the same fact delivered by all
28:  * three routes is applied exactly once.
29:  *
30:  * That is the property that makes the system correct when webhooks are
31:  * lost, and it only holds if nothing else is allowed to mutate payment
32:  * state from a provider signal.
33:  */
34: 
35: /** Facts that mean the money is secured and the order may exist. */
36: const SECURES_FUNDS = new Set(['attempt_authorized', 'attempt_captured'])
37: 
38: /** Facts that mean the payment will never complete. */
39: const RELEASES_FUNDS = new Set([
40:   'attempt_failed',
41:   'attempt_expired',
42:   'attempt_voided',
43: ])
44: 
45: export type ApplyOutcome =
46:   | 'applied'
47:   | 'duplicate'
48:   | 'ignored'
49:   | 'recorded'
50:   | 'unmatched'
51: 
52: export interface ApplyResult {
53:   readonly outcome: ApplyOutcome
54:   readonly intentId: bigint | null
55:   readonly reason?: string
56: }
57: 
58: @Injectable()
59: export class PaymentFactApplier {
60:   private readonly logger = new Logger(PaymentFactApplier.name)
61: 
62:   constructor(
63:     private readonly prisma: PrismaService,
64:     private readonly ledger: LedgerService,
65:     private readonly outbox: OutboxService,
66:     private readonly finalizer: CheckoutFinalizerService,
67:   ) {}
68: 
69:   async applyMany(
70:     facts: readonly ObservedFact[],
71:     source: PaymentEventSource,
72:   ): Promise<ApplyResult[]> {
73:     const results: ApplyResult[] = []
74: 
75:     for (const fact of facts) {
76:       results.push(await this.apply(fact, source))
77:     }
78: 
79:     return results
80:   }
81: 
82:   /**
83:    * @param source which route delivered this fact. Recorded on the event
84:    * so the audit trail shows whether the webhook, the sweep or the
85:    * customer's return got there first.
86:    */
87:   async apply(
88:     fact: ObservedFact,
89:     source: PaymentEventSource,
90:   ): Promise<ApplyResult> {
91:     // The attempt is found by (account, gateway reference), which is
92:     // unique. Scoping to the account rather than the gateway is what
93:     // stops two stores sharing one provider account from colliding.
94:     // A webhook carries a provider reference, not a store. The store is
95:     // derived from the account this attempt belongs to, so requiring
96:     // store_id here would mean guessing the answer before finding it.
97:     const attempt = await crossStoreQuery(
98:       'provider_lookup',
99:       'resolve the attempt a provider fact belongs to',
100:       () =>
101:         this.prisma.guarded().paymentAttempt.findFirst({
102:           where: {
103:             account_id: fact.accountId,
104:             gateway_reference: fact.gatewayReference,
105:           },
106:         }),
107:     )
108: 
109:     if (!attempt) {
110:       // Not an error: the provider may be faster than our own write, or
111:       // the reference may belong to a test intent that was purged. The
112:       // caller decides whether to retry later.
113:       this.logger.warn(
114:         `Unmatched fact ${fact.factType} for account ${fact.accountId} ref ${fact.gatewayReference}.`,
115:       )
116:       return { outcome: 'unmatched', intentId: null }
117:     }
118: 
119:     const intent = await this.prisma.guarded().paymentIntent.findFirst({
120:       where: {
121:         id: attempt.intent_id,
122:         store_id: attempt.store_id,
123:         mode: attempt.mode,
124:       },
125:     })
126: 
127:     if (!intent) {
128:       throw new NotFoundException(
129:         `Attempt ${attempt.id} references a missing intent.`,
130:       )
131:     }
132: 
133:     const decision = decideFact({
134:       snapshot: {
135:         status: intent.status,
136:         capturedTotalMinor: intent.captured_total_minor,
137:         refundedTotalMinor: intent.refunded_total_minor,
138:       },
139:       amountMinor: intent.amount_minor,
140:       factType: fact.factType,
141:       cumulativeAmountMinor: fact.cumulativeAmountMinor,
142:       providerSequence: fact.providerSequence,
143:       occurredAt: fact.occurredAt,
144:     })
145: 
146:     if (decision.kind === 'ignore') {
147:       // Superseded facts are still stored. Dropping them loses the
148:       // evidence that would explain a disputed sequence later.
149:       await this.recordEvent(fact, intent.id, intent.store_id, intent.mode, {
150:         applied: false,
151:         supersededReason: decision.reason,
152:         source,
153:       })
154:       return {
155:         // A fact carrying nothing new is a duplicate, not a fault.
156:         outcome: decision.reason === 'already_applied' ? 'duplicate' : 'ignored',
157:         intentId: intent.id,
158:         reason: decision.reason,
159:       }
160:     }
161: 
162:     if (decision.kind === 'record_only') {
163:       await this.recordEvent(fact, intent.id, intent.store_id, intent.mode, {
164:         applied: false,
165:         supersededReason: 'not_actionable',
166:         source,
167:       })
168:       return { outcome: 'recorded', intentId: intent.id, reason: decision.note }
169:     }
170: 
171:     const now = new Date()
172: 
173:     // A refund does not touch the attempt or create a capture, so it has
174:     // its own path rather than being forced through the capture shape.
175:     if (decision.kind === 'apply_refund') {
176:       return this.applyRefund(fact, intent, decision, source, now)
177:     }
178: 
179:     try {
180:       await this.prisma.$transaction(
181:         async (tx) => {
182:         // The unique dedupe key on payment_events is the idempotency
183:         // guarantee. It is inserted first so a duplicate aborts the whole
184:         // transaction before anything else is written.
185:         await tx.paymentEvent.create({
186:           data: {
187:             intent_id: intent.id,
188:             store_id: intent.store_id,
189:             mode: intent.mode,
190:             event_type: fact.factType,
191:             dedupe_key: fact.dedupeKey,
192:             source,
193:             applied: true,
194:             payload_redacted: (fact.rawRedacted ??
195:               null) as Prisma.InputJsonValue,
196:             occurred_at: fact.occurredAt ?? now,
197:           },
198:         })
199: 
200:         // Optimistic concurrency: if another writer moved the intent
201:         // between the read and here, this matches nothing and the whole
202:         // transaction is abandoned.
203:         const updated = await tx.paymentIntent.updateMany({
204:           where: { id: intent.id, version: intent.version },
205:           data: {
206:             status: decision.intentStatus,
207:             captured_total_minor: decision.capturedTotalMinor,
208:             refunded_total_minor: decision.refundedTotalMinor,
209:             terminal_at: decision.terminal ? now : null,
210:             version: { increment: 1 },
211:           },
212:         })
213: 
214:         if (updated.count === 0) {
215:           throw new ConcurrentIntentUpdate(intent.id)
216:         }
217: 
218:         await tx.paymentAttempt.update({
219:           where: { id: attempt.id },
220:           data: {
221:             status: decision.attemptStatus,
222:             next_action_kind: 'none',
223:             gateway_payment_id:
224:               fact.refs?.gatewayPaymentId ?? attempt.gateway_payment_id,
225:           },
226:         })
227: 
228:         if (decision.newCaptureMinor !== null) {
229:           const beneficiaryId = await this.findBeneficiary(
230:             tx,
231:             intent.store_id,
232:             intent.mode,
233:             intent.currency,
234:           )
235: 
236:           const capture = await tx.capture.create({
237:             data: {
238:               intent_id: intent.id,
239:               attempt_id: attempt.id,
240:               store_id: intent.store_id,
241:               mode: intent.mode,
242:               amount_minor: decision.newCaptureMinor,
243:               currency: intent.currency,
244:               status: 'succeeded',
245:               gateway_capture_ref: fact.refs?.gatewayCaptureRef ?? null,
246:               captured_at: fact.occurredAt ?? now,
247:             },
248:             select: { id: true },
249:           })
250: 
251:           await tx.captureAllocation.create({
252:             data: {
253:               capture_id: capture.id,
254:               beneficiary_id: beneficiaryId,
255:               store_id: intent.store_id,
256:               mode: intent.mode,
257:               amount_minor: decision.newCaptureMinor,
258:               kind: 'revenue',
259:             },
260:           })
261: 
262:           // Money captured through a gateway lands in a receivable from
263:           // the provider, cleared later by the settlement.
264:           await this.ledger.post(tx, {
265:             storeId: intent.store_id,
266:             mode: intent.mode,
267:             currency: intent.currency,
268:             entryType: 'payment.captured.gateway',
269:             sourceKind: 'capture',
270:             sourceId: capture.id.toString(),
271:             dedupeKey: `${fact.dedupeKey}:ledger`,
272:             occurredAt: fact.occurredAt ?? now,
273:             memo: `Capture for intent ${intent.id}`,
274:             postings: captureSucceeded({
275:               totalMinor: decision.newCaptureMinor,
276:               paymentAccountId: fact.accountId,
277:               allocations: [
278:                 { beneficiaryId, amountMinor: decision.newCaptureMinor },
279:               ],
280:             }),
281:           })
282:         }
283: 
284:         // A funds_secured checkout has no order until here. Creating it
285:         // inside this transaction is what makes "order exists implies
286:         // money secured" true rather than merely usual.
287:         if (intent.context_kind === 'checkout' && intent.context_id !== '') {
288:           const checkoutId = BigInt(intent.context_id)
289: 
290:           if (SECURES_FUNDS.has(fact.factType)) {
291:             await this.finalizer.finalize(tx, {
292:               checkoutId,
293:               storeId: intent.store_id,
294:               mode: intent.mode,
295:               paid: decision.capturedTotalMinor > 0n,
296:               occurredAt: fact.occurredAt ?? now,
297:             })
298:           } else if (RELEASES_FUNDS.has(fact.factType)) {
299:             await this.finalizer.abandon(tx, {
300:               checkoutId,
301:               storeId: intent.store_id,
302:               occurredAt: fact.occurredAt ?? now,
303:             })
304:           }
305:         }
306: 
307:         await this.outbox.emit(tx, {
308:           storeId: intent.store_id,
309:           mode: intent.mode,
310:           aggregateType: 'payment_intent',
311:           aggregateId: intent.id.toString(),
312:           eventType: `payment.${fact.factType}`,
313:           payload: {
314:             intentId: intent.id.toString(),
315:             attemptId: attempt.id.toString(),
316:             factType: fact.factType,
317:             intentStatus: decision.intentStatus,
318:             capturedTotalMinor: decision.capturedTotalMinor.toString(),
319:             currency: intent.currency,
320:           },
321:           occurredAt: fact.occurredAt ?? now,
322:         })
323:         },
324:         // The default 5s is not enough once a second delivery of the
325:         // same fact is blocking on the dedupe key: the loser waits for
326:         // the winner to finish creating an order and moving stock.
327:         { timeout: 20_000, maxWait: 10_000 },
328:       )
329:     } catch (error) {
330:       if (isUniqueConstraintError(error)) {
331:         // Same fact, already applied by another route.
332:         return { outcome: 'duplicate', intentId: intent.id }
333:       }
334: 
335:       if (error instanceof ConcurrentIntentUpdate) {
336:         this.logger.warn(
337:           `Intent ${intent.id} changed underneath fact ${fact.dedupeKey}; not applied.`,
338:         )
339:         return {
340:           outcome: 'ignored',
341:           intentId: intent.id,
342:           reason: 'concurrent_update',
343:         }
344:       }
345: 
346:       throw error
347:     }
348: 
349:     this.logger.log(
350:       `Applied ${fact.factType} to intent ${intent.id} (${decision.intentStatus}).`,
351:     )
352: 
353:     return { outcome: 'applied', intentId: intent.id }
354:   }
355: 
356:   /* ---------------------------------------------------------------- */
357: 
358:   /**
359:    * Applies a refund reported by a provider.
360:    *
361:    * Creates the Refund row, allocates it proportionally to the original
362:    * capture's beneficiaries, posts the ledger entry and advances the
363:    * intent — all in one transaction, so a refund can never exist without
364:    * its ledger effect.
365:    *
366:    * The ledger rule is chosen from the intent's payment_mode snapshot,
367:    * never the store's current mode: a store that switches modes must
368:    * still refund old payments through the route that took them.
369:    */
370:   private async applyRefund(
371:     fact: ObservedFact,
372:     intent: {
373:       id: bigint
374:       store_id: bigint
375:       mode: Mode
376:       currency: string
377:       version: number
378:       account_id: bigint | null
379:       payment_mode: StorePaymentMode
380:       captured_total_minor: bigint
381:     },
382:     decision: Extract<FactDecision, { kind: 'apply_refund' }>,
383:     source: PaymentEventSource,
384:     now: Date,
385:   ): Promise<ApplyResult> {
386:     if (intent.payment_mode !== 'MERCHANT_GATEWAY') {
387:       // No posting rule exists for other modes yet, and guessing one
388:       // would put wrong numbers in an immutable ledger.
389:       this.logger.error(
390:         `Refund for intent ${intent.id} uses payment mode ` +
391:           `${intent.payment_mode}, which has no ledger rule. Not applied.`,
392:       )
393:       return {
394:         outcome: 'ignored',
395:         intentId: intent.id,
396:         reason: 'unsupported_payment_mode',
397:       }
398:     }
399: 
400:     if (intent.account_id === null) {
401:       this.logger.error(`Refund for intent ${intent.id} has no payment account.`)
402:       return { outcome: 'ignored', intentId: intent.id, reason: 'no_account' }
403:     }
404: 
405:     const accountId = intent.account_id
406: 
407:     try {
408:       await this.prisma.$transaction(
409:         async (tx) => {
410:           await tx.paymentEvent.create({
411:             data: {
412:               intent_id: intent.id,
413:               store_id: intent.store_id,
414:               mode: intent.mode,
415:               event_type: fact.factType,
416:               dedupe_key: fact.dedupeKey,
417:               source,
418:               applied: true,
419:               payload_redacted: (fact.rawRedacted ??
420:                 null) as Prisma.InputJsonValue,
421:               occurred_at: fact.occurredAt ?? now,
422:             },
423:           })
424: 
425:           const updated = await tx.paymentIntent.updateMany({
426:             where: { id: intent.id, version: intent.version },
427:             data: {
428:               status: decision.intentStatus,
429:               refunded_total_minor: decision.refundedTotalMinor,
430:               version: { increment: 1 },
431:             },
432:           })
433: 
434:           if (updated.count === 0) {
435:             throw new ConcurrentIntentUpdate(intent.id)
436:           }
437: 
438:           const allocations = await this.refundAllocations(
439:             tx,
440:             intent,
441:             decision.newRefundMinor,
442:           )
443: 
444:           const refund = await tx.refund.create({
445:             data: {
446:               intent_id: intent.id,
447:               store_id: intent.store_id,
448:               mode: intent.mode,
449:               amount_minor: decision.newRefundMinor,
450:               currency: intent.currency,
451:               status: 'succeeded',
452:               initiated_by: source === 'merchant' ? 'merchant' : 'provider',
453:               gateway_refund_ref: fact.refs?.gatewayCaptureRef ?? null,
454:               succeeded_at: fact.occurredAt ?? now,
455:             },
456:             select: { id: true },
457:           })
458: 
459:           await tx.refundAllocation.createMany({
460:             data: allocations.map((allocation) => ({
461:               refund_id: refund.id,
462:               beneficiary_id: allocation.beneficiaryId,
463:               store_id: intent.store_id,
464:               mode: intent.mode,
465:               amount_minor: allocation.amountMinor,
466:               kind: 'revenue' as const,
467:             })),
468:           })
469: 
470:           await this.ledger.post(tx, {
471:             storeId: intent.store_id,
472:             mode: intent.mode,
473:             currency: intent.currency,
474:             entryType: 'payment.refunded.gateway',
475:             sourceKind: 'refund',
476:             sourceId: refund.id.toString(),
477:             dedupeKey: `${fact.dedupeKey}:ledger`,
478:             occurredAt: fact.occurredAt ?? now,
479:             memo: `Refund for intent ${intent.id}`,
480:             postings: refundIssued({
481:               totalMinor: decision.newRefundMinor,
482:               paymentAccountId: accountId,
483:               allocations,
484:             }),
485:           })
486: 
487:           await this.syncOrderRefundStatus(tx, intent, decision)
488: 
489:           await this.outbox.emit(tx, {
490:             storeId: intent.store_id,
491:             mode: intent.mode,
492:             aggregateType: 'payment_intent',
493:             aggregateId: intent.id.toString(),
494:             eventType: 'payment.refunded',
495:             payload: {
496:               intentId: intent.id.toString(),
497:               refundId: refund.id.toString(),
498:               amountMinor: decision.newRefundMinor.toString(),
499:               refundedTotalMinor: decision.refundedTotalMinor.toString(),
500:               currency: intent.currency,
501:             },
502:             occurredAt: fact.occurredAt ?? now,
503:           })
504:         },
505:         { timeout: 20_000, maxWait: 10_000 },
506:       )
507:     } catch (error) {
508:       if (isUniqueConstraintError(error)) {
509:         return { outcome: 'duplicate', intentId: intent.id }
510:       }
511: 
512:       if (error instanceof ConcurrentIntentUpdate) {
513:         return {
514:           outcome: 'ignored',
515:           intentId: intent.id,
516:           reason: 'concurrent_update',
517:         }
518:       }
519: 
520:       throw error
521:     }
522: 
523:     this.logger.log(
524:       `Refunded ${decision.newRefundMinor} on intent ${intent.id} ` +
525:         `(${decision.intentStatus}).`,
526:     )
527: 
528:     return { outcome: 'applied', intentId: intent.id }
529:   }
530: 
531:   /**
532:    * Splits a refund across the beneficiaries of the original captures.
533:    *
534:    * Proportional, not "all to the store". Under MERCHANT_GATEWAY there
535:    * is one beneficiary and this is a single row, but the split is what
536:    * lets a managed model reclaim from each party correctly without
537:    * reworking the refund path.
538:    */
539:   private async refundAllocations(
540:     tx: Prisma.TransactionClient,
541:     intent: { id: bigint; store_id: bigint; mode: Mode; currency: string },
542:     amountMinor: bigint,
543:   ): Promise<{ beneficiaryId: bigint; amountMinor: bigint }[]> {
544:     // Scoped to this intent's own captures. Querying every allocation in
545:     // the store would split a refund across beneficiaries of unrelated
546:     // orders — invisible while there is one beneficiary, badly wrong the
547:     // moment there is more than one.
548:     const captures = await tx.capture.findMany({
549:       where: {
550:         intent_id: intent.id,
551:         store_id: intent.store_id,
552:         status: 'succeeded',
553:       },
554:       select: { id: true },
555:     })
556: 
557:     if (captures.length === 0) {
558:       throw new Error(`Intent ${intent.id} has no successful capture to refund.`)
559:     }
560: 
561:     const captured = await tx.captureAllocation.findMany({
562:       where: { capture_id: { in: captures.map((capture) => capture.id) } },
563:       select: { beneficiary_id: true, amount_minor: true },
564:     })
565: 
566:     const totals = new Map<string, bigint>()
567: 
568:     for (const row of captured) {
569:       const key = row.beneficiary_id.toString()
570:       totals.set(key, (totals.get(key) ?? 0n) + row.amount_minor)
571:     }
572: 
573:     if (totals.size === 0) {
574:       throw new Error(
575:         `Intent ${intent.id} has no capture allocations to refund against.`,
576:       )
577:     }
578: 
579:     const entries = [...totals.entries()]
580:     const weights = entries.map(([, amount]) => amount)
581: 
582:     // The intent's real currency, not a placeholder. money() validates
583:     // against the registry, so a placeholder threw on every refund.
584:     const shares = allocate(money(amountMinor, intent.currency), weights)
585: 
586:     return entries.map(([beneficiaryId], index) => ({
587:       beneficiaryId: BigInt(beneficiaryId),
588:       amountMinor: shares[index].amountMinor,
589:     }))
590:   }
591: 
592:   /** Keeps the order's payment_status in step with the intent. */
593:   private async syncOrderRefundStatus(
594:     tx: Prisma.TransactionClient,
595:     intent: { store_id: bigint; mode: Mode; id: bigint },
596:     decision: Extract<FactDecision, { kind: 'apply_refund' }>,
597:   ): Promise<void> {
598:     const checkoutIntent = await tx.paymentIntent.findFirst({
599:       where: { id: intent.id },
600:       select: { context_kind: true, context_id: true },
601:     })
602: 
603:     if (checkoutIntent?.context_kind !== 'checkout') return
604:     if (!checkoutIntent.context_id) return
605: 
606:     await tx.order.updateMany({
607:       where: {
608:         store_id: intent.store_id,
609:         checkout_id: BigInt(checkoutIntent.context_id),
610:       },
611:       data: {
612:         payment_status:
613:           decision.intentStatus === 'refunded' ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
614:       },
615:     })
616:   }
617: 
618:   private async recordEvent(
619:     fact: ObservedFact,
620:     intentId: bigint,
621:     storeId: bigint,
622:     mode: Mode,
623:     options: {
624:       applied: boolean
625:       supersededReason: string
626:       source: PaymentEventSource
627:     },
628:   ): Promise<void> {
629:     try {
630:       await this.prisma.guarded().paymentEvent.create({
631:         data: {
632:           intent_id: intentId,
633:           store_id: storeId,
634:           mode,
635:           event_type: fact.factType,
636:           dedupe_key: fact.dedupeKey,
637:           source: options.source,
638:           applied: options.applied,
639:           superseded_reason: options.supersededReason,
640:           payload_redacted: (fact.rawRedacted ?? null) as Prisma.InputJsonValue,
641:           occurred_at: fact.occurredAt ?? new Date(),
642:         },
643:       })
644:     } catch (error) {
645:       // Already recorded by another route; nothing further to do.
646:       if (!isUniqueConstraintError(error)) throw error
647:     }
648:   }
649: 
650:   /**
651:    * Resolves the store's beneficiary, creating it on first use.
652:    *
653:    * Runs inside the caller's transaction and behind an advisory lock.
654:    * The unique constraint on beneficiaries includes external_ref, which
655:    * is NULL for the store's own beneficiary, and Postgres treats every
656:    * NULL as distinct — so the constraint does not prevent duplicates.
657:    * Two concurrent captures would otherwise each create one, splitting a
658:    * store's revenue across two ledger accounts that never reconcile.
659:    */
660:   private async findBeneficiary(
661:     tx: Prisma.TransactionClient,
662:     storeId: bigint,
663:     mode: Mode,
664:     currency: string,
665:   ): Promise<bigint> {
666:     const lockKey = `beneficiary:${storeId}:${mode}`
667:     // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void and
668:     // Prisma has no deserializer for that type, so $queryRaw fails with
669:     // "Failed to deserialize column of type 'void'". Nothing reads the
670:     // result here — the statement is executed purely for the lock.
671:     await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
672: 
673:     const existing = await tx.beneficiary.findFirst({
674:       where: { store_id: storeId, mode, kind: 'store', external_ref: null },
675:       select: { id: true },
676:     })
677: 
678:     if (existing) return existing.id
679: 
680:     const created = await tx.beneficiary.create({
681:       data: {
682:         store_id: storeId,
683:         mode,
684:         kind: 'store',
685:         external_ref: null,
686:         default_currency: currency,
687:       },
688:       select: { id: true },
689:     })
690: 
691:     return created.id
692:   }
693: }
694: 
695: /** Raised when optimistic concurrency rejects the update. */
696: class ConcurrentIntentUpdate extends Error {
697:   constructor(readonly intentId: bigint) {
698:     super(`Intent ${intentId} was modified concurrently.`)
699:     this.name = 'ConcurrentIntentUpdate'
700:     Object.setPrototypeOf(this, ConcurrentIntentUpdate.prototype)
701:   }
702: }

(End of file - total 702 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts</path>
<type>file</type>
<content>
1: import {
2:   BadRequestException,
3:   ConflictException,
4:   Injectable,
5:   Logger,
6:   NotFoundException,
7: } from '@nestjs/common'
8: import { randomUUID } from 'crypto'
9: import { Prisma } from '@prisma/client'
10: import type {
11:   Mode,
12:   OrderStatus,
13:   StorePaymentMode,
14:   PaymentAttemptStatus,
15:   PaymentMethodKey,
16: } from '@prisma/client'
17: import { PrismaService } from '../../prisma/prisma.service'
18: import { OutboxService } from '../../common/messaging/outbox.service'
19: import { LedgerService } from '../../ledger/ledger.service'
20: import { offlineCommitment } from '../../ledger/posting-rules'
21: import { money, parseDecimal, toDecimalString } from '../../common/money/money.util'
22: import type { Money } from '../../common/money/money.types'
23: import { IdempotencyService } from '../../common/idempotency/idempotency.service'
24: import {
25:   IdReservationService,
26:   PAYMENT_INTENTS_TABLE,
27: } from '../../common/ids/id-reservation.service'
28: import { fingerprintRequest } from '../../common/idempotency/idempotency.types'
29: import { PaymentAccountService } from '../payments/payment-account.service'
30: import {
31:   OfferingPolicyError,
32:   checkPolicy,
33:   computeFeeMinor,
34:   describePolicy,
35:   feeLabel,
36:   parseOfferingPolicy,
37: } from './offering-policy'
38: import { ProviderRegistry } from '../payments/gateways/provider-registry.service'
39: import { PaymentFactApplier } from '../payments/facts/payment-fact.applier'
40: import {
41:   ProviderError,
42:   buildFactDedupeKey,
43:   nextActionKindName,
44:   nextActionPayload,
45:   pspIdempotencyKey,
46:   type GatewayRefs,
47:   type InitializeResult,
48:   type NextAction,
49:   type ObservedFact,
50: } from '../payments/gateways/provider.types'
51: import { CreateCheckoutDto } from './dto/create-checkout.dto'
52: 
53: /** How long a checkout, and the stock it holds, stays alive. */
54: const CHECKOUT_TTL_MINUTES = 30
55: 
56: /** Idempotency scope for storefront checkout. */
57: const CHECKOUT_SCOPE = 'checkout.create'
58: 
59: /**
60:  * The provider's identifiers, where the result carries any.
61:  *
62:  * `no_gateway` has none, so this narrows rather than reaching for an
63:  * optional property the union does not universally have.
64:  */
65: function providerRefs(result: InitializeResult): GatewayRefs | undefined {
66:   switch (result.kind) {
67:     case 'requires_action':
68:     case 'authorized':
69:     case 'succeeded':
70:     case 'pending':
71:       return result.refs
72:     default:
73:       return undefined
74:   }
75: }
76: 
77: /** Account states a customer may pay against. Mirrors listPaymentMethods. */
78: const USABLE_ACCOUNT_STATUSES: readonly string[] = ['active', 'verifying']
79: 
80: interface ResolvedLine {
81:   variantId: bigint
82:   productId: bigint
83:   title: string
84:   variantTitle: string | null
85:   imageUrl: string | null
86:   unitPrice: Money
87:   quantity: number
88:   trackInventory: boolean
89:   continueSelling: boolean
90:   inventoryQty: number
91: }
92: 
93: @Injectable()
94: export class CheckoutService {
95:   private readonly logger = new Logger(CheckoutService.name)
96: 
97:   constructor(
98:     private readonly prisma: PrismaService,
99:     private readonly ledger: LedgerService,
100:     private readonly outbox: OutboxService,
101:     private readonly accounts: PaymentAccountService,
102:     private readonly idempotency: IdempotencyService,
103:     private readonly providers: ProviderRegistry,
104:     private readonly ids: IdReservationService,
105:     private readonly applier: PaymentFactApplier,
106:   ) {}
107: 
108:   /**
109:    * Payment methods a shopper can pick, for one storefront.
110:    *
111:    * Only enabled offerings on active accounts, ordered by the merchant's
112:    * chosen position.
113:    */
114:   async listPaymentMethods(slug: string, mode: Mode = 'live') {
115:     const store = await this.findStore(slug)
116: 
117:     const offerings = await this.prisma.guarded().paymentMethodOffering.findMany({
118:       where: { store_id: store.id, mode, enabled: true },
119:       orderBy: { position: 'asc' },
120:     })
121: 
122:     if (offerings.length === 0) return []
123: 
124:     const accounts = await this.prisma.guarded().paymentAccount.findMany({
125:       where: { store_id: store.id, mode, status: { in: ['active', 'verifying'] } },
126:     })
127:     const byId = new Map(accounts.map((a) => [a.id.toString(), a]))
128: 
129:     return offerings
130:       .filter((o) => byId.has(o.account_id.toString()))
131:       .map((o) => ({
132:         id: o.id.toString(),
133:         method: o.method,
134:         gateway: byId.get(o.account_id.toString())?.gateway,
135:         name_ar: o.display_name_ar,
136:         name_en: o.display_name_en,
137:         commitment_kind: o.commitment_kind,
138:         position: o.position,
139:         // Limits and fees the storefront should show before the customer
140:         // commits to a method. A malformed policy is reported as null
141:         // rather than breaking the whole list.
142:         policy: this.safeDescribePolicy(o.constraints),
143:       }))
144:   }
145: 
146:   /**
147:    * Creates a checkout, commits it, and produces the order.
148:    *
149:    * Single-shot on purpose: the storefront posts a complete cart and
150:    * expects an order back. Prices are always recomputed server-side.
151:    *
152:    * Note this deviates from the outbox-consumer design for order
153:    * creation: the order is written inside the same transaction so the
154:    * response can carry it. The outbox event is still emitted, for
155:    * downstream consumers only (notifications, analytics).
156:    */
157:   async createAndCommit(
158:     slug: string,
159:     dto: CreateCheckoutDto,
160:     mode: Mode = 'live',
161:     idempotencyKey?: string,
162:   ) {
163:     const store = await this.findStore(slug)
164: 
165:     // Without this, a double-tapped Place Order button produces two
166:     // orders, two ledger entries and two inventory decrements. The
167:     // interceptor cannot be reused here: it needs a store in the tenant
168:     // context, and storefront routes have no ActiveStoreGuard, so the
169:     // store is only known after the slug is resolved.
170:     if (!idempotencyKey) {
171:       return this.commit(store, dto, mode)
172:     }
173: 
174:     const claim = await this.idempotency.claim({
175:       storeId: store.id,
176:       mode,
177:       scope: CHECKOUT_SCOPE,
178:       idempotencyKey,
179:       fingerprint: fingerprintRequest({
180:         method: 'POST',
181:         path: `/storefront/${slug}/checkout`,
182:         body: dto as unknown as Record<string, unknown>,
183:       }),
184:       ttlSeconds: this.idempotency.defaultTtlSeconds,
185:       leaseSeconds: this.idempotency.defaultLeaseSeconds,
186:     })
187: 
188:     if (claim.outcome === 'conflict') {
189:       throw new ConflictException(claim.detail)
190:     }
191: 
192:     if (claim.outcome === 'in_flight') {
193:       throw new ConflictException(
194:         'This order is already being placed. Please wait a moment.',
195:       )
196:     }
197: 
198:     if (claim.outcome === 'replay') {
199:       return claim.body as Awaited<ReturnType<CheckoutService['commit']>>
200:     }
201: 
202:     try {
203:       const response = await this.commit(store, dto, mode)
204:       await this.idempotency.complete(claim.recordId, store.id, 201, response)
205:       return response
206:     } catch (error) {
207:       await this.idempotency
208:         .fail(claim.recordId, store.id)
209:         .catch(() => undefined)
210:       throw error
211:     }
212:   }
213: 
214:   /** The actual commit. Split out so idempotency can wrap it. */
215:   private async commit(
216:     store: { id: bigint; currency: string; payment_mode: StorePaymentMode },
217:     dto: CreateCheckoutDto,
218:     mode: Mode,
219:   ) {
220:     const currency = (store.currency || 'USD').toUpperCase()
221: 
222:     const offering = await this.prisma.guarded().paymentMethodOffering.findFirst({
223:       where: {
224:         id: BigInt(dto.payment_offering_id),
225:         store_id: store.id,
226:         mode,
227:         enabled: true,
228:       },
229:     })
230: 
231:     if (!offering) {
232:       throw new BadRequestException('Selected payment method is not available.')
233:     }
234: 
235:     // The gateway key lives on the account, and it selects the adapter.
236:     const account = await this.prisma.guarded().paymentAccount.findFirst({
237:       where: { id: offering.account_id, store_id: store.id, mode },
238:       select: { id: true, gateway: true, status: true },
239:     })
240: 
241:     // Must match what listPaymentMethods advertises, or a customer could
242:     // commit against a draft or errored account by posting its offering id.
243:     if (!account || !USABLE_ACCOUNT_STATUSES.includes(account.status)) {
244:       throw new BadRequestException('Selected payment method is not available.')
245:     }
246: 
247:     // No commitment-kind gate here any more. Whether a method can be
248:     // honoured is decided by the adapter registry, which rejects an
249:     // unregistered gateway or an unsupported method/currency, and by
250:     // interpretResult, which rejects a result this flow cannot complete.
251:     // A hardcoded allow-list here silently made every gateway
252:     // unreachable no matter what was registered.
253: 
254:     const lines = await this.resolveLines(store.id, currency, dto)
255:     const subtotalMinor = lines.reduce(
256:       (acc, l) => acc + l.unitPrice.amountMinor * BigInt(l.quantity),
257:       0n,
258:     )
259: 
260:     if (subtotalMinor <= 0n) {
261:       throw new BadRequestException('Cart total must be greater than zero.')
262:     }
263: 
264:     // Limits and fees the merchant configured on this method. Until now
265:     // the constraints column was written and never read.
266:     const policy = this.readPolicy(offering.constraints)
267: 
268:     const violation = checkPolicy(policy, {
269:       subtotalMinor,
270:       currency,
271:       city: dto.city,
272:     })
273: 
274:     if (violation) {
275:       throw new BadRequestException(violation.message)
276:     }
277: 
278:     const feeMinor = computeFeeMinor(policy, subtotalMinor)
279:     const totalMinor = subtotalMinor + feeMinor
280: 
281:     const now = new Date()
282:     const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000)
283:     const beneficiaryId = await this.ensureStoreBeneficiary(store.id, mode, currency)
284: 
285: 
286:     // The intent id is needed for the deterministic PSP idempotency key,
287:     // so the intent is created first, then the adapter is called, then the
288:     // rest of the commit runs. The adapter call stays outside the
289:     // transaction: never hold a database transaction open across network
290:     // I/O.
291:     const intentId = await this.ids.reserve(PAYMENT_INTENTS_TABLE)
292: 
293:     const initializeResult = await this.initializePayment({
294:       storeId: store.id,
295:       mode,
296:       accountId: offering.account_id,
297:       gateway: account.gateway,
298:       offeringId: offering.id,
299:       method: offering.method,
300:       gatewayMethodConfig: offering.gateway_method_config,
301:       intentId,
302:       amountMinor: totalMinor,
303:       currency,
304:     })
305: 
306:     const { nextAction, attemptStatus, offline } =
307:       this.interpretResult(initializeResult)
308: 
309:     const gatewayRefs = providerRefs(initializeResult)
310: 
311:     // Bank transfer produces an order that is explicitly not yet paid.
312:     // Cash on delivery is collected on handover, so it enters the normal
313:     // fulfilment queue.
314:     const orderStatus: OrderStatus =
315:       offering.commitment_kind === 'awaiting_offline_settlement'
316:         ? 'AWAITING_PAYMENT'
317:         : 'PENDING'
318: 
319:     const result = await this.prisma.$transaction(async (tx) => {
320:       const checkout = await tx.checkout.create({
321:         data: {
322:           store_id: store.id,
323:           mode,
324:           token: randomUUID().replace(/-/g, ''),
325:           status: 'pending_payment',
326:           customer_name: dto.customer_name,
327:           customer_email: dto.customer_email ?? null,
328:           customer_phone: dto.customer_phone,
329:           shipping_address: {
330:             address_line: dto.address_line,
331:             city: dto.city,
332:             notes: dto.notes ?? null,
333:           } as Prisma.InputJsonValue,
334:           currency,
335:           quote_total_minor: totalMinor,
336:           selected_offering_id: offering.id,
337:           expires_at: expiresAt,
338:         },
339:         select: { id: true, token: true },
340:       })
341: 
342:       await tx.checkoutLineItem.createMany({
343:         data: lines.map((l) => ({
344:           checkout_id: checkout.id,
345:           product_id: l.productId,
346:           variant_id: l.variantId,
347:           title: l.title,
348:           variant_title: l.variantTitle,
349:           image_url: l.imageUrl,
350:           unit_price_minor: l.unitPrice.amountMinor,
351:           quantity: l.quantity,
352:         })),
353:       })
354: 
355:       // Invariant: quote_total_minor equals the sum of its components.
356:       await tx.quoteComponent.create({
357:         data: {
358:           checkout_id: checkout.id,
359:           kind: 'line_subtotal',
360:           label: 'Items',
361:           amount_minor: subtotalMinor,
362:           source_ref: 'checkout.lines',
363:           position: 0,
364:         },
365:       })
366: 
367:       if (feeMinor > 0n) {
368:         await tx.quoteComponent.create({
369:           data: {
370:             checkout_id: checkout.id,
371:             kind: 'payment_fee',
372:             label: feeLabel(policy),
373:             amount_minor: feeMinor,
374:             source_ref: `offering:${offering.id}`,
375:             position: 1,
376:           },
377:         })
378:       }
379: 
380:       // Reservations are recorded and immediately converted: this phase
381:       // commits in one request, so stock never sits held.
382:       await tx.inventoryReservation.createMany({
383:         data: lines
384:           .filter((l) => l.trackInventory)
385:           .map((l) => ({
386:             checkout_id: checkout.id,
387:             store_id: store.id,
388:             mode,
389:             variant_id: l.variantId,
390:             quantity: l.quantity,
391:             // Offline commitment takes the stock now. A gateway
392:             // checkout only holds it until the money is secured, because
393:             // the customer may abandon the payment.
394:             state: offline ? ('converted' as const) : ('held' as const),
395:             expires_at: expiresAt,
396:             settled_at: offline ? now : null,
397:           })),
398:       })
399: 
400:       // Created here with the reserved id, so a checkout that fails
401:       // before this point leaves nothing behind.
402:       const intent = await tx.paymentIntent.create({
403:         data: {
404:           id: intentId,
405:           store_id: store.id,
406:           mode,
407:           context_kind: 'checkout',
408:           context_id: checkout.id.toString(),
409:           amount_minor: totalMinor,
410:           currency,
411:           capture_method: offering.capture_mode,
412:           usage: 'one_time',
413:           status: 'processing',
414:           // Snapshotted, not read from the store at refund time. A store
415:           // that switches payment mode must still refund old payments
416:           // through the route that actually took them.
417:           payment_mode: store.payment_mode,
418:           offering_id: offering.id,
419:           account_id: offering.account_id,
420:           expires_at: expiresAt,
421:         },
422:         select: { id: true },
423:       })
424: 
425:       const storedPayload = nextActionPayload(nextAction)
426: 
427:       await tx.paymentAttempt.create({
428:         data: {
429:           intent_id: intent.id,
430:           store_id: store.id,
431:           mode,
432:           sequence: 1,
433:           account_id: offering.account_id,
434:           offering_id: offering.id,
435:           status: attemptStatus,
436:           // The applier matches inbound facts on
437:           // (account_id, gateway_reference). Without this the reference
438:           // stays null, every webhook and every reconciliation sweep
439:           // fails to match, and a customer who paid never gets an order.
440:           gateway_reference: gatewayRefs?.gatewayReference ?? null,
441:           gateway_payment_id: gatewayRefs?.gatewayPaymentId ?? null,
442:           next_action_kind: nextActionKindName(nextAction),
443:           next_action_payload: storedPayload
444:             ? (storedPayload as Prisma.InputJsonValue)
445:             : Prisma.DbNull,
446:           next_action_expires_at: storedPayload ? expiresAt : null,
447:           psp_idempotency_key: pspIdempotencyKey({
448:             storeId: store.id,
449:             intentId,
450:             attemptSequence: 1,
451:             operation: 'initialize',
452:           }),
453:         },
454:       })
455: 
456:       if (!offline) {
457:         // No order yet. It is created by the fact applier when the
458:         // provider confirms the money, which is what makes "an order
459:         // exists" mean "the money is secured".
460:         return { checkout, order: null }
461:       }
462: 
463:       const orderNumber = await this.nextOrderNumber(tx, store.id)
464: 
465:       const order = await tx.order.create({
466:         data: {
467:           store_id: store.id,
468:           order_number: orderNumber,
469:           status: orderStatus,
470:           payment_status: 'UNPAID',
471:           payment_method: offering.method === 'cod' ? 'cod' : 'bank_transfer',
472:           currency,
473:           checkout_id: checkout.id,
474:           customer_name: dto.customer_name,
475:           customer_phone: dto.customer_phone,
476:           customer_email: dto.customer_email ?? null,
477:           address_line: dto.address_line,
478:           city: dto.city,
479:           notes: dto.notes ?? null,
480:           subtotal: toDecimalString(money(subtotalMinor, currency)),
481:           total: toDecimalString(money(totalMinor, currency)),
482:           items: {
483:             create: lines.map((l) => ({
484:               product_id: l.productId,
485:               variant_id: l.variantId,
486:               title: l.title,
487:               variant_title: l.variantTitle,
488:               price: toDecimalString(l.unitPrice),
489:               qty: l.quantity,
490:               image_url: l.imageUrl,
491:             })),
492:           },
493:         },
494:         select: { id: true, order_number: true },
495:       })
496: 
497:       await tx.checkout.update({
498:         where: { id: checkout.id },
499:         data: { status: 'committed', committed_at: now, order_id: order.id },
500:       })
501: 
502:       for (const line of lines) {
503:         if (!line.trackInventory) continue
504:         await tx.productVariant.update({
505:           where: { id: line.variantId },
506:           data: { inventory_qty: { decrement: line.quantity } },
507:         })
508:       }
509: 
510:       // Revenue is recognised at offline commitment; the matching
511:       // receivable clears when the merchant records collection. For a
512:       // gateway the ledger entry is posted by the applier when the money
513:       // is actually captured, so nothing is posted here.
514:       await this.ledger.post(tx, {
515:         storeId: store.id,
516:         mode,
517:         currency,
518:         entryType: 'checkout.committed.offline',
519:         sourceKind: 'checkout',
520:         sourceId: checkout.id.toString(),
521:         dedupeKey: `checkout:${checkout.id}:commit`,
522:         occurredAt: now,
523:         memo: `Order ${order.order_number}`,
524:         postings: offlineCommitment({
525:           totalMinor,
526:           allocations: [{ beneficiaryId, amountMinor: totalMinor }],
527:         }),
528:       })
529: 
530:       await this.outbox.emit(tx, {
531:         storeId: store.id,
532:         mode,
533:         aggregateType: 'checkout',
534:         aggregateId: checkout.id.toString(),
535:         eventType: 'checkout.committed',
536:         payload: {
537:           checkoutId: checkout.id.toString(),
538:           orderId: order.id.toString(),
539:           orderNumber: order.order_number,
540:           intentId: intent.id.toString(),
541:           amountMinor: totalMinor.toString(),
542:           currency,
543:           commitmentKind: offering.commitment_kind,
544:         },
545:         occurredAt: now,
546:       })
547: 
548:       return { checkout, order }
549:     })
550: 
551:     // The adapter may have authorised or captured in the same call. That
552:     // outcome becomes a fact and goes through the applier, so the order
553:     // is created by the same code path a webhook would use.
554:     if (!offline) {
555:       const fact = this.synchronousFact(
556:         initializeResult,
557:         offering.account_id,
558:         currency,
559:       )
560: 
561:       if (fact) {
562:         await this.applier.applyMany([fact], 'api')
563:       }
564:     }
565: 
566:     const order = result.order
567:       ? await this.prisma.guarded().order.findFirst({
568:           where: { id: result.order.id, store_id: store.id },
569:           select: {
570:             id: true,
571:             order_number: true,
572:             status: true,
573:             payment_status: true,
574:           },
575:         })
576:       : await this.prisma.guarded().order.findFirst({
577:           where: { checkout_id: result.checkout.id, store_id: store.id },
578:           select: {
579:             id: true,
580:             order_number: true,
581:             status: true,
582:             payment_status: true,
583:           },
584:         })
585: 
586:     this.logger.log(
587:       `Checkout ${result.checkout.id} committed for store ${store.id} ` +
588:         `(${offering.commitment_kind}${order ? `, order ${order.order_number}` : ', awaiting payment'})`,
589:     )
590: 
591:     return {
592:       // Null while the customer still has an action to complete. The
593:       // storefront polls the checkout token until it appears.
594:       order: order
595:         ? {
596:             id: order.id.toString(),
597:             order_number: order.order_number,
598:             status: order.status,
599:             payment_status: order.payment_status,
600:             currency,
601:             subtotal: toDecimalString(money(subtotalMinor, currency)),
602:             payment_fee: toDecimalString(money(feeMinor, currency)),
603:             total: toDecimalString(money(totalMinor, currency)),
604:           }
605:         : null,
606:       checkout_token: result.checkout.token,
607:       payment_redirect_url:
608:         nextAction.kind === 'redirect' ? nextAction.url : null,
609:       next_action: (() => {
610:         const payload = nextActionPayload(nextAction)
611:         return payload ? { kind: nextAction.kind, ...payload } : null
612:       })(),
613:     }
614:   }
615: 
616:   /**
617:    * Re-reads the instructions a customer needs after checkout.
618:    *
619:    * The success page needs this on refresh: bank details are not part of
620:    * the order record, they live on the attempt.
621:    */
622:   async getCheckoutStatus(slug: string, token: string) {
623:     const store = await this.findStore(slug)
624: 
625:     const checkout = await this.prisma.guarded().checkout.findFirst({
626:       where: { store_id: store.id, token },
627:     })
628: 
629:     if (!checkout) throw new NotFoundException('Checkout not found.')
630: 
631:     const intent = await this.prisma.guarded().paymentIntent.findFirst({
632:       where: {
633:         store_id: store.id,
634:         mode: checkout.mode,
635:         context_kind: 'checkout',
636:         context_id: checkout.id.toString(),
637:       },
638:       select: { id: true, status: true },
639:     })
640: 
641:     const attempt = intent
642:       ? await this.prisma.guarded().paymentAttempt.findFirst({
643:           where: { intent_id: intent.id, store_id: store.id, mode: checkout.mode },
644:           orderBy: { sequence: 'desc' },
645:           select: { next_action_kind: true, next_action_payload: true },
646:         })
647:       : null
648: 
649:     const order = checkout.order_id
650:       ? await this.prisma.guarded().order.findFirst({
651:           where: { id: checkout.order_id, store_id: store.id },
652:           select: {
653:             id: true,
654:             order_number: true,
655:             status: true,
656:             payment_status: true,
657:             total: true,
658:           },
659:         })
660:       : null
661: 
662:     return {
663:       checkout_token: checkout.token,
664:       checkout_status: checkout.status,
665:       currency: checkout.currency,
666:       payment_status: intent?.status ?? null,
667:       next_action:
668:         attempt && attempt.next_action_kind !== 'none'
669:           ? {
670:               kind: attempt.next_action_kind,
671:               ...((attempt.next_action_payload ?? {}) as Record<string, unknown>),
672:             }
673:           : null,
674:       order: order
675:         ? {
676:             id: order.id.toString(),
677:             order_number: order.order_number,
678:             status: order.status,
679:             payment_status: order.payment_status,
680:             total: String(order.total),
681:           }
682:         : null,
683:     }
684:   }
685: 
686:   /**
687:    * Asks the provider directly, then returns the refreshed status.
688:    *
689:    * This is what the customer's return from a gateway calls. Redirecting
690:    * back and then waiting for a webhook is the single most common cause
691:    * of "I paid but the page says it failed": the customer is often back
692:    * before the callback arrives. Asking synchronously removes the race.
693:    *
694:    * Safe to call repeatedly. The facts go through the same applier, so a
695:    * status the webhook already applied is recognised as a duplicate.
696:    */
697:   async syncCheckoutStatus(slug: string, token: string) {
698:     const store = await this.findStore(slug)
699: 
700:     const checkout = await this.prisma.guarded().checkout.findFirst({
701:       where: { store_id: store.id, token },
702:       select: { id: true, mode: true },
703:     })
704: 
705:     if (!checkout) throw new NotFoundException('Checkout not found.')
706: 
707:     const intent = await this.prisma.guarded().paymentIntent.findFirst({
708:       where: {
709:         store_id: store.id,
710:         mode: checkout.mode,
711:         context_kind: 'checkout',
712:         context_id: checkout.id.toString(),
713:       },
714:       select: { id: true, account_id: true },
715:     })
716: 
717:     if (intent?.account_id) {
718:       await this.pullProviderStatus(
719:         store.id,
720:         checkout.mode,
721:         intent.id,
722:         intent.account_id,
723:       )
724:     }
725: 
726:     return this.getCheckoutStatus(slug, token)
727:   }
728: 
729:   /**
730:    * Pulls status from the provider and applies whatever comes back.
731:    *
732:    * Failures are swallowed on purpose: this runs on the customer's
733:    * return, and a provider being slow must not turn a successful payment
734:    * into an error page. Reconciliation will catch up.
735:    */
736:   private async pullProviderStatus(
737:     storeId: bigint,
738:     mode: Mode,
739:     intentId: bigint,
740:     accountId: bigint,
741:   ): Promise<void> {
742:     try {
743:       const account = await this.prisma.guarded().paymentAccount.findFirst({
744:         where: { id: accountId, store_id: storeId, mode },
745:         select: { id: true, gateway: true },
746:       })
747: 
748:       if (!account || !this.providers.has(account.gateway)) return
749: 
750:       const provider = this.providers.get(account.gateway)
751:       if (!provider.capabilities.statusPolling) return
752: 
753:       const attempt = await this.prisma.guarded().paymentAttempt.findFirst({
754:         where: { intent_id: intentId, store_id: storeId, mode },
755:         orderBy: { sequence: 'desc' },
756:         select: { gateway_reference: true },
757:       })
758: 
759:       if (!attempt?.gateway_reference) return
760: 
761:       const credentials = await this.accounts.revealCredentialsForGateway(
762:         storeId,
763:         mode,
764:         account.id,
765:       )
766: 
767:       const facts = await provider.fetchStatus({
768:         accountId: account.id,
769:         gatewayReference: attempt.gateway_reference,
770:         credentials,
771:         mode,
772:       })
773: 
774:       if (facts.length > 0) {
775:         await this.applier.applyMany(facts, 'return_url')
776:       }
777:     } catch (error) {
778:       this.logger.warn(
779:         `Status sync failed for intent ${intentId}: ${(error as Error).message}`,
780:       )
781:     }
782:   }
783: 
784:   /**
785:    * Starts the payment through the gateway adapter.
786:    *
787:    * Cash on delivery and bank transfer used to be `if` branches here.
788:    * They are adapters now, so this method is identical for a manual
789:    * method and for a gateway that redirects: the difference lives in the
790:    * adapter and in the shape of the result it returns.
791:    */
792:   private async initializePayment(input: {
793:     storeId: bigint
794:     mode: Mode
795:     accountId: bigint
796:     gateway: string
797:     offeringId: bigint
798:     method: PaymentMethodKey
799:     gatewayMethodConfig: string
800:     intentId: bigint
801:     amountMinor: bigint
802:     currency: string
803:   }): Promise<InitializeResult> {
804:     let provider
805: 
806:     try {
807:       provider = this.providers.assertCanHandle({
808:         gateway: input.gateway,
809:         method: input.method,
810:         currency: input.currency,
811:       })
812:     } catch (error) {
813:       if (error instanceof ProviderError) {
814:         this.logger.error(
815:           `Adapter cannot handle this request (${error.code}): ${error.message}`,
816:         )
817:         throw new BadRequestException(
818:           'Selected payment method is not available.',
819:         )
820:       }
821:       throw error
822:     }
823: 
824:     // Credentials are decrypted here and handed to the adapter. Adapters
825:     // never reach into the credential store themselves, which keeps the
826:     // encryption path in exactly one place.
827:     const credentials = await this.accounts.revealCredentialsForGateway(
828:       input.storeId,
829:       input.mode,
830:       input.accountId,
831:     )
832: 
833:     try {
834:       return await provider.initializePayment({
835:         storeId: input.storeId,
836:         mode: input.mode,
837:         accountId: input.accountId,
838:         offeringId: input.offeringId,
839:         method: input.method,
840:         gatewayMethodConfig: input.gatewayMethodConfig,
841:         intentId: input.intentId,
842:         attemptId: null,
843:         attemptSequence: 1,
844:         amountMinor: input.amountMinor,
845:         currency: input.currency,
846:         credentials,
847:       })
848:     } catch (error) {
849:       // A ProviderError is a domain outcome, not a server fault. Letting
850:       // it escape would turn a misconfigured payment method into a 500.
851:       if (error instanceof ProviderError) {
852:         this.logger.error(
853:           `Adapter "${input.gateway}" refused to initialise (${error.code}): ${error.message}`,
854:         )
855:         throw new BadRequestException(
856:           error.code === 'configuration_error'
857:             ? 'This payment method is not configured. Please choose another.'
858:             : 'Payment could not be started. Please choose another method.',
859:         )
860:       }
861:       throw error
862:     }
863:   }
864: 
865:   /**
866:    * Reduces an adapter result to the attempt row plus the customer
867:    * response.
868:    *
869:    * This phase can only honour results that need no funds movement.
870:    * Anything else means a gateway adapter arrived before the machinery
871:    * that drives it, and failing loudly is safer than committing an order
872:    * against a payment that was never taken.
873:    */
874:   private interpretResult(result: InitializeResult): {
875:     nextAction: NextAction
876:     attemptStatus: PaymentAttemptStatus
877:     /** True when the merchant accepted an unfunded promise. */
878:     offline: boolean
879:   } {
880:     switch (result.kind) {
881:       case 'no_gateway':
882:         return {
883:           nextAction: result.nextAction ?? { kind: 'none' },
884:           attemptStatus: 'requires_action',
885:           offline: true,
886:         }
887: 
888:       case 'requires_action':
889:         return {
890:           nextAction: result.nextAction,
891:           attemptStatus: 'requires_action',
892:           offline: false,
893:         }
894: 
895:       case 'pending':
896:         return {
897:           nextAction: { kind: 'poll', pollAfterSeconds: result.pollAfterSeconds },
898:           attemptStatus: 'processing',
899:           offline: false,
900:         }
901: 
902:       case 'authorized':
903:         return { nextAction: { kind: 'none' }, attemptStatus: 'authorized', offline: false }
904: 
905:       case 'succeeded':
906:         return { nextAction: { kind: 'none' }, attemptStatus: 'succeeded', offline: false }
907: 
908:       case 'failed':
909:         throw new BadRequestException(
910:           `Payment could not be started (${result.errorCode}).`,
911:         )
912:     }
913:   }
914: 
915:   /**
916:    * Turns a synchronous provider outcome into a fact.
917:    *
918:    * The adapter may authorise or capture in the same call. Rather than a
919:    * second order-creation path, that outcome is expressed as an
920:    * ObservedFact and run through the applier, so every funds_secured
921:    * order is created in exactly one place. A webhook later reporting the
922:    * same thing dedupes against it.
923:    */
924:   private synchronousFact(
925:     result: InitializeResult,
926:     accountId: bigint,
927:     currency: string,
928:   ): ObservedFact | null {
929:     if (result.kind !== 'authorized' && result.kind !== 'succeeded') return null
930: 
931:     const reference = result.refs?.gatewayReference
932:     if (!reference) return null
933: 
934:     const factType =
935:       result.kind === 'succeeded' ? 'attempt_captured' : 'attempt_authorized'
936: 
937:     const cumulativeAmountMinor =
938:       result.kind === 'succeeded'
939:         ? result.capturedAmountMinor
940:         : result.authorizedAmountMinor
941: 
942:     return {
943:       dedupeKey: buildFactDedupeKey({
944:         accountId,
945:         gatewayReference: reference,
946:         factType,
947:         cumulativeAmountMinor,
948:         currency: currency.toUpperCase(),
949:       }),
950:       accountId,
951:       gatewayReference: reference,
952:       factType,
953:       cumulativeAmountMinor,
954:       currency: currency.toUpperCase(),
955:       refs: result.refs,
956:     }
957:   }
958: 
959:   /* ---------------------------------------------------------------- */
960: 
961:   /**
962:    * Parses the merchant's constraints, refusing the checkout if they are
963:    * malformed.
964:    *
965:    * Silently ignoring a broken "max 5000" rule would let through orders
966:    * the merchant explicitly refused, so a bad policy fails loudly.
967:    */
968:   private readPolicy(raw: unknown) {
969:     try {
970:       return parseOfferingPolicy(raw)
971:     } catch (error) {
972:       if (error instanceof OfferingPolicyError) {
973:         this.logger.error(
974:           `Malformed payment method constraints: ${error.message}`,
975:         )
976:         throw new BadRequestException(
977:           'This payment method is misconfigured. Please choose another.',
978:         )
979:       }
980:       throw error
981:     }
982:   }
983: 
984:   /** Policy for display. Never throws: one bad row must not hide the rest. */
985:   private safeDescribePolicy(raw: unknown) {
986:     try {
987:       return describePolicy(parseOfferingPolicy(raw))
988:     } catch {
989:       return null
990:     }
991:   }
992: 
993:   private async findStore(slug: string) {
994:     const store = await this.prisma.guarded().store.findFirst({ where: { slug } })
995:     if (!store) throw new NotFoundException('Store not found.')
996:     return store
997:   }
998: 
999:   /**
1000:    * Loads variants and recomputes prices from the database.
1001:    * Client-supplied prices are never trusted.
1002:    */
1003:   private async resolveLines(
1004:     storeId: bigint,
1005:     currency: string,
1006:     dto: CreateCheckoutDto,
1007:   ): Promise<ResolvedLine[]> {
1008:     const ids = dto.items.map((i) => BigInt(i.variant_id))
1009: 
1010:     const variants = await this.prisma.guarded().productVariant.findMany({
1011:       where: { id: { in: ids }, product: { store_id: storeId } },
1012:       include: { product: true },
1013:     })
1014: 
1015:     const byId = new Map(variants.map((v: any) => [v.id.toString(), v]))
1016:     const lines: ResolvedLine[] = []
1017: 
1018:     for (const item of dto.items) {
1019:       const variant: any = byId.get(item.variant_id)
1020: 
1021:       if (!variant) {
1022:         throw new BadRequestException(`Product variant ${item.variant_id} is unavailable.`)
1023:       }
1024: 
1025:       const priceRaw = variant.price === null ? '0' : String(variant.price)
1026:       const unitPrice = parseDecimal(priceRaw, currency)
1027: 
1028:       if (
1029:         variant.track_inventory &&
1030:         !variant.continue_selling &&
1031:         variant.inventory_qty < item.quantity
1032:       ) {
1033:         throw new BadRequestException(
1034:           `Not enough stock for "${variant.product.title}".`,
1035:         )
1036:       }
1037: 
1038:       lines.push({
1039:         variantId: variant.id,
1040:         productId: variant.product_id,
1041:         title: variant.product.title,
1042:         variantTitle: variant.title ?? null,
1043:         imageUrl: variant.image_url ?? null,
1044:         unitPrice,
1045:         quantity: item.quantity,
1046:         trackInventory: variant.track_inventory,
1047:         continueSelling: variant.continue_selling,
1048:         inventoryQty: variant.inventory_qty,
1049:       })
1050:     }
1051: 
1052:     return lines
1053:   }
1054: 
1055:   /** Store-scoped beneficiary, created on first use. */
1056:   private async ensureStoreBeneficiary(
1057:     storeId: bigint,
1058:     mode: Mode,
1059:     currency: string,
1060:   ): Promise<bigint> {
1061:     const existing = await this.prisma.guarded().beneficiary.findFirst({
1062:       where: { store_id: storeId, mode, kind: 'store', external_ref: null },
1063:       select: { id: true },
1064:     })
1065: 
1066:     if (existing) return existing.id
1067: 
1068:     const created = await this.prisma.guarded().beneficiary.create({
1069:       data: {
1070:         store_id: storeId,
1071:         mode,
1072:         kind: 'store',
1073:         external_ref: null,
1074:         default_currency: currency,
1075:       },
1076:       select: { id: true },
1077:     })
1078: 
1079:     return created.id
1080:   }
1081: 
1082:   /**
1083:    * Next per-store order number.
1084:    *
1085:    * The unique constraint on (store_id, order_number) is the real
1086:    * guarantee; this only picks a starting point.
1087:    */
1088:   /**
1089:    * Next per-store order number.
1090:    *
1091:    * Was `count(*) + 1001`, which two concurrent finalisations both read
1092:    * as the same value. The unique constraint on
1093:    * (store_id, order_number) then rejected one of them outright, so a
1094:    * paid customer's order failed rather than simply taking the next
1095:    * number.
1096:    *
1097:    * A row lock on the store serialises the read within the transaction.
1098:    * Same visible format, no schema change, and the unique constraint
1099:    * remains the real guarantee.
1100:    */
1101:   private async nextOrderNumber(
1102:     tx: Prisma.TransactionClient,
1103:     storeId: bigint,
1104:   ): Promise<string> {
1105:     await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`
1106: 
1107:     const highest = await tx.order.findFirst({
1108:       where: { store_id: storeId },
1109:       orderBy: { id: 'desc' },
1110:       select: { order_number: true },
1111:     })
1112: 
1113:     const previous = highest ? Number.parseInt(highest.order_number, 10) : NaN
1114: 
1115:     return String(Number.isFinite(previous) ? previous + 1 : 1001)
1116:   }
1117: }

(End of file - total 1117 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.6s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/products/product.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/products/product.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, NotFoundException } from '@nestjs/common'
2: import { PrismaService } from '../../prisma/prisma.service'
3: import { ProductStatus } from '@prisma/client'
4: import type { store as StoreRecord } from '@prisma/client'
5: 
6: @Injectable()
7: export class ProductService {
8:   constructor(private prisma: PrismaService) {}
9: 
10:   private jsonSafe(data: any) {
11:     return JSON.parse(JSON.stringify(data, (_, v) =>
12:       typeof v === 'bigint' ? v.toString() : v
13:     ))
14:   }
15: 
16:   // ── Handle / slug helpers ────────────────────────────────────────────────
17: 
18:   private slugify(text: string): string {
19:     return (text || '')
20:       .toLowerCase()
21:       .trim()
22:       .replace(/[^\p{L}\p{N}\s-]+/gu, '')
23:       .replace(/\s+/g, '-')
24:       .replace(/-+/g, '-')
25:       .replace(/^-+|-+$/g, '')
26:   }
27: 
28:   private async ensureUniqueHandle(
29:     storeId: bigint,
30:     base: string,
31:     excludeProductId?: bigint,
32:   ): Promise<string> {
33:     const safeBase = base && base.trim() ? base : 'product'
34:     let handle = safeBase
35:     let counter = 2
36:     while (true) {
37:       const existing = await this.prisma.product.findFirst({
38:         where: {
39:           store_id: storeId,
40:           handle,
41:           ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
42:         },
43:       })
44:       if (!existing) return handle
45:       handle = `${safeBase}-${counter}`
46:       counter++
47:     }
48:   }
49: 
50:   private generateVariants(options: { name: string; values: string[] }[], basePrice: number) {
51:     if (!options || options.length === 0) {
52:       return [{ title: 'Default Title', price: basePrice, option1: null, option2: null, option3: null }]
53:     }
54:     const combos: any[] = []
55:     const recurse = (idx: number, current: string[]) => {
56:       if (idx === options.length) { combos.push(current.slice()); return }
57:       for (const val of options[idx].values) {
58:         current.push(val)
59:         recurse(idx + 1, current)
60:         current.pop()
61:       }
62:     }
63:     recurse(0, [])
64:     return combos.map(combo => ({
65:       title: combo.join(' / '),
66:       price: basePrice,
67:       option1: combo[0] || null,
68:       option2: combo[1] || null,
69:       option3: combo[2] || null,
70:     }))
71:   }
72: 
73:   async getProducts(
74:     storeId: bigint,
75:     filters: { status?: string; search?: string; page: number; limit: number },
76:   ) {
77:     const where: any = { store_id: storeId }
78:     /**
79:      * FIX: الفرونت اند بيبعت الحالة بحروف صغيرة (مثلاً "active")، لكن الـ
80:      * enum في Prisma معرّف بحروف كبيرة ("ACTIVE"). كان ده بيسبب 500 على
81:      * أي فلترة بالحالة. .toUpperCase() بيوحّد الشكل قبل ما يوصل لـ Prisma.
82:      */
83:     if (filters.status) where.status = filters.status.toUpperCase()
84:     if (filters.search) {
85:       where.OR = [
86:         { title: { contains: filters.search, mode: 'insensitive' } },
87:         { productType: { name: { contains: filters.search, mode: 'insensitive' } } },
88:         { variants: { some: { sku: { contains: filters.search, mode: 'insensitive' } } } },
89:       ]
90:     }
91:     const [total, products] = await Promise.all([
92:       this.prisma.product.count({ where }),
93:       this.prisma.product.findMany({
94:         where,
95:         include: {
96:           productType: true,
97:           tags: { include: { tag: true } },
98:           images: { orderBy: { position: 'asc' }, take: 1 },
99:           variants: { orderBy: { position: 'asc' } },
100:           _count: { select: { variants: true } },
101:         },
102:         orderBy: { created_at: 'desc' },
103:         skip: (filters.page - 1) * filters.limit,
104:         take: filters.limit,
105:       }),
106:     ])
107:     return this.jsonSafe({
108:       products,
109:       total,
110:       page: filters.page,
111:       pages: Math.ceil(total / filters.limit),
112:     })
113:   }
114: 
115:   /**
116:    * جديد: قائمة المنتجات العامة (واجهة المتجر للعميل النهائي). بنستبعد
117:    * هنا صراحةً أي منتج DRAFT أو UNLISTED — الـ Unlisted معناه بالتحديد
118:    * إنه ميظهرش في أي قائمة أو بحث عادي، وبيتفتح بس لو حد معاه لينكه
119:    * المباشر (شوف getStorefrontProductByHandle تحت).
120:    */
121:   async getStorefrontProducts(
122:     storeSlug: string,
123:     filters: { search?: string; page: number; limit: number },
124:   ) {
125:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
126:     if (!store) throw new NotFoundException('Store not found')
127: 
128:     const where: any = {
129:       store_id: store.id,
130:       status: ProductStatus.ACTIVE,
131:       deleted_at: null,
132:     }
133:     if (filters.search) {
134:       where.OR = [
135:         { title: { contains: filters.search, mode: 'insensitive' } },
136:         { productType: { name: { contains: filters.search, mode: 'insensitive' } } },
137:       ]
138:     }
139: 
140:     const [total, products] = await Promise.all([
141:       this.prisma.product.count({ where }),
142:       this.prisma.product.findMany({
143:         where,
144:         include: {
145:           productType: true,
146:           images: { orderBy: { position: 'asc' }, take: 1 },
147:           variants: { orderBy: { position: 'asc' } },
148:         },
149:         orderBy: { created_at: 'desc' },
150:         skip: (filters.page - 1) * filters.limit,
151:         take: filters.limit,
152:       }),
153:     ])
154:     return this.jsonSafe({
155:       products,
156:       total,
157:       page: filters.page,
158:       pages: Math.ceil(total / filters.limit),
159:     })
160:   }
161: 
162:   /**
163:    * جديد: جلب منتج واحد عن طريق الـ handle بتاعه لصفحة المنتج العامة.
164:    * بيسمح بحالتين بس: ACTIVE (المنتج العادي الظاهر في المتجر) و UNLISTED
165:    * (المنتج اللي مخفي من القوائم بس لسه شغال لو حد فتح لينكه المباشر).
166:    * DRAFT و ARCHIVED مبيرجعوش حاجة هنا خالص — العميل النهائي ميقدرش
167:    * يشوفهم حتى لو حصل عليه الرابط بأي شكل.
168:    */
169:   async getStorefrontProductByHandle(storeSlug: string, handle: string) {
170:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
171:     if (!store) throw new NotFoundException('Store not found')
172: 
173:     const product = await this.prisma.product.findFirst({
174:       where: {
175:         store_id: store.id,
176:         handle,
177:         deleted_at: null,
178:         status: { in: [ProductStatus.ACTIVE, ProductStatus.UNLISTED] },
179:       },
180:       include: {
181:         productType: true,
182:         tags: { include: { tag: true } },
183:         images: { orderBy: { position: 'asc' } },
184:         variants: { orderBy: { position: 'asc' } },
185:         options: {
186:           include: { values: true },
187:           orderBy: { position: 'asc' },
188:         },
189:         // ⬇️ جديد — عشان الـ breadcrumb الاحترافي في الفرونت
190:         collections: {
191:           include: { collection: { select: { name: true, handle: true } } },
192:         },
193:       },
194:     })
195:     if (!product) throw new NotFoundException('Product not found')
196: 
197:     return this.jsonSafe({
198:       ...product,
199:       // شكل نضيف وجاهز للفرونت: array بسيطة من {name, handle}
200:       // بدل الـ join table المتداخلة
201:       collections: product.collections.map((pc) => ({
202:         name: pc.collection.name,
203:         handle: pc.collection.handle,
204:       })),
205:     })
206:   }
207: 
208:   async getProduct(store: StoreRecord, productId: string) {
209:     const product = await this.prisma.product.findFirst({
210:       where: { id: BigInt(productId), store_id: store.id },
211:       include: {
212:         productType: true,
213:         tags: { include: { tag: true } },
214:         collections: { include: { collection: true } },   // ← ضيف السطر ده
215:         images: { orderBy: { position: 'asc' } },
216:         variants: { orderBy: { position: 'asc' } },
217:         options: {
218:           include: { values: true },
219:           orderBy: { position: 'asc' },
220:         },
221:       },
222:     })
223:     if (!product) throw new NotFoundException('Product not found')
224:     return this.jsonSafe({ ...product, store: { slug: store.slug } })
225:   }
226: 
227:   async createProduct(store: StoreRecord, data: any) {
228:     const hasPrice = data.price !== undefined && data.price !== null && String(data.price).trim() !== ''
229:     const price = hasPrice ? parseFloat(data.price) : null
230: 
231:     const baseHandle = this.slugify(data.handle || data.title)
232:     const handle = await this.ensureUniqueHandle(store.id, baseHandle)
233: 
234:     const effectiveOptions = (data.options || []).filter(
235:       (o: any) => o.name && o.values?.some((v: string) => String(v).trim()),
236:     )
237:     const hasOptions = effectiveOptions.length > 0
238: 
239:     const productId = await this.prisma.$transaction(async (tx) => {
240:       const product = await tx.product.create({
241:         data: {
242:           store_id: store.id,
243:           title: data.title,
244:           description: data.description || null,
245:           status: (data.status as ProductStatus) || ProductStatus.DRAFT,
246:           product_type_id: data.product_type_id ? BigInt(data.product_type_id) : null,
247:           handle,
248:           seo_title: data.seo_title || null,
249:           seo_desc: data.seo_desc || null,
250:           category: data.category || null,
251:           charge_tax: data.charge_tax !== false,
252:         },
253:       })
254: 
255:       // Options
256:       if (Array.isArray(data.options) && data.options.length > 0) {
257:         for (let i = 0; i < data.options.length; i++) {
258:           const opt = data.options[i]
259:           if (!opt.name || !opt.values?.length) continue
260:           const option = await tx.productOption.create({
261:             data: {
262:               product_id: product.id,
263:               name: opt.name,
264:               position: i,
265:               colors: opt.colors ?? undefined,   // ← جديد
266:               display_type: opt.display_type ?? undefined,   // ← جديد
267:             },
268:           })
269:           for (const val of opt.values) {
270:             if (String(val).trim()) {
271:               await tx.productOptionValue.create({
272:                 data: { option_id: option.id, value: String(val).trim() },
273:               })
274:             }
275:           }
276:         }
277:       }
278: 
279:       // Variants
280:       if (hasOptions && Array.isArray(data.variants) && data.variants.length > 0) {
281:         // الفرونت اند بعت variants كاملة جاهزة (فيها combination/options)
282:         for (let i = 0; i < data.variants.length; i++) {
283:           const v = data.variants[i]
284:           const vPrice = parseFloat(v.price ?? '0')
285:           await tx.productVariant.create({
286:             data: {
287:               product_id: product.id,
288:               title: v.title || (Array.isArray(v.combination) ? v.combination.join(' / ') : '') || 'Default Title',
289:               price: isNaN(vPrice) ? 0 : vPrice,
290:               compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
291:               cost_per_item: v.cost_per_item ? parseFloat(v.cost_per_item) : null,
292:               sku: v.sku || null,
293:               barcode: v.barcode || null,
294:               inventory_qty: parseInt(v.inventory_qty ?? '0') || 0,
295:               track_inventory: true,
296:               continue_selling: v.continue_selling === true,
297:               option1: v.option1 ?? v.combination?.[0] ?? null,
298:               option2: v.option2 ?? v.combination?.[1] ?? null,
299:               option3: v.option3 ?? v.combination?.[2] ?? null,
300:               image_url: v.image_url || null,
301:               image_key: v.image_key || null,
302:               position: i,
303:             },
304:           })
305:         }
306:       } else {
307:         await tx.productVariant.create({
308:           data: {
309:             product_id: product.id,
310:             title: 'Default Title',
311:             price,
312:             compare_at_price: data.compare_at_price ? parseFloat(data.compare_at_price) : null,
313:             cost_per_item: data.cost_per_item ? parseFloat(data.cost_per_item) : null,
314:             sku: data.sku || null,
315:             barcode: data.barcode || null,
316:             inventory_qty: parseInt(data.inventory_qty || data.quantity || '0'),
317:             track_inventory: data.track_inventory !== false,
318:             continue_selling: data.continue_selling === true,
319:             option1: null,
320:             option2: null,
321:             option3: null,
322:             position: 0,
323:           },
324:         })
325:       }
326: 
327:       // Images
328:       if (Array.isArray(data.images) && data.images.length > 0) {
329:         for (let i = 0; i < data.images.length; i++) {
330:           await tx.productImage.create({
331:             data: {
332:               product_id: product.id,
333:               url: data.images[i].url,
334:               key: data.images[i].key || null,
335:               alt: data.images[i].alt || data.title,
336:               position: i,
337:             },
338:           })
339:         }
340:       }
341: 
342:       // Tags
343:       if (Array.isArray(data.tag_ids) && data.tag_ids.length > 0) {
344:         await tx.productTag.createMany({
345:           data: data.tag_ids.map((tagId: string | number) => ({
346:             product_id: product.id,
347:             tag_id: BigInt(tagId),
348:           })),
349:         })
350:       }
351: 
352:       // Collections
353:       if (Array.isArray(data.collection_ids) && data.collection_ids.length > 0) {
354:         await tx.productCollection.createMany({
355:           data: data.collection_ids.map((collectionId: string | number) => ({
356:             productId: product.id,
357:             collectionId: Number(collectionId),
358:           })),
359:         })
360:       }
361: 
362:       return product.id
363:     }, { timeout: 20000, maxWait: 10000 })
364: 
365:     const created = await this.prisma.product.findUnique({
366:       where: { id: productId },
367:       include: {
368:         images: true,
369:         variants: true,
370:         options: { include: { values: true } },
371:       },
372:     })
373:     return this.jsonSafe({ ...created, store: { slug: store.slug } })
374:   }
375: 
376:   async updateProduct(store: StoreRecord, productId: string, data: any) {
377:     const product = await this.prisma.product.findFirst({
378:       where: { id: BigInt(productId), store_id: store.id },
379:     })
380:     if (!product) throw new NotFoundException('Product not found')
381: 
382:     let handle: string | undefined
383:     if (data.handle !== undefined && data.handle !== null) {
384:       const baseHandle = this.slugify(data.handle)
385:       const candidate = baseHandle || this.slugify(data.title || 'product')
386:       if (candidate !== product.handle) {
387:         handle = await this.ensureUniqueHandle(store.id, candidate, product.id)
388:       }
389:     }
390: 
391:     const hasOptions = Array.isArray(data.options) && data.options.length > 0
392: 
393:     await this.prisma.$transaction(async (tx) => {
394:       // 1. Update core product fields
395:       await tx.product.update({
396:         where: { id: product.id },
397:         data: {
398:           title: data.title,
399:           description: data.description ?? null,
400:           status: data.status as ProductStatus,
401:           product_type_id: data.product_type_id ? BigInt(data.product_type_id) : null,
402:           seo_title: data.seo_title || null,
403:           seo_desc: data.seo_desc || null,
404:           category: data.category || null,
405:           charge_tax: data.charge_tax !== false,
406:           ...(handle !== undefined ? { handle } : {}),
407:         },
408:       })
409: 
410:       // 2. Sync tags (delete all, recreate)
411:       await tx.productTag.deleteMany({ where: { product_id: product.id } })
412:       if (Array.isArray(data.tag_ids) && data.tag_ids.length > 0) {
413:         await tx.productTag.createMany({
414:           data: data.tag_ids.map((tagId: string | number) => ({
415:             product_id: product.id,
416:             tag_id: BigInt(tagId),
417:           })),
418:         })
419:       }
420: 
421:       // 2b. Sync collections (delete all, recreate)
422:       await tx.productCollection.deleteMany({ where: { productId: product.id } })
423:       if (Array.isArray(data.collection_ids) && data.collection_ids.length > 0) {
424:         await tx.productCollection.createMany({
425:           data: data.collection_ids.map((collectionId: string | number) => ({
426:             productId: product.id,
427:             collectionId: Number(collectionId),
428:           })),
429:         })
430:       }
431: 
432:       // 3. Sync options (delete old, recreate from incoming)
433:       if (Array.isArray(data.options)) {
434:         const oldOptions = await tx.productOption.findMany({
435:           where: { product_id: product.id },
436:         })
437:         if (oldOptions.length) {
438:           await tx.productOptionValue.deleteMany({
439:             where: { option_id: { in: oldOptions.map((o) => o.id) } },
440:           })
441:           await tx.productOption.deleteMany({ where: { product_id: product.id } })
442:         }
443:         for (let i = 0; i < data.options.length; i++) {
444:           const opt = data.options[i]
445:           if (!opt.name || !opt.values?.length) continue
446:           const option = await tx.productOption.create({
447:             data: {
448:               product_id: product.id,
449:               name: opt.name,
450:               position: i,
451:               colors: opt.colors ?? undefined,   // ← جديد
452:               display_type: opt.display_type ?? undefined,   // ← ناقصة، ضيفها
453:             },
454:           })
455:           for (const val of opt.values) {
456:             if (val && String(val).trim()) {
457:               await tx.productOptionValue.create({
458:                 data: { option_id: option.id, value: String(val).trim() },
459:               })
460:             }
461:           }
462:         }
463:       }
464: 
465:       // 4. Sync variants
466:       if (hasOptions && Array.isArray(data.variants)) {
467:         const existingVariants = await tx.productVariant.findMany({
468:           where: { product_id: product.id },
469:         })
470:         const incomingIds = new Set(
471:           data.variants.filter((v: any) => v.id).map((v: any) => v.id.toString()),
472:         )
473:         const toDelete = existingVariants.filter((v) => !incomingIds.has(v.id.toString()))
474:         if (toDelete.length) {
475:           await tx.productVariant.deleteMany({
476:             where: { id: { in: toDelete.map((v) => v.id) } },
477:           })
478:         }
479:         for (let i = 0; i < data.variants.length; i++) {
480:           const v = data.variants[i]
481:           const vPrice = parseFloat(v.price ?? '0')
482:           const payload = {
483:             title: v.title || (Array.isArray(v.combination) ? v.combination.join(' / ') : '') || 'Default Title',
484:             price: isNaN(vPrice) ? 0 : vPrice,
485:             compare_at_price: v.compare_at_price != null && v.compare_at_price !== '' ? parseFloat(v.compare_at_price) : null,
486:             cost_per_item: v.cost_per_item != null && v.cost_per_item !== '' ? parseFloat(v.cost_per_item) : null,
487:             sku: v.sku || null,
488:             barcode: v.barcode || null,
489:             inventory_qty: parseInt(v.inventory_qty ?? v.quantity ?? '0') || 0,
490:             continue_selling: v.continue_selling === true,
491:             option1: v.option1 ?? v.combination?.[0] ?? null,
492:             option2: v.option2 ?? v.combination?.[1] ?? null,
493:             option3: v.option3 ?? v.combination?.[2] ?? null,
494:             image_url: v.image_url || null,
495:             image_key: v.image_key || null,
496:             position: i,
497:           }
498:           if (v.id) {
499:             await tx.productVariant.update({ where: { id: BigInt(v.id) }, data: payload })
500:           } else {
501:             await tx.productVariant.create({ data: { product_id: product.id, ...payload } })
502:           }
503:         }
504:       } else {
505:         const payload: any = {
506:           title: 'Default Title',
507:           sku: data.sku || null,
508:           barcode: data.barcode || null,
509:           inventory_qty: parseInt(data.inventory_qty ?? data.quantity ?? '0') || 0,
510:           track_inventory: data.track_inventory !== false,
511:           continue_selling: data.continue_selling === true,
512:           option1: null,
513:           option2: null,
514:           option3: null,
515:           position: 0,
516:         }
517: 
518:         if (data.price !== undefined) {
519:           const trimmed = data.price === null ? '' : String(data.price).trim()
520:           payload.price = trimmed === '' ? null : (isNaN(parseFloat(trimmed)) ? null : parseFloat(trimmed))
521:         }
522: 
523:         if (data.compare_at_price !== undefined) {
524:           payload.compare_at_price =
525:             data.compare_at_price !== null && String(data.compare_at_price).trim() !== ''
526:               ? parseFloat(data.compare_at_price)
527:               : null
528:         }
529:         if (data.cost_per_item !== undefined) {
530:           payload.cost_per_item =
531:             data.cost_per_item !== null && String(data.cost_per_item).trim() !== ''
532:               ? parseFloat(data.cost_per_item)
533:               : null
534:         }
535: 
536:         const existing = await tx.productVariant.findMany({
537:           where: { product_id: product.id },
538:           orderBy: { position: 'asc' },
539:         })
540:         if (existing.length > 0) {
541:           await tx.productVariant.update({ where: { id: existing[0].id }, data: payload })
542:           const extras = existing.slice(1)
543:           if (extras.length) {
544:             await tx.productVariant.deleteMany({ where: { id: { in: extras.map((v) => v.id) } } })
545:           }
546:         } else {
547:           await tx.productVariant.create({
548:             data: { product_id: product.id, price: payload.price ?? 0, ...payload },
549:           })
550:         }
551:       }
552: 
553:       // 5. Sync images (delete all, recreate from incoming)
554:       if (Array.isArray(data.images)) {
555:         await tx.productImage.deleteMany({ where: { product_id: product.id } })
556:         for (let i = 0; i < data.images.length; i++) {
557:           await tx.productImage.create({
558:             data: {
559:               product_id: product.id,
560:               url: data.images[i].url,
561:               key: data.images[i].key || null,
562:               alt: data.images[i].alt || null,
563:               position: i,
564:             },
565:           })
566:         }
567:       }
568:     }, { timeout: 20000, maxWait: 10000 })
569: 
570:     const updated = await this.prisma.product.findUnique({
571:       where: { id: product.id },
572:       include: {
573:         productType: true,
574:         tags: { include: { tag: true } },
575:         collections: { include: { collection: true } },   // ← ضيف السطر ده
576:         images: true,
577:         variants: { orderBy: { position: 'asc' } },
578:         options: { include: { values: true }, orderBy: { position: 'asc' } },
579:       },
580:     })
581:     return this.jsonSafe({ ...updated, store: { slug: store.slug } })
582:   }
583: 
584:   async updateProductStatus(storeId: bigint, productId: string, status: ProductStatus) {
585:     const product = await this.prisma.product.findFirst({
586:       where: { id: BigInt(productId), store_id: storeId },
587:     })
588:     if (!product) throw new NotFoundException('Product not found')
589:     return this.jsonSafe(
590:       await this.prisma.product.update({ where: { id: product.id }, data: { status } }),
591:     )
592:   }
593: 
594:   async deleteProduct(storeId: bigint, productId: string) {
595:     const product = await this.prisma.product.findFirst({
596:       where: { id: BigInt(productId), store_id: storeId },
597:     })
598:     if (!product) throw new NotFoundException('Product not found')
599: 
600:     return this.prisma.$transaction(async (tx) => {
601:       const options = await tx.productOption.findMany({ where: { product_id: product.id } })
602:       if (options.length) {
603:         await tx.productOptionValue.deleteMany({ where: { option_id: { in: options.map((o) => o.id) } } })
604:         await tx.productOption.deleteMany({ where: { product_id: product.id } })
605:       }
606:       await tx.productVariant.deleteMany({ where: { product_id: product.id } })
607:       await tx.productImage.deleteMany({ where: { product_id: product.id } })
608:       await tx.productTag.deleteMany({ where: { product_id: product.id } })
609:       return tx.product.delete({ where: { id: product.id } })
610:     })
611:   }
612: 
613:   async duplicateProduct(storeId: bigint, productId: string) {
614:     const product = await this.prisma.product.findFirst({
615:       where: { id: BigInt(productId), store_id: storeId },
616:       include: {
617:         images: true,
618:         variants: true,
619:         options: { include: { values: true } },
620:         tags: true,
621:       },
622:     })
623:     if (!product) throw new NotFoundException('Product not found')
624: 
625:     const baseHandle = this.slugify(`${product.title}-copy`)
626:     const handle = await this.ensureUniqueHandle(storeId, baseHandle)
627: 
628:     const newProductId = await this.prisma.$transaction(async (tx) => {
629:       const newProduct = await tx.product.create({
630:         data: {
631:           store_id: storeId,
632:           title: `${product.title} (Copy)`,
633:           description: product.description,
634:           status: ProductStatus.DRAFT,
635:           product_type_id: product.product_type_id,
636:           handle,
637:           seo_title: product.seo_title,
638:           seo_desc: product.seo_desc,
639:           category: product.category,
640:           charge_tax: product.charge_tax,
641:         },
642:       })
643: 
644:       for (const t of product.tags) {
645:         await tx.productTag.create({
646:           data: { product_id: newProduct.id, tag_id: t.tag_id },
647:         })
648:       }
649: 
650:       for (const opt of product.options) {
651:         const newOpt = await tx.productOption.create({
652:           data: {
653:             product_id: newProduct.id,
654:             name: opt.name,
655:             position: opt.position,
656:             colors: (opt as any).colors ?? undefined,
657:             display_type: (opt as any).display_type ?? undefined,
658:           },
659:         })
660:         for (const val of opt.values) {
661:           await tx.productOptionValue.create({
662:             data: { option_id: newOpt.id, value: val.value },
663:           })
664:         }
665:       }
666: 
667:       for (const v of product.variants) {
668:         await tx.productVariant.create({
669:           data: {
670:             product_id: newProduct.id,
671:             title: v.title,
672:             price: v.price,
673:             compare_at_price: v.compare_at_price,
674:             cost_per_item: v.cost_per_item,
675:             sku: v.sku,
676:             image_url: v.image_url,
677:             image_key: v.image_key,
678:             barcode: v.barcode,
679:             inventory_qty: v.inventory_qty,
680:             track_inventory: v.track_inventory,
681:             continue_selling: v.continue_selling,
682:             option1: v.option1,
683:             option2: v.option2,
684:             option3: v.option3,
685:             position: v.position,
686:           },
687:         })
688:       }
689: 
690:       for (const img of product.images) {
691:         await tx.productImage.create({
692:           data: {
693:             product_id: newProduct.id,
694:             url: img.url,
695:             key: img.key,
696:             alt: img.alt,
697:             position: img.position,
698:           },
699:         })
700:       }
701: 
702:       return newProduct.id
703:     }, { timeout: 20000, maxWait: 10000 })
704: 
705:     return this.jsonSafe(
706:       await this.prisma.product.findUnique({
707:         where: { id: newProductId },
708:         include: {
709:           productType: true,
710:           tags: { include: { tag: true } },
711:           images: true,
712:           variants: { orderBy: { position: 'asc' } },
713:           options: { include: { values: true }, orderBy: { position: 'asc' } },
714:         },
715:       }),
716:     )
717:   }
718: 
719:   async addProductImages(storeId: bigint, productId: string, images: { url: string; alt?: string; key?: string }[]) {
720:     const product = await this.prisma.product.findFirst({
721:       where: { id: BigInt(productId), store_id: storeId },
722:     })
723:     if (!product) throw new NotFoundException('Product not found')
724:     const last = await this.prisma.productImage.findFirst({
725:       where: { product_id: product.id },
726:       orderBy: { position: 'desc' },
727:     })
728:     const created: any[] = []
729:     let pos = last ? last.position + 1 : 0
730:     for (const img of images) {
731:       created.push(
732:         await this.prisma.productImage.create({
733:           data: { product_id: product.id, url: img.url, key: img.key || null, alt: img.alt || null, position: pos++ },
734:         }),
735:       )
736:     }
737:     return this.jsonSafe(created)
738:   }
739: 
740:   async deleteProductImage(storeId: bigint, productId: string, imageId: string) {
741:     const product = await this.prisma.product.findFirst({
742:       where: { id: BigInt(productId), store_id: storeId },
743:     })
744:     if (!product) throw new NotFoundException('Product not found')
745:     // ✅ تحقق ملكية إضافي (متفق عليه): قبل كده كان الحذف بيتم بالـ
746:     // imageId بس من غير التأكد إن الصورة دي بتاعة نفس المنتج اللي
747:     // اتأكدنا إنه بتاع المتجر الفعّال. دلوقتي البحث بيتقيّد بـ product_id
748:     // كمان، فمينفعش تتمسح صورة بتاعة منتج تاني حتى لو ID اتخمّن صح.
749:     const image = await this.prisma.productImage.findFirst({
750:       where: { id: BigInt(imageId), product_id: product.id },
751:     })
752:     if (!image) throw new NotFoundException('Image not found')
753:     return this.prisma.productImage.delete({ where: { id: image.id } })
754:   }
755: 
756:   async getProductTypes(storeId: bigint) {
757:     return this.jsonSafe(
758:       await this.prisma.productType.findMany({
759:         where: { store_id: storeId },
760:         orderBy: { name: 'asc' },
761:       }),
762:     )
763:   }
764: 
765:   async createProductType(storeId: bigint, name: string) {
766:     const exists = await this.prisma.productType.findFirst({
767:       where: { store_id: storeId, name: { equals: name.trim(), mode: 'insensitive' } },
768:     })
769:     if (exists) return this.jsonSafe(exists)
770:     return this.jsonSafe(
771:       await this.prisma.productType.create({ data: { store_id: storeId, name: name.trim() } }),
772:     )
773:   }
774: 
775:   async updateProductType(storeId: bigint, id: string, name: string) {
776:     const type = await this.prisma.productType.findFirst({
777:       where: { id: BigInt(id), store_id: storeId },
778:     })
779:     if (!type) throw new NotFoundException('Product type not found')
780:     return this.jsonSafe(
781:       await this.prisma.productType.update({ where: { id: type.id }, data: { name: name.trim() } }),
782:     )
783:   }
784: 
785:   async deleteProductType(storeId: bigint, id: string) {
786:     const type = await this.prisma.productType.findFirst({
787:       where: { id: BigInt(id), store_id: storeId },
788:     })
789:     if (!type) throw new NotFoundException('Product type not found')
790:     await this.prisma.product.updateMany({
791:       where: { product_type_id: type.id },
792:       data: { product_type_id: null },
793:     })
794:     return this.prisma.productType.delete({ where: { id: type.id } })
795:   }
796: 
797:   async getTags(storeId: bigint) {
798:     return this.jsonSafe(
799:       await this.prisma.tag.findMany({
800:         where: { store_id: storeId },
801:         orderBy: { name: 'asc' },
802:       }),
803:     )
804:   }
805: 
806:   async createTag(storeId: bigint, name: string) {
807:     const exists = await this.prisma.tag.findFirst({
808:       where: { store_id: storeId, name: { equals: name.trim(), mode: 'insensitive' } },
809:     })
810:     if (exists) return this.jsonSafe(exists)
811:     return this.jsonSafe(
812:       await this.prisma.tag.create({ data: { store_id: storeId, name: name.trim() } }),
813:     )
814:   }
815: 
816:   async updateTag(storeId: bigint, id: string, name: string) {
817:     const tag = await this.prisma.tag.findFirst({
818:       where: { id: BigInt(id), store_id: storeId },
819:     })
820:     if (!tag) throw new NotFoundException('Tag not found')
821:     return this.jsonSafe(
822:       await this.prisma.tag.update({ where: { id: tag.id }, data: { name: name.trim() } }),
823:     )
824:   }
825: 
826:   async deleteTag(storeId: bigint, id: string) {
827:     const tag = await this.prisma.tag.findFirst({
828:       where: { id: BigInt(id), store_id: storeId },
829:     })
830:     if (!tag) throw new NotFoundException('Tag not found')
831:     await this.prisma.productTag.deleteMany({ where: { tag_id: tag.id } })
832:     return this.prisma.tag.delete({ where: { id: tag.id } })
833:   }
834: }

(End of file - total 834 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/orders/order.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/orders/order.service.ts</path>
<type>file</type>
<content>
1: // src/stores/orders/order.service.ts
2: import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
3: import { PrismaService } from '../../prisma/prisma.service'
4: import { OrderStatus, ProductStatus } from '@prisma/client'
5: 
6: interface CheckoutItemInput {
7:   variantId: string
8:   qty: number
9: }
10: 
11: interface CheckoutCustomerInput {
12:   name: string
13:   phone: string
14:   email?: string
15:   address: string
16:   city: string
17:   notes?: string
18: }
19: 
20: @Injectable()
21: export class OrderService {
22:   constructor(
23:     private prisma: PrismaService,
24:   ) {}
25: 
26:   private jsonSafe(data: any) {
27:     return JSON.parse(JSON.stringify(data, (_, v) =>
28:       typeof v === 'bigint' ? v.toString() : v
29:     ))
30:   }
31: 
32:   /** رقم طلب بسيط وقابل للقراءة: #1001, #1002... لكل متجر لوحده */
33:   private async generateOrderNumber(storeId: bigint): Promise<string> {
34:     const count = await this.prisma.order.count({ where: { store_id: storeId } })
35:     return String(1000 + count + 1)
36:   }
37: 
38:   async createOrder(
39:     storeSlug: string,
40:     customer: CheckoutCustomerInput,
41:     items: CheckoutItemInput[],
42:   ) {
43:     if (!items || items.length === 0) throw new BadRequestException('السلة فاضية')
44:     if (!customer?.name || !customer?.phone || !customer?.address || !customer?.city) {
45:       throw new BadRequestException('بيانات العميل ناقصة')
46:     }
47: 
48:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
49:     if (!store) throw new NotFoundException('Store not found')
50: 
51:     const variantIds = items.map((i) => BigInt(i.variantId))
52:     const variants = await this.prisma.productVariant.findMany({
53:       where: { id: { in: variantIds } },
54:       include: { product: true },
55:     })
56: 
57:     const orderItemsData: any[] = []
58:     let subtotal = 0
59: 
60:     for (const item of items) {
61:       const variant = variants.find((v) => v.id === BigInt(item.variantId))
62:       if (!variant) {
63:         throw new BadRequestException(`منتج غير موجود (variant ${item.variantId})`)
64:       }
65:       if (variant.product.store_id !== store.id) {
66:         throw new BadRequestException('منتج لا ينتمي لهذا المتجر')
67:       }
68:       if (
69:         variant.product.status !== ProductStatus.ACTIVE &&
70:         variant.product.status !== ProductStatus.UNLISTED
71:       ) {
72:         throw new BadRequestException(`المنتج "${variant.product.title}" غير متاح حالياً`)
73:       }
74:       const qty = Math.max(1, Math.floor(item.qty))
75:       if (variant.track_inventory && !variant.continue_selling && variant.inventory_qty < qty) {
76:         throw new BadRequestException(`الكمية المطلوبة من "${variant.product.title}" غير متوفرة`)
77:       }
78: 
79:       const price = Number(variant.price)
80:       subtotal += price * qty
81: 
82:       orderItemsData.push({
83:         product_id: variant.product_id,
84:         variant_id: variant.id,
85:         title: variant.product.title,
86:         variant_title: variant.title === 'Default Title' ? null : variant.title,
87:         price,
88:         qty,
89:         image_url: variant.image_url || null,
90:       })
91:     }
92: 
93:     const total = subtotal
94:     const orderNumber = await this.generateOrderNumber(store.id)
95: 
96:     const order = await this.prisma.$transaction(async (tx) => {
97:       const created = await tx.order.create({
98:         data: {
99:           store_id: store.id,
100:           order_number: orderNumber,
101:           status: OrderStatus.PENDING,
102:           customer_name: customer.name.trim(),
103:           customer_phone: customer.phone.trim(),
104:           customer_email: customer.email?.trim() || null,
105:           address_line: customer.address.trim(),
106:           city: customer.city.trim(),
107:           notes: customer.notes?.trim() || null,
108:           subtotal,
109:           total,
110:           items: { create: orderItemsData },
111:         },
112:         include: { items: true },
113:       })
114: 
115:       // نقص المخزون فوراً
116:       for (const item of items) {
117:         const variant = variants.find((v) => v.id === BigInt(item.variantId))!
118:         if (variant.track_inventory) {
119:           await tx.productVariant.update({
120:             where: { id: variant.id },
121:             data: { inventory_qty: { decrement: Math.max(1, Math.floor(item.qty)) } },
122:           })
123:         }
124:       }
125: 
126:       return created
127:     })
128: 
129:     // إرجاع الطلب بدون أي رابط دفع
130:     return this.jsonSafe({ order, payment_redirect_url: null })
131:   }
132: 
133:   /** جلب طلب واحد بالـ order number — مستخدمة في صفحة تأكيد الطلب public */
134:   async getStorefrontOrder(storeSlug: string, orderNumber: string) {
135:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })
136:     if (!store) throw new NotFoundException('Store not found')
137: 
138:     const order = await this.prisma.order.findFirst({
139:       where: { store_id: store.id, order_number: orderNumber },
140:       include: { items: true },
141:     })
142:     if (!order) throw new NotFoundException('Order not found')
143:     return this.jsonSafe(order)
144:   }
145: 
146:   // ── لوحة تحكم التاجر ────────────────────────────────────────────────────
147: 
148:   async getOrders(
149:     storeId: bigint,
150:     filters: { status?: string; search?: string; page: number; limit: number },
151:   ) {
152:     const where: any = { store_id: storeId }
153:     if (filters.status) where.status = filters.status.toUpperCase()
154:     if (filters.search) {
155:       where.OR = [
156:         { order_number: { contains: filters.search, mode: 'insensitive' } },
157:         { customer_name: { contains: filters.search, mode: 'insensitive' } },
158:         { customer_phone: { contains: filters.search, mode: 'insensitive' } },
159:       ]
160:     }
161:     const [total, orders] = await Promise.all([
162:       this.prisma.order.count({ where }),
163:       this.prisma.order.findMany({
164:         where,
165:         include: { items: true },
166:         orderBy: { created_at: 'desc' },
167:         skip: (filters.page - 1) * filters.limit,
168:         take: filters.limit,
169:       }),
170:     ])
171:     return this.jsonSafe({
172:       orders,
173:       total,
174:       page: filters.page,
175:       pages: Math.ceil(total / filters.limit),
176:     })
177:   }
178: 
179:   async getOrder(storeId: bigint, orderId: string) {
180:     const order = await this.prisma.order.findFirst({
181:       where: { id: BigInt(orderId), store_id: storeId },
182:       include: { items: true },
183:     })
184:     if (!order) throw new NotFoundException('Order not found')
185:     return this.jsonSafe(order)
186:   }
187: 
188:   async updateOrderStatus(storeId: bigint, orderId: string, status: OrderStatus) {
189:     const order = await this.prisma.order.findFirst({
190:       where: { id: BigInt(orderId), store_id: storeId },
191:     })
192:     if (!order) throw new NotFoundException('Order not found')
193:     return this.jsonSafe(
194:       await this.prisma.order.update({ where: { id: order.id }, data: { status } }),
195:     )
196:   }
197: }

(End of file - total 197 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/collections/collections.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/collections/collections.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, NotFoundException } from '@nestjs/common';
2: import { PrismaService } from '../../prisma/prisma.service';
3: 
4: function toHandle(text: string): string {
5:   return text
6:     .toLowerCase()
7:     .trim()
8:     .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g, '')
9:     .replace(/[^a-z0-9\s-]+/g, '')
10:     .trim()
11:     .replace(/\s+/g, '-')
12:     .replace(/-+/g, '-')
13:     .replace(/^-+|-+$/g, '');
14: }
15: 
16: @Injectable()
17: export class CollectionsService {
18:   constructor(private prisma: PrismaService) {}
19: 
20:   /** بتاعة الاستخدام السريع جوه ProductForm — get-or-create بالاسم،
21:    *  بالظبط زي endpoint الـ tags و product-types الحاليين عندك. */
22:   async getOrCreateByName(storeId: bigint, name: string) {
23:     // مفيش أي "اسم تلقائي" وهمي (زي collection-1784...) — لو الاسم مش
24:     // قابل للتحويل لحروف/أرقام إنجليزية (زي اسم عربي بالكامل)، الـ handle
25:     // بياخد الاسم نفسه زي ما هو، بالظبط زي الفرونت (Title → handle).
26:     const handle = toHandle(name) || name;
27:     const existing = await this.prisma.collection.findFirst({
28:       where: { storeId, name: { equals: name, mode: 'insensitive' } },
29:     });
30:     if (existing) return existing;
31: 
32:     return this.prisma.collection.create({
33:       data: { storeId, name, handle },
34:     });
35:   }
36: 
37:   async list(storeId: bigint) {
38:     const collections = await this.prisma.collection.findMany({
39:       where: { storeId },
40:       orderBy: { createdAt: 'desc' },
41:       include: { _count: { select: { products: true } } },
42:     });
43:     return collections.map((c) => ({
44:       id: c.id,
45:       name: c.name,
46:       handle: c.handle,
47:       description: c.description,
48:       image_url: c.image_url,
49:       product_count: c._count.products,
50:       // الفرونت محتاجهم لعمود "Updated" — كانوا مش راجعين خالص قبل كده
51:       created_at: c.createdAt,
52:       updated_at: c.updatedAt,
53:     }));
54:   }
55: 
56:   async getOne(storeId: bigint, id: number) {
57:     const collection = await this.prisma.collection.findFirst({
58:       where: { id, storeId },
59:       include: {
60:         products: {
61:           orderBy: { position: 'asc' },
62:           include: {
63:             product: {
64:               include: { images: { take: 1, orderBy: { position: 'asc' } } },
65:             },
66:           },
67:         },
68:       },
69:     });
70:     if (!collection) throw new NotFoundException('Collection not found');
71:     return {
72:       id: collection.id,
73:       name: collection.name,
74:       handle: collection.handle,
75:       description: collection.description,
76:       image_url: collection.image_url,
77:       image_key: collection.image_key,
78:       created_at: collection.createdAt,
79:       updated_at: collection.updatedAt,
80:       products: collection.products.map((pc) => ({
81:         id: pc.product.id,
82:         title: pc.product.title,
83:         image_url: pc.product.images[0]?.url || null,
84:       })),
85:     };
86:   }
87: 
88:   async create(
89:     storeId: bigint,
90:     dto: {
91:       name: string;
92:       description?: string | null;
93:       image_url?: string | null;
94:       image_key?: string | null;
95:       seo_title?: string | null;
96:       seo_description?: string | null;
97:       product_ids?: string[];
98:     },
99:   ) {
100:     // نفس المبدأ هنا: من غير أي fallback وهمي بـ timestamp. لو الاسم منه
101:     // حروف/أرقام إنجليزية قابلة للتحويل، بياخدها؛ لو مش قابل (عربي بالكامل
102:     // مثلاً)، الـ base بيبقى الاسم نفسه زي ما هو، وبعدين لو فيه تكرار
103:     // بنضيفله رقم تسلسلي عادي (-2, -3, ...) بس عشان يفضل unique.
104:     const baseHandle = toHandle(dto.name) || dto.name;
105: 
106:     let handle = baseHandle;
107:     let i = 1;
108:     while (
109:       await this.prisma.collection.findFirst({ where: { storeId, handle } })
110:     ) {
111:       handle = `${baseHandle}-${++i}`;
112:     }
113: 
114:     const collection = await this.prisma.collection.create({
115:       data: {
116:         storeId,
117:         name: dto.name,
118:         handle,
119:         description: dto.description ?? null,
120:         image_url: dto.image_url ?? null,
121:         image_key: dto.image_key ?? null,
122:         seo_title: dto.seo_title ?? null,
123:         seo_description: dto.seo_description ?? null,
124:       },
125:     });
126: 
127:     if (dto.product_ids?.length) {
128:       await this.prisma.productCollection.createMany({
129:         data: dto.product_ids.map((id, position) => ({
130:           collectionId: collection.id,
131:           productId: BigInt(id),
132:           position,
133:         })),
134:         skipDuplicates: true,
135:       });
136:     }
137: 
138:     return this.getOne(storeId, collection.id);
139:   }
140: 
141:   async update(
142:     storeId: bigint,
143:     id: number,
144:     dto: {
145:       name?: string;
146:       description?: string | null;
147:       image_url?: string | null;
148:       image_key?: string | null;
149:       seo_title?: string | null;
150:       seo_description?: string | null;
151:       product_ids?: string[];
152:     },
153:   ) {
154:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });
155:     if (!existing) throw new NotFoundException('Collection not found');
156: 
157:     return this.prisma.$transaction(async (tx) => {
158:       if (dto.product_ids) {
159:         await tx.productCollection.deleteMany({ where: { collectionId: id } });
160:         if (dto.product_ids.length) {
161:           await tx.productCollection.createMany({
162:             data: dto.product_ids.map((productId, position) => ({
163:               collectionId: id,
164:               productId: BigInt(productId),
165:               position,
166:             })),
167:           });
168:         }
169:       }
170: 
171:       await tx.collection.update({
172:         where: { id },
173:         data: {
174:           name: dto.name,
175:           description: dto.description !== undefined ? dto.description : undefined,
176:           image_url: dto.image_url !== undefined ? dto.image_url : undefined,
177:           image_key: dto.image_key !== undefined ? dto.image_key : undefined,
178:           seo_title:
179:             dto.seo_title !== undefined ? dto.seo_title : undefined,
180: 
181:           seo_description:
182:             dto.seo_description !== undefined ? dto.seo_description : undefined,
183: 
184:           // Prisma بيحدّث updatedAt تلقائي مع @updatedAt، بس لازم الـ
185:           // update فعلًا يتنفذ حتى لو مفيش حقول اتغيرت — ده بيحصل هنا
186:           // أصلًا لأننا دايمًا بنعمل tx.collection.update.
187:         },
188:       });
189: 
190:       return this.getOne(storeId, id);
191:     });
192:   }
193: 
194:   async remove(storeId: bigint, id: number) {
195:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });
196:     if (!existing) throw new NotFoundException('Collection not found');
197:     return this.prisma.collection.delete({ where: { id } });
198:   }
199: 
200:   async addProducts(storeId: bigint, id: number, productIds: string[]) {
201:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });
202:     if (!existing) throw new NotFoundException('Collection not found');
203: 
204:     const ids = productIds.map((productId) => BigInt(productId));
205: 
206:     await this.prisma.$transaction(async (tx) => {
207:       // ✅ تحقق ملكية (متفق عليه): قبل كده كان بيتحقق بس إن الكولكشن
208:       // نفسها بتاعة المتجر الفعّال، من غير ما يتأكد إن كل المنتجات
209:       // المطلوب ربطها بيها بتاعة نفس المتجر كمان — وده كان ممكن يسمح
210:       // بربط منتج من متجر تاني غلط. دلوقتي بنتحقق من كل الـ productIds
211:       // مقابل نفس storeId جوه نفس الـ transaction قبل أي إدراج، فمفيش
212:       // إدراج جزئي ولا ربط عابر للمتاجر.
213:       const owned = await tx.product.findMany({
214:         where: { id: { in: ids }, store_id: storeId },
215:         select: { id: true },
216:       });
217:       if (owned.length !== ids.length) {
218:         throw new NotFoundException('One or more products not found');
219:       }
220: 
221:       const lastPosition = await tx.productCollection.count({
222:         where: { collectionId: id },
223:       });
224: 
225:       await tx.productCollection.createMany({
226:         data: productIds.map((productId, index) => ({
227:           collectionId: id,
228:           productId: BigInt(productId),
229:           position: lastPosition + index,
230:         })),
231:         skipDuplicates: true,
232:       });
233:     });
234: 
235:     return this.getOne(storeId, id);
236:   }
237: 
238:   async removeProduct(storeId: bigint, id: number, productId: string) {
239:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });
240:     if (!existing) throw new NotFoundException('Collection not found');
241: 
242:     await this.prisma.productCollection.deleteMany({
243:       where: { collectionId: id, productId: BigInt(productId) },
244:     });
245: 
246:     return this.getOne(storeId, id);
247:   }
248: }

(End of file - total 248 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/uploads/uploads.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/uploads/uploads.service.ts</path>
<type>file</type>
<content>
1: // src/uploads/uploads.service.ts
2: import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
3: import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
4: import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
5: import { randomUUID } from 'crypto';
6: import { PrismaService } from '../prisma/prisma.service';
7: 
8: const ALLOWED_MIME = ['image/png', 'image/jpeg','image/webp', 'image/jpg', 'video/mp4'];
9: const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
10: const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
11: 
12: @Injectable()
13: export class UploadsService {
14:   /**
15:    * FIX: @aws-sdk/client-s3 (v3.729.0+) enables "flexible checksums" by
16:    * default — it silently adds x-amz-checksum-crc32 / x-amz-sdk-checksum-
17:    * algorithm to presigned PutObject URLs. R2 doesn't implement this
18:    * feature, so browsers uploading to these URLs get rejected (surfaces as
19:    * a CORS failure, or a 501 "NotImplemented" for that header). Setting
20:    * requestChecksumCalculation to WHEN_REQUIRED restores the old behavior
21:    * (no checksum unless explicitly requested), which R2 is compatible with.
22:    * See: https://community.cloudflare.com/t/aws-sdk-client-s3-v3-729-0-breaks-uploadpart-and-putobject-r2-s3-api-compatibility/758637
23:    */
24:   private client = new S3Client({
25:     region: 'auto',
26:     endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
27:     credentials: {
28:       accessKeyId: process.env.R2_ACCESS_KEY_ID!,
29:       secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
30:     },
31:     requestChecksumCalculation: 'WHEN_REQUIRED',
32:   });
33: 
34:   constructor(private prisma: PrismaService) {}
35: 
36:   /**
37:    * FIX (root cause of every upload failing with 500 "Cannot convert
38:    * undefined to a BigInt"): the controller used to read `req.user.storeId`,
39:    * which does not exist on the session user object — only `req.user.id`
40:    * does (see ProductController / ProductService.getStore, which resolve
41:    * the store via `ownerId: BigInt(userId)`). We resolve the store the same
42:    * way here so uploads always target the right store instead of crashing
43:    * before ever reaching R2.
44:    */
45:   private async resolveStoreId(userId: string | number | bigint): Promise<bigint> {
46:     const store = await this.prisma.store.findFirst({
47:       where: { ownerId: BigInt(userId) },
48:     });
49:     if (!store) throw new UnauthorizedException('لا يوجد متجر مرتبط بهذا الحساب');
50:     return store.id;
51:   }
52: 
53:   async presignForUser(userId: string | number | bigint, body: { fileName: string; mimeType: string; size: number; folder: 'products' | 'variants' }) {
54:     const storeId = await this.resolveStoreId(userId);
55:     return this.presign(storeId, body);
56:   }
57: 
58:   async confirmForUser(userId: string | number | bigint, key: string, attachedType?: string, attachedId?: string) {
59:     const storeId = await this.resolveStoreId(userId);
60:     return this.confirm(storeId, key, attachedType, attachedId);
61:   }
62: 
63:   async removeForUser(userId: string | number | bigint, key: string) {
64:     const storeId = await this.resolveStoreId(userId);
65:     return this.remove(storeId, key);
66:   }
67: 
68:   async presign(storeId: bigint, body: { fileName: string; mimeType: string; size: number; folder: 'products' | 'variants' }) {
69:     if (!ALLOWED_MIME.includes(body.mimeType)) {
70:       throw new BadRequestException('نوع الملف غير مسموح به. المسموح: png, jpg, mp4');
71:     }
72:     const isVideo = body.mimeType === 'video/mp4';
73:     const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
74:     if (body.size > maxSize) {
75:       throw new BadRequestException(`حجم الملف أكبر من المسموح (${isVideo ? '50' : '10'} ميجا)`);
76:     }
77: 
78:     const ext = (body.fileName.split('.').pop() || 'jpg').toLowerCase();
79:     const key = `${storeId}/${body.folder}/${randomUUID()}.${ext}`;
80:     const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
81: 
82:     const command = new PutObjectCommand({
83:       Bucket: process.env.R2_BUCKET_NAME,
84:       Key: key,
85:       ContentType: body.mimeType,
86:     });
87:     const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 300 });
88: 
89:     await this.prisma.upload.create({
90:       data: {
91:         key,
92:         url: publicUrl,
93:         mime_type: body.mimeType,
94:         size: body.size,
95:         store_id: storeId,
96:         status: 'pending',
97:       },
98:     });
99: 
100:     return { uploadUrl, key, publicUrl };
101:   }
102: 
103:   async confirm(storeId: bigint, key: string, attachedType?: string, attachedId?: string) {
104:     const upload = await this.prisma.upload.findUnique({ where: { key } });
105:     if (!upload || upload.store_id !== storeId) {
106:       throw new UnauthorizedException('ملف غير موجود أو غير مصرح به');
107:     }
108:     await this.prisma.upload.update({
109:       where: { key },
110:       data: {
111:         status: 'attached',
112:         attached_type: attachedType,
113:         attached_id: attachedId ? BigInt(attachedId) : null,
114:       },
115:     });
116:     return { success: true };
117:   }
118: 
119:   async remove(storeId: bigint, key: string) {
120:     const upload = await this.prisma.upload.findUnique({ where: { key } });
121:     if (!upload || upload.store_id !== storeId) {
122:       throw new UnauthorizedException('غير مصرح لك بحذف هذا الملف');
123:     }
124:     await this.client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
125:     await this.prisma.upload.delete({ where: { key } });
126:     return { success: true };
127:   }
128: 
129:   // بيستخدمها الـ cron job
130:   getS3Client() {
131:     return this.client;
132:   }
133: }

(End of file - total 133 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 2.2s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/store.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/store.service.ts</path>
<type>file</type>
<content>
1: import {
2:   Injectable,
3:   NotFoundException,
4: } from '@nestjs/common'
5: 
6: import { PrismaService } from '../prisma/prisma.service'
7: import type { store as StoreRecord } from '@prisma/client'
8: import { CreateSectionDto } from './dtos/create-section.dto'
9: import { UpdateSectionDto } from './dtos/update-section.dto'
10: import { ReorderSectionsDto } from './dtos/reorder-sections.dto'
11: import { UpdateColorsDto } from './dtos/update-colors.dto'
12: import { UpdateTypographyDto } from './dtos/update-typography.dto'
13: import { UpdateHeaderDto } from './dtos/update-header.dto'
14: 
15: @Injectable()
16: export class StoreService {
17:   constructor(
18:     private prisma: PrismaService,
19:   ) {}
20: 
21:   private jsonSafe(data: any) {
22:     return JSON.parse(
23:       JSON.stringify(
24:         data,
25:         (_, value) =>
26:           typeof value === 'bigint'
27:             ? value.toString()
28:             : value,
29:       ),
30:     )
31:   }
32: 
33: 
34:   async getMyStores(userId: any) {
35:     return this.prisma.store.findMany({
36:       where: {
37:         ownerId: BigInt(userId),
38:       },
39:       include: {
40:         theme: true,
41:         sections: true,
42:       },
43:     })
44:   }
45: 
46:   async createStore(
47:     userId: any,
48:     data: any,
49:   ) {
50:     const now = new Date()
51:     const store = await this.prisma.store.create({
52:       data: {
53:         name: data.name,
54:         slug: data.slug,
55:         description: data.description || null,
56:         currency: data.currency || 'SAR',
57:         status: 1,
58:         ownerId: BigInt(userId),
59:         createdAt: new Date(),
60:         updatedAt: new Date(),
61:       },
62:     })
63: 
64:     // Create default theme for the store
65:     await this.prisma.storeTheme.create({
66:       data: {
67:         store_id: store.id,
68:         colors: {
69:           primary: '#2563eb',
70:           secondary: '#64748b',
71:           accent: '#f59e0b',
72:           background: '#ffffff',
73:           surface: '#f8fafc',
74:           textPrimary: '#0f172a',
75:           textSecondary: '#64748b',
76:           textMuted: '#94a3b8',
77:           border: '#e2e8f0',
78:           headerBg: '#ffffff',
79:           headerText: '#0f172a',
80:           footerBg: '#0f172a',
81:           footerText: '#ffffff',
82:         },
83:         typography: {
84:           headingFont: 'Inter',
85:           bodyFont: 'Inter',
86:           baseSize: '16px',
87:           scale: 1.25,
88:           h1Size: '2.5rem',
89:           h2Size: '2rem',
90:           h3Size: '1.5rem',
91:           lineHeight: 1.6,
92:           letterSpacing: 'normal',
93:         },
94:         header: {
95:           showSearch: true,
96:           showAccount: true,
97:           showCart: true,
98:           sticky: false,
99:           background: '#ffffff',
100:           textColor: '#0f172a',
101:           logoPosition: 'left',
102:           menuPosition: 'center',
103:         },
104:         footer: {
105:           showNewsletter: true,
106:           showSocialLinks: true,
107:           columns: 4,
108:           background: '#0f172a',
109:           textColor: '#ffffff',
110:         },
111:       },
112:     })
113: 
114:     return store
115:   }
116: 
117:   async updateStore(
118:     userId: any,
119:     slug: string,
120:     data: any,
121:   ) {
122:     const store =
123:       await this.prisma.store.findFirst({
124:         where: {
125:           slug,
126:           ownerId: BigInt(userId),
127:         },
128:       })
129: 
130:     if (!store)
131:       throw new NotFoundException(
132:         'Store not found',
133:       )
134: 
135:     return this.prisma.store.update({
136:       where: {
137:         id: store.id,
138:       },
139:       data: {
140:         name: data.name,
141:         description: data.description,
142:         currency: data.currency,
143:         status: Number(data.status),
144:         updatedAt: new Date(),
145:       },
146:     })
147:   }
148: 
149:   // =====================
150:   // PAGES
151:   // =====================
152: 
153:   async getStorePages(storeId: bigint) {
154:     return this.prisma.storePage.findMany({
155:       where: {
156:         store_id: storeId,
157:       },
158:       orderBy: {
159:         sort_order: 'asc',
160:       },
161:     })
162:   }
163: 
164:   /**
165:    * ⚠️ ملاحظة نوع البيانات: CreateStorePageDto موجود ومستخدم على مستوى
166:    * الـ Controller، لكن هنا سبناه any عن قصد — حقل type في الـ DTO
167:    * عبارة عن enum منفصل عن Prisma PageType (نفس القيم النصية، بس TS
168:    * بيتعامل مع الـ enums بالاسم مش بالشكل)، فتثبيت النوع هنا كان
169:    * هيكسر الـ build على prisma.storePage.create({ data: { type } }).
170:    */
171:   async createStorePage(
172:     storeId: bigint,
173:     data: any,
174:   ) {
175:     const lastPage =
176:       await this.prisma.storePage.findFirst({
177:         where: {
178:           store_id: storeId,
179:         },
180:         orderBy: {
181:           sort_order: 'desc',
182:         },
183:       })
184: 
185:     return this.prisma.storePage.create({
186:       data: {
187:         store_id: storeId,
188:         title: data.title,
189:         slug: data.slug,
190:         type: data.type,
191:         content: data.content || null,
192:         sort_order: lastPage
193:           ? lastPage.sort_order + 1
194:           : 0,
195:       },
196:     })
197:   }
198: 
199:   async updateStorePage(
200:     storeId: bigint,
201:     pageId: string,
202:     data: any,
203:   ) {
204:     const page = await this.prisma.storePage.findFirst({
205:       where: {
206:         id: BigInt(pageId),
207:         store_id: storeId,
208:       },
209:     })
210: 
211:     if (!page)
212:       throw new NotFoundException('Page not found')
213: 
214:     return this.prisma.storePage.update({
215:       where: {
216:         id: BigInt(pageId),
217:       },
218:       data: {
219:         title: data.title,
220:         slug: data.slug,
221:         type: data.type,
222:         content: data.content,
223:         is_active: data.is_active,
224:         image_url: data.image_url,
225:       },
226:     })
227:   }
228: 
229:   async deleteStorePage(
230:     storeId: bigint,
231:     pageId: string,
232:   ) {
233:     const page = await this.prisma.storePage.findFirst({
234:       where: {
235:         id: BigInt(pageId),
236:         store_id: storeId,
237:       },
238:     })
239: 
240:     if (!page)
241:       throw new NotFoundException('Page not found')
242: 
243:     return this.prisma.storePage.delete({
244:       where: {
245:         id: BigInt(pageId),
246:       },
247:     })
248:   }
249: 
250:   async reorderPages(
251:     storeId: bigint,
252:     pages: any[],
253:   ) {
254:     // ✅ تحقق ملكية: كل الصفحات المطلوب ترتيبها لازم تكون بتاعة نفس
255:     // المتجر الفعّال — قبل كده الميثود دي كانت بتحدّث أي id يتبعت من
256:     // غير أي تحقق خالص.
257:     const ids = pages.map((p) => BigInt(p.id))
258:     const owned = await this.prisma.storePage.findMany({
259:       where: { id: { in: ids }, store_id: storeId },
260:       select: { id: true },
261:     })
262:     if (owned.length !== ids.length) {
263:       throw new NotFoundException('One or more pages not found')
264:     }
265: 
266:     return Promise.all(
267:       pages.map(page =>
268:         this.prisma.storePage.update({
269:           where: {
270:             id: BigInt(page.id),
271:           },
272:           data: {
273:             sort_order:
274:               page.sort_order,
275:           },
276:         }),
277:       ),
278:     )
279:   }
280: 
281:   // =====================
282:   // MENUS
283:   // =====================
284: 
285:   async getMenus(storeId: bigint) {
286:     return this.prisma.storeMenu.findMany({
287:       where: {
288:         store_id: storeId,
289:       },
290:       include: {
291:         items: {
292:           orderBy: {
293:             sort_order: 'asc',
294:           },
295:         },
296:       },
297:     })
298:   }
299: 
300:   async createMenu(
301:     storeId: bigint,
302:     name: string,
303:   ) {
304:     const baseHandle =
305:       name
306:         .toLowerCase()
307:         .trim()
308:         .replace(/\s+/g, '-')
309: 
310:     const handle =
311:       `${baseHandle}-${Date.now()}`
312: 
313:     return this.prisma.storeMenu.create({
314:       data: {
315:         name,
316:         handle,
317:         store_id: storeId,
318:       },
319:     })
320:   }
321: 
322:   async updateMenu(
323:     storeId: bigint,
324:     id: string,
325:     data: any,
326:   ) {
327:     // ✅ تحقق ملكية: قبل كده الميثود دي كانت بتحدّث أي menu id يتبعت
328:     // من غير أي تحقق إن المينيو ده بتاع المتجر الفعّال أصلاً.
329:     const menu = await this.prisma.storeMenu.findFirst({
330:       where: { id: BigInt(id), store_id: storeId },
331:     })
332: 
333:     if (!menu)
334:       throw new NotFoundException('Menu not found')
335: 
336:     return this.prisma.storeMenu.update({
337:       where: {
338:         id: BigInt(id),
339:       },
340:       data: {
341:         name: data.name,
342:       },
343:     })
344:   }
345: 
346:   async deleteMenu(
347:     storeId: bigint,
348:     id: string,
349:   ) {
350:     const menu = await this.prisma.storeMenu.findFirst({
351:       where: {
352:         id: BigInt(id),
353:         store_id: storeId,
354:       },
355:     })
356: 
357:     if (!menu)
358:       throw new NotFoundException('Menu not found')
359: 
360:     return this.prisma.storeMenu.delete({
361:       where: {
362:         id: BigInt(id),
363:       },
364:     })
365:   }
366: 
367:   async addMenuItem(
368:     storeId: bigint,
369:     menuId: string,
370:     data: any,
371:   ) {
372:     // ✅ تحقق ملكية: قبل كده كان ممكن تضيف item لأي menu id من غير ما
373:     // نتأكد إن المينيو ده بتاع المتجر الفعّال.
374:     const menu = await this.prisma.storeMenu.findFirst({
375:       where: { id: BigInt(menuId), store_id: storeId },
376:     })
377: 
378:     if (!menu)
379:       throw new NotFoundException('Menu not found')
380: 
381:     const lastItem =
382:       await this.prisma.menuItem.findFirst({
383:         where: {
384:           menu_id: BigInt(menuId),
385:         },
386:         orderBy: {
387:           sort_order: 'desc',
388:         },
389:       })
390: 
391:     return this.prisma.menuItem.create({
392:       data: {
393:         menu_id: BigInt(menuId),
394:         title: data.title,
395:         type: data.type,
396:         url: data.url,
397:         resource_id:
398:           data.resource_id || null,
399:         parent_id:
400:           data.parent_id || null,
401:         sort_order:
402:           lastItem
403:             ? lastItem.sort_order + 1
404:             : 0,
405:       },
406:     })
407:   }
408: 
409:   async updateMenuItem(
410:     storeId: bigint,
411:     itemId: string,
412:     data: any,
413:   ) {
414:     // ✅ تحقق ملكية عن طريق علاقة menu → store_id (MenuItem مفيهوش
415:     // store_id مباشر). قبل كده الميثود دي كانت بتحدّث أي item id من
416:     // غير أي تحقق خالص.
417:     const item = await this.prisma.menuItem.findFirst({
418:       where: { id: BigInt(itemId), menu: { store_id: storeId } },
419:     })
420: 
421:     if (!item)
422:       throw new NotFoundException('Menu item not found')
423: 
424:     return this.prisma.menuItem.update({
425:       where: {
426:         id: BigInt(itemId),
427:       },
428:       data: {
429:         title: data.title,
430:         url: data.url,
431:         type: data.type,
432:         resource_id: data.resource_id || null,
433:         parent_id: data.parent_id || null,
434:       },
435:     })
436:   }
437: 
438:   async deleteMenuItem(
439:     storeId: bigint,
440:     itemId: string,
441:   ) {
442:     const item = await this.prisma.menuItem.findFirst({
443:       where: { id: BigInt(itemId), menu: { store_id: storeId } },
444:     })
445: 
446:     if (!item)
447:       throw new NotFoundException('Menu item not found')
448: 
449:     return this.prisma.menuItem.delete({
450:       where: {
451:         id: BigInt(itemId),
452:       },
453:     })
454:   }
455: 
456:   async reorderMenuItems(storeId: bigint, items: any[]) {
457:     // ✅ تحقق ملكية: نفس فكرة reorderPages — كل الـ items المطلوب
458:     // ترتيبها لازم تكون بتاعة menus تابعة للمتجر الفعّال.
459:     const ids = items.map((i) => BigInt(i.id))
460:     const owned = await this.prisma.menuItem.findMany({
461:       where: { id: { in: ids }, menu: { store_id: storeId } },
462:       select: { id: true },
463:     })
464:     if (owned.length !== ids.length) {
465:       throw new NotFoundException('One or more menu items not found')
466:     }
467: 
468:     return Promise.all(
469:       items.map((item) =>
470:         this.prisma.menuItem.update({
471:           where: {
472:             id: BigInt(item.id),
473:           },
474:           data: {
475:             sort_order: item.sortOrder,
476:             // لو الفرونت بعت parentId، حدّثه؛ لو مبعتوش خالص، سيب القديم زي ما هو
477:             ...(item.parentId !== undefined
478:               ? { parent_id: item.parentId ? BigInt(item.parentId) : null }
479:               : {}),
480:           },
481:         }),
482:       ),
483:     )
484:   }
485: 
486:   // =====================
487:   // LINK PICKER
488:   // =====================
489: 
490:   async getLinkPicker(storeId: bigint) {
491:     const pages =
492:       await this.prisma.storePage.findMany({
493:         where: {
494:           store_id: storeId,
495:         },
496:         orderBy: {
497:           title: 'asc',
498:         },
499:       })
500: 
501:     const policies = [
502:       {
503:         title: 'Privacy Policy',
504:         url: '/policies/privacy',
505:       },
506:       {
507:         title: 'Refund Policy',
508:         url: '/policies/refund',
509:       },
510:       {
511:         title: 'Terms of Service',
512:         url: '/policies/terms',
513:       },
514:     ]
515: 
516:     return {
517:       pages,
518:       policies,
519:       collections: [],
520:       products: [],
521:       blogs: [],
522:       blogPosts: [],
523:       canCreateCollection: true,
524:       canCreateProduct: true,
525:       canCreateBlog: true,
526:       canCreatePost: true,
527:     }
528:   }
529: 
530:   async getMenu(
531:     storeId: bigint,
532:     menuId: string,
533:   ) {
534:     return this.prisma.storeMenu.findFirst({
535:       where: {
536:         id: BigInt(menuId),
537:         store_id: storeId,
538:       },
539:       include: {
540:         items: {
541:           orderBy: {
542:             sort_order: 'asc',
543:           },
544:         },
545:       },
546:     })
547:   }
548: 
549:   async duplicateMenu(
550:     storeId: bigint,
551:     menuId: string,
552:   ) {
553:     // ✅ تحقق ملكية: قبل كده الميثود دي كانت بتنسخ أي menu id يتبعت من
554:     // غير أي تحقق إنه بتاع المتجر الفعّال.
555:     const menu =
556:       await this.prisma.storeMenu.findFirst({
557:         where: {
558:           id: BigInt(menuId),
559:           store_id: storeId,
560:         },
561:         include: {
562:           items: { orderBy: { sort_order: 'asc' } }
563:         }
564:       })
565: 
566:     if (!menu)
567:       throw new NotFoundException('Menu not found')
568: 
569:     const newMenu =
570:       await this.prisma.storeMenu.create({
571:         data: {
572:           store_id: menu.store_id,
573:           name: menu.name + ' copy',
574:           handle:
575:             `${menu.handle}-copy-${Date.now()}`
576:         }
577:       })
578: 
579:     // بننسخ الـ root items الأول، وبعدين الأبناء — عشان نقدر نربط
580:     // parent_id الجديد بالـ id الجديد الصح (مش القديم)
581:     // ملحوظة: النسخة دي بتدعم مستوى واحد من التداخل (أب + أبناء)،
582:     // لو محتاج مستويات أعمق قولّي أزودها.
583:     const idMap = new Map<string, bigint>()
584:     const roots = menu.items.filter((i) => !i.parent_id)
585:     const children = menu.items.filter((i) => i.parent_id)
586: 
587:     for (const item of roots) {
588:       const created = await this.prisma.menuItem.create({
589:         data: {
590:           menu_id: newMenu.id,
591:           title: item.title,
592:           type: item.type,
593:           url: item.url,
594:           resource_id: item.resource_id,
595:           sort_order: item.sort_order,
596:         },
597:       })
598:       idMap.set(item.id.toString(), created.id)
599:     }
600: 
601:     for (const item of children) {
602:       const newParentId = idMap.get(item.parent_id!.toString())
603:       const created = await this.prisma.menuItem.create({
604:         data: {
605:           menu_id: newMenu.id,
606:           title: item.title,
607:           type: item.type,
608:           url: item.url,
609:           resource_id: item.resource_id,
610:           parent_id: newParentId || null,
611:           sort_order: item.sort_order,
612:         },
613:       })
614:       idMap.set(item.id.toString(), created.id)
615:     }
616: 
617:     return newMenu
618:   }
619: 
620:   // =====================
621:   // THEME SYSTEM
622:   // =====================
623: 
624:   async getTheme(storeId: bigint) {
625:     let theme =
626:       await this.prisma.storeTheme.findUnique({
627:         where: {
628:           store_id: storeId
629:         }
630:       })
631: 
632:     if (!theme) {
633:       theme = await this.prisma.storeTheme.create({
634:         data: {
635:           store_id: storeId,
636:           colors: {
637:             primary: '#2563eb',
638:             secondary: '#64748b',
639:             accent: '#f59e0b',
640:             background: '#ffffff',
641:             surface: '#f8fafc',
642:             textPrimary: '#0f172a',
643:             textSecondary: '#64748b',
644:             textMuted: '#94a3b8',
645:             border: '#e2e8f0',
646:             headerBg: '#ffffff',
647:             headerText: '#0f172a',
648:             footerBg: '#0f172a',
649:             footerText: '#ffffff',
650:           },
651:           typography: {
652:             headingFont: 'Inter',
653:             bodyFont: 'Inter',
654:             baseSize: '16px',
655:             scale: 1.25,
656:             h1Size: '2.5rem',
657:             h2Size: '2rem',
658:             h3Size: '1.5rem',
659:             lineHeight: 1.6,
660:             letterSpacing: 'normal',
661:           },
662:           header: {
663:             showSearch: true,
664:             showAccount: true,
665:             showCart: true,
666:             sticky: false,
667:             background: '#ffffff',
668:             textColor: '#0f172a',
669:             logoPosition: 'left',
670:             menuPosition: 'center',
671:           },
672:           footer: {
673:             showNewsletter: true,
674:             showSocialLinks: true,
675:             columns: 4,
676:             background: '#0f172a',
677:             textColor: '#ffffff',
678:           },
679:         }
680:       })
681:     }
682: 
683:     // Fetch sections separately
684:     const sections = await this.prisma.themeSection.findMany({
685:       where: { store_id: storeId },
686:       orderBy: { sort_order: 'asc' }
687:     })
688: 
689:     return { ...theme, sections }
690:   }
691: 
692:  async updateTheme(storeId: bigint, content: any) {
693:   const data: any = {
694:     updated_at: new Date(),
695:   }
696: 
697:   if (content.colors) data.colors = content.colors
698:   if (content.typography) data.typography = content.typography
699:   if (content.header) data.header = content.header
700:   if (content.footer) data.footer = content.footer
701:   if (content.settings) data.settings = content.settings
702:     data.menu_id =
703:   content.menu_id
704:     ? BigInt(content.menu_id)
705:     : null
706:   return this.prisma.storeTheme.upsert({
707:     where: { store_id: storeId },
708:     create: {
709:       store_id: storeId,
710:        menu_id: content.menu_id
711:     ? BigInt(content.menu_id)
712:     : null,
713:       colors: content.colors || {},
714:       typography: content.typography || {},
715:       header: content.header || {},
716:       footer: content.footer || {},
717:       settings: content.settings || null,
718:     },
719:     update: data,
720:   })
721: }
722: 
723: private async createPublishedTheme(
724:   storeId: bigint,
725: ) {
726:   const themeRaw =
727:     await this.prisma.storeTheme.findUnique({
728:       where: {
729:         store_id: storeId,
730:       },
731:     })
732: 
733:   const sectionsRaw =
734:     await this.prisma.themeSection.findMany({
735:       where: {
736:         store_id: storeId,
737:         is_active: true,
738:       },
739:       orderBy: {
740:         sort_order: 'asc',
741:       },
742:     })
743: 
744:   const menusRaw =
745:     await this.prisma.storeMenu.findMany({
746:       where: {
747:         store_id: storeId,
748:       },
749:       include: {
750:         items: {
751:           orderBy: {
752:             sort_order: 'asc',
753:           },
754:         },
755:       },
756:     })
757: 
758:   const theme = this.jsonSafe(themeRaw)
759:   const sections = this.jsonSafe(sectionsRaw)
760:   const menus = this.jsonSafe(menusRaw)
761: 
762:   await this.prisma.storeThemePublished.upsert({
763:     where: {
764:       store_id: storeId,
765:     },
766: 
767:     create: {
768:       store_id: storeId,
769:       theme,
770:       sections,
771:       menus,
772:     },
773: 
774:     update: {
775:       theme,
776:       sections,
777:       menus,
778:     },
779:   })
780: }
781: 
782: async publishTheme(storeId: bigint) {
783:   await this.createPublishedTheme(
784:     storeId,
785:   )
786: 
787:   return {
788:     success: true,
789:   }
790: }
791:   async updateThemeColors(
792:     storeId: bigint,
793:     colors: UpdateColorsDto,
794:   ) {
795:     return this.prisma.storeTheme.update({
796:       where: { store_id: storeId },
797:       data: { colors: { ...colors } }
798:     })
799:   }
800: 
801:   async updateThemeTypography(
802:     storeId: bigint,
803:     typography: UpdateTypographyDto,
804:   ) {
805:     return this.prisma.storeTheme.update({
806:       where: { store_id: storeId },
807:       data: { typography: { ...typography } }
808:     })
809:   }
810: 
811:   async updateThemeHeader(
812:     storeId: bigint,
813:     header: UpdateHeaderDto,
814:   ) {
815:     return this.prisma.storeTheme.update({
816:       where: { store_id: storeId },
817:       data: { header: { ...header } }
818:     })
819:   }
820: 
821:   async updateThemeFooter(
822:     storeId: bigint,
823:     footer: any,
824:   ) {
825:     return this.prisma.storeTheme.update({
826:       where: { store_id: storeId },
827:       data: { footer }
828:     })
829:   }
830: 
831:   /**
832:    * ⚠️ استثناء مقصود: الميثود دي (بخلاف باقي الميثودز فوق) بتاخد صف
833:    * المتجر كامل (store) مش storeId بس — لأن الـ response الأصلي بيرجّع
834:    * الـ store نفسه جوه الكائن الراجع ({ store, theme, sections, menus })،
835:    * وعايزين نحافظ على نفس شكل الـ API response زي ما هو بالظبط.
836:    */
837:   async getThemePreview(
838:     store: StoreRecord,
839:   ) {
840:     const theme =
841:       await this.prisma.storeTheme.findUnique({
842:         where: {
843:           store_id: store.id,
844:         },
845:       })
846: 
847:     const sections =
848:       await this.prisma.themeSection.findMany({
849:         where: {
850:           store_id: store.id,
851:         },
852:         orderBy: {
853:           sort_order: 'asc',
854:         },
855:       })
856: 
857:     const menus =
858:       await this.prisma.storeMenu.findMany({
859:         where: {
860:           store_id: store.id,
861:         },
862:         include: {
863:           items: {
864:             orderBy: {
865:               sort_order: 'asc',
866:             },
867:           },
868:         },
869:       })
870: 
871:     return {
872:       store,
873:       theme,
874:       sections,
875:       menus,
876:     }
877:   }
878: // async getPublicStoreProducts(slug: string, limit: number = 8) {
879: //   const store = await this.prisma.store.findUnique({ where: { slug } })
880: //   if (!store) return []
881: 
882: //   return this.prisma.product.findMany({
883: //     where: { store_id: store.id, status: 'active' },
884: //     take: limit,
885: //     orderBy: { created_at: 'desc' },
886: //   })
887: // }
888: 
889:   // =====================
890:   // THEME SECTIONS
891:   // =====================
892: 
893:   async getThemeSections(storeId: bigint, pageType: string = 'home') {
894:     return this.prisma.themeSection.findMany({
895:       where: {
896:         store_id: storeId,
897:         page_type: pageType,
898:       },
899:       orderBy: { sort_order: 'asc' }
900:     })
901:   }
902: 
903:   async addThemeSection(
904:     storeId: bigint,
905:     data: CreateSectionDto,
906:   ) {
907:     const lastSection = await this.prisma.themeSection.findFirst({
908:       where: { store_id: storeId, page_type: data.pageType || 'home' },
909:       orderBy: { sort_order: 'desc' }
910:     })
911: 
912:     return this.prisma.themeSection.create({
913:       data: {
914:         store_id: storeId,
915:         type: data.type,
916:         name: data.name,
917:         settings: data.settings || {},
918:         blocks: data.blocks || [],
919:         sort_order: lastSection ? lastSection.sort_order + 1 : 0,
920:         page_type: data.pageType || 'home',
921:         is_active: true,
922:       }
923:     })
924:   }
925: 
926:   async updateThemeSection(
927:     storeId: bigint,
928:     sectionId: string,
929:     data: UpdateSectionDto,
930:   ) {
931:     const section = await this.prisma.themeSection.findFirst({
932:       where: { id: BigInt(sectionId), store_id: storeId }
933:     })
934:     if (!section) throw new NotFoundException('Section not found')
935: 
936:     return this.prisma.themeSection.update({
937:       where: { id: BigInt(sectionId) },
938:       data: {
939:         name: data.name,
940:         settings: data.settings,
941:         blocks: data.blocks,
942:         sort_order: data.sortOrder,
943:         is_active: data.isActive,
944:       }
945:     })
946:   }
947: 
948: async deleteThemeSection(
949:   storeId: bigint,
950:   sectionId: string,
951: ) {
952:   const section =
953:     await this.prisma.themeSection.findFirst({
954:       where: {
955:         id: BigInt(sectionId),
956:         store_id: storeId,
957:       },
958:     })
959: 
960:   if (!section)
961:     throw new NotFoundException()
962: 
963:   return this.prisma.themeSection.delete({
964:     where: {
965:       id: BigInt(sectionId),
966:     },
967:   })
968: }
969:   async reorderThemeSections(
970:     storeId: bigint,
971:     sections: ReorderSectionsDto['sections'],
972:   ) {
973:     // ✅ تحقق ملكية: نفس فكرة reorderPages/reorderMenuItems.
974:     const ids = sections.map((s) => BigInt(s.id))
975:     const owned = await this.prisma.themeSection.findMany({
976:       where: { id: { in: ids }, store_id: storeId },
977:       select: { id: true },
978:     })
979:     if (owned.length !== ids.length) {
980:       throw new NotFoundException('One or more sections not found')
981:     }
982: 
983:     return Promise.all(
984:       sections.map(section =>
985:         this.prisma.themeSection.update({
986:           where: { id: BigInt(section.id) },
987:           data: { sort_order: section.sortOrder }
988:         })
989:       )
990:     )
991:   }
992: 
993:   // =====================
994:   // PUBLIC STORE
995:   // =====================
996: 
997:   async getPublicStore(slug: string) {
998:   const store =
999:     await this.prisma.store.findUnique({
1000:       where: {
1001:         slug,
1002:       },
1003:     })
1004: 
1005:   if (!store)
1006:     return null
1007: 
1008:   const published =
1009:     await this.prisma.storeThemePublished.findUnique({
1010:       where: {
1011:         store_id: store.id,
1012:       },
1013:     })
1014: 
1015:   return {
1016:     ...store,
1017: 
1018:     theme:
1019:       published?.theme || null,
1020: 
1021:     sections:
1022:       published?.sections || [],
1023: 
1024:     menus:
1025:       published?.menus || [],
1026:   }
1027: }
1028: 
1029:   // stores.zip/store.service.ts - أضف/تأكد من وجود الدول دي
1030: 
1031: async getPublicStoreTheme(slug: string) {
1032:   const store = await this.prisma.store.findUnique({
1033:     where: { slug }
1034:   })
1035:   if (!store) return null
1036: 
1037:   const published =
1038:   await this.prisma.storeThemePublished.findUnique({
1039:     where: {
1040:       store_id: store.id,
1041:     },
1042:   })
1043: 
1044: return published?.theme || null
1045: }
1046: 
1047: async getPublicStoreSections(slug: string, pageType: string = 'home') {
1048:   const store = await this.prisma.store.findUnique({
1049:     where: { slug }
1050:   })
1051:   if (!store) return null
1052: 
1053:   return this.prisma.themeSection.findMany({
1054:     where: {
1055:       store_id: store.id,
1056:       page_type: pageType,
1057:       is_active: true,
1058:     },
1059:     orderBy: { sort_order: 'asc' }
1060:   })
1061: }
1062: 
1063:   async getPublicStorePage(
1064:     slug: string,
1065:     pageSlug: string,
1066:   ) {
1067:     const store = await this.prisma.store.findUnique({
1068:       where: { slug }
1069:     })
1070:     if (!store) return null
1071: 
1072:     return this.prisma.storePage.findFirst({
1073:       where: {
1074:         store_id: store.id,
1075:         slug: pageSlug,
1076:       },
1077:     })
1078:   }
1079: 
1080:   async getPublicStoreMenu(
1081:     slug: string,
1082:     handle: string,
1083:   ) {
1084:     const store = await this.prisma.store.findUnique({
1085:       where: { slug }
1086:     })
1087:     if (!store) return null
1088: 
1089:     return this.prisma.storeMenu.findFirst({
1090:       where: {
1091:         store_id: store.id,
1092:         handle,
1093:       },
1094:       include: {
1095:         items: {
1096:           orderBy: {
1097:             sort_order: 'asc',
1098:           },
1099:         },
1100:       },
1101:     })
1102:   }
1103: }

(End of file - total 1103 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts</path>
<type>file</type>
<content>
1: import {
2:   BadRequestException,
3:   Injectable,
4:   Logger,
5:   NotFoundException,
6: } from '@nestjs/common'
7: import { createHmac } from 'crypto'
8: import { Prisma } from '@prisma/client'
9: import type {
10:   CaptureMode,
11:   CommitmentKind,
12:   Mode,
13:   PaymentAccountStatus,
14:   PaymentMethodKey,
15:   PaymentProviderKey,
16: } from '@prisma/client'
17: import { PrismaService } from '../../prisma/prisma.service'
18: import { crossModeQuery } from '../../common/tenant/cross-mode-query'
19: import { StoreKeyService } from '../../common/crypto/store-key.service'
20: import { DecryptionError } from '../../common/crypto/key-provider.interface'
21: import type { CryptoMode, EncryptionContext } from '../../common/crypto/key-provider.interface'
22: import {
23:   IdReservationService,
24:   PAYMENT_ACCOUNTS_TABLE,
25: } from '../../common/ids/id-reservation.service'
26: import {
27:   allowedCredentialKeys,
28:   allowedMethods,
29:   findGateway,
30:   listGateways,
31: } from './gateway-catalog'
32: import type {
33:   OfferingInputDto,
34:   UpsertPaymentAccountDto,
35: } from './dto/upsert-payment-account.dto'
36: 
37: /**
38:  * ══════════════════════════════════════════════════════════════════
39:  * حسابات الدفع
40:  * ══════════════════════════════════════════════════════════════════
41:  *
42:  * أول مستهلك حقيقي لأساس التشفير المجمّد وخدمة حجز المعرّفات.
43:  *
44:  * ثلاث قواعد بتحكم الملف ده:
45:  *
46:  *  1. **بيانات الاعتماد مابترجعش أبداً.** ولا endpoint واحد بيفك
47:  *     تشفيرها ويرجّعها. الواجهة بتاخد تلميح مقنّع (آخر 4 حروف)
48:  *     و is_configured بس. فك التشفير هيبقى للأدابترز في 1b.2 وبعدها.
49:  *
50:  *  2. **المعرّف بيتحجز قبل التشفير.** الـ AAD المجمّد بيربط النص
51:  *     المشفّر بـ id الصف، فالـ id لازم يبقى معروف قبل ما نشفّر —
52:  *     مش بعد الإدراج.
53:  *
54:  *  3. **الحقل الفاضي معناه "ماتغيّرش".** التاجر ممكن يعدّل اسم الحساب
55:  *     من غير ما يعيد كتابة مفاتيحه. المسح ليه endpoint لوحده.
56:  */
57: 
58: /** نوع الصف في الـ AAD — ثابت مدى الحياة، ممنوع يتغيّر */
59: const RECORD_TYPE = 'payment_account'
60: 
61: /** اسم الحقل في الـ AAD */
62: const CREDENTIALS_FIELD = 'credentials'
63: 
64: const DEFAULT_DISPLAY_NAME = 'Default'
65: 
66: @Injectable()
67: export class PaymentAccountService {
68:   private readonly logger = new Logger(PaymentAccountService.name)
69: 
70:   constructor(
71:     private readonly prisma: PrismaService,
72:     private readonly storeKeys: StoreKeyService,
73:     private readonly ids: IdReservationService,
74:   ) {}
75: 
76:   /**
77:    * كل البوابات المدعومة + إعداد المتجر لكل واحدة.
78:    *
79:    * الرد ده هو اللي الواجهة بتبني منه الفورم كله.
80:    */
81:   async listSettings(storeId: bigint) {
82:     const accounts = await crossModeQuery(
83:       'merchant_dual_mode_view',
84:       'settings screen lists both live and test accounts for one store',
85:       () =>
86:         this.prisma.guarded().paymentAccount.findMany({
87:           where: { store_id: storeId },
88:           include: { offerings: { orderBy: { position: 'asc' } } },
89:           orderBy: [{ gateway: 'asc' }, { display_name: 'asc' }],
90:         }),
91:     )
92: 
93:     return listGateways().map((gateway) => {
94:       const configured = accounts.filter((a) => a.gateway === gateway.key)
95: 
96:       return {
97:         key: gateway.key,
98:         name_ar: gateway.name_ar,
99:         name_en: gateway.name_en,
100:         requires_credentials: gateway.requires_credentials,
101:         supports_test_mode: gateway.supports_test_mode,
102:         supports_multiple_integrations: gateway.supports_multiple_integrations,
103:         methods: gateway.methods,
104:         fields: gateway.credential_fields,
105:         accounts: configured.map((account) => this.toPublicAccount(account)),
106:       }
107:     })
108:   }
109: 
110:   /**
111:    * ينشئ أو يعدّل حساب بوابة.
112:    *
113:    * التدفق لما يكون في بيانات اعتماد جديدة على حساب جديد:
114:    *   1. احجز id من الـ sequence
115:    *   2. ابنِ الـ AAD بالـ id ده
116:    *   3. شفّر
117:    *   4. اعمل الصف بالـ id الصريح
118:    */
119:   async upsert(
120:     storeId: bigint,
121:     gatewayKey: string,
122:     dto: UpsertPaymentAccountDto,
123:   ) {
124:     const gateway = findGateway(gatewayKey)
125: 
126:     if (!gateway) {
127:       throw new NotFoundException(`بوابة غير مدعومة: "${gatewayKey}".`)
128:     }
129: 
130:     if (dto.mode === 'test' && !gateway.supports_test_mode) {
131:       throw new BadRequestException(
132:         `${gateway.name_ar} مالهاش وضع اختبار.`,
133:       )
134:     }
135: 
136:     const displayName = (dto.display_name ?? DEFAULT_DISPLAY_NAME).trim()
137: 
138:     if (displayName.length === 0) {
139:       throw new BadRequestException('اسم الحساب ماينفعش يكون فاضي.')
140:     }
141: 
142:     const credentials = this.sanitizeCredentials(gatewayKey, dto.credentials)
143:     const offerings = this.sanitizeOfferings(gatewayKey, dto.offerings)
144: 
145:     const existing = await this.prisma.guarded().paymentAccount.findFirst({
146:       where: {
147:         store_id: storeId,
148:         mode: dto.mode,
149:         gateway: gatewayKey as PaymentProviderKey,
150:         display_name: displayName,
151:       },
152:     })
153: 
154:     const accountId = existing
155:       ? existing.id
156:       : await this.ids.reserve(PAYMENT_ACCOUNTS_TABLE)
157: 
158:     const context: EncryptionContext = {
159:       mode: dto.mode as CryptoMode,
160:       recordType: RECORD_TYPE,
161:       recordId: accountId.toString(),
162:       field: CREDENTIALS_FIELD,
163:     }
164: 
165:     // دمج بيانات الاعتماد: الحقل اللي مابعتش يفضل زي ما هو
166:     const credentialUpdate = await this.buildCredentialUpdate(
167:       storeId,
168:       existing,
169:       credentials,
170:       context,
171:     )
172: 
173:     const status = this.resolveStatus(
174:       gateway.requires_credentials,
175:       credentialUpdate.hasCredentialsAfter,
176:       dto.enabled,
177:       existing?.status,
178:     )
179: 
180:     const data = {
181:       store_id: storeId,
182:       mode: dto.mode as Mode,
183:       gateway: gatewayKey as PaymentProviderKey,
184:       display_name: displayName,
185:       settlement_currency: dto.settlement_currency?.toUpperCase() ?? null,
186:       status,
187:       ...credentialUpdate.fields,
188:     }
189: 
190:     const account = await this.prisma.$transaction(async (tx) => {
191:       const saved = existing
192:         ? await tx.paymentAccount.update({
193:             where: { id: existing.id },
194:             data,
195:           })
196:         : await tx.paymentAccount.create({
197:             data: { id: accountId, ...data },
198:           })
199: 
200:       if (offerings) {
201:         await this.replaceOfferings(tx, saved.id, storeId, dto.mode, offerings)
202:       }
203: 
204:       return tx.paymentAccount.findFirstOrThrow({
205:         where: { id: saved.id, store_id: storeId },
206:         include: { offerings: { orderBy: { position: 'asc' } } },
207:       })
208:     })
209: 
210:     this.logger.log(
211:       `حساب دفع اتحفظ: متجر ${storeId} / ${gatewayKey} / ${dto.mode} / ${displayName}` +
212:         (credentialUpdate.credentialsChanged ? ' (بيانات اعتماد اتحدّثت)' : ''),
213:     )
214: 
215:     return this.toPublicAccount(account)
216:   }
217: 
218:   /**
219:    * يمسح بيانات الاعتماد ويوقف الحساب.
220:    *
221:    * المسح عملية منفصلة عن التعديل عن قصد — عشان التاجر مايمسحش سر
222:    * بالغلط وهو بيغيّر اسم الحساب.
223:    */
224:   async clearCredentials(
225:     storeId: bigint,
226:     gatewayKey: string,
227:     mode: 'test' | 'live',
228:     displayName = DEFAULT_DISPLAY_NAME,
229:   ) {
230:     const account = await this.prisma.guarded().paymentAccount.findFirst({
231:       where: {
232:         store_id: storeId,
233:         mode: mode as Mode,
234:         gateway: gatewayKey as PaymentProviderKey,
235:         display_name: displayName,
236:       },
237:     })
238: 
239:     if (!account) {
240:       throw new NotFoundException('الحساب مش موجود.')
241:     }
242: 
243:     const updated = await this.prisma.guarded().paymentAccount.update({
244:       where: { id: account.id, store_id: account.store_id, mode: account.mode },
245:       data: {
246:         credentials_envelope: null,
247:         credential_kek_version: null,
248:         credential_dek_version: null,
249:         credentials_fingerprint: null,
250:         credentials_hint: Prisma.DbNull,
251:         status: 'draft',
252:         last_verified_at: null,
253:         last_error: null,
254:       },
255:       include: { offerings: { orderBy: { position: 'asc' } } },
256:     })
257: 
258:     this.logger.warn(
259:       `بيانات اعتماد اتمسحت: متجر ${storeId} / ${gatewayKey} / ${mode} / ${displayName}`,
260:     )
261: 
262:     return this.toPublicAccount(updated)
263:   }
264: 
265:   /**
266:    * يفك تشفير بيانات الاعتماد **للاستخدام الداخلي بس**.
267:    *
268:    * ⚠️ ممنوع منعاً باتاً إن الناتج ده يرجع في أي رد API. الدالة دي
269:    * موجودة عشان الأدابترز في المرحلة 1b.2 وبعدها، مش عشان الواجهة.
270:    *
271:    * فشل السلامة بيترمي DecryptionError — مش بيرجع null — عشان العبث
272:    * مايتخفيش ورا "مفيش بيانات".
273:    */
274:   async revealCredentialsForGateway(
275:     storeId: bigint,
276:     mode: Mode,
277:     accountId: bigint,
278:   ): Promise<Record<string, string>> {
279:     const account = await this.prisma.guarded().paymentAccount.findFirstOrThrow({
280:       where: { id: accountId, store_id: storeId, mode },
281:     })
282: 
283:     if (!account.credentials_envelope) {
284:       return {}
285:     }
286: 
287:     const context: EncryptionContext = {
288:       mode: account.mode as CryptoMode,
289:       recordType: RECORD_TYPE,
290:       recordId: account.id.toString(),
291:       field: CREDENTIALS_FIELD,
292:     }
293: 
294:     try {
295:       const decrypted = await this.storeKeys.decryptJsonForStore<
296:         Record<string, string>
297:       >(storeId, account.credentials_envelope, context)
298: 
299:       return decrypted ?? {}
300:     } catch (error) {
301:       if (error instanceof DecryptionError && error.isSecurityRelevant) {
302:         // نقل الصف، أو تغيير الوضع، أو عبث بالبيانات
303:         this.logger.error(
304:           `[security] فشل التحقق من سلامة بيانات اعتماد الحساب ${accountId} ` +
305:             `(متجر ${storeId}): ${error.message}`,
306:         )
307:       }
308:       throw error
309:     }
310:   }
311: 
312:   /* ═══════════════════════════════════════════════════════════════
313:      داخلي
314:      ═══════════════════════════════════════════════════════════════ */
315: 
316:   /**
317:    * يبني حقول بيانات الاعتماد للحفظ.
318:    *
319:    * الدمج بيحصل على النص المفكوك مؤقتاً في الذاكرة عشان الحقل اللي
320:    * التاجر مابعتوش يفضل زي ما هو. النتيجة بتتشفّر تاني كاملة.
321:    */
322:   private async buildCredentialUpdate(
323:     storeId: bigint,
324:     existing: { id: bigint; credentials_envelope: string | null } | null,
325:     incoming: Record<string, string> | null,
326:     context: EncryptionContext,
327:   ): Promise<{
328:     fields: Record<string, unknown>
329:     credentialsChanged: boolean
330:     hasCredentialsAfter: boolean
331:   }> {
332:     const alreadyHas = Boolean(existing?.credentials_envelope)
333: 
334:     if (!incoming || Object.keys(incoming).length === 0) {
335:       // مفيش حاجة جديدة — سيب اللي متخزّن زي ما هو
336:       return { fields: {}, credentialsChanged: false, hasCredentialsAfter: alreadyHas }
337:     }
338: 
339:     let merged: Record<string, string> = {}
340: 
341:     if (existing?.credentials_envelope) {
342:       const current = await this.storeKeys.decryptJsonForStore<
343:         Record<string, string>
344:       >(storeId, existing.credentials_envelope, context)
345:       merged = { ...(current ?? {}) }
346:     }
347: 
348:     merged = { ...merged, ...incoming }
349: 
350:     const envelope = await this.storeKeys.encryptJsonForStore(
351:       storeId,
352:       merged,
353:       context,
354:     )
355: 
356:     return {
357:       fields: {
358:         credentials_envelope: envelope.payload,
359:         credential_kek_version: envelope.kekVersion,
360:         credential_dek_version: envelope.dekVersion,
361:         credentials_fingerprint: await this.fingerprint(storeId, merged),
362:         credentials_hint: this.buildHint(merged) as Prisma.InputJsonValue,
363:       },
364:       credentialsChanged: true,
365:       hasCredentialsAfter: true,
366:     }
367:   }
368: 
369:   /**
370:    * بصمة بيانات الاعتماد.
371:    *
372:    * HMAC بمفتاح المتجر المشتق مش hash عادي: hash عادي لسر قصير
373:    * (زي كود تاجر) قابل للتخمين بالقوة الغاشمة.
374:    */
375:   private async fingerprint(
376:     storeId: bigint,
377:     credentials: Record<string, string>,
378:   ): Promise<string> {
379:     const key = await this.storeKeys.deriveStoreKey(storeId)
380: 
381:     try {
382:       const canonical = Object.keys(credentials)
383:         .sort()
384:         .map((k) => `${k}=${credentials[k]}`)
385:         .join('\n')
386: 
387:       return createHmac('sha256', key).update(canonical, 'utf8').digest('hex')
388:     } finally {
389:       key.fill(0)
390:     }
391:   }
392: 
393:   /** آخر 4 حروف من كل حقل — للعرض بس، مفيش أسرار كاملة */
394:   private buildHint(credentials: Record<string, string>): Record<string, string> {
395:     const hint: Record<string, string> = {}
396: 
397:     for (const [key, value] of Object.entries(credentials)) {
398:       if (typeof value !== 'string' || value.length === 0) continue
399:       hint[key] = value.length <= 4 ? '••••' : `••••${value.slice(-4)}`
400:     }
401: 
402:     return hint
403:   }
404: 
405:   /** بيرفض أي مفتاح مش موجود في كتالوج البوابة */
406:   private sanitizeCredentials(
407:     gatewayKey: string,
408:     incoming: Record<string, string> | undefined,
409:   ): Record<string, string> | null {
410:     if (!incoming) return null
411: 
412:     const allowed = new Set(allowedCredentialKeys(gatewayKey))
413:     const result: Record<string, string> = {}
414: 
415:     for (const [key, value] of Object.entries(incoming)) {
416:       if (!allowed.has(key)) {
417:         throw new BadRequestException(
418:           `حقل غير معروف لبوابة ${gatewayKey}: "${key}".`,
419:         )
420:       }
421: 
422:       if (typeof value !== 'string') {
423:         throw new BadRequestException(`قيمة الحقل "${key}" لازم تكون نص.`)
424:       }
425: 
426:       // نص فاضي = ماتغيّرش، مش امسح
427:       if (value.trim().length === 0) continue
428: 
429:       result[key] = value.trim()
430:     }
431: 
432:     return Object.keys(result).length > 0 ? result : null
433:   }
434: 
435:   private sanitizeOfferings(
436:     gatewayKey: string,
437:     incoming: OfferingInputDto[] | undefined,
438:   ): OfferingInputDto[] | null {
439:     if (!incoming) return null
440: 
441:     const allowed = new Set(allowedMethods(gatewayKey))
442:     const seen = new Set<string>()
443: 
444:     for (const offering of incoming) {
445:       if (!allowed.has(offering.method)) {
446:         throw new BadRequestException(
447:           `وسيلة "${offering.method}" مش متاحة لبوابة ${gatewayKey}.`,
448:         )
449:       }
450: 
451:       const key = `${offering.method}:${offering.gateway_method_config ?? ''}`
452: 
453:       if (seen.has(key)) {
454:         throw new BadRequestException(
455:           `وسيلة مكرّرة: "${offering.method}" بنفس إعداد التكامل.`,
456:         )
457:       }
458: 
459:       seen.add(key)
460:     }
461: 
462:     return incoming
463:   }
464: 
465:   /**
466:    * يستبدل وسائل الدفع للحساب.
467:    *
468:    * حذف وإعادة إنشاء داخل نفس الـ transaction: الوسائل إعدادات
469:    * بسيطة مالهاش حالة، ومحدش بيشير ليها في 1b.1.
470:    */
471:   private async replaceOfferings(
472:     tx: Prisma.TransactionClient,
473:     accountId: bigint,
474:     storeId: bigint,
475:     mode: 'test' | 'live',
476:     offerings: OfferingInputDto[],
477:   ): Promise<void> {
478:     await tx.paymentMethodOffering.deleteMany({
479:       where: { account_id: accountId, store_id: storeId },
480:     })
481: 
482:     if (offerings.length === 0) return
483: 
484:     await tx.paymentMethodOffering.createMany({
485:       data: offerings.map((offering, index) => ({
486:         account_id: accountId,
487:         store_id: storeId,
488:         mode: mode as Mode,
489:         method: offering.method as PaymentMethodKey,
490:         gateway_method_config: offering.gateway_method_config ?? '',
491:         enabled: offering.enabled ?? false,
492:         position: offering.position ?? index,
493:         display_name_ar: offering.display_name_ar ?? null,
494:         display_name_en: offering.display_name_en ?? null,
495:         constraints: offering.constraints
496:           ? (offering.constraints as Prisma.InputJsonValue)
497:           : Prisma.DbNull,
498:         commitment_kind: (offering.commitment_kind ??
499:           'funds_secured') as CommitmentKind,
500:         capture_mode: (offering.capture_mode ?? 'automatic') as CaptureMode,
501:       })),
502:     })
503:   }
504: 
505:   private resolveStatus(
506:     requiresCredentials: boolean,
507:     hasCredentials: boolean,
508:     enabled: boolean | undefined,
509:     currentStatus: PaymentAccountStatus | undefined,
510:   ): PaymentAccountStatus {
511:     if (enabled === false) return 'disabled'
512: 
513:     // البوابات اليدوية (الدفع عند الاستلام / التحويل البنكي) مالهاش
514:     // بيانات اعتماد أصلاً، فبتبقى شغّالة بمجرد ما التاجر يفعّلها
515:     if (!requiresCredentials) {
516:       return enabled ? 'active' : (currentStatus ?? 'draft')
517:     }
518: 
519:     if (!hasCredentials) return 'draft'
520: 
521:     // في المرحلة 1b.1 مفيش أدابتر يقدر يتحقق من المفاتيح فعلاً،
522:     // فالحساب بيفضل verifying لحد ما أول أدابتر يوصل.
523:     return enabled ? 'verifying' : 'draft'
524:   }
525: 
526:   /**
527:    * الشكل اللي بيرجع في الـ API.
528:    *
529:    * ⚠️ لاحظ إن credentials_envelope مش هنا ولا هيبقى هنا أبداً.
530:    */
531:   private toPublicAccount(account: {
532:     id: bigint
533:     mode: string
534:     gateway: string
535:     display_name: string
536:     status: string
537:     settlement_currency: string | null
538:     credentials_envelope: string | null
539:     credentials_hint: unknown
540:     last_verified_at: Date | null
541:     last_error: string | null
542:     created_at: Date
543:     updated_at: Date
544:     offerings?: {
545:       id: bigint
546:       method: string
547:       gateway_method_config: string
548:       enabled: boolean
549:       position: number
550:       display_name_ar: string | null
551:       display_name_en: string | null
552:       constraints: unknown
553:       commitment_kind: string
554:       capture_mode: string
555:     }[]
556:   }) {
557:     return {
558:       id: account.id.toString(),
559:       mode: account.mode,
560:       gateway: account.gateway,
561:       display_name: account.display_name,
562:       status: account.status,
563:       settlement_currency: account.settlement_currency,
564:       is_configured: Boolean(account.credentials_envelope),
565:       credentials_hint: (account.credentials_hint ?? {}) as Record<string, string>,
566:       last_verified_at: account.last_verified_at,
567:       last_error: account.last_error,
568:       created_at: account.created_at,
569:       updated_at: account.updated_at,
570:       offerings: (account.offerings ?? []).map((offering) => ({
571:         id: offering.id.toString(),
572:         method: offering.method,
573:         gateway_method_config: offering.gateway_method_config,
574:         enabled: offering.enabled,
575:         position: offering.position,
576:         display_name_ar: offering.display_name_ar,
577:         display_name_en: offering.display_name_en,
578:         constraints: offering.constraints ?? null,
579:         commitment_kind: offering.commitment_kind,
580:         capture_mode: offering.capture_mode,
581:       })),
582:     }
583:   }
584: }

(End of file - total 584 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/checkout/checkout-finalizer.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/checkout/checkout-finalizer.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger } from '@nestjs/common'
2: import { Prisma } from '@prisma/client'
3: import type { Mode, OrderStatus, PaymentStatus } from '@prisma/client'
4: import { PrismaService } from '../../prisma/prisma.service'
5: import { OutboxService } from '../../common/messaging/outbox.service'
6: import { money, toDecimalString } from '../../common/money/money.util'
7: 
8: /** Shapes read off the loaded checkout. */
9: interface CheckoutLine {
10:   product_id: bigint | null
11:   variant_id: bigint | null
12:   title: string
13:   variant_title: string | null
14:   image_url: string | null
15:   unit_price_minor: bigint
16:   quantity: number
17: }
18: 
19: interface QuoteLine {
20:   kind: string
21:   amount_minor: bigint
22: }
23: 
24: /**
25:  * ==================================================================
26:  * Finalising a funds-secured checkout
27:  * ==================================================================
28:  *
29:  * For cash on delivery and bank transfer the merchant accepts an
30:  * unfunded promise, so the order exists from the moment the customer
31:  * confirms. For a gateway it does not: the customer may abandon the 3DS
32:  * challenge, the card may be declined, the redirect may never complete.
33:  * Creating the order at that point would fill the merchant's dashboard
34:  * with orders nobody ever paid for and decrement stock for carts that
35:  * were never bought.
36:  *
37:  * So a funds_secured checkout produces no order until the provider says
38:  * the money is secured. This runs at that moment, inside the applier's
39:  * transaction, and does what commitment does for the offline path:
40:  * creates the order, converts the stock reservations, and decrements
41:  * inventory.
42:  *
43:  * Lives in the payments module rather than checkout because the applier
44:  * drives it, and CheckoutModule already imports PaymentsModule — the
45:  * reverse would be a cycle.
46:  */
47: @Injectable()
48: export class CheckoutFinalizerService {
49:   private readonly logger = new Logger(CheckoutFinalizerService.name)
50: 
51:   constructor(
52:     private readonly prisma: PrismaService,
53:     private readonly outbox: OutboxService,
54:   ) {}
55: 
56:   /**
57:    * Creates the order for a checkout whose payment just succeeded.
58:    *
59:    * Idempotent: a checkout that already carries an order id is left
60:    * alone, so a redelivered capture cannot produce a second order.
61:    *
62:    * @returns the order id, or null when there was nothing to finalise.
63:    */
64:   async finalize(
65:     tx: Prisma.TransactionClient,
66:     input: {
67:       checkoutId: bigint
68:       storeId: bigint
69:       mode: Mode
70:       paid: boolean
71:       occurredAt: Date
72:     },
73:   ): Promise<bigint | null> {
74:     const checkout = await tx.checkout.findFirst({
75:       where: { id: input.checkoutId, store_id: input.storeId },
76:       include: { items: true, components: true },
77:     })
78: 
79:     if (!checkout) return null
80: 
81:     // Already finalised by another route.
82:     if (checkout.order_id !== null) return checkout.order_id
83: 
84:     const orderNumber = await this.nextOrderNumber(tx, input.storeId)
85:     const currency = checkout.currency
86: 
87:     const components = checkout.components as QuoteLine[]
88:     const items = checkout.items as CheckoutLine[]
89: 
90:     const subtotalMinor = components
91:       .filter((component) => component.kind === 'line_subtotal')
92:       .reduce((acc: bigint, component) => acc + component.amount_minor, 0n)
93: 
94:     const totalMinor = checkout.quote_total_minor
95: 
96:     const shipping = (checkout.shipping_address ?? {}) as Record<string, unknown>
97: 
98:     const order = await tx.order.create({
99:       data: {
100:         store_id: input.storeId,
101:         order_number: orderNumber,
102:         status: 'PENDING' as OrderStatus,
103:         payment_status: (input.paid ? 'PAID' : 'UNPAID') as PaymentStatus,
104:         currency,
105:         checkout_id: checkout.id,
106:         customer_name: checkout.customer_name ?? '',
107:         customer_phone: checkout.customer_phone ?? '',
108:         customer_email: checkout.customer_email,
109:         address_line: String(shipping.address_line ?? ''),
110:         city: String(shipping.city ?? ''),
111:         notes: shipping.notes === null || shipping.notes === undefined
112:           ? null
113:           : String(shipping.notes),
114:         paid_at: input.paid ? input.occurredAt : null,
115:         subtotal: toDecimalString(money(subtotalMinor, currency)),
116:         total: toDecimalString(money(totalMinor, currency)),
117:         items: {
118:           create: items.map((item) => ({
119:             product_id: item.product_id,
120:             variant_id: item.variant_id,
121:             title: item.title,
122:             variant_title: item.variant_title,
123:             price: toDecimalString(money(item.unit_price_minor, currency)),
124:             qty: item.quantity,
125:             image_url: item.image_url,
126:           })),
127:         },
128:       },
129:       select: { id: true, order_number: true },
130:     })
131: 
132:     await tx.checkout.update({
133:       where: { id: checkout.id },
134:       data: {
135:         status: 'committed',
136:         committed_at: input.occurredAt,
137:         order_id: order.id,
138:       },
139:     })
140: 
141:     // Stock was held at checkout, not taken. It is taken now.
142:     const reservations = await tx.inventoryReservation.findMany({
143:       where: {
144:         checkout_id: checkout.id,
145:         store_id: input.storeId,
146:         state: 'held',
147:       },
148:     })
149: 
150:     for (const reservation of reservations) {
151:       await tx.productVariant.update({
152:         where: { id: reservation.variant_id },
153:         data: { inventory_qty: { decrement: reservation.quantity } },
154:       })
155:     }
156: 
157:     await tx.inventoryReservation.updateMany({
158:       where: { checkout_id: checkout.id, store_id: input.storeId, state: 'held' },
159:       data: { state: 'converted', settled_at: input.occurredAt },
160:     })
161: 
162:     await this.outbox.emit(tx, {
163:       storeId: input.storeId,
164:       mode: input.mode,
165:       aggregateType: 'checkout',
166:       aggregateId: checkout.id.toString(),
167:       eventType: 'checkout.committed',
168:       payload: {
169:         checkoutId: checkout.id.toString(),
170:         orderId: order.id.toString(),
171:         orderNumber: order.order_number,
172:         amountMinor: totalMinor.toString(),
173:         currency,
174:         commitmentKind: 'funds_secured',
175:       },
176:       occurredAt: input.occurredAt,
177:     })
178: 
179:     this.logger.log(
180:       `Finalised checkout ${checkout.id} into order ${order.order_number} (${reservations.length} lines taken).`,
181:     )
182: 
183:     return order.id
184:   }
185: 
186:   /**
187:    * Releases a checkout whose payment will never complete.
188:    *
189:    * Without this the held stock stays unavailable until it expires, and
190:    * a customer whose card was declined silently blocks inventory.
191:    */
192:   async abandon(
193:     tx: Prisma.TransactionClient,
194:     input: { checkoutId: bigint; storeId: bigint; occurredAt: Date },
195:   ): Promise<void> {
196:     const checkout = await tx.checkout.findFirst({
197:       where: { id: input.checkoutId, store_id: input.storeId },
198:       select: { id: true, order_id: true },
199:     })
200: 
201:     // An order already exists, so the payment did succeed at some point;
202:     // unwinding it is a refund, not an abandonment.
203:     if (!checkout || checkout.order_id !== null) return
204: 
205:     await tx.inventoryReservation.updateMany({
206:       where: { checkout_id: input.checkoutId, store_id: input.storeId, state: 'held' },
207:       data: { state: 'released', settled_at: input.occurredAt },
208:     })
209: 
210:     await tx.checkout.updateMany({
211:       where: { id: input.checkoutId, store_id: input.storeId },
212:       data: { status: 'failed' },
213:     })
214:   }
215: 
216:   /**
217:    * Next per-store order number.
218:    *
219:    * Same reasoning as CheckoutService.nextOrderNumber: `count(*) + 1001`
220:    * is not safe when two captures finalise at once, and here it matters
221:    * more — the money is already taken, so a rejected insert means a paid
222:    * customer with no order.
223:    */
224:   private async nextOrderNumber(
225:     tx: Prisma.TransactionClient,
226:     storeId: bigint,
227:   ): Promise<string> {
228:     await tx.$executeRaw`SELECT id FROM store WHERE id = ${storeId} FOR UPDATE`
229: 
230:     const highest = await tx.order.findFirst({
231:       where: { store_id: storeId },
232:       orderBy: { id: 'desc' },
233:       select: { order_number: true },
234:     })
235: 
236:     const previous = highest ? Number.parseInt(highest.order_number, 10) : NaN
237: 
238:     return String(Number.isFinite(previous) ? previous + 1 : 1001)
239:   }
240: }

(End of file - total 240 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 2.0s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/payments/facts/reconciliation.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/payments/facts/reconciliation.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger } from '@nestjs/common'
2: import { Cron, CronExpression } from '@nestjs/schedule'
3: import { PrismaService } from '../../../prisma/prisma.service'
4: import { PaymentAccountService } from '../payment-account.service'
5: import { ProviderRegistry } from '../gateways/provider-registry.service'
6: import { PaymentFactApplier } from './payment-fact.applier'
7: import { crossStoreQuery } from '../../../common/tenant/cross-store-query'
8: 
9: /**
10:  * ==================================================================
11:  * Reconciliation
12:  * ==================================================================
13:  *
14:  * Webhooks are a latency optimisation, not the source of truth. They get
15:  * lost, silently disabled, blocked by firewalls, and delivered to the
16:  * wrong environment. This sweep asks each provider directly about
17:  * intents that have been sitting non-terminal too long, and feeds the
18:  * answers through the same applier a webhook would use.
19:  *
20:  * The system is designed to be correct with every webhook dropped. That
21:  * claim is only true because this exists.
22:  */
23: 
24: /** How long an intent may sit non-terminal before it is swept. */
25: const STALE_AFTER_SECONDS = 300
26: 
27: /** Cap per run so a backlog cannot monopolise a worker. */
28: const BATCH_SIZE = 50
29: 
30: const NON_TERMINAL = [
31:   'created',
32:   'requires_payment_method',
33:   'requires_action',
34:   'processing',
35:   'authorized',
36:   'partially_captured',
37: ] as const
38: 
39: @Injectable()
40: export class ReconciliationService {
41:   private readonly logger = new Logger(ReconciliationService.name)
42: 
43:   private running = false
44: 
45:   constructor(
46:     private readonly prisma: PrismaService,
47:     private readonly providers: ProviderRegistry,
48:     private readonly accounts: PaymentAccountService,
49:     private readonly applier: PaymentFactApplier,
50:   ) {}
51: 
52:   @Cron(CronExpression.EVERY_5_MINUTES)
53:   async run(): Promise<void> {
54:     if (this.running) return
55: 
56:     this.running = true
57:     try {
58:       const processed = await this.sweep()
59:       if (processed > 0) {
60:         this.logger.log(`Reconciliation swept ${processed} intents.`)
61:       }
62:     } catch (error) {
63:       this.logger.error(
64:         `Reconciliation sweep failed: ${(error as Error).message}`,
65:         (error as Error).stack,
66:       )
67:     } finally {
68:       this.running = false
69:     }
70:   }
71: 
72:   /** Exposed separately so it can be invoked on demand. */
73:   async sweep(): Promise<number> {
74:     const cutoff = new Date(Date.now() - STALE_AFTER_SECONDS * 1000)
75: 
76:     // Sweeping every store is the point of a platform-wide sweep. The
77:     // per-intent work below is scoped normally.
78:     const intents = await crossStoreQuery(
79:       'platform_sweep',
80:       'find non-terminal intents across all stores',
81:       () =>
82:         this.prisma.guarded().paymentIntent.findMany({
83:           where: {
84:             status: { in: [...NON_TERMINAL] },
85:             created_at: { lt: cutoff },
86:           },
87:           orderBy: { created_at: 'asc' },
88:           take: BATCH_SIZE,
89:         }),
90:     )
91: 
92:     let processed = 0
93: 
94:     for (const intent of intents) {
95:       try {
96:         if (await this.reconcileIntent(intent)) processed += 1
97:       } catch (error) {
98:         // One provider being unreachable must not stop the sweep.
99:         this.logger.warn(
100:           `Reconciling intent ${intent.id} failed: ${(error as Error).message}`,
101:         )
102:       }
103:     }
104: 
105:     return processed
106:   }
107: 
108:   private async reconcileIntent(intent: {
109:     id: bigint
110:     store_id: bigint
111:     mode: 'test' | 'live'
112:     account_id: bigint | null
113:   }): Promise<boolean> {
114:     if (intent.account_id === null) return false
115: 
116:     const account = await this.prisma.guarded().paymentAccount.findFirst({
117:       where: { id: intent.account_id, store_id: intent.store_id, mode: intent.mode },
118:       select: { id: true, gateway: true },
119:     })
120: 
121:     if (!account) return false
122:     if (!this.providers.has(account.gateway)) return false
123: 
124:     const provider = this.providers.get(account.gateway)
125: 
126:     // Manual methods have no provider to ask. Skipping them is what keeps
127:     // cash-on-delivery orders from being swept into a wrong state.
128:     if (!provider.capabilities.statusPolling) return false
129: 
130:     const attempt = await this.prisma.guarded().paymentAttempt.findFirst({
131:       where: { intent_id: intent.id, store_id: intent.store_id, mode: intent.mode },
132:       orderBy: { sequence: 'desc' },
133:       select: { gateway_reference: true },
134:     })
135: 
136:     if (!attempt?.gateway_reference) return false
137: 
138:     const credentials = await this.accounts.revealCredentialsForGateway(
139:       intent.store_id,
140:       intent.mode,
141:       account.id,
142:     )
143: 
144:     const facts = await provider.fetchStatus({
145:       accountId: account.id,
146:       gatewayReference: attempt.gateway_reference,
147:       credentials,
148:       mode: intent.mode,
149:     })
150: 
151:     if (facts.length === 0) return false
152: 
153:     await this.applier.applyMany(facts, 'reconciliation')
154:     return true
155:   }
156: }

(End of file - total 156 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger } from '@nestjs/common'
2: import { Cron, CronExpression } from '@nestjs/schedule'
3: import { PrismaService } from '../../prisma/prisma.service'
4: import { crossStoreQuery } from '../../common/tenant/cross-store-query'
5: 
6: /**
7:  * ==================================================================
8:  * Releasing abandoned checkouts
9:  * ==================================================================
10:  *
11:  * A funds_secured checkout holds stock rather than taking it, because
12:  * the customer may never complete the payment. That is correct — but it
13:  * only works if something eventually gives the stock back.
14:  *
15:  * Nothing did. `expires_at` was written on every reservation and never
16:  * read, so a shopper who opened a card payment and closed the tab held
17:  * that inventory permanently. Most carts are abandoned, so a store would
18:  * bleed sellable stock continuously with no visible cause.
19:  *
20:  * Offline checkouts are unaffected: their reservations are written as
21:  * `converted` at commitment, so there is nothing held to release.
22:  */
23: 
24: /** Cap per run so a backlog cannot monopolise a worker. */
25: const BATCH_SIZE = 200
26: 
27: @Injectable()
28: export class CheckoutExpiryJob {
29:   private readonly logger = new Logger(CheckoutExpiryJob.name)
30: 
31:   private running = false
32: 
33:   constructor(private readonly prisma: PrismaService) {}
34: 
35:   @Cron(CronExpression.EVERY_MINUTE)
36:   async run(): Promise<void> {
37:     if (this.running) return
38: 
39:     this.running = true
40:     try {
41:       const released = await this.releaseExpired()
42:       if (released > 0) {
43:         this.logger.log(`Released ${released} expired checkout(s).`)
44:       }
45:     } catch (error) {
46:       this.logger.error(
47:         `Checkout expiry sweep failed: ${(error as Error).message}`,
48:         (error as Error).stack,
49:       )
50:     } finally {
51:       this.running = false
52:     }
53:   }
54: 
55:   /**
56:    * Releases stock held by checkouts that expired without committing.
57:    *
58:    * Exposed separately so it can be invoked on demand and asserted in
59:    * tests without waiting for the schedule.
60:    *
61:    * @returns how many checkouts were released.
62:    */
63:   async releaseExpired(now = new Date()): Promise<number> {
64:     // Sweeping every store is the point of the sweep. The per-checkout
65:     // release below is scoped normally.
66:     const expired = await crossStoreQuery(
67:       'platform_sweep',
68:       'find expired uncommitted checkouts across all stores',
69:       () =>
70:         this.prisma.guarded().checkout.findMany({
71:           where: {
72:             // Only checkouts still waiting. A committed one owns its
73:             // stock, and a failed one was already released where it
74:             // failed.
75:             status: { in: ['open', 'pending_payment'] },
76:             expires_at: { lt: now },
77:             order_id: null,
78:           },
79:           orderBy: { expires_at: 'asc' },
80:           take: BATCH_SIZE,
81:           select: { id: true, store_id: true },
82:         }),
83:     )
84: 
85:     let released = 0
86: 
87:     for (const checkout of expired) {
88:       try {
89:         await this.releaseOne(checkout.id, checkout.store_id, now)
90:         released += 1
91:       } catch (error) {
92:         // One bad checkout must not stop the sweep.
93:         this.logger.warn(
94:           `Releasing checkout ${checkout.id} failed: ${(error as Error).message}`,
95:         )
96:       }
97:     }
98: 
99:     return released
100:   }
101: 
102:   private async releaseOne(
103:     checkoutId: bigint,
104:     storeId: bigint,
105:     now: Date,
106:   ): Promise<void> {
107:     await this.prisma.$transaction(async (tx) => {
108:       // Compare-and-set: only one sweeper (or one sweeper racing a
109:       // completing payment) moves the checkout out of its open state, so
110:       // stock is never released twice and never released from underneath
111:       // a payment that just succeeded.
112:       const claimed = await tx.checkout.updateMany({
113:         where: {
114:           id: checkoutId,
115:           store_id: storeId,
116:           status: { in: ['open', 'pending_payment'] },
117:           order_id: null,
118:         },
119:         data: { status: 'expired' },
120:       })
121: 
122:       if (claimed.count === 0) return
123: 
124:       await tx.inventoryReservation.updateMany({
125:         where: { checkout_id: checkoutId, store_id: storeId, state: 'held' },
126:         data: { state: 'expired', settled_at: now },
127:       })
128: 
129:       // The payment never completed, so the intent should not sit
130:       // non-terminal forever and be swept by reconciliation.
131:       await tx.paymentIntent.updateMany({
132:         where: {
133:           store_id: storeId,
134:           context_kind: 'checkout',
135:           context_id: checkoutId.toString(),
136:           status: {
137:             notIn: [
138:               'captured',
139:               'partially_captured',
140:               'refunded',
141:               'partially_refunded',
142:               'failed',
143:               'cancelled',
144:               'expired',
145:             ],
146:           },
147:         },
148:         data: { status: 'expired', terminal_at: now },
149:       })
150:     })
151:   }
152: }

(End of file - total 152 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/payments/payment-query.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/payments/payment-query.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, NotFoundException } from '@nestjs/common'
2: import type { Mode } from '@prisma/client'
3: import { PrismaService } from '../../prisma/prisma.service'
4: import { LedgerService } from '../../ledger/ledger.service'
5: import { money, toDecimalString } from '../../common/money/money.util'
6: 
7: /**
8:  * ==================================================================
9:  * Merchant payment read surface
10:  * ==================================================================
11:  *
12:  * Read-only. Every query is scoped by store_id from the guard, never
13:  * from the request body.
14:  *
15:  * Two views:
16:  *   - summary: what the store is owed and what it has collected
17:  *   - order detail: the full payment trail behind one order
18:  *
19:  * Amounts are returned both as minor units (exact, for clients that do
20:  * arithmetic) and as a formatted decimal string (for display).
21:  */
22: @Injectable()
23: export class PaymentQueryService {
24:   constructor(
25:     private readonly prisma: PrismaService,
26:     private readonly ledger: LedgerService,
27:   ) {}
28: 
29:   /**
30:    * Money position for a store: outstanding receivables, cash collected,
31:    * recognised revenue, per currency.
32:    *
33:    * Balances are derived from ledger postings, never from a stored
34:    * column, so they cannot drift from the journal.
35:    */
36:   async summary(storeId: bigint, mode: Mode = 'live') {
37:     const balances = await this.ledger.summary(storeId, mode)
38: 
39:     const [unpaidOrders, openIntents, deadLetters] = await Promise.all([
40:       this.prisma.guarded().order.count({
41:         where: { store_id: storeId, payment_status: 'UNPAID' },
42:       }),
43:       this.prisma.guarded().paymentIntent.count({
44:         where: {
45:           store_id: storeId,
46:           mode,
47:           status: { notIn: ['captured', 'refunded', 'failed', 'cancelled', 'expired'] },
48:         },
49:       }),
50:       this.prisma.guarded().outboxMessage.count({
51:         where: { store_id: storeId, mode, status: 'dead' },
52:       }),
53:     ])
54: 
55:     return {
56:       mode,
57:       balances: balances.map((balance) => ({
58:         currency: balance.currency,
59:         account_type: balance.accountType,
60:         amount_minor: balance.balanceMinor.toString(),
61:         amount: this.format(balance.balanceMinor, balance.currency),
62:       })),
63:       counts: {
64:         unpaid_orders: unpaidOrders,
65:         open_intents: openIntents,
66:         // Non-zero here means an event was never delivered downstream.
67:         dead_letters: deadLetters,
68:       },
69:     }
70:   }
71: 
72:   /**
73:    * Full payment trail for one order: intent, attempts, captures and the
74:    * audit events, plus the journal entries that moved money.
75:    */
76:   async orderPayment(storeId: bigint, orderId: string, mode: Mode = 'live') {
77:     const order = await this.prisma.guarded().order.findFirst({
78:       where: { id: BigInt(orderId), store_id: storeId },
79:       select: {
80:         id: true,
81:         order_number: true,
82:         status: true,
83:         payment_status: true,
84:         payment_method: true,
85:         currency: true,
86:         total: true,
87:         paid_at: true,
88:         checkout_id: true,
89:         created_at: true,
90:       },
91:     })
92: 
93:     if (!order) throw new NotFoundException('Order not found.')
94: 
95:     const base = {
96:       order: {
97:         id: order.id.toString(),
98:         order_number: order.order_number,
99:         status: order.status,
100:         payment_status: order.payment_status,
101:         payment_method: order.payment_method,
102:         currency: order.currency,
103:         total: String(order.total),
104:         paid_at: order.paid_at,
105:         created_at: order.created_at,
106:       },
107:     }
108: 
109:     // Orders created before checkout existed have no payment trail.
110:     if (order.checkout_id === null) {
111:       return {
112:         ...base,
113:         intent: null,
114:         attempts: [],
115:         captures: [],
116:         events: [],
117:         journal_entries: [],
118:       }
119:     }
120: 
121:     const intent = await this.prisma.guarded().paymentIntent.findFirst({
122:       where: {
123:         store_id: storeId,
124:         mode,
125:         context_kind: 'checkout',
126:         context_id: order.checkout_id.toString(),
127:       },
128:     })
129: 
130:     if (!intent) {
131:       return {
132:         ...base,
133:         intent: null,
134:         attempts: [],
135:         captures: [],
136:         events: [],
137:         journal_entries: [],
138:       }
139:     }
140: 
141:     const [attempts, captures, events, entries] = await Promise.all([
142:       this.prisma.guarded().paymentAttempt.findMany({
143:         where: { intent_id: intent.id, store_id: storeId },
144:         orderBy: { sequence: 'asc' },
145:       }),
146:       this.prisma.guarded().capture.findMany({
147:         where: { intent_id: intent.id, store_id: storeId },
148:         orderBy: { id: 'asc' },
149:       }),
150:       this.prisma.guarded().paymentEvent.findMany({
151:         where: { intent_id: intent.id, store_id: storeId },
152:         orderBy: { recorded_at: 'asc' },
153:       }),
154:       this.prisma.guarded().journalEntry.findMany({
155:         where: { store_id: storeId, mode, source_kind: 'order', source_id: order.id.toString() },
156:         orderBy: { id: 'asc' },
157:       }),
158:     ])
159: 
160:     return {
161:       ...base,
162:       intent: {
163:         id: intent.id.toString(),
164:         status: intent.status,
165:         currency: intent.currency,
166:         amount_minor: intent.amount_minor.toString(),
167:         amount: this.format(intent.amount_minor, intent.currency),
168:         captured_total_minor: intent.captured_total_minor.toString(),
169:         refunded_total_minor: intent.refunded_total_minor.toString(),
170:         capture_method: intent.capture_method,
171:         created_at: intent.created_at,
172:         terminal_at: intent.terminal_at,
173:       },
174:       attempts: attempts.map((attempt) => ({
175:         id: attempt.id.toString(),
176:         sequence: attempt.sequence,
177:         status: attempt.status,
178:         next_action_kind: attempt.next_action_kind,
179:         // The payload can carry merchant bank details; the merchant owns
180:         // them, so it is safe here and only here.
181:         next_action_payload: attempt.next_action_payload ?? null,
182:         error_code: attempt.error_code,
183:         created_at: attempt.created_at,
184:       })),
185:       captures: captures.map((capture) => ({
186:         id: capture.id.toString(),
187:         status: capture.status,
188:         currency: capture.currency,
189:         amount_minor: capture.amount_minor.toString(),
190:         amount: this.format(capture.amount_minor, capture.currency),
191:         reference: capture.gateway_capture_ref,
192:         captured_at: capture.captured_at,
193:       })),
194:       events: events.map((event) => ({
195:         id: event.id.toString(),
196:         event_type: event.event_type,
197:         source: event.source,
198:         applied: event.applied,
199:         superseded_reason: event.superseded_reason,
200:         occurred_at: event.occurred_at,
201:         recorded_at: event.recorded_at,
202:       })),
203:       journal_entries: entries.map((entry) => ({
204:         id: entry.id.toString(),
205:         entry_type: entry.entry_type,
206:         currency: entry.currency,
207:         occurred_at: entry.occurred_at,
208:         memo: entry.memo,
209:       })),
210:     }
211:   }
212: 
213:   /** Formats minor units for display, tolerating an unknown currency. */
214:   private format(amountMinor: bigint, currency: string): string {
215:     try {
216:       return toDecimalString(money(amountMinor, currency))
217:     } catch {
218:       return amountMinor.toString()
219:     }
220:   }
221: }

(End of file - total 221 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/messaging/consumed-event.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/messaging/consumed-event.service.ts</path>
<type>file</type>
<content>
1: import { Injectable } from '@nestjs/common'
2: import { PrismaService } from '../../prisma/prisma.service'
3: import { isUniqueConstraintError } from '../idempotency/idempotency.types'
4: import { OutboxRecord } from './messaging.types'
5: 
6: /**
7:  * منع التكرار على مستوى المستهلك.
8:  *
9:  * التسليم at-least-once: الموزّع ممكن يسلّم نفس الرسالة مرتين (انتهاء
10:  * حجز أثناء معالجة بطيئة، أو إعادة تشغيل بعد فشل جزئي).
11:  *
12:  * القيد الفريد (consumer_name, message_id) **هو** الضمانة — مش فحص
13:  * في الكود. الفحص بيسيب فرصة لطلبين متوازيين يعدّوا الاتنين.
14:  */
15: @Injectable()
16: export class ConsumedEventService {
17:   constructor(private readonly prisma: PrismaService) {}
18: 
19:   /**
20:    * بيحاول يحجز الرسالة للمستهلك ده.
21:    *
22:    * @returns true لو دي أول مرة، false لو اتستهلكت قبل كده
23:    */
24:   async tryConsume(
25:     consumerName: string,
26:     message: OutboxRecord,
27:     result = 'ok',
28:   ): Promise<boolean> {
29:     try {
30:       await this.prisma.consumedEvent.create({
31:         data: {
32:           consumer_name: consumerName,
33:           message_id: message.id,
34:           store_id: message.storeId,
35:           mode: message.mode,
36:           result,
37:         },
38:         select: { id: true },
39:       })
40:       return true
41:     } catch (error) {
42:       if (isUniqueConstraintError(error)) return false
43:       throw error
44:     }
45:   }
46: 
47:   /**
48:    * Releases a claim so the message can be retried.
49:    *
50:    * The claim is taken before the handler runs, which is what makes
51:    * concurrent delivery safe. But a handler that throws would otherwise
52:    * leave the claim behind, and every later attempt would skip it — the
53:    * message would be marked published without ever being processed.
54:    */
55:   async release(consumerName: string, messageId: bigint): Promise<void> {
56:     await this.prisma.consumedEvent.deleteMany({
57:       where: { consumer_name: consumerName, message_id: messageId },
58:     })
59:   }
60: 
61:   async wasConsumed(consumerName: string, messageId: bigint): Promise<boolean> {
62:     const found = await this.prisma.consumedEvent.findFirst({
63:       where: { consumer_name: consumerName, message_id: messageId },
64:       select: { id: true },
65:     })
66:     return found !== null
67:   }
68: }

(End of file - total 68 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.9s)

**Tool: grep**

**Input:**
```json
{
  "pattern": "this\\.prisma\\.(store|product|productType|tag|order|checkout|payment|ledger|beneficiary|journal|capture|refund|upload|collection|storeTheme|themeSection|storePage|storeMenu|paymentIntent|paymentAttempt|paymentEvent|inventory|outbox|consumed)",
  "path": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
Found 100 matches (more matches available)
/workspaces/testapp/backend/src/stores/active-store.service.ts:
  Line 38:       const store = await this.prisma.store.findFirst({

  Line 57:     const store = await this.prisma.store.findFirst({

  Line 83:     const store = await this.prisma.store.findFirst({


/workspaces/testapp/backend/src/stores/products/product.service.ts:
  Line 37:       const existing = await this.prisma.product.findFirst({

  Line 92:       this.prisma.product.count({ where }),

  Line 93:       this.prisma.product.findMany({

  Line 125:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 141:       this.prisma.product.count({ where }),

  Line 142:       this.prisma.product.findMany({

  Line 170:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 173:     const product = await this.prisma.product.findFirst({

  Line 209:     const product = await this.prisma.product.findFirst({

  Line 365:     const created = await this.prisma.product.findUnique({

  Line 377:     const product = await this.prisma.product.findFirst({

  Line 570:     const updated = await this.prisma.product.findUnique({

  Line 585:     const product = await this.prisma.product.findFirst({

  Line 590:       await this.prisma.product.update({ where: { id: product.id }, data: { status } }),

  Line 595:     const product = await this.prisma.product.findFirst({

  Line 614:     const product = await this.prisma.product.findFirst({

  Line 706:       await this.prisma.product.findUnique({

  Line 720:     const product = await this.prisma.product.findFirst({

  Line 724:     const last = await this.prisma.productImage.findFirst({

  Line 732:         await this.prisma.productImage.create({

  Line 741:     const product = await this.prisma.product.findFirst({

  Line 749:     const image = await this.prisma.productImage.findFirst({

  Line 753:     return this.prisma.productImage.delete({ where: { id: image.id } })

  Line 758:       await this.prisma.productType.findMany({

  Line 766:     const exists = await this.prisma.productType.findFirst({

  Line 771:       await this.prisma.productType.create({ data: { store_id: storeId, name: name.trim() } }),

  Line 776:     const type = await this.prisma.productType.findFirst({

  Line 781:       await this.prisma.productType.update({ where: { id: type.id }, data: { name: name.trim() } }),

  Line 786:     const type = await this.prisma.productType.findFirst({

  Line 790:     await this.prisma.product.updateMany({

  Line 794:     return this.prisma.productType.delete({ where: { id: type.id } })

  Line 799:       await this.prisma.tag.findMany({

  Line 807:     const exists = await this.prisma.tag.findFirst({

  Line 812:       await this.prisma.tag.create({ data: { store_id: storeId, name: name.trim() } }),

  Line 817:     const tag = await this.prisma.tag.findFirst({

  Line 822:       await this.prisma.tag.update({ where: { id: tag.id }, data: { name: name.trim() } }),

  Line 827:     const tag = await this.prisma.tag.findFirst({

  Line 831:     await this.prisma.productTag.deleteMany({ where: { tag_id: tag.id } })

  Line 832:     return this.prisma.tag.delete({ where: { id: tag.id } })


/workspaces/testapp/backend/src/stores/collections/storefront-collections.service.ts:
  Line 10:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 13:     const collections = await this.prisma.collection.findMany({

  Line 41:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 44:     const collection = await this.prisma.collection.findFirst({


/workspaces/testapp/backend/src/stores/collections/storefront-collections.controller.ts:
  Line 52:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 55:     const collections = await this.prisma.collection.findMany({

  Line 83:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 86:     const collection = await this.prisma.collection.findFirst({


/workspaces/testapp/backend/src/stores/collections/collections.service.ts:
  Line 27:     const existing = await this.prisma.collection.findFirst({

  Line 32:     return this.prisma.collection.create({

  Line 38:     const collections = await this.prisma.collection.findMany({

  Line 57:     const collection = await this.prisma.collection.findFirst({

  Line 109:       await this.prisma.collection.findFirst({ where: { storeId, handle } })

  Line 114:     const collection = await this.prisma.collection.create({

  Line 128:       await this.prisma.productCollection.createMany({

  Line 154:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 195:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 197:     return this.prisma.collection.delete({ where: { id } });

  Line 201:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 239:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 242:     await this.prisma.productCollection.deleteMany({


/workspaces/testapp/backend/src/common/messaging/consumed-event.service.ts:
  Line 30:       await this.prisma.consumedEvent.create({

  Line 56:     await this.prisma.consumedEvent.deleteMany({

  Line 62:     const found = await this.prisma.consumedEvent.findFirst({


/workspaces/testapp/backend/src/common/messaging/outbox-dispatcher.service.ts:
  Line 247:     await this.prisma.outboxMessage.updateMany({

  Line 269:     await this.prisma.outboxMessage.updateMany({

  Line 299:     return this.prisma.outboxMessage.count({ where: { status: 'dead' } })

  Line 308:     return this.prisma.outboxMessage.count({


/workspaces/testapp/backend/src/common/idempotency/idempotency.service.ts:
  Line 76:       const created = await this.prisma.paymentIdempotencyRecord.create({

  Line 104:     await this.prisma.paymentIdempotencyRecord.updateMany({

  Line 127:     await this.prisma.paymentIdempotencyRecord.updateMany({

  Line 136:     const result = await this.prisma.paymentIdempotencyRecord.deleteMany({

  Line 153:     const existing = await this.prisma.paymentIdempotencyRecord.findFirst({

  Line 232:     const result = await this.prisma.paymentIdempotencyRecord.updateMany({


/workspaces/testapp/backend/src/uploads/uploads.service.ts:
  Line 46:     const store = await this.prisma.store.findFirst({

  Line 89:     await this.prisma.upload.create({

  Line 104:     const upload = await this.prisma.upload.findUnique({ where: { key } });

  Line 108:     await this.prisma.upload.update({

  Line 120:     const upload = await this.prisma.upload.findUnique({ where: { key } });

  Line 125:     await this.prisma.upload.delete({ where: { key } });


/workspaces/testapp/backend/src/uploads/uploads-cleanup.cron.ts:
  Line 17:     const orphaned = await this.prisma.upload.findMany({

  Line 25:         await this.prisma.upload.delete({ where: { id: u.id } });


/workspaces/testapp/backend/src/stores/orders/order.service.ts:
  Line 34:     const count = await this.prisma.order.count({ where: { store_id: storeId } })

  Line 48:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 52:     const variants = await this.prisma.productVariant.findMany({

  Line 135:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 138:     const order = await this.prisma.order.findFirst({

  Line 162:       this.prisma.order.count({ where }),

  Line 163:       this.prisma.order.findMany({

  Line 180:     const order = await this.prisma.order.findFirst({

  Line 189:     const order = await this.prisma.order.findFirst({

  Line 194:       await this.prisma.order.update({ where: { id: order.id }, data: { status } }),


/workspaces/testapp/backend/src/stores/store.service.ts:
  Line 35:     return this.prisma.store.findMany({

  Line 51:     const store = await this.prisma.store.create({

  Line 65:     await this.prisma.storeTheme.create({

  Line 123:       await this.prisma.store.findFirst({

  Line 135:     return this.prisma.store.update({

  Line 154:     return this.prisma.storePage.findMany({


(Results truncated. Consider using a more specific path or pattern.)
```

**Tool: grep**

**Input:**
```json
{
  "pattern": "crossStoreQuery|crossModeQuery",
  "path": "/workspaces/testapp/backend/src"
}
```

**Output:**
```
Found 71 matches
/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts:
  Line 4: import { crossStoreQuery } from '../../common/tenant/cross-store-query'

  Line 66:     const expired = await crossStoreQuery(


/workspaces/testapp/backend/src/stores/payments/facts/reconciliation.service.ts:
  Line 7: import { crossStoreQuery } from '../../../common/tenant/cross-store-query'

  Line 78:     const intents = await crossStoreQuery(


/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts:
  Line 15: import { crossStoreQuery } from '../../../common/tenant/cross-store-query'

  Line 97:     const attempt = await crossStoreQuery(


/workspaces/testapp/backend/src/common/tenant/cross-store-query.spec.ts:
  Line 2:   crossStoreQuery,

  Line 16:     await crossStoreQuery('provider_lookup', 'resolve attempt', async () => {

  Line 27:     await crossStoreQuery('platform_sweep', 'nightly reconcile', async () => {

  Line 38:       crossStoreQuery('provider_lookup', 'boom', async () => {

  Line 48:       crossStoreQuery('provider_lookup', 'outer', () =>

  Line 49:         crossStoreQuery('platform_sweep', 'inner', async () => undefined),

  Line 51:     ).rejects.toThrow(/Nested crossStoreQuery/)

  Line 57:     const result = await crossStoreQuery('health_check', 'count', async () => 7)

  Line 71:       crossStoreQuery('provider_lookup', 'first', async () => {

  Line 75:       crossStoreQuery('platform_sweep', 'second', async () => {

  Line 93:       crossStoreQuery('provider_lookup', 'inside', async () => {

  Line 108:       crossStoreQuery('provider_lookup', 'outer', async () => {

  Line 110:         return crossStoreQuery('platform_sweep', 'inner', async () => undefined)

  Line 112:     ).rejects.toThrow(/Nested crossStoreQuery/)

  Line 117:       crossStoreQuery('provider_lookup', 'a', async () => tick()),

  Line 118:       crossStoreQuery('health_check', 'b', async () => tick()),


/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:
  Line 94:           // crossModeQuery suppresses ONLY the mode-scope finding. Store

  Line 99:           // crossStoreQuery to pass; crossModeQuery cannot substitute


/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:
  Line 4: import { crossModeQuery } from './cross-mode-query'

  Line 5: import { crossStoreQuery } from './cross-store-query'

  Line 9:  * guard-crossstore-suppression.spec.ts does for crossStoreQuery. A test

  Line 48: describe('crossModeQuery — case A: suppresses only the mode finding', () => {

  Line 57:     await crossModeQuery('merchant_dual_mode_view', 'settings screen', () =>

  Line 66: describe('crossModeQuery — case B: store violations are NOT suppressed', () => {

  Line 67:   it('still warns on missing_store_scope inside crossModeQuery', async () => {

  Line 76:     await crossModeQuery('merchant_dual_mode_view', 'no store at all', () =>

  Line 87:   it('still warns on store_scope_mismatch inside crossModeQuery', async () => {

  Line 102:         await crossModeQuery('merchant_dual_mode_view', 'wrong store', () =>

  Line 116:   it('does not accidentally behave like crossStoreQuery', async () => {

  Line 117:     // The decisive check: crossModeQuery must never grant the full

  Line 118:     // bypass crossStoreQuery provides. Same unscoped query, run under

  Line 119:     // each mechanism — only crossStoreQuery should come back clean.

  Line 132:     await crossModeQuery('merchant_dual_mode_view', 'x', () =>

  Line 142:     await crossStoreQuery('provider_lookup', 'x', () =>

  Line 151: describe('crossModeQuery — case C: unwrapped queries are unaffected', () => {

  Line 165:   it('resumes warning once the crossModeQuery scope closes', async () => {

  Line 173:     await crossModeQuery('merchant_dual_mode_view', 'inside', () =>

  Line 183: describe('crossModeQuery — case D: survives an await before the query runs', () => {

  Line 192:     await crossModeQuery('merchant_dual_mode_view', 'deferred', async () => {


/workspaces/testapp/backend/src/common/tenant/cross-mode-query.spec.ts:
  Line 2:   crossModeQuery,

  Line 16:     await crossModeQuery('merchant_dual_mode_view', 'settings screen', async () => {

  Line 27:     await crossModeQuery('merchant_dual_mode_view', 'list all accounts', async () => {

  Line 36:       crossModeQuery('merchant_dual_mode_view', 'boom', async () => {

  Line 46:       crossModeQuery('merchant_dual_mode_view', 'outer', () =>

  Line 47:         crossModeQuery('merchant_dual_mode_view', 'inner', async () => undefined),

  Line 49:     ).rejects.toThrow(/Nested crossModeQuery/)

  Line 55:     const result = await crossModeQuery(

  Line 77:     await crossModeQuery('merchant_dual_mode_view', 'lazy', () =>

  Line 92:       crossModeQuery('merchant_dual_mode_view', 'first', async () => {

  Line 110:       crossModeQuery('merchant_dual_mode_view', 'inside', async () => {

  Line 125:       crossModeQuery('merchant_dual_mode_view', 'a', async () => tick()),

  Line 126:       crossModeQuery('merchant_dual_mode_view', 'b', async () => tick()),


/workspaces/testapp/backend/src/common/tenant/cross-mode-query.ts:
  Line 12:  *   crossStoreQuery suppresses the ENTIRE tenant check — store and mode

  Line 16:  *   crossModeQuery suppresses ONLY the mode check. Store scope stays

  Line 22:  * Reusing crossStoreQuery for the mode-only case would be strictly too

  Line 73:  * Nesting is refused, same as crossStoreQuery — a nested block makes the

  Line 75:  * Nesting crossModeQuery inside crossStoreQuery (or the reverse) is also

  Line 83:  * exact bug was found and fixed once already in crossStoreQuery; this

  Line 89: export async function crossModeQuery<T>(

  Line 98:       `Nested crossModeQuery: "${description}" inside "${existing.description}".`,


/workspaces/testapp/backend/src/common/tenant/cross-store-query.ts:
  Line 53:  * "Nested crossStoreQuery". Worse in the other direction: one request's

  Line 85: export async function crossStoreQuery<T>(

  Line 96:       `Nested crossStoreQuery: "${description}" inside "${existing.description}".`,


/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts:
  Line 18: import { crossModeQuery } from '../../common/tenant/cross-mode-query'

  Line 82:     const accounts = await crossModeQuery(

```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/payments/payment-collection.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/payments/payment-collection.service.ts</path>
<type>file</type>
<content>
1: import {
2:   BadRequestException,
3:   ConflictException,
4:   Injectable,
5:   Logger,
6:   NotFoundException,
7: } from '@nestjs/common'
8: import { Prisma } from '@prisma/client'
9: import type { Mode } from '@prisma/client'
10: import { PrismaService } from '../../prisma/prisma.service'
11: import { LedgerService } from '../../ledger/ledger.service'
12: import { offlineCollected } from '../../ledger/posting-rules'
13: import { OutboxService } from '../../common/messaging/outbox.service'
14: import { parseDecimal } from '../../common/money/money.util'
15: import { assertIntentTransition } from './payment-intent.state'
16: 
17: /**
18:  * ==================================================================
19:  * Recording collection of an offline payment
20:  * ==================================================================
21:  *
22:  * Cash on delivery and bank transfer produce revenue at commitment and
23:  * a receivable that stays open until the merchant confirms the money
24:  * arrived. This is the only way that receivable ever clears.
25:  *
26:  * Without it a merchant can take a COD order and never mark it paid,
27:  * and offline_receivable grows forever.
28:  *
29:  * Idempotent: the ledger dedupe key makes a repeated call a no-op, and
30:  * an already-paid order is reported as a conflict rather than posted
31:  * twice.
32:  */
33: @Injectable()
34: export class PaymentCollectionService {
35:   private readonly logger = new Logger(PaymentCollectionService.name)
36: 
37:   constructor(
38:     private readonly prisma: PrismaService,
39:     private readonly ledger: LedgerService,
40:     private readonly outbox: OutboxService,
41:   ) {}
42: 
43:   async recordCollection(
44:     storeId: bigint,
45:     orderId: string,
46:     options: { mode?: Mode; reference?: string } = {},
47:   ) {
48:     const mode: Mode = options.mode ?? 'live'
49: 
50:     const order = await this.prisma.guarded().order.findFirst({
51:       where: { id: BigInt(orderId), store_id: storeId },
52:     })
53: 
54:     if (!order) throw new NotFoundException('Order not found.')
55: 
56:     if (order.payment_status === 'PAID') {
57:       throw new ConflictException('Order is already marked as paid.')
58:     }
59: 
60:     if (order.payment_status === 'REFUNDED') {
61:       throw new ConflictException('A refunded order cannot be marked as paid.')
62:     }
63: 
64:     // Legacy orders predate checkout and have no committed receivable, so
65:     // posting a collection against them would drive offline_receivable
66:     // negative. They must be reconciled by hand.
67:     if (order.checkout_id === null) {
68:       throw new BadRequestException(
69:         'This order was not created through checkout and has no ledger entry to settle.',
70:       )
71:     }
72: 
73:     const currency = (order.currency || 'USD').toUpperCase()
74:     const total = parseDecimal(String(order.total), currency)
75: 
76:     if (total.amountMinor <= 0n) {
77:       throw new BadRequestException('Order total must be greater than zero.')
78:     }
79: 
80:     const intent = await this.prisma.guarded().paymentIntent.findFirst({
81:       where: {
82:         store_id: storeId,
83:         mode,
84:         context_kind: 'checkout',
85:         context_id: order.checkout_id.toString(),
86:       },
87:     })
88: 
89:     if (!intent) {
90:       throw new NotFoundException('No payment intent found for this order.')
91:     }
92: 
93:     assertIntentTransition(intent.status, 'captured')
94: 
95:     const beneficiary = await this.prisma.guarded().beneficiary.findFirst({
96:       where: { store_id: storeId, mode, kind: 'store', external_ref: null },
97:       select: { id: true },
98:     })
99: 
100:     if (!beneficiary) {
101:       throw new NotFoundException('Store beneficiary is missing.')
102:     }
103: 
104:     const now = new Date()
105: 
106:     const updated = await this.prisma.$transaction(async (tx) => {
107:       // Compare-and-set claim. This is the concurrency guard: only one
108:       // transaction can flip UNPAID -> PAID. A second concurrent caller
109:       // blocks on the row lock, re-evaluates the WHERE after the first
110:       // commits, matches nothing, and rolls back before writing a
111:       // Capture.
112:       //
113:       // Capture has no unique constraint of its own, so without this the
114:       // only thing preventing a duplicate would be the unique dedupe_key
115:       // on payment_events happening to be inserted first. That is an
116:       // ordering accident, not a guarantee.
117:       const claimed = await tx.order.updateMany({
118:         where: { id: order.id, store_id: storeId, payment_status: 'UNPAID' },
119:         data: { payment_status: 'PAID', paid_at: now },
120:       })
121: 
122:       if (claimed.count === 0) {
123:         throw new ConflictException(
124:           'Order was marked as paid by another request.',
125:         )
126:       }
127: 
128:       const capture = await tx.capture.create({
129:         data: {
130:           intent_id: intent.id,
131:           store_id: storeId,
132:           mode,
133:           amount_minor: total.amountMinor,
134:           currency,
135:           status: 'succeeded',
136:           gateway_capture_ref: options.reference ?? null,
137:           captured_at: now,
138:         },
139:         select: { id: true },
140:       })
141: 
142:       await tx.captureAllocation.create({
143:         data: {
144:           capture_id: capture.id,
145:           beneficiary_id: beneficiary.id,
146:           store_id: storeId,
147:           mode,
148:           amount_minor: total.amountMinor,
149:           kind: 'revenue',
150:         },
151:       })
152: 
153:       await tx.paymentIntent.update({
154:         where: { id: intent.id },
155:         data: {
156:           status: 'captured',
157:           captured_total_minor: total.amountMinor,
158:           terminal_at: now,
159:           version: { increment: 1 },
160:         },
161:       })
162: 
163:       await tx.paymentAttempt.updateMany({
164:         where: { intent_id: intent.id, status: { notIn: ['succeeded', 'failed'] } },
165:         data: { status: 'succeeded', next_action_kind: 'none' },
166:       })
167: 
168:       await tx.paymentEvent.create({
169:         data: {
170:           intent_id: intent.id,
171:           store_id: storeId,
172:           mode,
173:           event_type: 'payment.collected.offline',
174:           dedupe_key: `intent:${intent.id}:collected`,
175:           source: 'merchant',
176:           applied: true,
177:           payload_redacted: {
178:             orderId: order.id.toString(),
179:             amountMinor: total.amountMinor.toString(),
180:             currency,
181:             reference: options.reference ?? null,
182:           } as Prisma.InputJsonValue,
183:           occurred_at: now,
184:         },
185:       })
186: 
187:       // Clears the receivable opened at commitment.
188:       await this.ledger.post(tx, {
189:         storeId,
190:         mode,
191:         currency,
192:         entryType: 'payment.collected.offline',
193:         sourceKind: 'order',
194:         sourceId: order.id.toString(),
195:         dedupeKey: `order:${order.id}:collected`,
196:         occurredAt: now,
197:         memo: `Collection for order ${order.order_number}`,
198:         postings: offlineCollected({ totalMinor: total.amountMinor }),
199:       })
200: 
201:       // Already updated by the claim above; read it back for the response.
202:       const saved = await tx.order.findFirstOrThrow({
203:         where: { id: order.id, store_id: storeId },
204:         select: {
205:           id: true,
206:           order_number: true,
207:           payment_status: true,
208:           paid_at: true,
209:           status: true,
210:         },
211:       })
212: 
213:       await this.outbox.emit(tx, {
214:         storeId,
215:         mode,
216:         aggregateType: 'order',
217:         aggregateId: order.id.toString(),
218:         eventType: 'payment.collected',
219:         payload: {
220:           orderId: order.id.toString(),
221:           orderNumber: order.order_number,
222:           intentId: intent.id.toString(),
223:           captureId: capture.id.toString(),
224:           amountMinor: total.amountMinor.toString(),
225:           currency,
226:         },
227:         occurredAt: now,
228:       })
229: 
230:       return saved
231:     })
232: 
233:     this.logger.log(
234:       `Offline payment collected: store ${storeId} order ${updated.order_number} ${total.amountMinor} ${currency}`,
235:     )
236: 
237:     return {
238:       id: updated.id.toString(),
239:       order_number: updated.order_number,
240:       status: updated.status,
241:       payment_status: updated.payment_status,
242:       paid_at: updated.paid_at,
243:     }
244:   }
245: }

(End of file - total 245 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.8s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/active-store.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/active-store.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
2: import { PrismaService } from '../prisma/prisma.service'
3: import { store as StoreRecord } from '@prisma/client'
4: 
5: /**
6:  * ActiveStoreService
7:  * ====================
8:  * البنية التحتية المشتركة لحل "المتجر الفعّال" لأي مستخدم بأمان.
9:  *
10:  * ⚠️ قاعدة أمان أساسية: أي storeIdentifier (id أو slug) قادم من الفرونت
11:  * (هيدر / باراميتر / URL) بيتعامل معاه هنا دايماً كـ "مفتاح بحث" بس،
12:  * مش كحقيقة موثوقة. مفيش أي استعلام بيرجع صف متجر من غير ما يتأكد إن
13:  * ownerId بتاعه == userId الحالي. لو مش بتاعه، بنرجع NotFoundException
14:  * (مش بنفرّق بين "مش موجود" و"موجود بس مش بتاعك") عشان منسربش معلومة
15:  * عن وجود متاجر تانية لمستخدمين تانيين.
16:  *
17:  * لو مفيش storeIdentifier مبعوت خالص، بنرجع لنفس السلوك الحالي في
18:  * المشروع (أول متجر بيملكه اليوزر) — للحفاظ على التوافق الكامل مع كل
19:  * الكود الحالي لحد ما نربط الـ UI بتاع اختيار المتجر في مرحلة لاحقة.
20:  */
21: @Injectable()
22: export class ActiveStoreService {
23:   constructor(private readonly prisma: PrismaService) {}
24: 
25:   /**
26:    * يحل المتجر الفعّال. لا يفرّق بين "غير موجود" و"غير مملوك" في الخطأ
27:    * المرجوع — مناسب للاستخدام العام (قراءة/كتابة) في الـ Guard.
28:    */
29:   async resolveActiveStore(
30:     userId: string | bigint,
31:     storeIdentifier?: string | null,
32:   ): Promise<StoreRecord> {
33:     const ownerId = BigInt(userId)
34: 
35:     if (storeIdentifier) {
36:       const isNumericId = /^\d+$/.test(storeIdentifier)
37: 
38:       const store = await this.prisma.store.findFirst({
39:         where: {
40:           ownerId,
41:           ...(isNumericId
42:             ? { id: BigInt(storeIdentifier) }
43:             : { slug: storeIdentifier }),
44:         },
45:       })
46: 
47:       if (!store) {
48:         throw new NotFoundException('Store not found')
49:       }
50: 
51:       return store
52:     }
53: 
54:     // مفيش identifier — نفس سلوك findFirst({ownerId}) الحالي في المشروع،
55:     // بس بترتيب زمني صريح (أقدم متجر) عشان يكون سلوك حتمي وقابل للتوقع
56:     // بدل ما نسيب Postgres يختار أي ترتيب.
57:     const store = await this.prisma.store.findFirst({
58:       where: { ownerId },
59:       orderBy: { createdAt: 'asc' },
60:     })
61: 
62:     if (!store) {
63:       throw new NotFoundException('Store not found')
64:     }
65: 
66:     return store
67:   }
68: 
69:   /**
70:    * نسخة صارمة: بترمي ForbiddenException (مش NotFoundException) لو
71:    * الـ identifier موجود فعلاً بس مملوك ليوزر تاني — مفيدة في السياقات
72:    * الحساسة (حذف/تعديل) اللي محتاجة تفرقة واضحة في الـ logs/monitoring
73:    * بين "معرّف غلط" و"محاولة وصول لمتجر مش بتاعك". اختيارية الاستخدام،
74:    * وهتتفعّل في المراحل الجاية حسب الحاجة الفعلية لكل endpoint.
75:    */
76:   async assertOwnership(
77:     userId: string | bigint,
78:     storeIdentifier: string,
79:   ): Promise<StoreRecord> {
80:     const ownerId = BigInt(userId)
81:     const isNumericId = /^\d+$/.test(storeIdentifier)
82: 
83:     const store = await this.prisma.store.findFirst({
84:       where: isNumericId
85:         ? { id: BigInt(storeIdentifier) }
86:         : { slug: storeIdentifier },
87:     })
88: 
89:     if (!store) {
90:       throw new NotFoundException('Store not found')
91:     }
92: 
93:     if (store.ownerId !== ownerId) {
94:       throw new ForbiddenException('You do not have access to this store')
95:     }
96: 
97:     return store
98:   }
99: }

(End of file - total 99 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/idempotency/idempotency.service.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/idempotency/idempotency.service.ts</path>
<type>file</type>
<content>
1: import { Injectable, Logger } from '@nestjs/common'
2: import { ConfigService } from '@nestjs/config'
3: import { Cron, CronExpression } from '@nestjs/schedule'
4: import { Prisma } from '@prisma/client'
5: import { PrismaService } from '../../prisma/prisma.service'
6: import type { IdempotencyConfig } from '../config/configuration'
7: import {
8:   ClaimRequest,
9:   ClaimResult,
10:   isUniqueConstraintError,
11: } from './idempotency.types'
12: 
13: /**
14:  * ══════════════════════════════════════════════════════════════════
15:  * خدمة منع التكرار
16:  * ══════════════════════════════════════════════════════════════════
17:  *
18:  * التصميم: **الحجز أولاً (claim-first)**، مش الفحص أولاً.
19:  *
20:  * الطريقة الغلط الشائعة:
21:  *   1. دوّر على سجل بالمفتاح ده
22:  *   2. لو مش موجود، نفّذ العملية واعمل سجل
23:  *
24:  * طلبين متوازيين بيعدّوا خطوة 1 الاتنين قبل ما أي واحد يوصل لخطوة 2،
25:  * فالعملية بتتنفّذ مرتين. ده بالظبط سيناريو الدبل-كليك على زرار الدفع.
26:  *
27:  * الطريقة الصح:
28:  *   1. اعمل السجل بحالة in_flight — القيد الفريد بيرفض التاني
29:  *   2. لو الإنشاء نجح → نفّذ
30:  *   3. لو رجع P2002 → في سجل موجود، شوف حالته:
31:  *        completed + نفس البصمة  → رجّع الرد المخزّن
32:  *        completed + بصمة مختلفة → 409 تعارض
33:  *        in_flight + الحجز ساري  → 409 اتأخّر وحاول تاني
34:  *        in_flight + الحجز خلص   → اسرق الحجز وكمّل (الطلب الأصلي مات)
35:  *
36:  * القيد الفريد في قاعدة البيانات هو اللي بينفّذ الضمانة، مش الكود.
37:  *
38:  * ⚠️ ملاحظة على أعمدة Json: Prisma **بيرفض** تمرير null عادية لعمود
39:  * Json، ولازم Prisma.DbNull (NULL في قاعدة البيانات) أو Prisma.JsonNull
40:  * (قيمة JSON اسمها null). وتمرير undefined معناه "ماتغيّرش العمود" مش
41:  * "فضّيه". الاتنين دول مصدر أخطاء صامتة، فمستخدمين DbNull صراحةً.
42:  */
43: @Injectable()
44: export class IdempotencyService {
45:   private readonly logger = new Logger(IdempotencyService.name)
46: 
47:   constructor(
48:     private readonly prisma: PrismaService,
49:     private readonly config: ConfigService,
50:   ) {}
51: 
52:   private get settings(): IdempotencyConfig {
53:     return this.config.getOrThrow<IdempotencyConfig>('idempotency')
54:   }
55: 
56:   get defaultTtlSeconds(): number {
57:     return this.settings.ttlSeconds
58:   }
59: 
60:   get defaultLeaseSeconds(): number {
61:     return this.settings.leaseSeconds
62:   }
63: 
64:   /**
65:    * يحاول حجز المفتاح.
66:    *
67:    * ⚠️ لازم يتنادى **خارج** أي transaction للمستدعي. السجل لازم يتحفظ
68:    * فوراً عشان الطلب المتوازي يشوفه.
69:    */
70:   async claim(request: ClaimRequest): Promise<ClaimResult> {
71:     const now = new Date()
72:     const expiresAt = new Date(now.getTime() + request.ttlSeconds * 1000)
73:     const lockedUntil = new Date(now.getTime() + request.leaseSeconds * 1000)
74: 
75:     try {
76:       const created = await this.prisma.paymentIdempotencyRecord.create({
77:         data: {
78:           store_id: request.storeId,
79:           mode: request.mode,
80:           scope: request.scope,
81:           idempotency_key: request.idempotencyKey,
82:           request_fingerprint: request.fingerprint,
83:           status: 'in_flight',
84:           locked_until: lockedUntil,
85:           expires_at: expiresAt,
86:         },
87:         select: { id: true },
88:       })
89: 
90:       return { outcome: 'proceed', recordId: created.id }
91:     } catch (error) {
92:       if (!isUniqueConstraintError(error)) throw error
93:       return this.resolveExisting(request, now, lockedUntil)
94:     }
95:   }
96: 
97:   /** يسجّل نجاح العملية ويخزّن الرد للإعادة */
98:   async complete(
99:     recordId: bigint,
100:     storeId: bigint,
101:     statusCode: number,
102:     body: unknown,
103:   ): Promise<void> {
104:     await this.prisma.paymentIdempotencyRecord.updateMany({
105:       where: { id: recordId, store_id: storeId },
106:       data: {
107:         status: 'completed',
108:         response_status_code: statusCode,
109:         // DbNull مش null: تمرير null عادية لعمود Json بيرمي في Prisma
110:         response_body:
111:           body === null || body === undefined
112:             ? Prisma.DbNull
113:             : (body as Prisma.InputJsonValue),
114:         locked_until: null,
115:         completed_at: new Date(),
116:       },
117:     })
118:   }
119: 
120:   /**
121:    * يسجّل فشل العملية.
122:    *
123:    * الحالة بتبقى failed مش completed، فإعادة المحاولة بنفس المفتاح
124:    * مسموحة — العميل المفروض يقدر يعيد بعد خطأ مؤقت.
125:    */
126:   async fail(recordId: bigint, storeId: bigint): Promise<void> {
127:     await this.prisma.paymentIdempotencyRecord.updateMany({
128:       where: { id: recordId, store_id: storeId },
129:       data: { status: 'failed', locked_until: null, completed_at: new Date() },
130:     })
131:   }
132: 
133:   /** ينضّف السجلات المنتهية — كل ساعة */
134:   @Cron(CronExpression.EVERY_HOUR)
135:   async purgeExpired(): Promise<number> {
136:     const result = await this.prisma.paymentIdempotencyRecord.deleteMany({
137:       where: { expires_at: { lt: new Date() } },
138:     })
139: 
140:     if (result.count > 0) {
141:       this.logger.log(`تم حذف ${result.count} سجل idempotency منتهي.`)
142:     }
143: 
144:     return result.count
145:   }
146: 
147:   /** يقرر النتيجة لما القيد الفريد يرفض الإنشاء */
148:   private async resolveExisting(
149:     request: ClaimRequest,
150:     now: Date,
151:     lockedUntil: Date,
152:   ): Promise<ClaimResult> {
153:     const existing = await this.prisma.paymentIdempotencyRecord.findFirst({
154:       where: {
155:         store_id: request.storeId,
156:         mode: request.mode,
157:         scope: request.scope,
158:         idempotency_key: request.idempotencyKey,
159:       },
160:     })
161: 
162:     if (!existing) {
163:       // اتحذف بين المحاولتين (تنضيف) — المستدعي يعيد المحاولة
164:       return { outcome: 'in_flight', retryAfterSeconds: 1 }
165:     }
166: 
167:     // نفس المفتاح بجسم مختلف = خطأ من العميل، مش إعادة إرسال
168:     if (existing.request_fingerprint !== request.fingerprint) {
169:       return {
170:         outcome: 'conflict',
171:         detail:
172:           'نفس Idempotency-Key اتبعت مع محتوى طلب مختلف. ' +
173:           'كل عملية لازم يكون ليها مفتاح خاص بيها.',
174:       }
175:     }
176: 
177:     if (existing.status === 'completed') {
178:       return {
179:         outcome: 'replay',
180:         statusCode: existing.response_status_code ?? 200,
181:         body: existing.response_body ?? null,
182:       }
183:     }
184: 
185:     if (existing.status === 'failed') {
186:       // العملية فشلت — نسمح بإعادة المحاولة بحجز جديد
187:       const stolen = await this.stealLease(existing.id, request, lockedUntil)
188:       return stolen
189:         ? { outcome: 'proceed', recordId: existing.id }
190:         : { outcome: 'in_flight', retryAfterSeconds: 1 }
191:     }
192: 
193:     // in_flight
194:     const leaseExpired =
195:       existing.locked_until !== null && existing.locked_until <= now
196: 
197:     if (!leaseExpired) {
198:       const retryAfterSeconds = existing.locked_until
199:         ? Math.max(
200:             1,
201:             Math.ceil((existing.locked_until.getTime() - now.getTime()) / 1000),
202:           )
203:         : 1
204: 
205:       return { outcome: 'in_flight', retryAfterSeconds }
206:     }
207: 
208:     // الحجز خلص — الطلب الأصلي مات (السيرفر وقع مثلاً). نسرق الحجز.
209:     this.logger.warn(
210:       `حجز idempotency منتهي للمفتاح ${request.scope}:${request.idempotencyKey} — ` +
211:         `جاري استئنافه.`,
212:     )
213: 
214:     const stolen = await this.stealLease(existing.id, request, lockedUntil)
215: 
216:     return stolen
217:       ? { outcome: 'proceed', recordId: existing.id }
218:       : { outcome: 'in_flight', retryAfterSeconds: 1 }
219:   }
220: 
221:   /**
222:    * يحاول أخذ الحجز بشرط إن حالته لسه زي ما شفناها.
223:    *
224:    * updateMany بشرط بيمنع طلبين من سرقة نفس الحجز المنتهي في نفس اللحظة:
225:    * الأول بس اللي هيلاقي الحالة القديمة.
226:    */
227:   private async stealLease(
228:     recordId: bigint,
229:     request: ClaimRequest,
230:     lockedUntil: Date,
231:   ): Promise<boolean> {
232:     const result = await this.prisma.paymentIdempotencyRecord.updateMany({
233:       where: {
234:         id: recordId,
235:         store_id: request.storeId,
236:         OR: [
237:           { status: 'failed' },
238:           { status: 'in_flight', locked_until: { lte: new Date() } },
239:           { status: 'in_flight', locked_until: null },
240:         ],
241:       },
242:       data: {
243:         status: 'in_flight',
244:         locked_until: lockedUntil,
245:         completed_at: null,
246:         response_status_code: null,
247:         // DbNull مش undefined: undefined معناها "ماتغيّرش" فالرد القديم
248:         // كان هيفضل مخزّن على سجل بقى in_flight تاني
249:         response_body: Prisma.DbNull,
250:       },
251:     })
252: 
253:     return result.count === 1
254:   }
255: }

(End of file - total 255 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/uploads/uploads-cleanup.cron.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/uploads/uploads-cleanup.cron.ts</path>
<type>file</type>
<content>
1: // src/uploads/uploads-cleanup.cron.ts
2: import { Injectable, Logger } from '@nestjs/common';
3: import { Cron, CronExpression } from '@nestjs/schedule';
4: import { DeleteObjectCommand } from '@aws-sdk/client-s3';
5: import { PrismaService } from '../prisma/prisma.service';
6: import { UploadsService } from './uploads.service';
7: 
8: @Injectable()
9: export class UploadsCleanupCron {
10:   private readonly logger = new Logger(UploadsCleanupCron.name);
11: 
12:   constructor(private prisma: PrismaService, private uploadsService: UploadsService) {}
13: 
14:   @Cron(CronExpression.EVERY_HOUR)
15:   async cleanupOrphaned() {
16:     const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
17:     const orphaned = await this.prisma.upload.findMany({
18:       where: { status: 'pending', created_at: { lt: oneHourAgo } },
19:     });
20: 
21:     const client = this.uploadsService.getS3Client();
22:     for (const u of orphaned) {
23:       try {
24:         await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: u.key }));
25:         await this.prisma.upload.delete({ where: { id: u.id } });
26:       } catch (err) {
27:         this.logger.error(`فشل حذف ${u.key}: ${err}`);
28:       }
29:     }
30:     if (orphaned.length) this.logger.log(`تم تنظيف ${orphaned.length} ملف يتيم`);
31:   }
32: }

(End of file - total 32 lines)
</content>
```

**Tool: grep**

**Input:**
```json
{
  "pattern": "Collection|Upload",
  "path": "/workspaces/testapp/backend/prisma/schema.prisma"
}
```

**Output:**
```
Found 20 matches
/workspaces/testapp/backend/prisma/schema.prisma:
  Line 384:   collections         Collection[]

  Line 539:   collections ProductCollection[]

  Line 678: model Upload {

  Line 694: model Collection {

  Line 709:   products ProductCollection[]

  Line 717: model ProductCollection {

  Line 723:   collection Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)


/workspaces/testapp/backend/prisma/migrations/0_init/migration.sql:
  Line 23: CREATE TABLE "public"."Collection" (

  Line 36:     CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")

  Line 111: CREATE TABLE "public"."ProductCollection" (

  Line 116:     CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("productId","collectionId")

  Line 300: CREATE TABLE "public"."Upload" (

  Line 312:     CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")

  Line 677: CREATE UNIQUE INDEX "Collection_storeId_handle_key" ON "public"."Collection"("storeId" ASC, "handle" ASC);

  Line 755: CREATE UNIQUE INDEX "Upload_key_key" ON "public"."Upload"("key" ASC);

  Line 758: CREATE INDEX "Upload_status_created_at_idx" ON "public"."Upload"("status" ASC, "created_at" ASC);

  Line 761: CREATE INDEX "Upload_store_id_idx" ON "public"."Upload"("store_id" ASC);

  Line 878: ALTER TABLE "public"."Collection" ADD CONSTRAINT "Collection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "public"."store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

  Line 899: ALTER TABLE "public"."ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "public"."Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

  Line 902: ALTER TABLE "public"."ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.5s)

**Tool: grep**

**Input:**
```json
{
  "pattern": "this\\.prisma\\.",
  "path": "/workspaces/testapp/backend/src/stores"
}
```

**Output:**
```
Found 100 matches (more matches available)
/workspaces/testapp/backend/src/stores/active-store.service.ts:
  Line 38:       const store = await this.prisma.store.findFirst({

  Line 57:     const store = await this.prisma.store.findFirst({

  Line 83:     const store = await this.prisma.store.findFirst({


/workspaces/testapp/backend/src/stores/products/product.service.ts:
  Line 37:       const existing = await this.prisma.product.findFirst({

  Line 92:       this.prisma.product.count({ where }),

  Line 93:       this.prisma.product.findMany({

  Line 125:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 141:       this.prisma.product.count({ where }),

  Line 142:       this.prisma.product.findMany({

  Line 170:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 173:     const product = await this.prisma.product.findFirst({

  Line 209:     const product = await this.prisma.product.findFirst({

  Line 239:     const productId = await this.prisma.$transaction(async (tx) => {

  Line 365:     const created = await this.prisma.product.findUnique({

  Line 377:     const product = await this.prisma.product.findFirst({

  Line 393:     await this.prisma.$transaction(async (tx) => {

  Line 570:     const updated = await this.prisma.product.findUnique({

  Line 585:     const product = await this.prisma.product.findFirst({

  Line 590:       await this.prisma.product.update({ where: { id: product.id }, data: { status } }),

  Line 595:     const product = await this.prisma.product.findFirst({

  Line 600:     return this.prisma.$transaction(async (tx) => {

  Line 614:     const product = await this.prisma.product.findFirst({

  Line 628:     const newProductId = await this.prisma.$transaction(async (tx) => {

  Line 706:       await this.prisma.product.findUnique({

  Line 720:     const product = await this.prisma.product.findFirst({

  Line 724:     const last = await this.prisma.productImage.findFirst({

  Line 732:         await this.prisma.productImage.create({

  Line 741:     const product = await this.prisma.product.findFirst({

  Line 749:     const image = await this.prisma.productImage.findFirst({

  Line 753:     return this.prisma.productImage.delete({ where: { id: image.id } })

  Line 758:       await this.prisma.productType.findMany({

  Line 766:     const exists = await this.prisma.productType.findFirst({

  Line 771:       await this.prisma.productType.create({ data: { store_id: storeId, name: name.trim() } }),

  Line 776:     const type = await this.prisma.productType.findFirst({

  Line 781:       await this.prisma.productType.update({ where: { id: type.id }, data: { name: name.trim() } }),

  Line 786:     const type = await this.prisma.productType.findFirst({

  Line 790:     await this.prisma.product.updateMany({

  Line 794:     return this.prisma.productType.delete({ where: { id: type.id } })

  Line 799:       await this.prisma.tag.findMany({

  Line 807:     const exists = await this.prisma.tag.findFirst({

  Line 812:       await this.prisma.tag.create({ data: { store_id: storeId, name: name.trim() } }),

  Line 817:     const tag = await this.prisma.tag.findFirst({

  Line 822:       await this.prisma.tag.update({ where: { id: tag.id }, data: { name: name.trim() } }),

  Line 827:     const tag = await this.prisma.tag.findFirst({

  Line 831:     await this.prisma.productTag.deleteMany({ where: { tag_id: tag.id } })

  Line 832:     return this.prisma.tag.delete({ where: { id: tag.id } })


/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts:
  Line 70:         this.prisma.guarded().checkout.findMany({

  Line 107:     await this.prisma.$transaction(async (tx) => {


/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts:
  Line 117:     const offerings = await this.prisma.guarded().paymentMethodOffering.findMany({

  Line 124:     const accounts = await this.prisma.guarded().paymentAccount.findMany({

  Line 222:     const offering = await this.prisma.guarded().paymentMethodOffering.findFirst({

  Line 236:     const account = await this.prisma.guarded().paymentAccount.findFirst({

  Line 319:     const result = await this.prisma.$transaction(async (tx) => {

  Line 567:       ? await this.prisma.guarded().order.findFirst({

  Line 576:       : await this.prisma.guarded().order.findFirst({

  Line 625:     const checkout = await this.prisma.guarded().checkout.findFirst({

  Line 631:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 642:       ? await this.prisma.guarded().paymentAttempt.findFirst({

  Line 650:       ? await this.prisma.guarded().order.findFirst({

  Line 700:     const checkout = await this.prisma.guarded().checkout.findFirst({

  Line 707:     const intent = await this.prisma.guarded().paymentIntent.findFirst({

  Line 743:       const account = await this.prisma.guarded().paymentAccount.findFirst({

  Line 753:       const attempt = await this.prisma.guarded().paymentAttempt.findFirst({

  Line 994:     const store = await this.prisma.guarded().store.findFirst({ where: { slug } })

  Line 1010:     const variants = await this.prisma.guarded().productVariant.findMany({

  Line 1061:     const existing = await this.prisma.guarded().beneficiary.findFirst({

  Line 1068:     const created = await this.prisma.guarded().beneficiary.create({


/workspaces/testapp/backend/src/stores/collections/storefront-collections.service.ts:
  Line 10:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 13:     const collections = await this.prisma.collection.findMany({

  Line 41:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 44:     const collection = await this.prisma.collection.findFirst({


/workspaces/testapp/backend/src/stores/collections/storefront-collections.controller.ts:
  Line 52:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 55:     const collections = await this.prisma.collection.findMany({

  Line 83:     const store = await this.prisma.store.findFirst({ where: { slug: storeSlug } })

  Line 86:     const collection = await this.prisma.collection.findFirst({


/workspaces/testapp/backend/src/stores/collections/collections.service.ts:
  Line 27:     const existing = await this.prisma.collection.findFirst({

  Line 32:     return this.prisma.collection.create({

  Line 38:     const collections = await this.prisma.collection.findMany({

  Line 57:     const collection = await this.prisma.collection.findFirst({

  Line 109:       await this.prisma.collection.findFirst({ where: { storeId, handle } })

  Line 114:     const collection = await this.prisma.collection.create({

  Line 128:       await this.prisma.productCollection.createMany({

  Line 154:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 157:     return this.prisma.$transaction(async (tx) => {

  Line 195:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 197:     return this.prisma.collection.delete({ where: { id } });

  Line 201:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 206:     await this.prisma.$transaction(async (tx) => {

  Line 239:     const existing = await this.prisma.collection.findFirst({ where: { id, storeId } });

  Line 242:     await this.prisma.productCollection.deleteMany({


/workspaces/testapp/backend/src/stores/store.service.ts:
  Line 35:     return this.prisma.store.findMany({

  Line 51:     const store = await this.prisma.store.create({

  Line 65:     await this.prisma.storeTheme.create({

  Line 123:       await this.prisma.store.findFirst({

  Line 135:     return this.prisma.store.update({

  Line 154:     return this.prisma.storePage.findMany({

  Line 176:       await this.prisma.storePage.findFirst({

  Line 185:     return this.prisma.storePage.create({

  Line 204:     const page = await this.prisma.storePage.findFirst({

  Line 214:     return this.prisma.storePage.update({


(Results truncated. Consider using a more specific path or pattern.)
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/refund.service.ts"
}
```

**Error:**
```
File not found: /workspaces/testapp/backend/src/stores/refund.service.ts
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/prisma/schema.prisma",
  "offset": 1500
}
```

**Output:**
```
<path>/workspaces/testapp/backend/prisma/schema.prisma</path>
<type>file</type>
<content>
1500:   /// أصلاً، مش بالوضع النشط على المتجر وقت طلب الاسترداد. من غير
1501:   /// العمود ده، تحويل المتجر لوضع تاني بيخلي الاستردادات القديمة
1502:   /// تتحسب غلط بأثر رجعي.
1503:   payment_mode StorePaymentMode @default(MERCHANT_GATEWAY)
1504: 
1505:   status PaymentIntentStatus @default(created)
1506: 
1507:   /// نسخ مخزّنة من حقيقة الدفتر — بيتأكد منها فاحص الثوابت
1508:   authorized_total_minor BigInt @default(0)
1509:   captured_total_minor   BigInt @default(0)
1510:   refunded_total_minor   BigInt @default(0)
1511: 
1512:   /// تحكّم تفاؤلي في التزامن
1513:   version Int @default(0)
1514: 
1515:   /// مفتاح العميل — فريد لكل متجر ووضع
1516:   idempotency_key String? @db.VarChar(255)
1517: 
1518:   account_id  BigInt?
1519:   offering_id BigInt?
1520: 
1521:   expires_at  DateTime? @db.Timestamptz(6)
1522:   terminal_at DateTime? @db.Timestamptz(6)
1523: 
1524:   metadata Json?
1525: 
1526:   attempts PaymentAttempt[]
1527:   captures Capture[]
1528:   refunds  Refund[]
1529:   events   PaymentEvent[]
1530: 
1531:   created_at DateTime @default(now()) @db.Timestamptz(6)
1532:   updated_at DateTime @updatedAt @db.Timestamptz(6)
1533: 
1534:   @@unique([store_id, mode, idempotency_key])
1535:   @@index([store_id, mode, status])
1536:   @@index([context_kind, context_id])
1537:   @@index([status, expires_at])
1538:   @@index([store_id, mode, created_at])
1539:   @@map("payment_intents")
1540: }
1541: 
1542: /// محاولة واحدة على حساب بوابة واحد.
1543: ///
1544: /// بتحمل حقائق التفويض بنفسها — مفيش كيان Authorization منفصل، لأن
1545: /// مفيش بوابة بتدي أكتر من تفويض للمحاولة الواحدة.
1546: model PaymentAttempt {
1547:   id BigInt @id @default(autoincrement())
1548: 
1549:   intent_id BigInt
1550:   intent    PaymentIntent @relation(fields: [intent_id], references: [id], onDelete: Cascade)
1551: 
1552:   store_id BigInt
1553:   mode     Mode
1554: 
1555:   /// ترتيب المحاولة داخل النية
1556:   sequence Int
1557: 
1558:   account_id  BigInt?
1559:   offering_id BigInt?
1560: 
1561:   status PaymentAttemptStatus @default(initialized)
1562: 
1563:   authorized_amount_minor   BigInt?
1564:   authorization_expires_at  DateTime? @db.Timestamptz(6)
1565: 
1566:   /// معرّفات البوابة — التفرّد على مستوى الحساب مش البوابة، عشان
1567:   /// متجرين بنفس حساب البوابة مايتعارضوش
1568:   gateway_reference  String? @db.VarChar(255)
1569:   gateway_payment_id String? @db.VarChar(255)
1570: 
1571:   next_action_kind       NextActionKind @default(none)
1572:   next_action_payload    Json?
1573:   next_action_expires_at DateTime?      @db.Timestamptz(6)
1574: 
1575:   /// مشتق من (store, intent, sequence, operation) — مش عشوائي، عشان
1576:   /// إعادة المحاولة تبعت نفس المفتاح للبوابة
1577:   psp_idempotency_key String? @db.VarChar(255)
1578: 
1579:   /// من تصنيف الأخطاء الموحّد، مش نص البوابة الخام
1580:   error_code        String? @db.VarChar(60)
1581:   error_message_raw String?
1582: 
1583:   request_snapshot  Json?
1584:   response_snapshot Json?
1585: 
1586:   created_at DateTime @default(now()) @db.Timestamptz(6)
1587:   updated_at DateTime @updatedAt @db.Timestamptz(6)
1588: 
1589:   @@unique([intent_id, sequence])
1590:   @@unique([account_id, gateway_reference])
1591:   @@index([store_id, mode, status])
1592:   @@index([gateway_reference])
1593:   @@map("payment_attempts")
1594: }
1595: 
1596: /// تحصيل فعلي لمبلغ.
1597: /// أكتر من تحصيل للمحاولة الواحدة مسموح (شحن على دفعات).
1598: model Capture {
1599:   id BigInt @id @default(autoincrement())
1600: 
1601:   intent_id  BigInt
1602:   intent     PaymentIntent @relation(fields: [intent_id], references: [id], onDelete: Cascade)
1603:   attempt_id BigInt?
1604: 
1605:   store_id BigInt
1606:   mode     Mode
1607: 
1608:   amount_minor BigInt
1609:   currency     String @db.VarChar(3)
1610: 
1611:   status CaptureStatus @default(pending)
1612: 
1613:   gateway_capture_ref String? @db.VarChar(255)
1614: 
1615:   captured_at DateTime? @db.Timestamptz(6)
1616: 
1617:   allocations CaptureAllocation[]
1618:   refunds     Refund[]
1619: 
1620:   created_at DateTime @default(now()) @db.Timestamptz(6)
1621:   updated_at DateTime @updatedAt @db.Timestamptz(6)
1622: 
1623:   @@index([intent_id, status])
1624:   @@index([store_id, mode, status])
1625:   @@map("captures")
1626: }
1627: 
1628: /// توزيع التحصيل على المستفيدين.
1629: ///
1630: /// في المرحلة دي صف واحد بس للمتجر نفسه (+ عمولة منصة اختيارية)،
1631: /// لكن البُعد موجود من دلوقتي عشان السوق متعدد البائعين مايبقاش
1632: /// إعادة كتابة للدفتر بعدين.
1633: /// ثابت: مجموع amount_minor = amount_minor بتاع التحصيل.
1634: model CaptureAllocation {
1635:   id BigInt @id @default(autoincrement())
1636: 
1637:   capture_id BigInt
1638:   capture    Capture @relation(fields: [capture_id], references: [id], onDelete: Cascade)
1639: 
1640:   beneficiary_id BigInt
1641:   store_id       BigInt
1642:   mode           Mode
1643: 
1644:   amount_minor BigInt
1645:   kind         AllocationKind @default(revenue)
1646: 
1647:   @@index([capture_id])
1648:   @@index([beneficiary_id])
1649:   @@map("capture_allocations")
1650: }
1651: 
1652: /// استرداد مبلغ محصّل.
1653: ///
1654: /// مربوط بالتحصيل اللي جه منه، مش بالطلب: التحصيل هو اللي بيعرف أي
1655: /// حساب بوابة استلم الفلوس فعلاً، والاسترداد لازم يرجع من نفس المسار.
1656: model Refund {
1657:   id BigInt @id @default(autoincrement())
1658: 
1659:   intent_id BigInt
1660:   intent    PaymentIntent @relation(fields: [intent_id], references: [id], onDelete: Cascade)
1661: 
1662:   /// null للاستردادات اللي البوابة بلّغت عنها من غير ما تحدّد التحصيل
1663:   capture_id BigInt?
1664:   capture    Capture? @relation(fields: [capture_id], references: [id], onDelete: SetNull)
1665: 
1666:   store_id BigInt
1667:   mode     Mode
1668: 
1669:   amount_minor BigInt
1670:   currency     String @db.VarChar(3)
1671: 
1672:   status    RefundStatus    @default(pending)
1673:   initiated_by RefundInitiator @default(merchant)
1674: 
1675:   reason String? @db.VarChar(400)
1676: 
1677:   gateway_refund_ref String? @db.VarChar(255)
1678: 
1679:   /// مفتاح العميل — فريد لكل متجر ووضع
1680:   idempotency_key String? @db.VarChar(255)
1681: 
1682:   failure_code String? @db.VarChar(60)
1683: 
1684:   allocations RefundAllocation[]
1685: 
1686:   succeeded_at DateTime? @db.Timestamptz(6)
1687:   created_at   DateTime  @default(now()) @db.Timestamptz(6)
1688:   updated_at   DateTime  @updatedAt @db.Timestamptz(6)
1689: 
1690:   @@unique([store_id, mode, idempotency_key])
1691:   @@unique([store_id, gateway_refund_ref])
1692:   @@index([intent_id, status])
1693:   @@index([store_id, mode, created_at])
1694:   @@map("refunds")
1695: }
1696: 
1697: /// توزيع الاسترداد على المستفيدين.
1698: ///
1699: /// بيعكس CaptureAllocation بالظبط. تحت MERCHANT_GATEWAY بيبقى صف واحد،
1700: /// لكن البُعد لازم يكون موجود من دلوقتي: استرداد 40 من تحصيل 100 كان
1701: /// متقسّم 90/10 لازم يسحب 36/4، مش 40 من جهة واحدة.
1702: /// ثابت: مجموع amount_minor = amount_minor بتاع الاسترداد.
1703: model RefundAllocation {
1704:   id BigInt @id @default(autoincrement())
1705: 
1706:   refund_id BigInt
1707:   refund    Refund @relation(fields: [refund_id], references: [id], onDelete: Cascade)
1708: 
1709:   beneficiary_id BigInt
1710:   store_id       BigInt
1711:   mode           Mode
1712: 
1713:   amount_minor BigInt
1714:   kind         AllocationKind @default(revenue)
1715: 
1716:   @@index([refund_id])
1717:   @@index([beneficiary_id])
1718:   @@map("refund_allocations")
1719: }
1720: 
1721: /// جهة تُنسب لها الإيرادات. مش حساب أموال — التاجر هو Merchant of Record.
1722: model Beneficiary {
1723:   id BigInt @id @default(autoincrement())
1724: 
1725:   store_id BigInt
1726:   mode     Mode
1727: 
1728:   kind         BeneficiaryKind
1729:   external_ref String?         @db.VarChar(120)
1730: 
1731:   default_currency String @db.VarChar(3)
1732: 
1733:   created_at DateTime @default(now()) @db.Timestamptz(6)
1734: 
1735:   @@unique([store_id, mode, kind, external_ref])
1736:   @@index([store_id, mode])
1737:   @@map("beneficiaries")
1738: }
1739: 
1740: /// حساب في الدفتر.
1741: ///
1742: /// ⚠️ العملة جزء من هوية الحساب: دفتر بيخلط عملات في رصيد واحد
1743: /// مابينفعش يتجمع، وأي استعلام رصيد بيرجّع كلام فاضي.
1744: model LedgerAccount {
1745:   id BigInt @id @default(autoincrement())
1746: 
1747:   store_id BigInt
1748:   mode     Mode
1749:   currency String @db.VarChar(3)
1750: 
1751:   account_type LedgerAccountType
1752: 
1753:   beneficiary_id     BigInt?
1754:   payment_account_id BigInt?
1755: 
1756:   postings LedgerPosting[]
1757: 
1758:   created_at DateTime @default(now()) @db.Timestamptz(6)
1759: 
1760:   /// الاسم صريح: الاسم التلقائي بيطلع 89 حرف، وPostgres بيقصّه عند 63
1761:   @@unique([store_id, mode, currency, account_type, beneficiary_id, payment_account_id], map: "ledger_accounts_identity_key")
1762:   @@index([store_id, mode, currency])
1763:   @@map("ledger_accounts")
1764: }
1765: 
1766: /// قيد محاسبي. غير قابل للتعديل — التصحيح بقيد عكسي مش بتحديث.
1767: /// ثابت: مجموع المدين = مجموع الدائن، داخل عملة واحدة.
1768: model JournalEntry {
1769:   id BigInt @id @default(autoincrement())
1770: 
1771:   store_id BigInt
1772:   mode     Mode
1773:   currency String @db.VarChar(3)
1774: 
1775:   /// نوع القاعدة اللي أنتجت القيد. نص مش enum: التصنيف مفتوح
1776:   /// وبيكبر مع كل بوابة جديدة.
1777:   entry_type String @db.VarChar(60)
1778: 
1779:   source_kind String @db.VarChar(40)
1780:   source_id   String @db.VarChar(64)
1781: 
1782:   /// مشتق من المحتوى — بيخلي الترحيل idempotent مهما كان مصدر الحدث
1783:   dedupe_key String @unique @db.VarChar(120)
1784: 
1785:   occurred_at DateTime @db.Timestamptz(6)
1786:   posted_at   DateTime @default(now()) @db.Timestamptz(6)
1787: 
1788:   reverses_entry_id BigInt?
1789: 
1790:   memo String? @db.VarChar(400)
1791: 
1792:   postings LedgerPosting[]
1793: 
1794:   @@index([store_id, mode, currency, occurred_at])
1795:   @@index([source_kind, source_id])
1796:   @@map("journal_entries")
1797: }
1798: 
1799: model LedgerPosting {
1800:   id BigInt @id @default(autoincrement())
1801: 
1802:   entry_id BigInt
1803:   entry    JournalEntry @relation(fields: [entry_id], references: [id], onDelete: Cascade)
1804: 
1805:   ledger_account_id BigInt
1806:   ledgerAccount     LedgerAccount @relation(fields: [ledger_account_id], references: [id], onDelete: Restrict)
1807: 
1808:   direction PostingDirection
1809: 
1810:   /// دايماً موجب — الاتجاه في direction
1811:   amount_minor BigInt
1812: 
1813:   @@index([entry_id])
1814:   @@index([ledger_account_id])
1815:   @@map("ledger_postings")
1816: }
1817: 
1818: /// سجل ملحق غير قابل للتعديل لكل ما يحصل للنية.
1819: /// للتدقيق وأدلة النزاعات — مش لإعادة بناء الحالة وقت التشغيل.
1820: model PaymentEvent {
1821:   id BigInt @id @default(autoincrement())
1822: 
1823:   intent_id BigInt
1824:   intent    PaymentIntent @relation(fields: [intent_id], references: [id], onDelete: Cascade)
1825: 
1826:   store_id BigInt
1827:   mode     Mode
1828: 
1829:   /// من التصنيف الموحّد للأحداث
1830:   event_type String @db.VarChar(60)
1831: 
1832:   /// مشتق من المحتوى مش من وسيلة النقل — نفس الحقيقة من webhook أو
1833:   /// مطابقة أو رجوع العميل بتدي نفس المفتاح
1834:   dedupe_key String @unique @db.VarChar(120)
1835: 
1836:   source PaymentEventSource
1837: 
1838:   /// false معناه الحدث اتسجّل لكن ماغيّرش الحالة (قديم أو مكرر)
1839:   applied           Boolean @default(true)
1840:   superseded_reason String? @db.VarChar(120)
1841: 
1842:   payload_redacted Json?
1843: 
1844:   occurred_at DateTime? @db.Timestamptz(6)
1845:   recorded_at DateTime  @default(now()) @db.Timestamptz(6)
1846: 
1847:   @@index([intent_id, recorded_at])
1848:   @@index([store_id, mode, event_type])
1849:   @@map("payment_events")
1850: }

(End of file - total 1850 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 16.6s)

_Thinking:_



Core isolation model and guard wiring mapped — now auditing remaining gaps, raw SQL, and transaction paths.

**Tool: glob**

**Input:**
```json
{
  "pattern": "**/*.md"
}
```

**Output:**
```
/workspaces/testapp/backend/APPLY.md
/workspaces/testapp/backend/AI_RULES.md
/workspaces/testapp/backend/aws/README.md
/workspaces/testapp/backend/README.md
/workspaces/testapp/backend/docs/PAYMENTS-ARCHITECTURE.md
/workspaces/testapp/backend/docs/MONEY.md
/workspaces/testapp/frontend/README.md
```

**Tool: bash**

**Input:**
```json
{
  "command": "grep -r \"P0\\|P1-A\\|guardEnabled\\|tenant\" /workspaces/testapp/backend/src --include=\"*.ts\" -n | head -n 200"
}
```

**Output:**
```
/workspaces/testapp/backend/src/app.module.ts:21:import { TenantModule } from './common/tenant/tenant.module'
/workspaces/testapp/backend/src/common/idempotency/idempotency.interceptor.ts:15:import { TenantContextService } from '../tenant/tenant-context.service'
/workspaces/testapp/backend/src/common/idempotency/idempotency.interceptor.ts:61:    private readonly tenantContext: TenantContextService,
/workspaces/testapp/backend/src/common/idempotency/idempotency.interceptor.ts:85:    const storeIdRaw = this.tenantContext.getStoreId()
/workspaces/testapp/backend/src/common/idempotency/idempotency.interceptor.ts:96:    const mode = this.tenantContext.getMode()
/workspaces/testapp/backend/src/common/config/configuration.ts:22:export interface TenantConfig { guardEnabled: boolean }
/workspaces/testapp/backend/src/common/config/configuration.ts:53:export const tenantConfig = registerAs<TenantConfig>('tenant', () => ({
/workspaces/testapp/backend/src/common/config/configuration.ts:54:  guardEnabled: parseBoolOr(process.env.TENANT_GUARD_ENABLED, process.env.NODE_ENV !== 'production'),
/workspaces/testapp/backend/src/common/config/configuration.ts:56:export const configurationLoaders = [appConfig, securityConfig, paymentsConfig, messagingConfig, idempotencyConfig, tenantConfig]
/workspaces/testapp/backend/src/common/crypto/store-key.service.spec.ts:130:  describe('cross-tenant isolation', () => {
/workspaces/testapp/backend/src/common/crypto/store-key.service.spec.ts:155:  describe('intra-tenant isolation via AAD (B1)', () => {
/workspaces/testapp/backend/src/common/tenant/cross-store-query.ts:38:  /** Operational health check across all tenants. */
/workspaces/testapp/backend/src/common/tenant/cross-store-query.ts:54: * open scope silently suppressed the tenant guard for every query any
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.ts:6:} from './tenant-scoped-models'
/workspaces/testapp/backend/src/common/tenant/cross-mode-query.ts:12: *   crossStoreQuery suppresses the ENTIRE tenant check — store and mode
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:3:import { TenantContextService } from './tenant-context.service'
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:4:import { inspectScope } from './tenant-scope.inspector'
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:8: * Demonstration: the tenant isolation net is not attached
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:11: * These tests describe the behaviour tenant isolation is supposed to
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:17: * silently, and in a multi-tenant payment system that is one merchant
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:22:  it('exposes the active store to the tenant context during a request', () => {
/workspaces/testapp/backend/src/common/tenant/tenant-isolation.gap.spec.ts:46:  it('flags an unscoped read on a tenant-scoped model', () => {
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:2:import { buildTenantGuardDefinition } from './tenant-guard.extension'
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:3:import { TenantContextService } from './tenant-context.service'
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:12: * lives in tenant-guard.extension.ts, not in tenant-scope.inspector.ts,
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:53:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:71:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:93:      tenantContext: context,
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:129:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:139:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:156:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:169:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/guard-crossstore-suppression.spec.ts:188:      tenantContext: new TenantContextService(),
/workspaces/testapp/backend/src/common/tenant/tenant.module.ts:2:import { TenantContextService } from './tenant-context.service'
/workspaces/testapp/backend/src/common/tenant/tenant.module.ts:3:import { TenantContextMiddleware } from './tenant-context.middleware'
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:3:import { inspectScope } from './tenant-scope.inspector'
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:6:import type { TenantContextService } from './tenant-context.service'
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:13: * بيفحص الاستعلامات على الموديلات المسجّلة في tenant-scoped-models،
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:36:  readonly tenantContext: TenantContextService
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:69:    name: 'tenant-guard',
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:80:            `[tenant-scope] عبور متاجر مسموح: ${model ?? 'unknown'}.${operation}` +
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:91:            contextStoreId: options.tenantContext.getStoreId(),
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:107:              `[tenant-scope] وضع عابر مسموح: ${model ?? 'unknown'}.${operation}` +
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:113:            const requestId = options.tenantContext.getRequestId()
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:117:                `[tenant-scope] ` +
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:131:                `[tenant-scope] ${violation.model}.${violation.operation} — ` +
/workspaces/testapp/backend/src/common/tenant/tenant-guard.extension.ts:143:            `[tenant-scope] فشل الفحص لـ ${model ?? 'unknown'}.${operation}: ` +
/workspaces/testapp/backend/src/common/tenant/cross-store-query.spec.ts:88:    // The dangerous direction: an open scope suppressing the tenant
/workspaces/testapp/backend/src/common/tenant/registry-completeness.spec.ts:6:} from './tenant-scoped-models'
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts:1:import { inspectScope } from './tenant-scope.inspector'
/workspaces/testapp/backend/src/common/tenant/tenant-scope.inspector.spec.ts:35:  it('flags creates missing tenant fields', () => {
/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts:4:import { TenantContextService } from './tenant-context.service'
/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts:17:  constructor(private readonly tenantContext: TenantContextService) {}
/workspaces/testapp/backend/src/common/tenant/tenant-context.middleware.ts:25:    this.tenantContext.run(
/workspaces/testapp/backend/src/prisma/prisma.service.ts:5:import { TenantContextService } from '../common/tenant/tenant-context.service';
/workspaces/testapp/backend/src/prisma/prisma.service.ts:6:import { createTenantGuardExtension } from '../common/tenant/tenant-guard.extension';
/workspaces/testapp/backend/src/prisma/prisma.service.ts:23:    private readonly tenantContext: TenantContextService,
/workspaces/testapp/backend/src/prisma/prisma.service.ts:41:   * tenant-scoped-models مش مقيّد بـ store_id و mode. مابيعدّلش الاستعلام،
/workspaces/testapp/backend/src/prisma/prisma.service.ts:59:    const tenant = this.config.get<TenantConfig>('tenant')
/workspaces/testapp/backend/src/prisma/prisma.service.ts:63:        enabled: tenant?.guardEnabled ?? false,
/workspaces/testapp/backend/src/prisma/prisma.service.ts:64:        tenantContext: this.tenantContext,
/workspaces/testapp/backend/src/prisma/prisma.service.spec.ts:32:    // الحارس بيقرأ مساحة 'tenant' — بنطفّيه في الاختبار
/workspaces/testapp/backend/src/prisma/prisma.service.spec.ts:34:      get: jest.fn(() => ({ guardEnabled: false })),
/workspaces/testapp/backend/src/prisma/prisma.service.spec.ts:35:      getOrThrow: jest.fn(() => ({ guardEnabled: false })),
/workspaces/testapp/backend/src/stores/payments/facts/payment-fact.applier.ts:15:import { crossStoreQuery } from '../../../common/tenant/cross-store-query'
/workspaces/testapp/backend/src/stores/payments/facts/reconciliation.service.ts:7:import { crossStoreQuery } from '../../../common/tenant/cross-store-query'
/workspaces/testapp/backend/src/stores/payments/payment-account.service.ts:18:import { crossModeQuery } from '../../common/tenant/cross-mode-query'
/workspaces/testapp/backend/src/stores/active-store.guard.ts:3:import { TenantContextService } from '../common/tenant/tenant-context.service'
/workspaces/testapp/backend/src/stores/active-store.guard.ts:31:    private readonly tenantContext: TenantContextService,
/workspaces/testapp/backend/src/stores/active-store.guard.ts:61:    this.tenantContext.setStoreId(store.id.toString())
/workspaces/testapp/backend/src/stores/checkout/checkout.service.ts:167:    // interceptor cannot be reused here: it needs a store in the tenant
/workspaces/testapp/backend/src/stores/checkout/checkout-expiry.job.ts:4:import { crossStoreQuery } from '../../common/tenant/cross-store-query'
/workspaces/testapp/backend/src/main.ts:8:import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware'
/workspaces/testapp/backend/src/main.ts:47:  const tenantMiddleware = app.get(TenantContextMiddleware)
/workspaces/testapp/backend/src/main.ts:48:  app.use(tenantMiddleware.use.bind(tenantMiddleware))
/workspaces/testapp/backend/src/auth/strategies/microsoft.strategy.ts:14:      tenant: 'common',

```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 1.3s)

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/common/config/configuration.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/common/config/configuration.ts</path>
<type>file</type>
<content>
1: import { registerAs } from '@nestjs/config'
2: 
3: function parseList(raw: string | undefined): string[] {
4:   if (!raw) return []
5:   return raw.split(',').map((i) => i.trim()).filter((i) => i.length > 0)
6: }
7: function parseIntOr(raw: string | undefined, fallback: number): number {
8:   if (!raw) return fallback
9:   const parsed = parseInt(raw, 10)
10:   return Number.isFinite(parsed) ? parsed : fallback
11: }
12: function parseBoolOr(raw: string | undefined, fallback: boolean): boolean {
13:   if (raw === undefined || raw === '') return fallback
14:   return raw === 'true' || raw === '1'
15: }
16: 
17: export interface AppConfig { nodeEnv: string; isProduction: boolean; port: number; corsOrigins: string[] }
18: export interface SecurityConfig { jwtSecret: string; flowSecret: string }
19: export interface PaymentsConfig { encryptionKey: string; encryptionKeyVersion: number; previousEncryptionKey?: string; previousEncryptionKeyVersion?: number }
20: export interface MessagingConfig { dispatcherEnabled: boolean; pollIntervalMs: number; batchSize: number; leaseSeconds: number; maxAttempts: number; backoffBaseSeconds: number }
21: export interface IdempotencyConfig { ttlSeconds: number; leaseSeconds: number }
22: export interface TenantConfig { guardEnabled: boolean }
23: 
24: export const appConfig = registerAs<AppConfig>('app', () => ({
25:   nodeEnv: process.env.NODE_ENV ?? 'development',
26:   isProduction: process.env.NODE_ENV === 'production',
27:   port: parseIntOr(process.env.PORT, 4000),
28:   corsOrigins: parseList(process.env.CORS_ORIGINS ?? 'http://localhost:3000,*.localhost:3000'),
29: }))
30: export const securityConfig = registerAs<SecurityConfig>('security', () => ({
31:   jwtSecret: process.env.JWT_SECRET as string,
32:   flowSecret: process.env.FLOW_SECRET as string,
33: }))
34: export const paymentsConfig = registerAs<PaymentsConfig>('payments', () => ({
35:   encryptionKey: process.env.PAYMENT_ENCRYPTION_KEY as string,
36:   encryptionKeyVersion: parseIntOr(process.env.PAYMENT_ENCRYPTION_KEY_VERSION, 1),
37:   previousEncryptionKey: process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS,
38:   previousEncryptionKeyVersion: process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION
39:     ? parseIntOr(process.env.PAYMENT_ENCRYPTION_KEY_PREVIOUS_VERSION, 1) : undefined,
40: }))
41: export const messagingConfig = registerAs<MessagingConfig>('messaging', () => ({
42:   dispatcherEnabled: parseBoolOr(process.env.OUTBOX_DISPATCHER_ENABLED, true),
43:   pollIntervalMs: parseIntOr(process.env.OUTBOX_POLL_INTERVAL_MS, 5000),
44:   batchSize: parseIntOr(process.env.OUTBOX_BATCH_SIZE, 50),
45:   leaseSeconds: parseIntOr(process.env.OUTBOX_LEASE_SECONDS, 60),
46:   maxAttempts: parseIntOr(process.env.OUTBOX_MAX_ATTEMPTS, 8),
47:   backoffBaseSeconds: parseIntOr(process.env.OUTBOX_BACKOFF_BASE_SECONDS, 5),
48: }))
49: export const idempotencyConfig = registerAs<IdempotencyConfig>('idempotency', () => ({
50:   ttlSeconds: parseIntOr(process.env.IDEMPOTENCY_TTL_SECONDS, 86_400),
51:   leaseSeconds: parseIntOr(process.env.IDEMPOTENCY_LEASE_SECONDS, 60),
52: }))
53: export const tenantConfig = registerAs<TenantConfig>('tenant', () => ({
54:   guardEnabled: parseBoolOr(process.env.TENANT_GUARD_ENABLED, process.env.NODE_ENV !== 'production'),
55: }))
56: export const configurationLoaders = [appConfig, securityConfig, paymentsConfig, messagingConfig, idempotencyConfig, tenantConfig]

(End of file - total 56 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/stores/active-store.guard.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/stores/active-store.guard.ts</path>
<type>file</type>
<content>
1: import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
2: import { ActiveStoreService } from './active-store.service'
3: import { TenantContextService } from '../common/tenant/tenant-context.service'
4: 
5: /**
6:  * ActiveStoreGuard
7:  * ==================
8:  * بيشتغل بعد أي Auth Guard (SessionAuthGuard) في نفس الـ @UseGuards() chain،
9:  * يعني الترتيب المتوقع:
10:  *
11:  *   @UseGuards(SessionAuthGuard, ActiveStoreGuard)
12:  *
13:  * بيحل المتجر الفعّال من (بالترتيب):
14:  *   1. هيدر X-Store-Id
15:  *   2. هيدر X-Store-Slug
16:  *   3. الـ route param :storeSlug
17:  *
18:  * وبيتحقق إن المتجر ده فعلاً بتاع req.user.id عن طريق ActiveStoreService،
19:  * وبعدين بيحط النتيجة على الـ request:
20:  *   - request.activeStore    → صف المتجر كامل
21:  *   - request.activeStoreId  → bigint، اختصار سريع
22:  *
23:  * وكمان بيحط المتجر في TenantContext، عشان حارس Prisma يبقى عنده حاجة
24:  * يقارن بيها. من غير الخطوة دي الحارس شغّال على فراغ: مفيش متجر في
25:  * السياق، فمفيش استعلام يتقال عليه إنه خرج بره نطاق المتجر.
26:  */
27: @Injectable()
28: export class ActiveStoreGuard implements CanActivate {
29:   constructor(
30:     private readonly activeStoreService: ActiveStoreService,
31:     private readonly tenantContext: TenantContextService,
32:   ) {}
33: 
34:   async canActivate(context: ExecutionContext): Promise<boolean> {
35:     const request = context.switchToHttp().getRequest()
36: 
37:     const userId = request.user?.id ?? request.user?.sub
38:     if (!userId) {
39:       // من المفروض الـ Auth Guard اللي قبله يكون رفض الطلب قبل ما يوصل
40:       // هنا أصلاً. منكررش خطأ Auth هنا — الـ Auth Guard هو المسؤول عنه.
41:       return true
42:     }
43: 
44:     const storeIdentifier: string | null =
45:       (request.headers['x-store-id'] as string) ||
46:       (request.headers['x-store-slug'] as string) ||
47:       request.params?.storeSlug ||
48:       null
49: 
50:     const store = await this.activeStoreService.resolveActiveStore(
51:       userId,
52:       storeIdentifier,
53:     )
54: 
55:     request.activeStore = store
56:     request.activeStoreId = store.id
57: 
58:     // ⚠️ بعد التحقق من الملكية، مش قبله. لو اتحطت قبل، أي طلب بيطلب
59:     // متجر مش بتاعه كان هيملا السياق بمتجر مالوش حق فيه، والحارس نفسه
60:     // كان هيبقى مصدر التسريب بدل ما يمنعه.
61:     this.tenantContext.setStoreId(store.id.toString())
62: 
63:     return true
64:   }
65: }

(End of file - total 65 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/main.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/main.ts</path>
<type>file</type>
<content>
1: import 'dotenv/config'
2: import { NestFactory } from '@nestjs/core'
3: import { ConfigService } from '@nestjs/config'
4: import { ValidationPipe, Logger } from '@nestjs/common'
5: import { AppModule } from './app.module'
6: import cookieParser from 'cookie-parser'
7: import type { AppConfig } from './common/config/configuration'
8: import { TenantContextMiddleware } from './common/tenant/tenant-context.middleware'
9: 
10: // Prisma بيرجّع BigInt، و JSON.stringify مابيعرفش يتعامل معاه.
11: // لازم يفضل هنا قبل أي serialization.
12: ;(BigInt.prototype as any).toJSON = function () {
13:   return this.toString()
14: }
15: 
16: /**
17:  * يحوّل عنصر من قائمة CORS_ORIGINS لدالة مطابقة.
18:  * العنصر اللي بيبدأ بـ "*." معناه أي subdomain تحت الدومين ده،
19:  * وده اللي بيحافظ على سلوك الـ regex اللي كان مكتوب في الملف ده قبل كده.
20:  */
21: function buildOriginMatcher(pattern: string): (origin: string) => boolean {
22:   if (pattern.startsWith('*.')) {
23:     const suffix = pattern.slice(2)
24:     const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
25:     const regex = new RegExp(`^https?://([a-zA-Z0-9-]+\\.)+${escaped}$`)
26:     return (origin) => regex.test(origin)
27:   }
28: 
29:   return (origin) => origin === pattern
30: }
31: 
32: async function bootstrap() {
33:   const logger = new Logger('Bootstrap')
34: 
35:   // rawBody مطلوبة للتحقق من توقيع الـ webhooks في المراحل الجاية.
36:   const app = await NestFactory.create(AppModule, { rawBody: true })
37: 
38:   const config = app.get(ConfigService)
39:   const { port, corsOrigins, nodeEnv } = config.getOrThrow<AppConfig>('app')
40: 
41:   app.use(cookieParser())
42: 
43:   /**
44:    * سياق المستأجر — لازم بعد cookieParser وقبل التوجيه.
45:    * بيفتح AsyncLocalStorage للطلب وبيكمّل. مابيرفضش أي طلب.
46:    */
47:   const tenantMiddleware = app.get(TenantContextMiddleware)
48:   app.use(tenantMiddleware.use.bind(tenantMiddleware))
49: 
50:   /**
51:    * التحقق من الـ DTOs.
52:    *
53:    * class-validator و class-transformer كانوا مثبتين في المشروع من غير
54:    * ما يتفعّلوا، يعني كل الـ DTOs الموجودة كانت شكلية. تفعيلهم هنا.
55:    *
56:    * forbidNonWhitelisted مقفولة عن قصد: whitelist بتشيل الحقول الزيادة
57:    * بصمت بدل ما ترفض الطلب كله، فمفيش طلب كان بينجح هيبدأ يفشل.
58:    *
59:    * ملاحظة: الـ routes اللي مكتوبة @Body() body: any مالهاش metatype،
60:    * فـ NestJS بيتخطاها تماماً — يعني أغلب الكود الحالي مش متأثر.
61:    */
62:   app.useGlobalPipes(
63:     new ValidationPipe({
64:       transform: true,
65:       whitelist: true,
66:       forbidNonWhitelisted: false,
67:       transformOptions: { enableImplicitConversion: false },
68:     }),
69:   )
70: 
71:   const matchers = corsOrigins.map(buildOriginMatcher)
72: 
73:   app.enableCors({
74:     origin: (origin, callback) => {
75:       // الطلبات من غير Origin (server-to-server، curl، health checks)
76:       // مسموحة زي ما كانت بالظبط.
77:       if (!origin || matchers.some((matches) => matches(origin))) {
78:         callback(null, true)
79:       } else {
80:         callback(new Error('Blocked by CORS Policy (DartCoin Security)'))
81:       }
82:     },
83:     credentials: true,
84:     methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
85:     allowedHeaders: [
86:       'Content-Type',
87:       'Authorization',
88:       'X-Register-Flow',
89:       'X-Register-Signature',
90:       'X-Device-Fingerprint',
91:       'Idempotency-Key',
92:       'X-Request-Id',
93:     ],
94:   })
95: 
96:   app.setGlobalPrefix('api')
97: 
98:   // بيخلي onModuleDestroy تشتغل فعلاً عند SIGTERM — مهم لقفل اتصالات
99:   // Prisma بشكل نظيف.
100:   app.enableShutdownHooks()
101: 
102:   await app.listen(port)
103: 
104:   logger.log(`🚀 Server running on http://localhost:${port}/api [${nodeEnv}]`)
105:   logger.log(`🔓 CORS origins: ${corsOrigins.join(', ')}`)
106: }
107: 
108: bootstrap()

(End of file - total 108 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/workspaces/testapp/backend/src/prisma/prisma.service.spec.ts"
}
```

**Output:**
```
<path>/workspaces/testapp/backend/src/prisma/prisma.service.spec.ts</path>
<type>file</type>
<content>
1: import { Test, TestingModule } from '@nestjs/testing';
2: import { ConfigService } from '@nestjs/config';
3: import { PrismaService } from './prisma.service';
4: 
5: /**
6:  * PrismaService بياخد EventEmitter2، وبقى بياخد كمان ConfigService و
7:  * TenantContextService (المرحلة 1a — حارس عزل المستأجرين).
8:  *
9:  * useMocker بيوفّر بدائل للتلاتة.
10:  *
11:  * ⚠️ compile() مش init(): init() بتشغّل onModuleInit اللي بتنادي
12:  * $connect()، وده كان هيحتاج قاعدة بيانات حقيقية.
13:  */
14: 
15: // PrismaClient بيقرأ DATABASE_URL وقت الإنشاء، و jest مابيحمّلش .env.
16: // قيمة وهمية كفاية لأننا مش بنتصل بأي قاعدة بيانات هنا.
17: process.env.DATABASE_URL =
18:   process.env.DATABASE_URL ??
19:   'postgresql://test:test@localhost:5432/test?schema=public';
20: 
21: const autoMock = () =>
22:   new Proxy({} as Record<string | symbol, unknown>, {
23:     get: (target, prop) => {
24:       if (prop === 'then') return undefined;
25:       if (!(prop in target)) target[prop] = jest.fn();
26:       return target[prop];
27:     },
28:   });
29: 
30: const mocker = (token: unknown): unknown => {
31:   if (token === ConfigService) {
32:     // الحارس بيقرأ مساحة 'tenant' — بنطفّيه في الاختبار
33:     return {
34:       get: jest.fn(() => ({ guardEnabled: false })),
35:       getOrThrow: jest.fn(() => ({ guardEnabled: false })),
36:     };
37:   }
38:   return autoMock();
39: };
40: 
41: describe('PrismaService', () => {
42:   let service: PrismaService;
43: 
44:   beforeEach(async () => {
45:     const module: TestingModule = await Test.createTestingModule({
46:       providers: [PrismaService],
47:     })
48:       .useMocker(mocker)
49:       .compile();
50: 
51:     service = module.get<PrismaService>(PrismaService);
52:   });
53: 
54:   it('should be defined', () => {
55:     expect(service).toBeDefined();
56:   });
57: });

(End of file - total 57 lines)
</content>
```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 5.5s)

_Thinking:_



**Tool: bash**

**Input:**
```json
{
  "command": "python3 -c \"\nimport re\nschema=open('/workspaces/testapp/backend/prisma/schema.prisma').read()\n# find all models\nmodels=[]\nfor m in re.finditer(r'^model\\s+(\\w+)\\s*\\{([\\s\\S]*?)^\\}', schema, re.M):\n    name=m.group(1)\n    body=m.group(2)\n    has_store_id=bool(re.search(r'^\\s*store_id\\s+', body, re.M))\n    has_storeId=bool(re.search(r'^\\s*storeId\\s+', body, re.M))\n    if has_store_id or has_storeId:\n        print(name, 'has', 'store_id' if has_store_id else 'storeId')\n\"\n"
}
```

**Output:**
```
StoreTheme has store_id
ThemeSection has store_id
StorePage has store_id
StoreMenu has store_id
StoreThemePublished has store_id
Product has store_id
ProductType has store_id
Tag has store_id
Upload has store_id
Collection has storeId
Order has store_id
PaymentMethodOffering has store_id
PaymentAccount has store_id
PaymentIdempotencyRecord has store_id
OutboxMessage has store_id
ConsumedEvent has store_id
Checkout has store_id
InventoryReservation has store_id
PaymentIntent has store_id
PaymentAttempt has store_id
Capture has store_id
CaptureAllocation has store_id
Refund has store_id
RefundAllocation has store_id
Beneficiary has store_id
LedgerAccount has store_id
JournalEntry has store_id
PaymentEvent has store_id

```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 2.3s)

**Tool: bash**

**Input:**
```json
{
  "command": "python3 -c \"\nimport re\nfrom pathlib import Path\nscoped=open('/workspaces/testapp/backend/src/common/tenant/tenant-scoped-models.ts').read()\n# extract model names\nimport re as r2\nmodels=r2.findall(r\\\"model:\\s*'(\\w+)'\\\", scoped)\nprint('registered:', models)\nschema=open('/workspaces/testapp/backend/prisma/schema.prisma').read()\nall_models=[]\nfor m in re.finditer(r'^model\\s+(\\w+)\\s*\\{([\\s\\S]*?)^\\}', schema, re.M):\n    name=m.group(1)\n    body=m.group(2)\n    if re.search(r'^\\s*store_id\\s+', body, re.M) or re.search(r'^\\s*storeId\\s+', body, re.M):\n        all_models.append(name)\nprint('schema with store:', all_models)\nmissing=set(all_models)-set(models)\nprint('missing:', missing)\n# also check deliberately unscopped\nunscoped=r2.findall(r\\\"DELIBERATELY_UNSCOPED.*?\\]\\\", scoped, r2.S)\nprint(unscoped[:500])\n\"\n"
}
```

**Output:**
```
registered: ['PaymentIdempotencyRecord', 'OutboxMessage', 'ConsumedEvent', 'PaymentAccount', 'PaymentMethodOffering', 'Checkout', 'InventoryReservation', 'PaymentIntent', 'PaymentAttempt', 'Capture', 'CaptureAllocation', 'PaymentEvent', 'Refund', 'RefundAllocation', 'Beneficiary', 'LedgerAccount', 'JournalEntry', 'Product', 'ProductType', 'Tag', 'Order', 'Upload', 'StoreTheme', 'StoreThemePublished', 'ThemeSection', 'StorePage', 'StoreMenu', 'CheckoutLineItem', 'QuoteComponent', 'LedgerPosting']
schema with store: ['StoreTheme', 'ThemeSection', 'StorePage', 'StoreMenu', 'StoreThemePublished', 'Product', 'ProductType', 'Tag', 'Upload', 'Collection', 'Order', 'PaymentMethodOffering', 'PaymentAccount', 'PaymentIdempotencyRecord', 'OutboxMessage', 'ConsumedEvent', 'Checkout', 'InventoryReservation', 'PaymentIntent', 'PaymentAttempt', 'Capture', 'CaptureAllocation', 'Refund', 'RefundAllocation', 'Beneficiary', 'LedgerAccount', 'JournalEntry', 'PaymentEvent']
missing: {'Collection'}
['DELIBERATELY_UNSCOPED: readonly { model: string; reason: string }[]']

```

---

## Assistant (Build · Muse Spark 1.2 Contributor · 39.7s)

_Thinking:_



# Tenant-Isolation Audit — READ-ONLY Verification

Verified against workspace `prisma/schema.prisma:1` + `src/common/tenant/*` + `src/prisma/prisma.service.ts:1` + all `src/**/*.service.ts`. No file modified.

## 1) Every tenant-isolation problem still existing

**A. Registry incomplete (P0 holdover)**
* `Collection` has `storeId BigInt` (`schema.prisma:694`) yet absent from `tenant-scoped-models.ts:35-85`. `registry-completeness.spec.ts:17` scans only `^\s*store_id` and therefore silently passes, hiding the gap.

**B. Legacy merchant-console services are completely unguarded (P1-A unimplemented)**
Every read/write on `Product`,`ProductType`,`Tag`,`Order`,`Collection`,`Upload`,`StoreTheme`,`StoreThemePublished`,`ThemeSection`,`StorePage`,`StoreMenu` bypasses `TenantGuard` because they call `this.prisma.<model>` direct (~85 calls). They carry manual `where:{store_id/storeId: X}` but there is **no report-only net** to detect forgotten/typo'd scope or `store_scope_mismatch`. Violations are invisible regardless of `tenantConfig.guardEnabled` (`src/common/config/configuration.ts:54` defaults `true` in dev, `false` in prod).

**C. All `$transaction` on tenant data use unguarded client**
`src/prisma/prisma.service.ts:51-67` exposes `guarded()` as opt-in cache. `Inspector` only runs on `query.$allOperations` of the extended client. Any `this.prisma.$transaction(async tx=>{ tx.<tenantModel>… })` creates a bare `TransactionClient` with **no extension** — every operation inside it is uninspected even if outer call was guarded.

**D. Idempotency / Outbox / Ledger paths mixed**
`IdempotencyService`, `ConsumedEventService`, `OutboxDispatcher`, `LedgerService` touch `PaymentIdempotencyRecord:153`, `ConsumedEvent:30`, `OutboxMessage:247,269,298,308` via bare `prisma` (counts/creates). Sweeps intentionally cross-store but are raw SQL with no `crossStoreQuery` annotation and no guard suppression, so they cannot be distinguished from bugs in grep/`logCrossStoreExceptions`.

**E. Raw SQL completely bypasses guard (legitimate + one oversight)**
`$queryRaw`/`$executeRaw` (`ledger.service.ts:109,130,157,192`, `outbox-dispatcher:142`, `id-reservation:103`, `checkout:1105`, `checkout-finalizer:228`, `payment-fact.applier:667`) is never inspected (`inspector.spec.ts:13` explicitly returns `[]` for `model:undefined`). `LedgerService.findUnbalancedEntries:156-162` is a platform `SELECT ledger_postings GROUP BY` with no store predicate and no `health_check` wrapper.

**F. Guard context still partially empty on storefront**
`TenantContextMiddleware:25-33` opens `storeId:null, mode:live` for every request. `ActiveStoreGuard:61` fills it only for auth'd merchant routes (`X-Store-Id/Slug`). Storefront `CheckoutService.findStore:994` resolves store by `slug` via `guarded().store.findFirst` — but `store` is not registered, so `mode`/`store_id` check does not apply and `CheckoutService.commit:319` opens an unguarded transaction next.

## 2-3) Every file + exact line + exact code change

> Lines from current workspace. `old -> new` is literal replacement.

### 2.3 Registry fix
* `src/common/tenant/tenant-scoped-models.ts:75` after 84
```
// old: last entry { model: 'StoreMenu', storeField: 'store_id', modeField: null }
// new: add
{ model: 'Collection', storeField: 'storeId', modeField: null, storeRelation: 'store' },
```
Add `storeField:'storeId'` — Prisma field is camelCase (`schema.prisma:705`), not `store_id`. Regression test in `registry-completeness.spec.ts:21-35` must also scan `/^\s*storeId\s+/m`.

### 2.4 Legacy services — change to `guarded()` (normal tenant-scoped fixes)
* `src/stores/products/product.service.ts:37,92,93,125,141,142,173,209,365,377,585,590,595,614,706,720,724,732,741,749,753,758,766,771,776,781,786,790,794,799,807,812,817,822,827,831,832` — every `this.prisma.product|productType|tag|productTag|productImage|productOption|productVariant|productCollection|store` on tenant models → `this.prisma.guarded().<model>`. e.g. `this.prisma.product.findFirst:37 -> this.prisma.guarded().product.findFirst` (keep `where:{store_id:storeId}` arg unchanged — guard only reports).

* `src/stores/collections/collections.service.ts:27,32,38,57,109,114,128,154,195,197,201,239,242` → `this.prisma.guarded().collection|productCollection`. Note `storeId` field.

* `src/stores/collections/storefront-collections.service.ts:10,13,41,44` — public storefront reads still need `store_id` from resolved `store.id`. Change to `guarded()` with explicit `where:{storeId:store.id}` (ProductCollection/Collection).

* `src/stores/orders/order.service.ts:34,48,52,135,138,162,163,180,189,194` — `prisma.store` is **not** tenant-scoped (ownerId lookup) stays unguarded; `prisma.order:34,138,162,163,180,189` → `guarded().order`, `prisma.productVariant:52` → `guarded().productVariant.findMany` but add `where:{product:{store_id:store.id}}` already present.

* `src/stores/store.service.ts:35,51,65,123,135,154,176,185,204,214,233,243,258,268,286,313,329,336,350,360,374,382,391,417,424,441,449,458,470,492,534,556,570,626,633,684,706,727,734,745,762,795,805,815,825,841,848,858,894,907,912,931,936,953,963,975,985,999,1009,1032,1038,1048,1072,1089` — all `StoreTheme:626`, `ThemeSection:684,894,907,912`, `StorePage:154,176`, `StoreMenu:286,534`, `MenuItem:382,417,449,458` (via `menu.store_id`) must become `guarded()`. `store:35,51,123,999` (scalar `ownerId`/`slug` lookup) correctly remains unguarded — document as not tenant-scoped.

* `src/uploads/uploads.service.ts:46,89,104,108,120,125` — `store:46` stays unguarded; `upload:89,104,108,120,125` → `guarded().upload` with `where:{key, store_id:storeId}` checks already present.

* `src/uploads/uploads-cleanup.cron.ts:17,25` — `upload.findMany:17` and `delete:25` are `platform_sweep` orphan scan. Must wrap: `crossStoreQuery('platform_sweep','purge orphan uploads',()=>prisma.guarded().upload.findMany…)` else remain flagged.

* `src/common/idempotency/idempotency.service.ts:76,104,127,136,153,232` — `paymentIdempotencyRecord` is tenant-scoped (`store_id,mode`). Change all to `guarded().paymentIdempotencyRecord`.

* `src/common/messaging/consumed-event.service.ts:30,56,62` — `consumedEvent` → `guarded().consumedEvent`.

* `src/common/messaging/outbox-dispatcher.service.ts:247,269,298,308` — `outboxMessage.updateMany/count:247,269,298,308` are scoped writes/counts but called from platform worker with no store context. Keep `platform_sweep` via `crossStoreQuery` (or retain bare + comment). Counts for health (`deadLetterCount:299`, `stalePendingCount:308`) → classify `health_check` if exposed via `/health`.

* `src/stores/active-store.service.ts:38,57,83` — `store` only, not tenant-scoped. **Do not** change; leave as bare `prisma.store.findFirst` (ownerId guard).

* `src/ledger/ledger.service.ts:99,109,130,157,192,211,213` — `ledgerAccount:99,211,213` already `guarded().ledgerAccount.findFirst`; `tx.ledgerAccount:211` inside `post()` runs on passed `tx` (from caller's `guarded().$transaction`). No direct change, but callers must provide guarded tx (see §5). Raw `$queryRaw:109,130,157` stays but add comment `// raw scoped via ledger_account_id — legitimate`.

### 2.5 Transactions `this.prisma.$transaction` → `this.prisma.guarded().$transaction`
Every tx that touches a `TENANT_SCOPED_MODELS` entry:
* `src/stores/products/product.service.ts:239,393,600,628` — contains `tx.product`, `tx.productVariant`, `tx.productImage` (tenant: `Product`)
* `src/stores/orders/order.service.ts:96` — `tx.order`, `tx.productVariant`
* `src/stores/collections/collections.service.ts:157,206` — `tx.collection`,`tx.productCollection` (after adding Collection to registry)
* `src/stores/checkout/checkout.service.ts:319` — `tx.checkout`, `tx.checkoutLineItem`, `tx.inventoryReservation`, `tx.paymentIntent`, `tx.paymentAttempt`
* `src/stores/checkout/checkout-expiry.job.ts:107` — `tx.checkout`, `tx.inventoryReservation`, `tx.paymentIntent`
* `src/stores/payments/payment-collection.service.ts:106` — `tx.order`, `tx.capture`, `tx.captureAllocation`
* `src/stores/payments/payment-account.service.ts:190` — `tx.paymentAccount`, `tx.paymentMethodOffering`
* `src/stores/payments/order-cancellation.service.ts:104` — `tx.order`, `tx.journalEntry` (check file)
* `src/stores/payments/facts/payment-fact.applier.ts:180,408` — `tx.paymentEvent`, `tx.paymentIntent`, `tx.paymentAttempt`, `tx.capture`
* `src/stores/payments/facts/reconciliation.service.ts` — no tx (reads use `crossStoreQuery`)
* `src/ledger/ledger.service.integration.spec.ts:68,88,108,120…` — tests only.

Replace literal `this.prisma.$transaction(` and `prisma.$transaction(` with `this.prisma.guarded().$transaction(` (and `prisma.guarded().$transaction(` in jobs where `this.prisma` injected). Do **not** change `tx.$executeRaw` advisory locks inside — they stay on `tx`.

## 4) Classification per location

* **normal tenant-scoped fixes** — all items in §2.4 except the three classes below. Keep explicit `store_id/storeId` + `mode` in `where`/`data`; guard only warns, never injects.

* **crossStoreQuery(platform_sweep)** — already correct:
  - `reconciliation.service.ts:78` `crossStoreQuery('platform_sweep','find non-terminal intents…', guarded().paymentIntent.findMany)` ✅
  - `checkout-expiry.job.ts:66` same ✅
  Keep. New required:
  - `uploads-cleanup.cron.ts:17` pending sweep → wrap as platform_sweep
  - `outbox-dispatcher.claimBatch:142` raw `FOR UPDATE SKIP LOCKED` sweep → document as `platform_sweep` (raw, legitimate); optional wrap not needed since raw bypasses guard, but add audit comment + `logCrossStoreExceptions(['outbox claimBatch: platform_sweep'])`.

* **crossStoreQuery(provider_lookup)** — already correct:
  - `payment-fact.applier.ts:97` `crossStoreQuery('provider_lookup','resolve the attempt…', guarded().paymentAttempt.findFirst({where:{account_id,gateway_reference}}))` ✅ (store deliberately absent per comment)

* **crossStoreQuery(health_check)** — missing:
  - `ledger.service.ts:156-162` `findUnbalancedEntries()` — `SELECT FROM ledger_postings GROUP BY` with no store predicate. Must be `crossStoreQuery('health_check','find unbalanced postings',()=>prisma.$queryRaw…)` or annotate as legitimate `health_check` and add to `logCrossStoreExceptions`. If exposed via health endpoint, use `health_check`; otherwise `platform_sweep`.

* **crossModeQuery(merchant_dual_mode_view)** — already correct:
  - `payment-account.service.ts:82` `crossModeQuery('merchant_dual_mode_view','settings screen lists both live and test…', guarded().paymentAccount.findMany({where:{store_id:storeId}}))` ✅ (suppresses only `missing_mode_scope`, store still enforced per `guard-crossstore-suppression.spec.ts:116-148`)

Do **not** invent new `CrossStoreReason` / `CrossModeReason` (prompt constraint). Allowed sets remain `{provider_lookup,platform_sweep,health_check}` and `{merchant_dual_mode_view}`.

## 5) Transactions that MUST change

List is §2.5 above. Exact diff per file:

```
- this.prisma.$transaction(async tx=>{
+ this.prisma.guarded().$transaction(async tx=>{
```
For `ProductService, OrderService, CollectionsService, CheckoutService(319), CheckoutExpiryJob(107), PaymentCollectionService(106), PaymentAccountService(190), PaymentFactApplier(180,408), OrderCancellationService(104)`

Inside transactions, do not rename `tx` operations; `tx` inherits guarded extension from parent `guarded().$transaction`.

## 6) Raw SQL — bypasses guard & legitimacy

| location | query | bypasses | legitimate? | action |
|---|---|---|---|---|
| `ledger.service:109` `$queryRaw SELECT direction, SUM… FROM ledger_postings WHERE ledger_account_id=${account.id}` | yes (model undefined) | **yes** — scope derived from `guarded().ledgerAccount` id | keep, add comment |
| `ledger.service:130` `SELECT la.currency… FROM ledger_accounts JOIN ledger_postings WHERE la.store_id=${storeId} AND la.mode::text=${mode}` | yes | **yes** — explicit `store_id,mode` predicate | keep |
| `ledger.service:157` `SELECT entry_id FROM ledger_postings GROUP BY HAVING SUM(debit)<>SUM(credit) LIMIT` | yes | **needs health_check wrapper** | wrap `crossStoreQuery('health_check',…)` or mark platform health check |
| `ledger.service:192` `tx.$executeRaw SELECT pg_advisory_xact_lock…` | yes (void) | **yes** — lock, not tenant data | keep |
| `id-reservation:103` `SELECT nextval(pg_get_serial_sequence…)` | yes | **yes** — sequence, not tenant | keep |
| `outbox-dispatcher:142` `UPDATE outbox_messages … FOR UPDATE SKIP LOCKED RETURNING` | yes | **yes platform_sweep** — sweeps all stores by design | keep + document |
| `checkout.service:1105`, `checkout-finalizer:228` `SELECT id FROM store WHERE id=${storeId} FOR UPDATE` | via `tx.$executeRaw` | **yes** — serialize order_number | keep |
| `payment-fact.applier:667` `pg_advisory_xact_lock(hashtext(lockKey))` | yes | **yes** | keep |

No `$queryRawUnsafe` exists; all use parameterized template literals → no injection risk.

## 7) Tenant-scoped Prisma model missing from registry

* **`Collection`** (`schema.prisma:694` `storeId BigInt @map("storeId")`) — 1 model with store field but not in `TENANT_SCOPED_MODELS:35`. Must add:

```ts
{ model: 'Collection', storeField: 'storeId', modeField: null, storeRelation: 'store' }
```

Coverage: `ProductCollection` is join table without `store_id` — correctly absent (scoped via `Collection`/`Product`). All other 27 `store_id` models are present; `DELIBERATELY_UNSCOPED:92` (CheckoutLineItem, QuoteComponent, LedgerPosting) correctly excluded (no `store_id`).

## 8) Tests that must be added/updated

* **Update `registry-completeness.spec.ts:21`** — expand scan to `/^\s*(store_id|storeId)\s+/m` and assert `Collection` included.

* **Update `tenant-isolation.gap.spec.ts:82-104`** — currently expects `callers:[]` for `guarded()`. After fixes, uncomment and assert `callers.length >= 6` (Product/Order/Collection/Upload/Store/Idempotency) and delete placeholder `has at least one service` stub.

* **New `inspector.spec.ts`** case: relation-nested `Collection` `{store:{id}}` and `storeId` inside `AND` + mismatch detection for `storeId` vs `contextStoreId`.

* **New `guarded-transaction.spec.ts`** — verify `prisma.guarded().$transaction` still invokes `inspectScope` inside `tx.*` (mock extension, throwOnViolation:true, assert violation on missing `store_id` inside tx).

* **New `cross-store` integration**: `uploads-cleanup` sweep suppressed with `platform_sweep`, `ledger.findUnbalancedEntries` suppressed with `health_check` and **not** with `provider_lookup`.

* **Existing `guard-crossstore-suppression.spec.ts:116-148`** already proves `crossModeQuery` never suppresses `missing_store_scope`; keep passing after Collection addition.

* **Existing `checkout.service.spec` / `payment-fact.applier.spec`** — update mocks to expect `guarded().$transaction` timeouts `{timeout:20000,maxWait:10000}` unchanged.

## 9) Safest implementation order

1. **Registry + infra** — add `Collection` in `tenant-scoped-models.ts:85`, fix `registry-completeness.spec` scan. Zero runtime impact (report-only `inspectScope` now includes Collection).
2. **Guard wiring** — ensure `TenantConfig.guardEnabled` stays `false` in prod, `throwOnViolation:false` in prod (prompt). No enforcement yet; keep `buildTenantGuardDefinition:33-46` report-only.
3. **Normal reads/writes (no tx)** — migrate leaf `findMany/count/findFirst` in `ProductService, CollectionsService (read), OrderService.read, StoreService reads, UploadsService reads, IdempotencyService reads` to `guarded()`. Verify logs, no behavior change.
4. **Transactions** — change each `$transaction` to `guarded().$transaction` one file at a time behind same flag, with explicit `store_id,mode` already present; verify `inspectScope` still reports missing scope inside tx in `throwOnViolation` test env.
5. **Platform sweeps** — wrap `UploadsCleanup.findMany` with `crossStoreQuery('platform_sweep',…)` and annotate `OutboxDispatcher.claimBatch`/`Ledger.findUnbalancedEntries` with `health_check`/`platform_sweep` comments + `logCrossStoreExceptions`.
6. **Mode span** — keep `PaymentAccountService.listSettings:82` as sole `merchant_dual_mode_view`; no new `crossModeQuery`.
7. **Tests & CI** — run `jest src/common/tenant` with `TENANT_GUARD_ENABLED=true` to prove no new warnings on happy paths, then merge.

No automatic `store_id` injection, no RLS, no `throwOnViolation` in prod, no new `CrossStoreReason`.

## 10) Final checklist for P1 completion

- [ ] `tenant-scoped-models.ts` includes `Collection` (`storeId`) and `DELIBERATELY_UNSCOPED` unchanged
- [ ] `registry-completeness.spec.ts` scans both `store_id` and `storeId` and passes
- [ ] Every legacy service in §2.4 uses `this.prisma.guarded()` for tenant models; grep `this\.prisma\.<tenantModel>` without `guarded` returns `0` (`rg 'this\.prisma\.(product|collection|order|upload|storeTheme|themeSection|storePage|storeMenu|paymentIdempotencyRecord|consumedEvent|outboxMessage|paymentAccount|paymentMethodOffering|checkout|inventoryReservation|paymentIntent|paymentAttempt|capture|refund|beneficiary|ledgerAccount|journalEntry|paymentEvent)'`)
- [ ] All tx in §2.5 are `guarded().$transaction`
- [ ] `payment-fact.applier:97` remains `provider_lookup`, `reconciliation:78` + `checkout-expiry:66` remain `platform_sweep`
- [ ] `payment-account.service:82` remains `merchant_dual_mode_view`
- [ ] `ledger.findUnbalancedEntries` either wrapped `health_check` or documented as health check
- [ ] `uploads-cleanup.cron:17` wrapped `platform_sweep`
- [ ] Raw `$queryRaw` in `ledger summary/balance` documented as legitimate scoped via `ledger_account_id`/`store_id`
- [ ] `PrismaService.guardedCache:18` still lazy, `enabled` from `tenant.guardEnabled:63` (report-only)
- [ ] No `throwOnViolation` enabled in prod, no RLS enabled
- [ ] No new `CrossStoreReason`/`CrossModeReason` invented
- [ ] `tenant-isolation.gap.spec:82` now asserts guarded callers exist
- [ ] `npm test` (tenant specs) green with `TENANT_GUARD_ENABLED=true`

---

## IMPLEMENTATION DIFF PLAN (exact intended changes, file-by-file)

```
tenant-scoped-models.ts
+ { model: 'Collection', storeField: 'storeId', modeField: null, storeRelation: 'store' },

prisma.service.ts
  (no diff; verify guardedCache unchanged)

common/messaging/idempotency.service.ts:76,104,127,136,153,232
- this.prisma.paymentIdempotencyRecord.create/updateMany/findFirst/deleteMany
+ this.prisma.guarded().paymentIdempotencyRecord.*

common/messaging/consumed-event.service.ts:30,56,62
- this.prisma.consumedEvent.<op>
+ this.prisma.guarded().consumedEvent.<op>

common/messaging/outbox-dispatcher.service.ts:247,269,298,308
- this.prisma.outboxMessage.<op>
+ this.prisma.guarded().outboxMessage.<op>  // OR wrap claimBatch(142) platform_sweep + counts health_check
(add logCrossStoreExceptions in onModuleInit)

ledger/ledger.service.ts:99
- await this.prisma.guarded().ledgerAccount.findFirst  // keep
  $queryRaw:109,130 keep raw (comment legitimate)
:156
- const rows = await this.prisma.$queryRaw<EntryIdRow[]>`...
+ const rows = await crossStoreQuery('health_check','find unbalanced entries',()=>this.prisma.$queryRaw<EntryIdRow[]>`...`)

stores/products/product.service.ts:37,92-93,125,141-142,173,209,239,365,377,393,570,585,590,595,600,614,628,706,720,724,732,741,749,753,758,766,771,776,781,786,790,794,799,807,812,817,822,827,831,832,600,628
- this.prisma.product.<op>  -> this.prisma.guarded().product.<op>
- this.prisma.$transaction -> this.prisma.guarded().$transaction  // :239,393,600,628

stores/collections/collections.service.ts:27,32,38,57,109,114,128,154,157,195,197,201,206,239,242
- this.prisma.collection|productCollection.<op> -> guarded().*
- this.prisma.$transaction(157,206) -> guarded().$transaction

stores/orders/order.service.ts:34,96,138,162-163,180,189,52
- this.prisma.order.<op> -> guarded().order
  tx at :96 -> guarded().$transaction  (store:48,135 stay bare)

stores/store.service.ts:154,176,185,204,214,233,243,258,268,286,313,329,336,350,360,374,382,391,417,424,441,449,458,470,492,534,556,570,626,633,684,706,727,734,745,762,795,805,815,825,841,848,858,894,907,912,931,936,953,963,975,985
- this.prisma.storePage/storeMenu/themeSection/storeTheme/storeThemePublished/menuItem.<op> -> guarded().*  (store:35,51,123,999 bare)

uploads/uploads.service.ts:89,104,108,120,125
- this.prisma.upload.<op> -> guarded().upload

uploads/uploads-cleanup.cron.ts:17
- const orphaned = await this.prisma.upload.findMany({where:{status:'pending'…}})
+ const orphaned = await crossStoreQuery('platform_sweep','purge orphan uploads',()=>this.prisma.guarded().upload.findMany({where:{status:'pending'…}}))

stores/checkout/checkout.service.ts:117,124,222,236,319,567,576,625,631,642,650,700,707,743,753,994,1010,1061,1068
- reads already guarded ✅  keep; :319 $transaction -> guarded().$transaction

stores/checkout/checkout-expiry.job.ts:70,107
  :70 already guarded+crossStoreQuery ✅ keep; :107 -> guarded().$transaction

stores/payments/payment-account.service.ts:86,145,190,230,243,279
  :82 crossModeQuery ✅ keep; :190 $transaction -> guarded().$transaction; reads already guarded

stores/payments/payment-collection.service.ts:50,80,95,106
  reads guarded ✅; :106 -> guarded().$transaction

stores/payments/facts/payment-fact.applier.ts:97,180,408
  :97 provider_lookup ✅; :180,408 -> guarded().$transaction

stores/payments/facts/reconciliation.service.ts:78
  platform_sweep ✅ keep

registry-completeness.spec.ts:21,31
+ /^\s*storeId\s+/m scan + expect Collection registered

tenant-isolation.gap.spec.ts:82-104
  update callers assertion to expect guarded() usages present
```
No `throwOnViolation` in prod, no RLS, no auto `store_id` injection, no architecture change. All guard checks remain warn-only until explicit P2 enforcement.


---

