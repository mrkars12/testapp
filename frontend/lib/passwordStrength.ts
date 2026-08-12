export function validatePassword(
password: string
) {

const checks = {

lowercase:
  /[a-z]/.test(password),

uppercase:
  /[A-Z]/.test(password),

number:
  /[0-9]/.test(password),

special:
  /[^A-Za-z0-9]/.test(password),

length:
  password.length >= 8,

}

const passed =
Object.values(checks)
.filter(Boolean)
.length

return {

checks,

score: passed,

valid:
  passed === 5,

}
}
